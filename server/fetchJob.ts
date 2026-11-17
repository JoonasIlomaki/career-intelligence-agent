import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import type {
  ExtractedDeadlineCandidate,
  FetchedJobResult,
  JobDeadlineAssessment,
} from "../src/types/career.ts";

export const ALLOWED_JOB_HOSTS = new Set<string>([
  "valtiolle.fi",
  "www.valtiolle.fi",
  "jobly.fi",
  "www.jobly.fi",
  "duunitori.fi",
  "www.duunitori.fi",
  "ats.talentadore.com",
]);

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
export const DEFAULT_DNS_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_FETCH_BYTES = 1_500_000;
const MAX_EXTRACTED_CHARS = 28_000;
const MIN_DESCRIPTION_CHARS = 80;
const MIN_HTML_FALLBACK_CHARS = 120;

export class JobFetchError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface DnsAddressRecord {
  address: string;
  family: number;
}

export interface HttpGetOptions {
  url: URL;
  resolvedIp: string;
  resolvedFamily: number;
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
  /** Optional TLS/port overrides strictly for isolated local test servers; production defaults to port 443 and system CAs with rejectUnauthorized: true. */
  portOverride?: number;
  caOverride?: string | Buffer | Array<string | Buffer>;
}

export interface HttpGetResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface FetchJobDependencies {
  dnsLookup?: (hostname: string) => Promise<DnsAddressRecord[]>;
  httpGet?: (options: HttpGetOptions) => Promise<HttpGetResponse>;
  signal?: AbortSignal;
  timeoutMs?: number;
  dnsTimeoutMs?: number;
  maxBytes?: number;
}

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const num = Number(part);
    if (num < 0 || num > 255) return null;
    value = ((value << 8) | num) >>> 0;
  }
  return value;
}

function isPublicIpv4(ip: string): boolean {
  const num = ipv4ToUint32(ip);
  if (num === null) return false;

  const first = (num >>> 24) & 0xff;
  const second = (num >>> 16) & 0xff;
  const third = (num >>> 8) & 0xff;

  if (first === 0) return false; // 0.0.0.0/8 ("This network", RFC 1122)
  if (first === 10) return false; // 10.0.0.0/8 (Private-Use, RFC 1918)
  if (first === 100 && second >= 64 && second <= 127) return false; // 100.64.0.0/10 (Shared Address Space / CGNAT, RFC 6598)
  if (first === 127) return false; // 127.0.0.0/8 (Loopback, RFC 1122)
  if (first === 169 && second === 254) return false; // 169.254.0.0/16 (Link-Local & cloud metadata, RFC 3927)
  if (first === 172 && second >= 16 && second <= 31) return false; // 172.16.0.0/12 (Private-Use, RFC 1918)
  if (first === 192 && second === 0 && third === 0) return false; // 192.0.0.0/24 (IETF Protocol Assignments, RFC 6890)
  if (first === 192 && second === 0 && third === 2) return false; // 192.0.2.0/24 (TEST-NET-1, RFC 5737)
  if (first === 192 && second === 31 && third === 196) return false; // 192.31.196.0/24 (AS112-v4, RFC 7535)
  if (first === 192 && second === 52 && third === 193) return false; // 192.52.193.0/24 (AMT, RFC 7450)
  if (first === 192 && second === 88 && third === 99) return false; // 192.88.99.0/24 (Deprecated 6to4 Relay Anycast, RFC 7526)
  if (first === 192 && second === 168) return false; // 192.168.0.0/16 (Private-Use, RFC 1918)
  if (first === 192 && second === 175 && third === 48) return false; // 192.175.48.0/24 (Direct Delegation AS112, RFC 7534)
  if (first === 198 && (second === 18 || second === 19)) return false; // 198.18.0.0/15 (Benchmarking, RFC 2544)
  if (first === 198 && second === 51 && third === 100) return false; // 198.51.100.0/24 (TEST-NET-2, RFC 5737)
  if (first === 203 && second === 0 && third === 113) return false; // 203.0.113.0/24 (TEST-NET-3, RFC 5737)
  if (first >= 224) return false; // 224.0.0.0/4 Multicast & 240.0.0.0/4 Reserved / 255.255.255.255 Broadcast

  return true;
}

