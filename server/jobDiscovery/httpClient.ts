import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import {
  DEFAULT_DNS_TIMEOUT_MS,
  type DnsAddressRecord,
  isPublicIpAddress,
} from "../fetchJob.ts";
import { ALLOWED_ATS_HOSTS } from "./registry.ts";
import type {
  DiscoveryHttpGetOptions,
  DiscoveryHttpGetResponse,
  JobDiscoveryDependencies,
} from "./types.ts";
import type { JobDiscoverySourceType } from "../../src/types/career.ts";

export const DEFAULT_DISCOVERY_TIMEOUT_MS = 10_000;
export const DEFAULT_DISCOVERY_MAX_BYTES = 4_000_000;
export const DEFAULT_DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;

export class DiscoverySourceError extends Error {
  statusCode: number;
  code: string;
  rateLimited: boolean;
  retryAfterSeconds: number | null;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    options: { rateLimited?: boolean; retryAfterSeconds?: number | null } = {}
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.rateLimited = Boolean(options.rateLimited);
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export function validateAtsEndpointUrl(
  rawUrl: string,
  source: JobDiscoverySourceType
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new DiscoverySourceError(
      "Rekrytointirajapinnan osoite on virheellinen.",
      400,
      "INVALID_URL"
    );
  }

  if (parsed.protocol !== "https:") {
    throw new DiscoverySourceError(
      "Vain HTTPS-yhteydet sallitaan rekrytointirajapintoihin.",
      400,
      "HTTPS_REQUIRED"
    );
  }

  if (parsed.username || parsed.password || parsed.port !== "") {
    throw new DiscoverySourceError(
      "Rajapintaosoite ei saa sisältää tunnuksia tai mukautettua porttia.",
      400,
      "UNSAFE_URL"
    );
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || net.isIP(host) !== 0) {
    throw new DiscoverySourceError(
      "Suorat IP-osoitteet eivät ole sallittuja rajapintakutsuissa.",
      400,
      "IP_LITERAL_BLOCKED"
    );
  }

  const allowed = ALLOWED_ATS_HOSTS[source];
  if (!allowed || !allowed.has(host)) {
    throw new DiscoverySourceError(
      `Palvelin "${host}" ei kuulu sallittuihin ${source}-rajapintaosoitteisiin.`,
      403,
      "HOST_NOT_ALLOWLISTED"
    );
  }

  return parsed;
}

async function defaultDnsLookup(hostname: string): Promise<DnsAddressRecord[]> {
  return dns.promises.lookup(hostname, { all: true, verbatim: true });
}

async function lookupDnsWithTimeout(
  dnsLookup: (hostname: string) => Promise<DnsAddressRecord[]>,
  hostname: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<DnsAddressRecord[]> {
  if (signal?.aborted) {
    throw new DiscoverySourceError("Haku keskeytettiin.", 499, "ABORTED");
  }

  return new Promise<DnsAddressRecord[]>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DiscoverySourceError("Haku keskeytettiin.", 499, "ABORTED"));
    };
    signal?.addEventListener("abort", onAbort);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new DiscoverySourceError(
          "Rekrytointirajapinnan nimipalveluhaku aikakatkaistiin.",
          504,
          "DNS_TIMEOUT"
        )
      );
    }, timeoutMs);

    dnsLookup(hostname).then(
      (records) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(records);
      },
      () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          new DiscoverySourceError(
            "Rekrytointirajapinnan nimipalveluhaku epäonnistui.",
            502,
            "DNS_FAILED"
          )
        );
      }
    );
  });
}

