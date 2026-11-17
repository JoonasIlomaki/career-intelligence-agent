import type { DiscoveredJob } from "../../src/types/career.ts";

function normalizeToken(val: string): string {
  return val
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9äöå]+/g, " ")
    .trim();
}

export function normalizeDiscoveryJobUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      !parsed.hostname
    ) {
      return "";
    }
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "referrer",
      "source",
    ];
    for (const p of trackingParams) {
      parsed.searchParams.delete(p);
    }
    parsed.hash = "";
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    const search = parsed.searchParams.toString();
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${pathname}${
      search ? `?${search}` : ""
    }`;
  } catch {
    return "";
  }
}

function mergeJobRecords(
  primary: DiscoveredJob,
  secondary: DiscoveredJob
): DiscoveredJob {
  const winner =
    secondary.description.length > primary.description.length
      ? secondary
      : primary;
  const other = winner === primary ? secondary : primary;

  const alternateSources = [...(winner.alternateSources ?? [])];
  if (
    other.jobUrl &&
    !alternateSources.some(
      (a) => a.source === other.source && a.jobUrl === other.jobUrl
    )
  ) {
    alternateSources.push({
      source: other.source,
      jobUrl: other.jobUrl,
      company: other.company,
    });
  }
  if (other.alternateSources) {
    for (const alt of other.alternateSources) {
      if (
        !alternateSources.some(
          (a) => a.source === alt.source && a.jobUrl === alt.jobUrl
        )
      ) {
        alternateSources.push(alt);
      }
    }
  }

  return {
    ...winner,
    publishedAt: winner.publishedAt ?? other.publishedAt,
    updatedAt: winner.updatedAt ?? other.updatedAt,
    deadline: winner.deadline ?? other.deadline,
    alternateSources: alternateSources.length > 0 ? alternateSources : undefined,
  };
}

const SUSPECTED_DUPLICATE_NOTE =
  "Huomio: Samalta työnantajalta löytyi toinen ilmoitus samalla nimikkeellä ja sijainnilla — tarkista, ovatko ne erillisiä avoimia paikkoja.";

function withUncertaintyHint(job: DiscoveredJob, hint: string): DiscoveredJob {
  if (job.uncertainties.includes(hint)) return job;
  return {
    ...job,
    uncertainties: [...job.uncertainties, hint],
  };
}

/**
 * Deduplicates discovered jobs automatically ONLY on strong unique identifiers:
 *  1. non-empty source + employer/company + sourceJobId
 *  2. normalized valid HTTP(S) jobUrl
 * Matching company + title + location with distinct IDs/URLs are preserved as separate records
 * with a non-destructive suspected-duplicate notice so distinct roles are never silently discarded.
 */
export function deduplicateDiscoveredJobs(jobs: DiscoveredJob[]): {
  jobs: DiscoveredJob[];
  duplicateCount: number;
} {
  const result: DiscoveredJob[] = [];
  const bySourceId = new Map<string, number>();
  const byUrl = new Map<string, number>();
  const byCompanyTitleLocation = new Map<string, number>();
  let duplicateCount = 0;

  for (const job of jobs) {
    const cleanSourceId = job.sourceJobId.trim();
    const sourceKey = cleanSourceId
      ? `${job.source}|${normalizeToken(job.employerId || job.company)}|${cleanSourceId}`
      : "";
    const urlKey = normalizeDiscoveryJobUrl(job.jobUrl);

    let existingIdx: number | undefined = sourceKey
      ? bySourceId.get(sourceKey)
      : undefined;
    if (existingIdx === undefined && urlKey) {
      existingIdx = byUrl.get(urlKey);
    }

    if (existingIdx !== undefined) {
      duplicateCount++;
      result[existingIdx] = mergeJobRecords(result[existingIdx], job);
      continue;
    }

    const hasKnownLocation =
      job.location !== "Ei ilmoitettu" && normalizeToken(job.location).length > 0;
    const compositeKey = hasKnownLocation
      ? `${normalizeToken(job.company)}|${normalizeToken(job.title)}|${normalizeToken(
          job.location
        )}`
      : "";

    let entryToPush = job;
    if (compositeKey) {
      const suspectedIdx = byCompanyTitleLocation.get(compositeKey);
      if (suspectedIdx !== undefined) {
        result[suspectedIdx] = withUncertaintyHint(
          result[suspectedIdx],
          SUSPECTED_DUPLICATE_NOTE
        );
        entryToPush = withUncertaintyHint(job, SUSPECTED_DUPLICATE_NOTE);
      }
    }

    const idx = result.length;
    result.push(entryToPush);
    if (sourceKey) bySourceId.set(sourceKey, idx);
    if (urlKey) byUrl.set(urlKey, idx);
    if (compositeKey && !byCompanyTitleLocation.has(compositeKey)) {
      byCompanyTitleLocation.set(compositeKey, idx);
    }
  }

  return { jobs: result, duplicateCount };
}