function expandIpv6(ip: string): number[] | null {
  const clean = ip.split("%")[0].toLowerCase();
  if (!clean) return null;

  // Handle IPv4-embedded suffix (e.g. ::ffff:127.0.0.1)
  let work = clean;
  const lastColon = work.lastIndexOf(":");
  if (lastColon !== -1 && work.slice(lastColon + 1).includes(".")) {
    const ipv4Part = work.slice(lastColon + 1);
    const v4 = ipv4ToUint32(ipv4Part);
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    work = `${work.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const doubleColonParts = work.split("::");
  if (doubleColonParts.length > 2) return null;

  let head: string[] = [];
  let tail: string[] = [];

  if (doubleColonParts.length === 2) {
    head = doubleColonParts[0] ? doubleColonParts[0].split(":") : [];
    tail = doubleColonParts[1] ? doubleColonParts[1].split(":") : [];
    const missing = 8 - (head.length + tail.length);
    if (missing < 1) return null;
    const expanded = [...head, ...Array(missing).fill("0"), ...tail];
    return parseIpv6Hextets(expanded);
  }

  const parts = work.split(":");
  if (parts.length !== 8) return null;
  return parseIpv6Hextets(parts);
}

function parseIpv6Hextets(parts: string[]): number[] | null {
  const result: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
    result.push(parseInt(part, 16));
  }
  return result;
}

function isPublicIpv6(ip: string): boolean {
  const hextets = expandIpv6(ip);
  if (!hextets) return false;

  // Default-deny: only IANA Global Unicast Address space (2000::/3) is eligible.
  // Automatically denies ::/128, ::1/128, ::ffff:0:0/96 (IPv4-mapped), ::/96,
  // 64:ff9b::/96 & 64:ff9b:1::/48 (NAT64), 100::/64 (Discard), fc00::/7 (ULA),
  // fe80::/10 (Link-Local), fec0::/10, ff00::/8 (Multicast), and unassigned space.
  if ((hextets[0] & 0xe000) !== 0x2000) {
    return false;
  }

  // Block IANA special-purpose / non-public sub-ranges inside 2000::/3:
  // - 2001:0000::/23: IETF Protocol Assignments (includes Teredo 2001::/32, Benchmarking 2001:2::/48, ORCHID/v2)
  if (hextets[0] === 0x2001 && hextets[1] <= 0x01ff) {
    return false;
  }
  // - 2001:0db8::/32: Documentation prefix (RFC 3849)
  if (hextets[0] === 0x2001 && hextets[1] === 0x0db8) {
    return false;
  }
  // - 2002::/16: 6to4 IPv4-in-IPv6 transition tunnel (RFC 3056 / RFC 7526)
  if (hextets[0] === 0x2002) {
    return false;
  }
  // - 3fff::/20: Documentation prefix (RFC 9637)
  if (hextets[0] === 0x3fff && (hextets[1] & 0xf000) === 0x0000) {
    return false;
  }

  return true;
}

export function isPublicIpAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPublicIpv4(ip);
  if (version === 6) return isPublicIpv6(ip);
  return false;
}

export function validateFetchJobUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new JobFetchError(
      "Anna työpaikkailmoituksen HTTPS-osoite ennen hakua.",
      400,
      "EMPTY_URL"
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new JobFetchError(
      "URL-osoite ei ole kelvollinen. Tarkista osoitteen muoto.",
      400,
      "INVALID_URL"
    );
  }

  if (parsed.protocol !== "https:") {
    throw new JobFetchError(
      "Vain HTTPS-osoitteet ovat sallittuja ilmoitusten haussa.",
      400,
      "HTTPS_REQUIRED"
    );
  }

  if (parsed.username || parsed.password) {
    throw new JobFetchError(
      "URL-osoite ei saa sisältää käyttäjätunnusta tai salasanaa.",
      400,
      "CREDENTIALS_IN_URL"
    );
  }

  if (parsed.port !== "") {
    throw new JobFetchError(
      "Epätavalliset porttinumerot eivät ole sallittuja URL-osoitteessa.",
      400,
      "CUSTOM_PORT_BLOCKED"
    );
  }

  const normalizedHost = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const unwrappedHost =
    normalizedHost.startsWith("[") && normalizedHost.endsWith("]")
      ? normalizedHost.slice(1, -1)
      : normalizedHost;

  if (!unwrappedHost || net.isIP(unwrappedHost) !== 0) {
    throw new JobFetchError(
      "Suorat IP-osoitteet eivät ole sallittuja. Käytä tuetun työpaikkasivuston verkkotunnusta.",
      400,
      "IP_LITERAL_BLOCKED"
    );
  }

  if (!ALLOWED_JOB_HOSTS.has(unwrappedHost)) {
    throw new JobFetchError(
      `Verkkotunnus "${unwrappedHost}" ei kuulu ensimmäisen version sallittujen työpaikkasivustojen listalle (valtiolle.fi, jobly.fi, duunitori.fi, ats.talentadore.com). Liitä ilmoitusteksti manuaalisesti.`,
      400,
      "HOST_NOT_ALLOWLISTED"
    );
  }

  return parsed;
}

async function defaultDnsLookup(hostname: string): Promise<DnsAddressRecord[]> {
  return dns.promises.lookup(hostname, { all: true, verbatim: true });
}

export async function executePinnedHttpsGet(
  options: HttpGetOptions
): Promise<HttpGetResponse> {
  const { url, resolvedIp, resolvedFamily, timeoutMs, maxBytes, signal } =
    options;

  if (signal?.aborted) {
    throw new JobFetchError("Haku keskeytettiin.", 499, "ABORTED");
  }

  return new Promise<HttpGetResponse>((resolve, reject) => {
    let settled = false;
    const finishError = (err: JobFetchError) => {
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

    const requestOptions: https.RequestOptions = {
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
        "User-Agent": "CareerIntelligenceAgent/1.0 (+https-job-import)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "Accept-Language": "fi-FI,fi;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, identity",
      },
    };

    const req = https.request(
      requestOptions,
      (res) => {
        const statusCode = res.statusCode ?? 0;
        const normalizedHeaders: Record<string, string | string[] | undefined> =
          res.headers;

        // Do not buffer redirects or non-200 bodies unnecessarily
        if (statusCode >= 300 && statusCode < 400) {
          res.resume();
          finishError(
            new JobFetchError(
              `Sivusto palautti uudelleenohjauksen (HTTP ${statusCode}). Automaattisia uudelleenohjauksia ei seurata tietoturvasyistä. Avaa sivu selaimessa ja liitä lopullinen osoite tai ilmoitusteksti.`,
              422,
              "REDIRECT_BLOCKED"
            )
          );
          return;
        }

        if (statusCode === 401 || statusCode === 403) {
          res.resume();
          finishError(
            new JobFetchError(
              "Sivusto esti automaattisen haun tai vaatii kirjautumisen. Liitä työpaikkailmoituksen teksti käsin.",
              403,
              "UPSTREAM_FORBIDDEN"
            )
          );
          return;
        }

        if (statusCode === 404 || statusCode === 410) {
          res.resume();
          finishError(
            new JobFetchError(
              "Ilmoitusta ei löytynyt annetusta osoitteesta (HTTP 404/410). Tarkista osoite tai liitä teksti käsin.",
              404,
              "NOT_FOUND"
            )
          );
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.resume();
          finishError(
            new JobFetchError(
              `Sivusto palautti virhetilan (HTTP ${statusCode}). Liitä ilmoitusteksti käsin.`,
              502,
              "UPSTREAM_ERROR"
            )
          );
          return;
        }

        const rawContentType = normalizedHeaders["content-type"];
        const contentType = Array.isArray(rawContentType)
          ? rawContentType[0] ?? ""
          : rawContentType ?? "";
        const mediaType = contentType.split(";")[0].trim().toLowerCase();
        if (
          mediaType !== "text/html" &&
          mediaType !== "application/xhtml+xml"
        ) {
          res.resume();
          finishError(
            new JobFetchError(
              `Sivun sisältötyyppi (${mediaType || "tuntematon"}) ei ole tuettu HTML-ilmoitus. Liitä ilmoitusteksti käsin.`,
              415,
              "UNSUPPORTED_MEDIA_TYPE"
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
            new JobFetchError(
              `Ilmoitussivun koko ylittää sallitun enimmäiskoon (${Math.round(maxBytes / 1000)} kt).`,
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
          transformStream = zlib.createGunzip({ maxOutputLength: maxBytes + 1 });
          stream = res.pipe(transformStream);
        } else if (encoding === "deflate") {
          transformStream = zlib.createInflate({ maxOutputLength: maxBytes + 1 });
          stream = res.pipe(transformStream);
        } else if (encoding && encoding !== "identity") {
          res.resume();
          finishError(
            new JobFetchError(
              "Sivun pakkausmuotoa ei tueta. Liitä ilmoitusteksti käsin.",
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
              new JobFetchError(
                `Ilmoitussivun koko ylittää sallitun enimmäiskoon (${Math.round(maxBytes / 1000)} kt).`,
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
              new JobFetchError(
                `Ilmoitussivun purettu koko ylittää sallitun enimmäiskoon (${Math.round(maxBytes / 1000)} kt).`,
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

        stream.on("error", (err) => {
          const msg = err instanceof Error ? err.message : "";
          if (msg.includes("maxOutputLength")) {
            finishError(
              new JobFetchError(
                `Ilmoitussivun koko ylittää sallitun enimmäiskoon (${Math.round(maxBytes / 1000)} kt).`,
                413,
                "PAYLOAD_TOO_LARGE"
              )
            );
            return;
          }
          finishError(
            new JobFetchError(
              "Sivun sisällön lukeminen epäonnistui.",
              502,
              "STREAM_ERROR"
            )
          );
        });
      }
    );

    const onAbort = () => {
      req.destroy();
      finishError(new JobFetchError("Haku keskeytettiin.", 499, "ABORTED"));
    };
    signal?.addEventListener("abort", onAbort);

    const timer = setTimeout(() => {
      req.destroy();
      finishError(
        new JobFetchError(
          "Ilmoitussivun nouto aikakatkaistiin. Yritä uudelleen tai liitä teksti käsin.",
          504,
          "TIMEOUT"
        )
      );
    }, timeoutMs);

    req.on("error", () => {
      finishError(
        new JobFetchError(
          "Verkkoyhteys työpaikkasivustolle epäonnistui. Liitä ilmoitusteksti käsin.",
          502,
          "NETWORK_ERROR"
        )
      );
    });

    req.end();
  });
}

export const PARTIAL_JOB_WARNING =
  "Ilmoituksesta saatiin vain osa tiedoista. Tarkista alkuperäinen ilmoitus ja täydennä teksti ennen analysointia.";

export const HTML_UNCERTAIN_WARNING =
  "Ilmoituksesta ei löytynyt rakenteista schema.org/JobPosting-tietoa, joten teksti poimittiin suoraan sivun HTML-sisällöstä. Tarkista ennen analysointia, että kaikki olennaiset tiedot tulivat mukaan eikä mukana ole sivuston ylimääräistä tekstiä.";

export const BODY_ONLY_WARNING =
  "Ilmoituksen rakenteista sisältöaluetta ei pystytty varmistamaan luotettavasti, joten teksti poimittiin yleisestä sivurungosta. Tarkista ennen analysointia, että kaikki osiot tulivat mukaan.";

export const HTML_WITH_STRUCTURED_NOTICE =
  "Ilmoitusteksti koottiin yhdistämällä rakenteiset perustiedot ja sivun varsinainen ilmoitusteksti.";

export const DEADLINE_CONFLICT_WARNING =
  "Hakuaika on ristiriitainen. Tarkista oikea määräaika työnantajan alkuperäisestä ilmoituksesta.";

const MIN_SHORT_COMPLETE_CHARS = 100;

function decodeHtmlEntities(input: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    bull: "•",
    middot: "·",
    hellip: "...",
    euro: "€",
    laquo: "«",
    raquo: "»",
    lsquo: "‘",
    rsquo: "’",
    ldquo: "“",
    rdquo: "”",
    deg: "°",
    times: "×",
    auml: "ä",
    Auml: "Ä",
    ouml: "ö",
    Ouml: "Ö",
    aring: "å",
    Aring: "Å",
  };

  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : full;
    }
    if (entity.startsWith("#")) {
      const code = parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : full;
    }
    return named[entity] ?? full;
  });
}

function isStandaloneUiActionLine(line: string): boolean {
  const stripped = line.replace(/^-\s*/, "").trim();
  if (!stripped) return false;
  return /^(?:(?:skip to main content|siirry suoraan pääsisältöön|siirry suoraan työpaikkahakuun|siirry pääsisältöön|viimeisimmät haut|takaisin hakuun|takaisin hakutuloksiin|selaa työpaikkoja|hae työpaikkaa|hae paikkaa|tallenna työpaikka|lisää suosikiksi|poista suosikeista|suosikki|vahdi vastaavia töitä|avaa google mapsissa|tutustu työnantajaan|jaa tämä ilmoitus|jaa ilmoitus|tulosta ilmoitus|tulosta|näytä kartalla|samankaltaisia työpaikkoja|vastaavat työpaikat|työpaikan tiedot|kirjaudu sisään|rekisteröidy|ei kiitos|sähköpostiosoitteesi|kirjaudu sisään tai luo tili,?\s*jotta voit tallentaa työpaikkailmoituksia suosikkeihisi\.?|haluatko sähköpostiisi ilmoitukset uusista työpaikoista\??)\s*)+$/i.test(
    stripped
  );
}

function htmlFragmentToPlainText(html: string): string {
  let text = html;

  // Strip comments and non-visible / executable tags
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(
    /<(script|style|noscript|template|svg|iframe|object|embed|button)\b[^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );

  // Strip pure inline formatting tags without inserting artificial spaces inside words (e.g. <span>E</span>tsimme)
  text = text.replace(
    /<\/?(span|strong|em|b|i|u|s|mark|small|abbr|code)\b[^>]*>/gi,
    ""
  );

  // Preserve list items, definition lists, tables, and block boundaries
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<li\b[^>]*>/gi, "\n- ");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<\/dt>/gi, ":\n");
  text = text.replace(/::\s*\n/g, ":\n");
  text = text.replace(/<\/dd>/gi, "\n\n");
  text = text.replace(/<\/th>/gi, ": ");
  text = text.replace(/<\/td>/gi, " ");
  text = text.replace(
    /<\/(p|div|section|article|h[1-6]|tr|blockquote|dl|ul|ol|table|figcaption)>/gi,
    "\n\n"
  );
  text = text.replace(
    /<(h[1-6]|p|div|section|article|blockquote|dt|dd|tr)\b[^>]*>/gi,
    "\n"
  );

  // Remove any remaining tags
  text = text.replace(/<[^>]+>/g, " ");

  text = decodeHtmlEntities(text);

  // Normalize lines while preserving bullet structure and paragraph breaks
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((line) => !isStandaloneUiActionLine(line));

  const collapsed: string[] = [];
  let blankStreak = 0;
  for (const line of lines) {
    if (!line) {
      blankStreak++;
      if (blankStreak <= 1 && collapsed.length > 0) {
        collapsed.push("");
      }
      continue;
    }
    blankStreak = 0;
    collapsed.push(line);
  }

  return collapsed.join("\n").trim();
}

function stripTagsByPredicate(
  html: string,
  tagNames: Set<string>,
  attrPredicate?: (attrs: string, innerHtml?: string) => boolean
): string {
  const tagRegex = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g;
  let output = "";
  let lastIndex = 0;
  let skipDepth = 0;
  let skipTag = "";

  for (const match of html.matchAll(tagRegex)) {
    const full = match[0];
    const index = match.index ?? 0;
    const isClosing = full.startsWith("</");
    const isSelfClosing = full.endsWith("/>");
    const tag = match[1].toLowerCase();
    const attrs = match[2] ?? "";

    if (skipDepth > 0) {
      if (tag === skipTag) {
        if (isClosing) {
          skipDepth--;
          if (skipDepth === 0) {
            lastIndex = index + full.length;
          }
        } else if (!isSelfClosing) {
          skipDepth++;
        }
      }
      continue;
    }

    if (!isClosing && !isSelfClosing && tagNames.has(tag)) {
      const shouldSkip = attrPredicate ? attrPredicate(attrs) : true;
      if (shouldSkip) {
        output += html.slice(lastIndex, index);
        skipDepth = 1;
        skipTag = tag;
        lastIndex = index + full.length;
      }
    }
  }

  if (skipDepth === 0) {
    output += html.slice(lastIndex);
  }
  return output;
}

function extractBalancedContainers(
  html: string,
  tagNames: Set<string>,
  attrPredicate: (attrs: string) => boolean
): Array<{ rawHtml: string; plainText: string }> {
  const tagRegex = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g;
  const results: Array<{ rawHtml: string; plainText: string }> = [];
  let depth = 0;
  let activeTag = "";
  let contentStart = -1;

  for (const match of html.matchAll(tagRegex)) {
    const full = match[0];
    const index = match.index ?? 0;
    const isClosing = full.startsWith("</");
    const isSelfClosing = full.endsWith("/>");
    const tag = match[1].toLowerCase();
    const attrs = match[2] ?? "";

    if (depth > 0) {
      if (tag === activeTag) {
        if (isClosing) {
          depth--;
          if (depth === 0) {
            const rawInner = html.slice(contentStart, index);
            const plain = htmlFragmentToPlainText(rawInner);
            if (plain.length > 0) {
              results.push({ rawHtml: rawInner, plainText: plain });
            }
          }
        } else if (!isSelfClosing) {
          depth++;
        }
      }
      continue;
    }

    if (!isClosing && !isSelfClosing && tagNames.has(tag) && attrPredicate(attrs)) {
      depth = 1;
      activeTag = tag;
      contentStart = index + full.length;
    }
  }

  return results;
}

function extractLargestContainer(
  html: string,
  tagName: "main" | "article"
): { rawHtml: string; plainText: string } | null {
  const containers = extractBalancedContainers(
    html,
    new Set([tagName]),
    () => true
  );
  let best: { rawHtml: string; plainText: string } | null = null;
  for (const c of containers) {
    if (!best || c.plainText.length > best.plainText.length) {
      best = c;
    }
  }
  return best;
}

function extractLargestContainerByAttr(
  html: string,
  attrPattern: RegExp
): { rawHtml: string; plainText: string } | null {
  const containers = extractBalancedContainers(
    html,
    new Set(["div", "section", "article", "main"]),
    (attrs) => attrPattern.test(attrs)
  );
  let best: { rawHtml: string; plainText: string } | null = null;
  for (const c of containers) {
    if (!best || c.plainText.length > best.plainText.length) {
      best = c;
    }
  }
  return best;
}

function hasJobPostingType(typeValue: unknown): boolean {
  if (typeof typeValue === "string") {
    return (
      typeValue === "JobPosting" ||
      typeValue.endsWith("/JobPosting") ||
      typeValue.endsWith(":JobPosting")
    );
  }
  if (Array.isArray(typeValue)) {
    return typeValue.some((entry) => hasJobPostingType(entry));
  }
  return false;
}

function findJobPostingNodes(
  node: unknown,
  out: Array<Record<string, unknown>>
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) {
      findJobPostingNodes(item, out);
    }
    return;
  }

  const record = node as Record<string, unknown>;
  if (hasJobPostingType(record["@type"])) {
    out.push(record);
  }

  if (Array.isArray(record["@graph"])) {
    findJobPostingNodes(record["@graph"], out);
  }
}

function extractOrganizationName(org: unknown): string | null {
  if (typeof org === "string" && org.trim()) {
    return decodeHtmlEntities(org.trim());
  }
  if (Array.isArray(org) && org.length > 0) {
    return extractOrganizationName(org[0]);
  }
  if (org && typeof org === "object") {
    const name = (org as Record<string, unknown>).name;
    if (typeof name === "string" && name.trim()) {
      return decodeHtmlEntities(name.trim());
    }
  }
  return null;
}

function extractJobLocationText(loc: unknown): string | null {
  if (typeof loc === "string" && loc.trim()) {
    return decodeHtmlEntities(loc.trim());
  }
  if (Array.isArray(loc)) {
    const parts = loc
      .map((item) => extractJobLocationText(item))
      .filter((v): v is string => Boolean(v));
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (loc && typeof loc === "object") {
    const obj = loc as Record<string, unknown>;
    if (obj.address && typeof obj.address === "object") {
      const addr = obj.address as Record<string, unknown>;
      const parts = [
        addr.addressLocality,
        addr.addressRegion,
        addr.addressCountry,
      ].filter(
        (v): v is string => typeof v === "string" && v.trim().length > 0
      );
      if (parts.length > 0) return decodeHtmlEntities(parts.join(", "));
    }
    if (typeof obj.name === "string" && obj.name.trim()) {
      return decodeHtmlEntities(obj.name.trim());
    }
  }
  return null;
}

function hasSalaryDigits(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return `${value}`;
  }
  if (typeof value === "string") {
    const trimmed = decodeHtmlEntities(value.trim());
    if (trimmed && /\d/.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

function formatSalaryUnit(unitRaw: unknown): string {
  if (typeof unitRaw !== "string") return "";
  const u = unitRaw.trim().toUpperCase();
  if (!u) return "";
  if (u === "MONTH" || u === "MONTHLY") return " / kk";
  if (u === "HOUR" || u === "HOURLY") return " / h";
  if (u === "YEAR" || u === "YEARLY") return " / vuosi";
  if (u === "WEEK" || u === "WEEKLY") return " / vko";
  if (u === "DAY" || u === "DAILY") return " / pv";
  return ` / ${unitRaw.trim()}`;
}

function extractSalaryText(baseSalary: unknown): string | null {
  if (typeof baseSalary === "string") {
    return hasSalaryDigits(baseSalary);
  }
  if (typeof baseSalary === "number") {
    return hasSalaryDigits(baseSalary);
  }
  if (baseSalary && typeof baseSalary === "object") {
    const obj = baseSalary as Record<string, unknown>;
    const currency =
      typeof obj.currency === "string" ? obj.currency.trim() : "";
    const innerValue = obj.value;

    const directValue = hasSalaryDigits(innerValue);
    if (directValue) {
      if (!currency || /€|eur|usd|\$/i.test(directValue)) return directValue;
      return `${directValue} ${currency}`;
    }

    if (innerValue && typeof innerValue === "object") {
      const q = innerValue as Record<string, unknown>;
      const min = hasSalaryDigits(q.minValue);
      const max = hasSalaryDigits(q.maxValue);
      const val = hasSalaryDigits(q.value);
      const unit = formatSalaryUnit(q.unitText);

      if (min && max) {
        return `${min} - ${max}${currency ? ` ${currency}` : ""}${unit}`;
      }
      if (min) {
        return `alk. ${min}${currency ? ` ${currency}` : ""}${unit}`;
      }
      if (max) {
        return `enint. ${max}${currency ? ` ${currency}` : ""}${unit}`;
      }
      if (val) {
        return `${val}${currency ? ` ${currency}` : ""}${unit}`;
      }
    }
  }
  return null;
}

const EMPLOYMENT_TYPE_FINNISH_MAP: Record<string, string> = {
  FULL_TIME: "Kokoaikainen",
  FULLTIME: "Kokoaikainen",
  PART_TIME: "Osa-aikainen",
  PARTTIME: "Osa-aikainen",
  CONTRACTOR: "Määräaikainen / sopimus",
  CONTRACT: "Määräaikainen / sopimus",
  TEMPORARY: "Määräaikainen",
  INTERN: "Harjoittelu",
  INTERNSHIP: "Harjoittelu",
  VOLUNTEER: "Vapaaehtoistyö",
  PER_DIEM: "Päiväkohtainen",
  OTHER: "Muu",
};

function normalizeEmploymentTypes(raw: unknown): string | null {
  const rawItems: string[] = [];
  if (typeof raw === "string") {
    rawItems.push(...raw.split(","));
  } else if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === "string") {
        rawItems.push(...entry.split(","));
      }
    }
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const item of rawItems) {
    const decoded = decodeHtmlEntities(item).trim();
    if (!decoded) continue;
    if (/^kaikki työpaikat$/i.test(decoded)) continue;

    const codeKey = decoded.toUpperCase().replace(/[\s-]+/g, "_");
    const mapped = EMPLOYMENT_TYPE_FINNISH_MAP[codeKey] ?? decoded;
    const dedupKey = mapped.toLowerCase();
    if (!seen.has(dedupKey)) {
      seen.add(dedupKey);
      normalized.push(mapped);
    }
  }

  return normalized.length > 0 ? normalized.join(", ") : null;
}

function formatDeadlineForDisplay(rawDeadline: string | null): string | null {
  if (!rawDeadline) return null;
  const trimmed = rawDeadline.trim();
  if (!trimmed) return null;

  // Date-only ISO: YYYY-MM-DD
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const day = Number(dateOnly[3]);
    const month = Number(dateOnly[2]);
    const year = dateOnly[1];
    return `${day}.${month}.${year}`;
  }

  // Datetime ISO with optional timezone offset: YYYY-MM-DDTHH:mm(:ss)?(Z|+HH:MM|-HH:MM)?
  const dateTimeMatch =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      trimmed
    );
  if (dateTimeMatch) {
    const day = Number(dateTimeMatch[3]);
    const month = Number(dateTimeMatch[2]);
    const year = dateTimeMatch[1];
    const hour = dateTimeMatch[4];
    const minute = dateTimeMatch[5];
    const tzRaw = dateTimeMatch[6];

    let tzLabel = "";
    if (tzRaw) {
      if (/^z$/i.test(tzRaw) || /^[+-]00:?00$/.test(tzRaw)) {
        tzLabel = " (UTC)";
      } else {
        const tzParts = /^([+-])(\d{2}):?(\d{2})$/.exec(tzRaw);
        if (tzParts) {
          const sign = tzParts[1];
          const tzHour = Number(tzParts[2]);
          const tzMin = Number(tzParts[3]);
          tzLabel =
            tzMin > 0
              ? ` (UTC${sign}${tzHour}:${tzParts[3]})`
              : ` (UTC${sign}${tzHour})`;
        }
      }
    }

    return `${day}.${month}.${year} klo ${hour}:${minute}${tzLabel}`;
  }

  return trimmed;
}

interface ParsedStructuredDeadlineInfo {
  rawValue: string;
  displayValue: string;
  offsetDate: string | null;
  offsetMinutes: number | null;
  offsetMonthDay: string | null;
  helsinkiDate: string | null;
  helsinkiMinutes: number | null;
  helsinkiMonthDay: string | null;
  utcEpochMs: number | null;
  isUtc: boolean;
  isDateOnly: boolean;
}

interface ParsedBodyDeadlineHit {
  candidate: ExtractedDeadlineCandidate;
  isoDate: string | null;
  monthDay: string | null;
  timeMinutes: number | null;
}

export function toValidIsoDate(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getTimeZoneDateParts(
  epochMs: number,
  timeZone: string
): { isoDate: string; minutes: number; monthDay: string } | null {
  if (!Number.isFinite(epochMs)) return null;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(epochMs));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") {
      map[p.type] = p.value;
    }
  }
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  let hour = Number(map.hour);
  const minute = Number(map.minute);
  if (hour === 24) hour = 0;
  const isoDate = toValidIsoDate(year, month, day);
  if (!isoDate || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return {
    isoDate,
    minutes: hour * 60 + minute,
    monthDay: `${month}-${day}`,
  };
}

export function helsinkiLocalDateTimeToEpochMs(
  isoDate: string,
  hour: number,
  minute: number
): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Initial guess in UTC+2, refined via actual Europe/Helsinki Intl offset
  const baseUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guessMs = baseUtcMs - 2 * 60 * 60 * 1000;
  for (let i = 0; i < 2; i++) {
    const rendered = getTimeZoneDateParts(guessMs, "Europe/Helsinki");
    if (!rendered) return null;
    const rm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rendered.isoDate);
    if (!rm) return null;
    const rHour = Math.floor(rendered.minutes / 60);
    const rMin = rendered.minutes % 60;
    const renderedUtcMs = Date.UTC(
      Number(rm[1]),
      Number(rm[2]) - 1,
      Number(rm[3]),
      rHour,
      rMin,
      0,
      0
    );
    const delta = baseUtcMs - renderedUtcMs;
    if (delta === 0) break;
    guessMs += delta;
  }
  return guessMs;
}

function parseStructuredDeadlineInfo(
  rawDeadline: string | null
): ParsedStructuredDeadlineInfo | null {
  if (!rawDeadline) return null;
  const trimmed = rawDeadline.trim();
  if (!trimmed) return null;

  const displayValue = formatDeadlineForDisplay(trimmed) ?? trimmed;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const isoDate = toValidIsoDate(year, month, day);
    if (!isoDate) return null;
    const monthDay = `${month}-${day}`;
    return {
      rawValue: trimmed,
      displayValue,
      offsetDate: isoDate,
      offsetMinutes: null,
      offsetMonthDay: monthDay,
      helsinkiDate: isoDate,
      helsinkiMinutes: null,
      helsinkiMonthDay: monthDay,
      utcEpochMs: null,
      isUtc: false,
      isDateOnly: true,
    };
  }

  const dateTimeMatch =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      trimmed
    );
  if (dateTimeMatch) {
    const year = Number(dateTimeMatch[1]);
    const month = Number(dateTimeMatch[2]);
    const day = Number(dateTimeMatch[3]);
    const hour = Number(dateTimeMatch[4]);
    const minute = Number(dateTimeMatch[5]);
    const second = Number(dateTimeMatch[6] ?? "0");
    const tzRaw = dateTimeMatch[7] ?? "";

    const offsetDate = toValidIsoDate(year, month, day);
    if (!offsetDate || hour > 23 || minute > 59 || second > 59) return null;
    const offsetMinutes = hour * 60 + minute;
    const offsetMonthDay = `${month}-${day}`;

    if (tzRaw) {
      const normalizedTz = /^z$/i.test(tzRaw)
        ? "Z"
        : /^([+-])(\d{2})(\d{2})$/.test(tzRaw)
        ? tzRaw.replace(/^([+-])(\d{2})(\d{2})$/, "$1$2:$3")
        : tzRaw;
      const isoFull = `${offsetDate}T${dateTimeMatch[4]}:${dateTimeMatch[5]}:${String(
        second
      ).padStart(2, "0")}${normalizedTz}`;
      const epochMs = Date.parse(isoFull);
      const isUtc =
        /^z$/i.test(normalizedTz) || /^[+-]00:00$/.test(normalizedTz);
      const helsinki = Number.isFinite(epochMs)
        ? getTimeZoneDateParts(epochMs, "Europe/Helsinki")
        : null;
      return {
        rawValue: trimmed,
        displayValue,
        offsetDate,
        offsetMinutes,
        offsetMonthDay,
        helsinkiDate: helsinki?.isoDate ?? offsetDate,
        helsinkiMinutes: helsinki?.minutes ?? offsetMinutes,
        helsinkiMonthDay: helsinki?.monthDay ?? offsetMonthDay,
        utcEpochMs: Number.isFinite(epochMs) ? epochMs : null,
        isUtc,
        isDateOnly: false,
      };
    }

    return {
      rawValue: trimmed,
      displayValue,
      offsetDate,
      offsetMinutes,
      offsetMonthDay,
      helsinkiDate: offsetDate,
      helsinkiMinutes: offsetMinutes,
      helsinkiMonthDay: offsetMonthDay,
      utcEpochMs: helsinkiLocalDateTimeToEpochMs(offsetDate, hour, minute),
      isUtc: false,
      isDateOnly: false,
    };
  }

  return {
    rawValue: trimmed,
    displayValue,
    offsetDate: null,
    offsetMinutes: null,
    offsetMonthDay: null,
    helsinkiDate: null,
    helsinkiMinutes: null,
    helsinkiMonthDay: null,
    utcEpochMs: null,
    isUtc: false,
    isDateOnly: false,
  };
}

function extractSentenceExcerpt(text: string, index: number, matchLen: number): string {
  const before = text.slice(Math.max(0, index - 120), index);
  const after = text.slice(index + matchLen, Math.min(text.length, index + matchLen + 120));
  const lastBreak = Math.max(before.lastIndexOf("\n"), before.lastIndexOf(". "));
  const startOffset =
    lastBreak === -1
      ? Math.max(0, index - before.length)
      : Math.max(0, index - before.length + lastBreak + 1);
  const nextNewline = after.indexOf("\n");
  const nextPeriod = after.indexOf(". ");
  let endRel = after.length;
  if (nextNewline !== -1) endRel = Math.min(endRel, nextNewline);
  if (nextPeriod !== -1) endRel = Math.min(endRel, nextPeriod + 1);
  const raw = text.slice(startOffset, index + matchLen + endRel).replace(/\s+/g, " ").trim();
  return raw.length > 180 ? `${raw.slice(0, 177).trimEnd()}...` : raw;
}

function extractBodyDeadlinesFromTexts(texts: string[]): {
  fullHits: ParsedBodyDeadlineHit[];
  yearlessHits: ParsedBodyDeadlineHit[];
} {
  const fullHits: ParsedBodyDeadlineHit[] = [];
  const yearlessHits: ParsedBodyDeadlineHit[] = [];
  const seenFullKeys = new Set<string>();
  const seenYearlessKeys = new Set<string>();

  const addFullHit = (
    isoDate: string,
    displayBase: string,
    rawValue: string,
    hourStr: string | undefined,
    minStr: string | undefined,
    excerpt: string
  ) => {
    let timeMinutes: number | null = null;
    let display = displayBase;
    if (hourStr !== undefined && minStr !== undefined) {
      const h = Number(hourStr);
      const m = Number(minStr);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        timeMinutes = h * 60 + m;
        display = `${displayBase} klo ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      }
    }
    const key = `${isoDate}|${timeMinutes ?? ""}`;
    if (seenFullKeys.has(key)) return;
    seenFullKeys.add(key);
    fullHits.push({
      isoDate,
      monthDay: `${Number(isoDate.slice(5, 7))}-${Number(isoDate.slice(8, 10))}`,
      timeMinutes,
      candidate: {
        value: display,
        rawValue,
        isoDate,
        source: "body_text",
        sourceLabel: "Ilmoitusteksti",
        excerpt,
      },
    });
  };

  for (const rawText of texts) {
    if (!rawText) continue;
    const text = rawText.trim();
    if (!text) continue;

    // 1. Prefix keyword + Finnish date (d.M.yyyy + optional klo HH:mm)
    const fiPrefixRegex =
      /(?:hakuaika\s+(?:päättyy|on(?:\s+avoinna)?)|haku\s+päättyy|viimeinen\s+hakupäivä(?:\s+on)?|hakemukse\w*\b[^.\n]{0,60}?\bviimeistään|jätä\s+(?:hakemukse\w*|yhteystietosi)\b[^.\n]{0,60}?\bviimeistään|lähetä\s+hakemukse\w*\b[^.\n]{0,60}?\bviimeistään|hae\b[^.\n]{0,60}?\bviimeistään|viimeistään(?:\s+päivänä)?|päättyy|application\s+deadline|closing\s+date|apply\s+(?:by|before|until|no\s+later\s+than))\s*:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s*(?:klo|kello)?\s*(\d{1,2})[:.](\d{2}))?/gi;

    for (const match of text.matchAll(fiPrefixRegex)) {
      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = Number(match[3]);
      const isoDate = toValidIsoDate(year, month, day);
      if (!isoDate) continue;
      const excerpt = extractSentenceExcerpt(text, match.index ?? 0, match[0].length);
      addFullHit(
        isoDate,
        `${day}.${month}.${year}`,
        `${day}.${month}.${year}`,
        match[4],
        match[5],
        excerpt
      );
    }

    // 2. Prefix keyword + ISO date (yyyy-mm-dd)
    const isoPrefixRegex =
      /(?:hakuaika\s+(?:päättyy|on)|haku\s+päättyy|viimeinen\s+hakupäivä(?:\s+on)?|application\s+deadline|closing\s+date|apply\s+(?:by|before|until|no\s+later\s+than)|deadline)\s*:?\s*(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2}))?/gi;

    for (const match of text.matchAll(isoPrefixRegex)) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const isoDate = toValidIsoDate(year, month, day);
      if (!isoDate) continue;
      const excerpt = extractSentenceExcerpt(text, match.index ?? 0, match[0].length);
      addFullHit(
        isoDate,
        `${day}.${month}.${year}`,
        isoDate,
        match[4],
        match[5],
        excerpt
      );
    }

    // 3. Recruitment clause + Finnish date + suffix ("mennessä" / "asti" / "saakka")
    const fiSuffixRegex =
      /(?:hakuaika|haku|hae|hakemuk\w*|yhteystie\w*|lähetä|jätä)[^.\n]{0,60}?(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s*(?:klo|kello)?\s*(\d{1,2})[:.](\d{2}))?\s*(?:mennessä|asti|saakka)\b/gi;

    for (const match of text.matchAll(fiSuffixRegex)) {
      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = Number(match[3]);
      const isoDate = toValidIsoDate(year, month, day);
      if (!isoDate) continue;
      const excerpt = extractSentenceExcerpt(text, match.index ?? 0, match[0].length);
      addFullHit(
        isoDate,
        `${day}.${month}.${year}`,
        `${day}.${month}.${year}`,
        match[4],
        match[5],
        excerpt
      );
    }

    // 4. Yearless explicit deadline phrase (e.g. "Hakuaika päättyy 22.11." or "(Päättyy 22.11.)")
    const fiYearlessRegex =
      /(?:hakuaika\s+päättyy|haku\s+päättyy|viimeinen\s+hakupäivä(?:\s+on)?|\bpäättyy)\s*:?\s*(\d{1,2})\.(\d{1,2})\.(?!\d)/gi;

    for (const match of text.matchAll(fiYearlessRegex)) {
      const day = Number(match[1]);
      const month = Number(match[2]);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      const monthDay = `${month}-${day}`;
      if (seenYearlessKeys.has(monthDay)) continue;
      seenYearlessKeys.add(monthDay);
      const excerpt = extractSentenceExcerpt(text, match.index ?? 0, match[0].length);
      yearlessHits.push({
        isoDate: null,
        monthDay,
        timeMinutes: null,
        candidate: {
          value: `${day}.${month}.`,
          rawValue: `${day}.${month}.`,
          isoDate: null,
          source: "body_text",
          sourceLabel: "Ilmoitusteksti",
          excerpt,
        },
      });
    }
  }

  return { fullHits, yearlessHits };
}

