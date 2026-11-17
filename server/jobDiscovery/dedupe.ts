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
    return trimmed.toLowerCase();
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

/**
 * Deduplicates discovered jobs without ever merging different jobs solely on matching title.
 * Primary keys:
 *  1. source + employerId + sourceJobId
 *  2. normalized jobUrl
 * Secondary suspected-duplicate key (only when location is known):
 *  3. normalized company + normalized title + normalized location
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
    const sourceKey = `${job.source}|${normalizeToken(job.company)}|${job.sourceJobId}`;
    const urlKey = normalizeDiscoveryJobUrl(job.jobUrl);
    const hasKnownLocation =
      job.location !== "Ei ilmoitettu" && normalizeToken(job.location).length > 0;
    const compositeKey = hasKnownLocation
      ? `${normalizeToken(job.company)}|${normalizeToken(job.title)}|${normalizeToken(
          job.location
        )}`
      : "";

    let existingIdx: number | undefined = bySourceId.get(sourceKey);
    if (existingIdx === undefined && urlKey) {
      existingIdx = byUrl.get(urlKey);
    }
    if (existingIdx === undefined && compositeKey) {
      existingIdx = byCompanyTitleLocation.get(compositeKey);
    }

    if (existingIdx !== undefined) {
      duplicateCount++;
      result[existingIdx] = mergeJobRecords(result[existingIdx], job);
      continue;
    }

    const idx = result.length;
    result.push(job);
    bySourceId.set(sourceKey, idx);
    if (urlKey) byUrl.set(urlKey, idx);
    if (compositeKey) byCompanyTitleLocation.set(compositeKey, idx);
  }

  return { jobs: result, duplicateCount };
}