export async function executePinnedAtsJsonGet(
  options: DiscoveryHttpGetOptions
): Promise<DiscoveryHttpGetResponse> {
  const { url, resolvedIp, resolvedFamily, timeoutMs, maxBytes, signal } =
    options;

  if (signal?.aborted) {
    throw new DiscoverySourceError("Haku keskeytettiin.", 499, "ABORTED");
  }

  return new Promise<DiscoveryHttpGetResponse>((resolve, reject) => {
    let settled = false;
    const finishError = (err: DiscoverySourceError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    };

    const pinnedLookup: net.LookupFunction = (_hostname, lookupOpts, cb) => {
      const wantsAll =
        typeof lookupOpts === "object" &&
        lookupOpts !== null &&
        "all" in lookupOpts &&
        Boolean((lookupOpts as { all?: boolean }).all);
      if (wantsAll) {
        (
          cb as (
            err: NodeJS.ErrnoException | null,
            addresses: dns.LookupAddress[]
          ) => void
        )(null, [{ address: resolvedIp, family: resolvedFamily }]);
      } else {
        (
          cb as (
            err: NodeJS.ErrnoException | null,
            address: string,
            family: number
          ) => void
        )(null, resolvedIp, resolvedFamily);
      }
    };

    const req = https.request(
      {
        protocol: "https:",
        hostname: url.hostname,
        port: options.portOverride ?? 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: url.hostname,
        rejectUnauthorized: true,
        ...(options.caOverride ? { ca: options.caOverride } : {}),
        lookup: pinnedLookup,
        headers: {
          Host: url.hostname,
          "User-Agent": "CareerIntelligenceAgent/0.3 (+job-discovery)",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate, identity",
        },
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        const normalizedHeaders: Record<string, string | string[] | undefined> =
          res.headers;

        if (statusCode >= 300 && statusCode < 400) {
          res.resume();
          finishError(
            new DiscoverySourceError(
              `Rajapinta palautti uudelleenohjauksen (HTTP ${statusCode}), jota ei seurata tietoturvasyistä.`,
              422,
              "REDIRECT_BLOCKED"
            )
          );
          return;
        }

        if (statusCode === 429) {
          res.resume();
          const rawRetry = normalizedHeaders["retry-after"];
          const retryHeader = Array.isArray(rawRetry) ? rawRetry[0] : rawRetry;
          const retryParsed =
            typeof retryHeader === "string" ? Number(retryHeader) : NaN;
          const retryAfterSeconds = Number.isFinite(retryParsed)
            ? retryParsed
            : null;
          finishError(
            new DiscoverySourceError(
              retryAfterSeconds
                ? `Rajapinnan pyyntöraja täyttyi (HTTP 429). Yritä uudelleen ${retryAfterSeconds} s kuluttua.`
                : "Rajapinnan pyyntöraja täyttyi (HTTP 429). Yritä hetken kuluttua uudelleen.",
              429,
              "RATE_LIMITED",
              { rateLimited: true, retryAfterSeconds }
            )
          );
          return;
        }

        if (statusCode === 404) {
          res.resume();
          finishError(
            new DiscoverySourceError(
              "Työnantajan työpaikkasyötettä ei löytynyt tästä osoitteesta (HTTP 404).",
              404,
              "NOT_FOUND"
            )
          );
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.resume();
          finishError(
            new DiscoverySourceError(
              `Rekrytointirajapinta palautti virheen (HTTP ${statusCode}).`,
              502,
              "UPSTREAM_ERROR"
            )
          );
          return;
        }

        const contentLengthHeader = normalizedHeaders["content-length"];
        const declaredLength =
          typeof contentLengthHeader === "string"
            ? Number(contentLengthHeader)
            : NaN;
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          res.destroy();
          finishError(
            new DiscoverySourceError(
              "Rajapintavastauksen koko ylittää sallitun enimmäiskoon.",
              413,
              "PAYLOAD_TOO_LARGE"
            )
          );
          return;
        }

        const rawEncoding = normalizedHeaders["content-encoding"];
        const encoding = (
          Array.isArray(rawEncoding) ? rawEncoding[0] : rawEncoding ?? ""
        )
          .trim()
          .toLowerCase();

        let transformStream: zlib.Gunzip | zlib.Inflate | null = null;
        let stream: NodeJS.ReadableStream = res;
        if (encoding === "gzip") {
          transformStream = zlib.createGunzip();
          stream = res.pipe(transformStream);
        } else if (encoding === "deflate") {
          transformStream = zlib.createInflate();
          stream = res.pipe(transformStream);
        } else if (encoding && encoding !== "identity") {
          res.resume();
          finishError(
            new DiscoverySourceError(
              "Rajapinnan pakkausmuotoa ei tueta.",
              415,
              "UNSUPPORTED_ENCODING"
            )
          );
          return;
        }

        let wireBytes = 0;
        res.on("data", (wireChunk: Buffer) => {
          wireBytes += wireChunk.length;
          if (wireBytes > maxBytes) {
            req.destroy();
            finishError(
              new DiscoverySourceError(
                "Rajapintavastauksen siirtokoko ylittää sallitun enimmäiskoon.",
                413,
                "PAYLOAD_TOO_LARGE"
              )
            );
          }
        });

        const chunks: Buffer[] = [];
        let decodedBytes = 0;

        stream.on("data", (chunk: Buffer) => {
          decodedBytes += chunk.length;
          if (decodedBytes > maxBytes) {
            if (transformStream) {
              res.unpipe(transformStream);
              transformStream.destroy();
            }
            req.destroy();
            finishError(
              new DiscoverySourceError(
                "Rajapintavastauksen purettu koko ylittää sallitun enimmäiskoon.",
                413,
                "PAYLOAD_TOO_LARGE"
              )
            );
            return;
          }
          chunks.push(chunk);
        });

        stream.on("end", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve({
            statusCode,
            headers: normalizedHeaders,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });

        stream.on("error", () => {
          finishError(
            new DiscoverySourceError(
              "Rajapintavastauksen lukeminen epäonnistui.",
              502,
              "STREAM_ERROR"
            )
          );
        });
      }
    );

    const onAbort = () => {
      req.destroy();
      finishError(new DiscoverySourceError("Haku keskeytettiin.", 499, "ABORTED"));
    };
    signal?.addEventListener("abort", onAbort);

    const timer = setTimeout(() => {
      req.destroy();
      finishError(
        new DiscoverySourceError(
          "Yhteys rekrytointirajapintaan aikakatkaistiin.",
          504,
          "TIMEOUT"
        )
      );
    }, timeoutMs);

    req.on("error", () => {
      finishError(
        new DiscoverySourceError(
          "Verkkoyhteys rekrytointirajapintaan epäonnistui.",
          502,
          "NETWORK_ERROR"
        )
      );
    });

    req.end();
  });
}