function doStructuredAndBodyDeadlinesMatch(
  structured: ParsedStructuredDeadlineInfo,
  body: ParsedBodyDeadlineHit
): boolean {
  if (!body.isoDate) {
    if (!body.monthDay) return true;
    return (
      body.monthDay === structured.offsetMonthDay ||
      body.monthDay === structured.helsinkiMonthDay
    );
  }

  // If both provide explicit HH:mm times, compare exact calendar date and HH:mm minute
  // in Europe/Helsinki without any minute or second tolerance across minute boundaries.
  if (
    body.timeMinutes !== null &&
    !structured.isDateOnly &&
    structured.helsinkiDate !== null &&
    structured.helsinkiMinutes !== null
  ) {
    return (
      body.isoDate === structured.helsinkiDate &&
      body.timeMinutes === structured.helsinkiMinutes
    );
  }

  // Date-only comparison (supports explicit offset date and Europe/Helsinki conversion of UTC timestamps)
  if (body.isoDate === structured.helsinkiDate) {
    return true;
  }
  if (
    structured.offsetDate &&
    body.isoDate === structured.offsetDate &&
    structured.isUtc
  ) {
    return true;
  }

  return false;
}

function assessJobDeadlines(
  rawStructuredDeadline: string | null,
  rawBodyTexts: string[]
): {
  assessment: JobDeadlineAssessment;
  resolvedSingleDeadline: string | null;
} {
  const structuredParsed = parseStructuredDeadlineInfo(rawStructuredDeadline);
  const structuredCandidate: ExtractedDeadlineCandidate | null = structuredParsed
    ? {
        value: structuredParsed.displayValue,
        rawValue: structuredParsed.rawValue,
        isoDate: structuredParsed.helsinkiDate ?? structuredParsed.offsetDate,
        source: "structured_jsonld",
        sourceLabel: "schema.org/JobPosting (validThrough)",
        excerpt: null,
      }
    : null;

  const { fullHits, yearlessHits } = extractBodyDeadlinesFromTexts(rawBodyTexts);

  // Deduplicate distinct calendar dates and check for conflicting explicit times on the same date
  const uniqueBodyByIso = new Map<string, ParsedBodyDeadlineHit>();
  let internalTimeConflict: [ParsedBodyDeadlineHit, ParsedBodyDeadlineHit] | null =
    null;

  for (const hit of fullHits) {
    if (!hit.isoDate) continue;
    const existing = uniqueBodyByIso.get(hit.isoDate);
    if (!existing) {
      uniqueBodyByIso.set(hit.isoDate, hit);
      continue;
    }
    if (existing.timeMinutes === null && hit.timeMinutes !== null) {
      uniqueBodyByIso.set(hit.isoDate, hit);
    } else if (
      existing.timeMinutes !== null &&
      hit.timeMinutes !== null &&
      existing.timeMinutes !== hit.timeMinutes &&
      !internalTimeConflict
    ) {
      internalTimeConflict = [existing, hit];
    }
  }
  const distinctFullBody = [...uniqueBodyByIso.values()];

  const primaryBodyHit: ParsedBodyDeadlineHit | null =
    distinctFullBody[0] ??
    (structuredParsed ? yearlessHits[0] ?? null : null);

  // Case 1: Body text itself contains conflicting dates or conflicting explicit times
  if (distinctFullBody.length > 1 || internalTimeConflict) {
    const [firstHit, secondHit] = internalTimeConflict ?? [
      distinctFullBody[0],
      distinctFullBody[1],
    ];
    return {
      assessment: {
        status: "conflict",
        hasConflict: true,
        isConfirmed: false,
        structuredDeadline: structuredCandidate ?? firstHit.candidate,
        bodyDeadline: structuredCandidate
          ? firstHit.candidate
          : secondHit.candidate,
        conflictWarning: DEADLINE_CONFLICT_WARNING,
      },
      resolvedSingleDeadline: null,
    };
  }

  // Case 2: Both structured validThrough and body deadline exist
  if (structuredParsed && structuredCandidate && primaryBodyHit) {
    const matches = doStructuredAndBodyDeadlinesMatch(
      structuredParsed,
      primaryBodyHit
    );
    if (!matches) {
      return {
        assessment: {
          status: "conflict",
          hasConflict: true,
          isConfirmed: false,
          structuredDeadline: structuredCandidate,
          bodyDeadline: primaryBodyHit.candidate,
          conflictWarning: DEADLINE_CONFLICT_WARNING,
        },
        resolvedSingleDeadline: null,
      };
    }

    return {
      assessment: {
        status: "consistent",
        hasConflict: false,
        isConfirmed: false,
        structuredDeadline: structuredCandidate,
        bodyDeadline: primaryBodyHit.candidate,
        conflictWarning: null,
      },
      resolvedSingleDeadline: structuredParsed.rawValue,
    };
  }

  // Case 3: Only structured deadline exists
  if (structuredParsed && structuredCandidate) {
    return {
      assessment: {
        status: "structured_only",
        hasConflict: false,
        isConfirmed: false,
        structuredDeadline: structuredCandidate,
        bodyDeadline: null,
        conflictWarning: null,
      },
      resolvedSingleDeadline: structuredParsed.rawValue,
    };
  }

  // Case 4: Only body deadline exists
  if (distinctFullBody.length === 1) {
    const bodyOnly = distinctFullBody[0];
    return {
      assessment: {
        status: "body_only",
        hasConflict: false,
        isConfirmed: false,
        structuredDeadline: null,
        bodyDeadline: bodyOnly.candidate,
        conflictWarning: null,
      },
      resolvedSingleDeadline: bodyOnly.isoDate ?? bodyOnly.candidate.rawValue,
    };
  }

  // Case 5: No deadline detected
  return {
    assessment: {
      status: "missing",
      hasConflict: false,
      isConfirmed: false,
      structuredDeadline: null,
      bodyDeadline: null,
      conflictWarning: null,
    },
    resolvedSingleDeadline: null,
  };
}

function isGenericRoleTitle(title: string): boolean {
  const norm = title.trim().toLowerCase();
  if (!norm) return true;
  if (
    /^(harjoittelija|trainee|intern|kesätyöntekijä|työntekijä|asiantuntija|suunnittelija|kehittäjä|developer|analyst|consultant|specialist|korkeakouluharjoittelija)$/.test(
      norm
    )
  ) {
    return true;
  }
  // All-lowercase single word or hyphenated slug (e.g. "data-analyst")
  if (title === norm && !/\s/.test(norm)) {
    return true;
  }
  return false;
}

function selectBestJobTitle(
  structuredTitle: string | null,
  headingTitle: string | null
): string | null {
  const cleanHeading = headingTitle ? headingTitle.trim() : null;
  const cleanStructured = structuredTitle ? structuredTitle.trim() : null;

  const validHeading =
    cleanHeading &&
    !/^(työpaikat|avoimet työpaikat|työpaikkailmoitus|haku|etusivu|ladataan)$/i.test(
      cleanHeading
    )
      ? cleanHeading
      : null;

  if (!cleanStructured) return validHeading;
  if (!validHeading) return cleanStructured;

  const normStruct = normalizeForComparison(cleanStructured);
  const normHead = normalizeForComparison(validHeading);
  if (normStruct === normHead) {
    return validHeading.length >= cleanStructured.length
      ? validHeading
      : cleanStructured;
  }

  // Prefer detailed H1 heading when structured title is generic or a short substring/category
  if (isGenericRoleTitle(cleanStructured) && validHeading.length > cleanStructured.length) {
    return validHeading;
  }

  if (
    normHead.includes(normStruct) &&
    validHeading.length >= cleanStructured.length + 6
  ) {
    return validHeading;
  }

  return cleanStructured;
}