export async function fetchAtsJson<T = unknown>(
  rawUrl: string,
  source: JobDiscoverySourceType,
  deps: JobDiscoveryDependencies = {}
): Promise<T> {
  const url = validateAtsEndpointUrl(rawUrl, source);
  const dnsLookup = deps.dnsLookup ?? defaultDnsLookup;
  const httpGet = deps.httpGet ?? executePinnedAtsJsonGet;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  const dnsTimeoutMs = Math.min(
    timeoutMs,
    deps.dnsTimeoutMs ?? DEFAULT_DNS_TIMEOUT_MS
  );
  const maxBytes = deps.maxBytes ?? DEFAULT_DISCOVERY_MAX_BYTES;

  const records = await lookupDnsWithTimeout(
    dnsLookup,
    url.hostname,
    dnsTimeoutMs,
    deps.signal
  );

  if (!records || records.length === 0) {
    throw new DiscoverySourceError(
      "Rajapinnalle ei löytynyt julkista IP-osoitetta.",
      502,
      "DNS_EMPTY"
    );
  }

  for (const rec of records) {
    if (!isPublicIpAddress(rec.address)) {
      throw new DiscoverySourceError(
        "Rajapinta osoittaa estettyyn IP-osoitealueeseen.",
        403,
        "PRIVATE_IP_BLOCKED"
      );
    }
  }

  const pinned = records[0];
  const response = await httpGet({
    url,
    resolvedIp: pinned.address,
    resolvedFamily: pinned.family || net.isIP(pinned.address),
    timeoutMs,
    maxBytes,
    signal: deps.signal,
  });

  if (response.statusCode >= 300 && response.statusCode < 400) {
    throw new DiscoverySourceError(
      `Rajapinta palautti uudelleenohjauksen (HTTP ${response.statusCode}).`,
      422,
      "REDIRECT_BLOCKED"
    );
  }

  if (response.statusCode === 429) {
    throw new DiscoverySourceError(
      "Rajapinnan pyyntöraja täyttyi (HTTP 429). Yritä hetken kuluttua uudelleen.",
      429,
      "RATE_LIMITED",
      { rateLimited: true }
    );
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new DiscoverySourceError(
      `Rekrytointirajapinta palautti virheen (HTTP ${response.statusCode}).`,
      502,
      "UPSTREAM_ERROR"
    );
  }

  if (Buffer.byteLength(response.body, "utf8") > maxBytes) {
    throw new DiscoverySourceError(
      "Rajapintavastauksen koko ylittää sallitun enimmäiskoon.",
      413,
      "PAYLOAD_TOO_LARGE"
    );
  }

  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new DiscoverySourceError(
      "Rekrytointirajapinta ei palauttanut kelvollista JSON-dataa.",
      502,
      "INVALID_JSON"
    );
  }
}