function extractSchemaTextField(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return htmlFragmentToPlainText(value.trim());
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => extractSchemaTextField(entry))
      .filter((v): v is string => Boolean(v));
    return parts.length > 0 ? parts.join("\n- ") : null;
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const key of [
      "name",
      "description",
      "credentialCategory",
      "educationalLevel",
    ]) {
      if (typeof rec[key] === "string" && rec[key].trim()) {
        return htmlFragmentToPlainText(rec[key].trim());
      }
    }
  }
  return null;
}

function detectBlockedOrJsShell(
  rawHtml: string,
  visibleText: string
): string | null {
  const lowerVisible = visibleText.toLowerCase();
  const lowerRaw = rawHtml.toLowerCase();

  if (
    lowerVisible.includes("please enable javascript") ||
    lowerVisible.includes("enable javascript") ||
    lowerVisible.includes("javascript is required") ||
    lowerVisible.includes("you need to enable javascript") ||
    lowerVisible.includes("selaimesi ei tue javascriptia")
  ) {
    return "Sivusto vaatii JavaScript-suorituksen eikä palauttanut varsinaista ilmoitustekstiä. Avaa sivu selaimessa ja liitä ilmoitusteksti käsin.";
  }

  if (
    lowerVisible.includes("checking your browser") ||
    lowerVisible.includes("verify you are human") ||
    lowerVisible.includes("cf-browser-verification") ||
    (lowerRaw.includes("captcha") && visibleText.length < 400)
  ) {
    return "Sivusto esitti bottisuojauksen tai CAPTCHA-haasteen. Liitä ilmoitusteksti käsin.";
  }

  if (
    (lowerVisible.includes("kirjaudu sisään") ||
      lowerVisible.includes("sign in to") ||
      lowerVisible.includes("log in to")) &&
    visibleText.length < 300
  ) {
    return "Sivusto vaikuttaa vaativan kirjautumisen ennen ilmoituksen näyttämistä. Liitä ilmoitusteksti käsin.";
  }

  if (
    visibleText.length < MIN_HTML_FALLBACK_CHARS &&
    /<div\s+id=["'](root|app|__next)["'][^>]*>\s*<\/div>/i.test(rawHtml)
  ) {
    return "Sivusto palautti vain tyhjän JavaScript-sovelluskuoren ilman luettavaa ilmoitustekstiä. Liitä ilmoitusteksti käsin.";
  }

  return null;
}

function clampExtractedText(text: string): string {
  if (text.length <= MAX_EXTRACTED_CHARS) return text;
  return `${text.slice(0, MAX_EXTRACTED_CHARS - 40).trimEnd()}\n\n[Teksti katkaistu enimmäispituuden vuoksi]`;
}

function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitParagraphBlocks(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

function isRedundantDeadlineBlock(
  block: string,
  hasDeadlineHeader: boolean
): boolean {
  if (!hasDeadlineHeader) return false;
  const compact = block.replace(/\s+/g, " ").trim();
  if (compact.length > 85) return false;

  // Match standalone "Hakuaika päättyy 23.11.2026 klo 16:15" or "Julkaistu 13.11. (Päättyy 22.11.)" without extra instructions
  return (
    /^(hakuaika\s+päättyy|haku\s+päättyy|viimeinen\s+hakupäivä|päättyy)\s*:?\s*\d{1,2}\.\d{1,2}\.(?:\d{2,4})?(?:\s+klo\s+\d{1,2}[:.]\d{2})?$/i.test(
      compact
    ) ||
    /^julkaistu\s+\d{1,2}\.\d{1,2}\.(?:\d{2,4})?\s*(?:\(\s*päättyy\s+\d{1,2}\.\d{1,2}\.(?:\d{2,4})?\s*\))?$/i.test(
      compact
    )
  );
}

function deduplicateInternalParagraphs(
  text: string,
  hasDeadlineHeader = false
): string {
  const blocks = splitParagraphBlocks(text);
  const kept: string[] = [];
  const seenSubstantialBlocks = new Set<string>();
  const seenSubstantialLines = new Set<string>();

  for (const block of blocks) {
    if (isRedundantDeadlineBlock(block, hasDeadlineHeader)) {
      continue;
    }

    const normBlock = normalizeForComparison(block);
    if (!normBlock) continue;
    if (normBlock.length >= 35 && seenSubstantialBlocks.has(normBlock)) {
      continue;
    }

    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !isStandaloneUiActionLine(l))
      .filter((line) => {
        const normLine = normalizeForComparison(line);
        if (normLine.length >= 50 && seenSubstantialLines.has(normLine)) {
          return false;
        }
        if (normLine.length >= 50) {
          seenSubstantialLines.add(normLine);
        }
        return true;
      });

    if (lines.length === 0) continue;
    const rejoined = lines.join("\n");
    if (isRedundantDeadlineBlock(rejoined, hasDeadlineHeader)) {
      continue;
    }

    if (normBlock.length >= 35) {
      seenSubstantialBlocks.add(normBlock);
    }
    kept.push(rejoined);
  }

  return kept.join("\n\n").trim();
}

function mergeUniquePostingTexts(
  primaryBody: string,
  secondaryBody: string,
  titleToSkip?: string | null,
  hasDeadlineHeader = false
): string {
  const primaryBlocks = splitParagraphBlocks(
    deduplicateInternalParagraphs(primaryBody, hasDeadlineHeader)
  );
  const normTitle = titleToSkip ? normalizeForComparison(titleToSkip) : "";

  const filteredPrimary = primaryBlocks.filter((block, index) => {
    if (index === 0 && normTitle) {
      const normBlock = normalizeForComparison(block);
      if (normBlock === normTitle) {
        return false;
      }
    }
    return true;
  });

  const combinedTextNorm = normalizeForComparison(filteredPrimary.join(" "));
  const secondaryBlocks = splitParagraphBlocks(
    deduplicateInternalParagraphs(secondaryBody, hasDeadlineHeader)
  );
  const extraSecondary: string[] = [];

  for (const block of secondaryBlocks) {
    const norm = normalizeForComparison(block);
    if (!norm || norm.length < 15) continue;
    if (normTitle && norm === normTitle) continue;
    if (combinedTextNorm.includes(norm)) continue;

    const sentences = block
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => normalizeForComparison(s).length >= 20);
    if (
      sentences.length > 0 &&
      sentences.every((s) =>
        combinedTextNorm.includes(normalizeForComparison(s))
      )
    ) {
      continue;
    }

    extraSecondary.push(block);
  }

  return [...filteredPrimary, ...extraSecondary].join("\n\n").trim();
}

interface CoverageAssessment {
  detectedSections: string[];
  looksTruncated: boolean;
  isAdequateAsFullPosting: boolean;
  hasSubstantiveProse: boolean;
  hasBulletList: boolean;
  paragraphCount: number;
}

const RECRUITMENT_ASPECT_RULES: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "tehtävänkuvaus",
    pattern:
      /tehtäv(?:ä|i|ö)|työnkuva|työn\s+sisältö|vastuu|työtehtäv|ilmiöanalyysi|pääset\s+(?:tekemään|työskentelemään|osallistumaan)|työskentelee|sisältää|lokien\s+seuranta|lokianalyysi|käyttäjätuki|järjestelmäylläpito|responsibilities|duties|what\s+you(?:'ll|\s+will)\s+do|about\s+the\s+role|your\s+role/i,
  },
  {
    label: "kelpoisuusehdot ja koulutus",
    pattern:
      /kelpoisu|korkeakoulu(?:opint|ssa|opiskelij)|yliopisto(?:opint|ssa|opiskelij)?|ammattikorkeakoulu|\bamk\b|tutkinto|opiskelija(?:n|na|t)?\b|opinto(?:ja|jen|ihisi|ala)?|koulutuk?s|soveltuv(?:a|at|ia)\s+(?:opinto|koulut|it-opint)|kielitaito|sujuvaa\s+suomea|suomen\s+kiel|englannin\s+kiel|eligibility|degree|university|student|education|fluent\s+in/i,
  },
  {
    label: "vaadittu ja toivottu osaaminen",
    pattern:
      /edellyt|vaadit|odotamme|arvostamme|eduksi|toivomme|osaamis|taito|kokemus|ominaisuuk|sertifikaat|perehtyneis|hallitset|tuntemus|skills?|qualifications?|requirements?|experience|preferred/i,
  },
  {
    label: "työsuhteen tai harjoittelun ehdot",
    pattern:
      /\bharjoittelu(?!paik)|kesto|määräaik|vakinai|vakituis|toistaiseksi|kokoaik|osa-aik|virkasuhde|työsuhde|työaik|etätyö|hybridi|läsnätyö|liukuva|aloitus|sopimuksen\s+mukaan|\bkuukau(?:den|tta|si|deksi)\b|\b\d+\s*kk\b|\bh\/vko\b|internship|contract|permanent|full[- ]?time|part[- ]?time|remote|hybrid|work\s+hours|duration/i,
  },
  {
    label: "palkkaus ja edut",
    pattern:
      /palkka|palkkau|€\s*\/\s*(?:kk|h|tunti)|eur\/kk|kuukausipalk|tuntipalk|palkkaluok|\btes\b|työtervey|ruokailu|liikuntaetu|virike-etu|salary|compensation|benefits/i,
  },
  {
    label: "hakuaika ja rekrytointiehdot",
    pattern:
      /hakuaika|haku\s+päättyy|\bhae\b|hakemus|yhteyshenkilö|lisätietoja|turvallisuusselvitys|supo|koeaika|rekrytointiprosessi|\bmennessä\b|deadline|valid\s+through|apply|application|contact|security\s+clearance/i,
  },
];

function countSubstantiveUnits(bodyText: string): number {
  const lines = bodyText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !isStandaloneUiActionLine(l));

  let substantiveUnits = 0;
  for (const line of lines) {
    if (line.startsWith("- ") && line.length >= 16) {
      substantiveUnits++;
      continue;
    }
    const sentences = line
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 28 && /\s+/.test(s));
    if (sentences.length > 0) {
      substantiveUnits += sentences.length;
    } else if (line.length >= 55 && /\s+/.test(line)) {
      substantiveUnits++;
    }
  }
  return substantiveUnits;
}

function assessContentCoverage(bodyText: string): CoverageAssessment {
  const detectedSections = RECRUITMENT_ASPECT_RULES.filter((rule) =>
    rule.pattern.test(bodyText)
  ).map((rule) => rule.label);

  const trimmed = bodyText.trim();
  const looksTruncated =
    /(\.{3}|…|\bluelisää\b|\blue lisää\b|\bkatso lisää\b|\bread more\b)\s*$/i.test(
      trimmed
    );

  const hasRole = detectedSections.includes("tehtävänkuvaus");
  const hasQualificationOrSkill =
    detectedSections.includes("kelpoisuusehdot ja koulutus") ||
    detectedSections.includes("vaadittu ja toivottu osaaminen");
  const hasTermsOrApplication =
    detectedSections.includes("työsuhteen tai harjoittelun ehdot") ||
    detectedSections.includes("palkkaus ja edut") ||
    detectedSections.includes("hakuaika ja rekrytointiehdot");

  const hasBulletList = /^\s*-\s+/m.test(trimmed);
  const paragraphCount = splitParagraphBlocks(trimmed).length;
  const substantiveUnits = countSubstantiveUnits(trimmed);
  const hasSubstantiveProse = substantiveUnits >= 2;

  // Complete posting requires multiple core recruitment aspects AND real prose/bullets (not nav fragments)
  const isAdequateAsFullPosting =
    !looksTruncated &&
    trimmed.length >= MIN_SHORT_COMPLETE_CHARS &&
    hasSubstantiveProse &&
    detectedSections.length >= 3 &&
    hasRole &&
    hasQualificationOrSkill &&
    hasTermsOrApplication;

  return {
    detectedSections,
    looksTruncated,
    isAdequateAsFullPosting,
    hasSubstantiveProse,
    hasBulletList,
    paragraphCount,
  };
}

interface ExtractedJsonLdCandidate {
  title: string | null;
  company: string | null;
  location: string | null;
  employmentType: string | null;
  deadline: string | null;
  salary: string | null;
  workHours: string | null;
  isRemote: boolean;
  bodyText: string;
  coverage: CoverageAssessment;
}

interface ExtractedHtmlCandidate {
  plainText: string;
  title: string | null;
  usedSemanticContainer: boolean;
  hasBlockingShellSignal: boolean;
  shellProblem: string | null;
  coverage: CoverageAssessment;
}

function buildMetadataHeaderLines(meta: {
  title: string | null;
  company: string | null;
  location: string | null;
  isRemote: boolean;
  employmentType: string | null;
  workHours: string | null;
  salary: string | null;
  deadline: string | null;
  deadlineInfo?: JobDeadlineAssessment;
}): string[] {
  const lines: string[] = [];
  if (meta.title) lines.push(`Tehtävä: ${meta.title}`);
  if (meta.company) lines.push(`Työnantaja: ${meta.company}`);
  if (meta.location) lines.push(`Sijainti: ${meta.location}`);
  if (meta.isRemote) lines.push("Työskentelymalli: Etätyö");
  if (meta.employmentType) lines.push(`Työsuhteen tyyppi: ${meta.employmentType}`);
  if (meta.workHours) lines.push(`Työaika: ${meta.workHours}`);
  if (meta.salary) lines.push(`Palkkaus: ${meta.salary}`);

  if (meta.deadlineInfo?.hasConflict) {
    const s = meta.deadlineInfo.structuredDeadline;
    const b = meta.deadlineInfo.bodyDeadline;
    if (s && b) {
      lines.push(
        `Hakuaika (RISTIRIITAINEN, tarkistettava): ${s.sourceLabel} ilmoittaa ${s.value}, mutta ${b.sourceLabel.toLowerCase()} ilmoittaa ${b.value}`
      );
    } else {
      lines.push(
        "Hakuaika (RISTIRIITAINEN, tarkistettava): lähteissä esiintyy eri määräaikoja"
      );
    }
  } else {
    const formattedDeadline = formatDeadlineForDisplay(meta.deadline);
    if (formattedDeadline) lines.push(`Hakuaika päättyy: ${formattedDeadline}`);
  }

  return lines;
}

function extractJsonLdCandidate(html: string): ExtractedJsonLdCandidate | null {
  const jsonLdScripts = [
    ...html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    ),
  ];

  const jobNodes: Array<Record<string, unknown>> = [];
  for (const match of jsonLdScripts) {
    const rawJson = decodeHtmlEntities(match[1]).trim();
    if (!rawJson) continue;
    try {
      const parsed: unknown = JSON.parse(rawJson);
      findJobPostingNodes(parsed, jobNodes);
    } catch {
      // Ignore malformed JSON-LD blocks and continue inspecting remaining blocks/HTML
    }
  }

  let bestCandidate: ExtractedJsonLdCandidate | null = null;

  for (const node of jobNodes) {
    const title =
      typeof node.title === "string" && node.title.trim()
        ? decodeHtmlEntities(node.title.trim())
        : typeof node.name === "string" && node.name.trim()
        ? decodeHtmlEntities(node.name.trim())
        : null;
    const company = extractOrganizationName(node.hiringOrganization);
    const location = extractJobLocationText(node.jobLocation);
    const deadline =
      typeof node.validThrough === "string" && node.validThrough.trim()
        ? node.validThrough.trim()
        : null;
    const employmentType = normalizeEmploymentTypes(node.employmentType);
    const salary = extractSalaryText(node.baseSalary);
    const workHours =
      typeof node.workHours === "string" && node.workHours.trim()
        ? decodeHtmlEntities(node.workHours.trim())
        : null;
    const isRemote = node.jobLocationType === "TELECOMMUTE";

    const rawDesc =
      typeof node.description === "string" ? node.description.trim() : "";
    const descriptionText = rawDesc ? htmlFragmentToPlainText(rawDesc) : "";

    const extraFieldSections: string[] = [];
    const labeledExtras: Array<[string, unknown]> = [
      ["Kelpoisuusvaatimukset", node.qualifications],
      ["Koulutusvaatimukset", node.educationRequirements],
      ["Kokemusvaatimukset", node.experienceRequirements],
      ["Osaaminen", node.skills],
      ["Vastuualueet", node.responsibilities],
      ["Edut", node.jobBenefits],
    ];
    for (const [label, val] of labeledExtras) {
      const parsedField = extractSchemaTextField(val);
      if (parsedField) {
        const normDesc = normalizeForComparison(descriptionText);
        const normField = normalizeForComparison(parsedField);
        if (normField && !normDesc.includes(normField)) {
          extraFieldSections.push(`${label}:\n${parsedField}`);
        }
      }
    }

    const bodyText = [descriptionText, ...extraFieldSections]
      .filter((s) => s.length > 0)
      .join("\n\n")
      .trim();

    if (bodyText.length < MIN_DESCRIPTION_CHARS) {
      continue;
    }

    const coverage = assessContentCoverage(bodyText);
    const candidate: ExtractedJsonLdCandidate = {
      title,
      company,
      location,
      employmentType,
      deadline,
      salary,
      workHours,
      isRemote,
      bodyText,
      coverage,
    };

    if (
      !bestCandidate ||
      candidate.coverage.detectedSections.length >
        bestCandidate.coverage.detectedSections.length ||
      (candidate.coverage.detectedSections.length ===
        bestCandidate.coverage.detectedSections.length &&
        candidate.bodyText.length > bestCandidate.bodyText.length)
    ) {
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}

function extractHtmlCandidate(
  html: string,
  sourceUrl: string
): ExtractedHtmlCandidate {
  let host = "";
  try {
    host = new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    host = "";
  }

  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const rawBody = bodyMatch ? bodyMatch[1] : html;

  let cleaned = rawBody.replace(/<!--[\s\S]*?-->/g, " ");
  cleaned = stripTagsByPredicate(
    cleaned,
    new Set([
      "script",
      "style",
      "noscript",
      "template",
      "svg",
      "iframe",
      "object",
      "embed",
      "nav",
      "header",
      "footer",
      "aside",
      "button",
    ])
  );
  // Strip search, alert, and login forms while keeping generic wrappers untouched
  cleaned = stripTagsByPredicate(
    cleaned,
    new Set(["form"]),
    (attrs) =>
      /\b(search|filter|alert|newsletter|login|auth|cookie|subscribe|autocomplete|jobwatch|saved-searches)\b/i.test(
        attrs
      ) || !/\bid=["']aspnetForm["']/i.test(attrs)
  );
  // Strip portal navigation, skip links, cookie banners, related-jobs cards, and login boxes
  cleaned = stripTagsByPredicate(
    cleaned,
    new Set(["div", "section", "ul"]),
    (attrs) =>
      /\b(cookie|consent|onetrust|cookiebot|gdpr|cmp-|navbar|menubar|breadcrumb|social-share|share-buttons|skip-link|skip-to-content|previous-searches|search-autocomplete|form__search|nav__menu|nav__toggle|icons__jobwatch|pane-node-links|block--monsterfi-alerts|block-search-api-saved-searches|recruiter-job-banner|similar-jobs|related-jobs|recommended-jobs|job-box|login-prompt|auth-box|footer-links|site-header|site-footer)\b/i.test(
        attrs
      ) ||
      /\brole=["'](?:navigation|search|banner|contentinfo|complementary)["']/i.test(
        attrs
      ) ||
      /\baria-hidden=["']true["']/i.test(attrs)
  );

  // Extract heading from cleaned HTML (prefer <h1> before narrowing further to description box)
  const h1Match = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(cleaned);
  const pageTitleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const h1Title = h1Match ? htmlFragmentToPlainText(h1Match[1]) : "";
  const pageTitle = pageTitleMatch
    ? htmlFragmentToPlainText(pageTitleMatch[1])
    : "";

  // 1. Portal-specific scoped job containers (explicit allowlisted hosts)
  let scopedContainer: { rawHtml: string; plainText: string } | null = null;
  if (host === "duunitori.fi" || host === "www.duunitori.fi") {
    scopedContainer = extractLargestContainerByAttr(
      cleaned,
      /\b(?:description--jobentry|description-box)\b/i
    );
  } else if (host === "jobly.fi" || host === "www.jobly.fi") {
    scopedContainer =
      extractLargestContainerByAttr(cleaned, /\bfield--name-body\b/i) ??
      extractLargestContainerByAttr(
        cleaned,
        /\b(?:node--job-per-template|node-job)\b/i
      );
  }

  // 2. Generic semantic or standard job-posting containers
  const mainContainer = extractLargestContainer(cleaned, "main");
  const articleContainer = extractLargestContainer(cleaned, "article");
  const genericJobContainer = extractLargestContainerByAttr(
    cleaned,
    /\b(?:job-description|posting-description|vacancy-description|description--jobentry|field--name-body)\b/i
  );

  let focusedPlain = "";
  let usedSemanticContainer = false;

  if (
    scopedContainer &&
    scopedContainer.plainText.length >= MIN_HTML_FALLBACK_CHARS
  ) {
    focusedPlain = h1Title
      ? `${h1Title}\n\n${scopedContainer.plainText}`
      : scopedContainer.plainText;
    usedSemanticContainer = true;
  } else if (
    mainContainer &&
    articleContainer &&
    articleContainer.plainText.length >= MIN_HTML_FALLBACK_CHARS &&
    articleContainer.plainText.length >= mainContainer.plainText.length * 0.6
  ) {
    focusedPlain = articleContainer.plainText;
    usedSemanticContainer = true;
  } else if (
    genericJobContainer &&
    genericJobContainer.plainText.length >= MIN_HTML_FALLBACK_CHARS
  ) {
    focusedPlain = h1Title
      ? `${h1Title}\n\n${genericJobContainer.plainText}`
      : genericJobContainer.plainText;
    usedSemanticContainer = true;
  } else if (
    mainContainer &&
    mainContainer.plainText.length >= MIN_HTML_FALLBACK_CHARS
  ) {
    focusedPlain = mainContainer.plainText;
    usedSemanticContainer = true;
  } else if (
    articleContainer &&
    articleContainer.plainText.length >= MIN_HTML_FALLBACK_CHARS
  ) {
    focusedPlain = articleContainer.plainText;
    usedSemanticContainer = true;
  } else {
    focusedPlain = htmlFragmentToPlainText(cleaned);
  }

  focusedPlain = deduplicateInternalParagraphs(focusedPlain);

  const shellProblem = detectBlockedOrJsShell(html, focusedPlain);
  const hasBlockingShellSignal =
    shellProblem !== null ||
    /<div\s+id=["'](root|app|__next)["'][^>]*>\s*<\/div>/i.test(html);

  const fallbackTitle = h1Title || pageTitle || null;

  return {
    plainText: focusedPlain,
    title: fallbackTitle,
    usedSemanticContainer,
    hasBlockingShellSignal,
    shellProblem,
    coverage: assessContentCoverage(focusedPlain),
  };
}

function htmlAddsSubstantialInfoOverJsonLd(
  jsonLd: ExtractedJsonLdCandidate,
  htmlCandidate: ExtractedHtmlCandidate
): boolean {
  if (htmlCandidate.plainText.length < MIN_HTML_FALLBACK_CHARS) {
    return false;
  }

  // If JSON-LD is already a complete posting and HTML only came from unscoped whole <body>,
  // do not merge noisy page chrome over clean structured data.
  if (
    jsonLd.coverage.isAdequateAsFullPosting &&
    !htmlCandidate.usedSemanticContainer
  ) {
    return false;
  }

  const missingAspectsInJsonLd = htmlCandidate.coverage.detectedSections.filter(
    (section) => !jsonLd.coverage.detectedSections.includes(section)
  );
  if (
    missingAspectsInJsonLd.length > 0 &&
    htmlCandidate.coverage.hasSubstantiveProse
  ) {
    return true;
  }

  // Check if HTML contains substantial unique prose paragraphs not covered by JSON-LD
  const normJson = normalizeForComparison(jsonLd.bodyText);
  const normTitle = jsonLd.title ? normalizeForComparison(jsonLd.title) : "";
  const extraBlocks = splitParagraphBlocks(htmlCandidate.plainText).filter(
    (block) => {
      const norm = normalizeForComparison(block);
      if (norm.length < 45) return false;
      if (normTitle && norm === normTitle) return false;
      return !normJson.includes(norm);
    }
  );
  const extraChars = extraBlocks.reduce((sum, b) => sum + b.length, 0);
  return extraBlocks.length >= 2 || extraChars >= 250;
}

export function extractJobContentFromHtml(
  html: string,
  sourceUrl: string
): Omit<FetchedJobResult, "fetchedAt"> {
  const jsonLd = extractJsonLdCandidate(html);
  const htmlCandidate = extractHtmlCandidate(html, sourceUrl);

  if (jsonLd) {
    const resolvedTitle = selectBestJobTitle(jsonLd.title, htmlCandidate.title);
    const { assessment: deadlineInfo, resolvedSingleDeadline } =
      assessJobDeadlines(jsonLd.deadline, [
        jsonLd.bodyText,
        htmlCandidate.plainText,
      ]);

    // Only strip redundant standalone deadline blocks when deadlines do NOT conflict
    const stripRedundantDeadline =
      !deadlineInfo.hasConflict && Boolean(resolvedSingleDeadline);

    const headerLines = buildMetadataHeaderLines({
      title: resolvedTitle,
      company: jsonLd.company,
      location: jsonLd.location,
      isRemote: jsonLd.isRemote,
      employmentType: jsonLd.employmentType,
      workHours: jsonLd.workHours,
      salary: jsonLd.salary,
      deadline: resolvedSingleDeadline,
      deadlineInfo,
    });
    const headerBlock = headerLines.length > 0 ? headerLines.join("\n") : "";

    const htmlIsSubstantial = htmlAddsSubstantialInfoOverJsonLd(
      jsonLd,
      htmlCandidate
    );

    const combineWarning = (baseWarning: string | null): string | null => {
      if (!deadlineInfo.hasConflict || !deadlineInfo.conflictWarning) {
        return baseWarning;
      }
      return baseWarning
        ? `${deadlineInfo.conflictWarning} ${baseWarning}`
        : deadlineInfo.conflictWarning;
    };

    if (htmlIsSubstantial) {
      const mergedBody = mergeUniquePostingTexts(
        htmlCandidate.plainText,
        jsonLd.bodyText,
        resolvedTitle,
        stripRedundantDeadline
      );
      const mergedCoverage = assessContentCoverage(mergedBody);
      const combinedText = headerBlock
        ? `${headerBlock}\n\n${mergedBody}`
        : mergedBody;

      const isComplete =
        mergedCoverage.isAdequateAsFullPosting &&
        !htmlCandidate.hasBlockingShellSignal;

      const baseWarning = isComplete
        ? null
        : "Verkkonouto onnistui, mutta kaikkia keskeisiä rekrytointiosioita ei pystytty varmistamaan. Tarkista teksti ennen analysointia.";

      return {
        sourceUrl,
        title: resolvedTitle,
        company: jsonLd.company,
        deadline: resolvedSingleDeadline,
        deadlineInfo,
        extractedText: clampExtractedText(combinedText),
        fetchMethod: "jsonld_and_html",
        networkStatus: "ok",
        coverageStatus: isComplete ? "complete" : "uncertain",
        confidence: isComplete ? "high" : "uncertain",
        detectedSections: mergedCoverage.detectedSections,
        coverageSummary: isComplete
          ? `${HTML_WITH_STRUCTURED_NOTICE} Tunnistetut osiot: ${mergedCoverage.detectedSections.join(", ")}.`
          : `Verkkonouto onnistui, mutta kaikkia keskeisiä rekrytointiosioita ei pystytty varmistamaan automaattisesti (tunnistettu: ${mergedCoverage.detectedSections.join(", ") || "perustiedot"}).`,
        warning: combineWarning(baseWarning),
      };
    }

    // Only structured JobPosting was used (clean JSON-LD + best title from HTML H1 if sharper)
    const cleanedJsonBody = deduplicateInternalParagraphs(
      jsonLd.bodyText,
      stripRedundantDeadline
    );
    const jsonLdOnlyText = headerBlock
      ? `${headerBlock}\n\n${cleanedJsonBody}`
      : cleanedJsonBody;

    const isComplete =
      jsonLd.coverage.isAdequateAsFullPosting &&
      !htmlCandidate.hasBlockingShellSignal;

    if (isComplete) {
      return {
        sourceUrl,
        title: resolvedTitle,
        company: jsonLd.company,
        deadline: resolvedSingleDeadline,
        deadlineInfo,
        extractedText: clampExtractedText(jsonLdOnlyText),
        fetchMethod: "schema_org_jsonld",
        networkStatus: "ok",
        coverageStatus: "complete",
        confidence: "high",
        detectedSections: jsonLd.coverage.detectedSections,
        coverageSummary: `Tunnistetut osiot: ${jsonLd.coverage.detectedSections.join(", ")}.`,
        warning: combineWarning(null),
      };
    }

    // Narrow structured JobPosting summary and HTML did not supply missing content
    return {
      sourceUrl,
      title: resolvedTitle,
      company: jsonLd.company,
      deadline: resolvedSingleDeadline,
      deadlineInfo,
      extractedText: clampExtractedText(jsonLdOnlyText),
      fetchMethod: "schema_org_jsonld",
      networkStatus: "ok",
      coverageStatus: "partial",
      confidence: "partial",
      detectedSections: jsonLd.coverage.detectedSections,
      coverageSummary: `Verkkonouto onnistui, mutta sivulta saatiin vain tiivistelmä tai osa tiedoista (tunnistettu: ${jsonLd.coverage.detectedSections.join(", ") || "suppea kuvaus"}).`,
      warning: combineWarning(PARTIAL_JOB_WARNING),
    };
  }

  // No usable JobPosting JSON-LD -> rely on HTML extraction
  if (htmlCandidate.shellProblem) {
    throw new JobFetchError(
      htmlCandidate.shellProblem,
      422,
      "UNREADABLE_JS_OR_BLOCKED"
    );
  }

  const meetsMinimumHtmlThreshold =
    htmlCandidate.plainText.length >= MIN_HTML_FALLBACK_CHARS ||
    htmlCandidate.coverage.isAdequateAsFullPosting;

  if (!meetsMinimumHtmlThreshold) {
    throw new JobFetchError(
      "Sivulta ei saatu poimittua riittävästi varsinaista työpaikkailmoituksen tekstiä. Avaa ilmoitus selaimessa ja liitä teksti käsin.",
      422,
      "INSUFFICIENT_CONTENT"
    );
  }

  const { assessment: htmlDeadlineInfo, resolvedSingleDeadline: htmlDeadline } =
    assessJobDeadlines(null, [htmlCandidate.plainText]);

  const isPartialHtml =
    htmlCandidate.coverage.looksTruncated ||
    !htmlCandidate.coverage.hasSubstantiveProse;
  const baseHtmlWarning = isPartialHtml
    ? PARTIAL_JOB_WARNING
    : htmlCandidate.usedSemanticContainer
    ? HTML_UNCERTAIN_WARNING
    : BODY_ONLY_WARNING;

  return {
    sourceUrl,
    title: htmlCandidate.title,
    company: null,
    deadline: htmlDeadline,
    deadlineInfo: htmlDeadlineInfo,
    extractedText: clampExtractedText(htmlCandidate.plainText),
    fetchMethod: "html_fallback",
    networkStatus: "ok",
    coverageStatus: isPartialHtml ? "partial" : "uncertain",
    confidence: isPartialHtml ? "partial" : "uncertain",
    detectedSections: htmlCandidate.coverage.detectedSections,
    coverageSummary: `Verkkonouto onnistui ilman schema.org/JobPosting-rakennetta. Tunnistetut osiot: ${htmlCandidate.coverage.detectedSections.join(", ") || "yleinen tekstisisältö"}.`,
    warning:
      htmlDeadlineInfo.hasConflict && htmlDeadlineInfo.conflictWarning
        ? `${htmlDeadlineInfo.conflictWarning} ${baseHtmlWarning}`
        : baseHtmlWarning,
  };
}

async function lookupDnsWithTimeout(
  dnsLookup: (hostname: string) => Promise<DnsAddressRecord[]>,
  hostname: string,
  dnsTimeoutMs: number,
  signal?: AbortSignal
): Promise<DnsAddressRecord[]> {
  if (signal?.aborted) {
    throw new JobFetchError("Haku keskeytettiin.", 499, "ABORTED");
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
      reject(new JobFetchError("Haku keskeytettiin.", 499, "ABORTED"));
    };
    signal?.addEventListener("abort", onAbort);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new JobFetchError(
          "Verkkotunnuksen nimipalveluselvitys aikakatkaistiin. Yritä uudelleen tai liitä teksti käsin.",
          504,
          "DNS_TIMEOUT"
        )
      );
    }, dnsTimeoutMs);

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
          new JobFetchError(
            "Verkkotunnuksen nimipalveluselvitys epäonnistui. Tarkista osoite tai liitä teksti käsin.",
            502,
            "DNS_FAILED"
          )
        );
      }
    );
  });
}

export async function fetchJobFromUrl(
  rawUrl: string,
  deps: FetchJobDependencies = {}
): Promise<FetchedJobResult> {
  const url = validateFetchJobUrl(rawUrl);
  const dnsLookup = deps.dnsLookup ?? defaultDnsLookup;
  const httpGet = deps.httpGet ?? executePinnedHttpsGet;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const dnsTimeoutMs = Math.min(
    timeoutMs,
    deps.dnsTimeoutMs ?? DEFAULT_DNS_TIMEOUT_MS
  );
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_FETCH_BYTES;

  const records = await lookupDnsWithTimeout(
    dnsLookup,
    url.hostname,
    dnsTimeoutMs,
    deps.signal
  );

  if (!records || records.length === 0) {
    throw new JobFetchError(
      "Verkkotunnukselle ei löytynyt julkista IP-osoitetta.",
      502,
      "DNS_EMPTY"
    );
  }

  for (const rec of records) {
    if (!isPublicIpAddress(rec.address)) {
      throw new JobFetchError(
        "Verkkotunnus osoittaa estettyyn tai yksityiseen IP-osoitealueeseen.",
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
    throw new JobFetchError(
      `Sivusto palautti uudelleenohjauksen (HTTP ${response.statusCode}). Automaattisia uudelleenohjauksia ei seurata tietoturvasyistä.`,
      422,
      "REDIRECT_BLOCKED"
    );
  }

  if (response.statusCode === 401 || response.statusCode === 403) {
    throw new JobFetchError(
      "Sivusto esti automaattisen haun tai vaatii kirjautumisen. Liitä ilmoitusteksti käsin.",
      403,
      "UPSTREAM_FORBIDDEN"
    );
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new JobFetchError(
      `Sivusto palautti virhetilan (HTTP ${response.statusCode}). Liitä ilmoitusteksti käsin.`,
      502,
      "UPSTREAM_ERROR"
    );
  }

  const rawContentType = response.headers["content-type"];
  const contentType = Array.isArray(rawContentType)
    ? rawContentType[0] ?? ""
    : rawContentType ?? "";
  const mediaType = contentType.split(";")[0].trim().toLowerCase();
  if (mediaType !== "text/html" && mediaType !== "application/xhtml+xml") {
    throw new JobFetchError(
      `Sivun sisältötyyppi (${mediaType || "tuntematon"}) ei ole tuettu HTML-ilmoitus. Liitä ilmoitusteksti käsin.`,
      415,
      "UNSUPPORTED_MEDIA_TYPE"
    );
  }

  if (Buffer.byteLength(response.body, "utf8") > maxBytes) {
    throw new JobFetchError(
      `Ilmoitussivun koko ylittää sallitun enimmäiskoon (${Math.round(maxBytes / 1000)} kt).`,
      413,
      "PAYLOAD_TOO_LARGE"
    );
  }

  const extracted = extractJobContentFromHtml(response.body, url.toString());
  return {
    ...extracted,
    fetchedAt: new Date().toISOString(),
  };
}
