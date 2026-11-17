import { fetchAtsJson, DiscoverySourceError } from "../httpClient.ts";
import { isAllowedAtsJobUrl } from "../registry.ts";
import type {
  AdapterFetchResult,
  EmployerSourceEntry,
  JobDiscoveryDependencies,
  RawAtsJobRecord,
} from "../types.ts";

interface AshbyJobRaw {
  id?: unknown;
  title?: unknown;
  department?: unknown;
  team?: unknown;
  employmentType?: unknown;
  location?: unknown;
  secondaryLocations?: unknown;
  publishedAt?: unknown;
  isListed?: unknown;
  isRemote?: unknown;
  workplaceType?: unknown;
  address?: {
    postalAddress?: {
      addressCountry?: unknown;
      addressRegion?: unknown;
      addressLocality?: unknown;
    } | null;
  } | null;
  jobUrl?: unknown;
  applyUrl?: unknown;
  descriptionHtml?: unknown;
  descriptionPlain?: unknown;
}

interface AshbyBoardResponse {
  jobs?: unknown;
}

function asNonEmptyString(val: unknown): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractSecondaryLocations(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const results: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      results.push(item.trim());
    } else if (item && typeof item === "object") {
      const loc = asNonEmptyString((item as { location?: unknown }).location);
      if (loc) results.push(loc);
    }
  }
  return results;
}

export async function fetchAshbyJobs(
  entry: EmployerSourceEntry,
  deps: JobDiscoveryDependencies = {}
): Promise<AdapterFetchResult> {
  const endpoint = `https://${entry.apiHost}/posting-api/job-board/${encodeURIComponent(
    entry.identifier
  )}`;

  const payload = await fetchAtsJson<AshbyBoardResponse>(
    endpoint,
    "ashby",
    deps
  );

  if (!payload || typeof payload !== "object" || !Array.isArray(payload.jobs)) {
    throw new DiscoverySourceError(
      "Ashby-rajapinnan vastaus ei sisältänyt odotettua jobs-listaa.",
      502,
      "INVALID_PAYLOAD"
    );
  }

  const nowIso = (deps.now?.() ?? new Date()).toISOString();
  const warnings: string[] = [];
  const rawJobs: RawAtsJobRecord[] = [];
  let skippedInvalidCount = 0;

  for (const rawItem of payload.jobs as AshbyJobRaw[]) {
    if (!rawItem || typeof rawItem !== "object") {
      skippedInvalidCount++;
      continue;
    }
    if (rawItem.isListed === false) {
      continue;
    }

    const id = asNonEmptyString(rawItem.id);
    const title = asNonEmptyString(rawItem.title);
    if (!id || !title) {
      skippedInvalidCount++;
      continue;
    }

    const dept = asNonEmptyString(rawItem.department);
    const team = asNonEmptyString(rawItem.team);
    const departmentRaw =
      dept && team && dept !== team ? `${dept} / ${team}` : dept ?? team;

    const postal = rawItem.address?.postalAddress;
    const countryRaw = asNonEmptyString(postal?.addressCountry);
    const region = asNonEmptyString(postal?.addressRegion);
    const locality = asNonEmptyString(postal?.addressLocality);
    const fallbackLocation =
      [locality, region, countryRaw].filter(Boolean).join(", ") || null;

    const locationRaw = asNonEmptyString(rawItem.location) ?? fallbackLocation;
    const rawUrl =
      asNonEmptyString(rawItem.jobUrl) ?? asNonEmptyString(rawItem.applyUrl);
    const jobUrl = rawUrl && isAllowedAtsJobUrl(rawUrl) ? rawUrl : "";

    const descriptionHtmlOrText =
      asNonEmptyString(rawItem.descriptionHtml) ??
      asNonEmptyString(rawItem.descriptionPlain) ??
      "";

    rawJobs.push({
      source: "ashby",
      employerId: entry.id,
      company: entry.company,
      sourceJobId: id,
      title,
      locationRaw,
      secondaryLocationsRaw: extractSecondaryLocations(rawItem.secondaryLocations),
      countryRaw,
      workplaceTypeRaw: asNonEmptyString(rawItem.workplaceType),
      isRemoteFlag:
        typeof rawItem.isRemote === "boolean" ? rawItem.isRemote : null,
      employmentTypeRaw: asNonEmptyString(rawItem.employmentType),
      departmentRaw,
      descriptionHtmlOrText,
      jobUrl,
      publishedAt: asNonEmptyString(rawItem.publishedAt),
      updatedAt: null,
      deadlineRaw: null,
      languageRaw: null,
    });
  }

  if (skippedInvalidCount > 0) {
    warnings.push(
      `${entry.company} (Ashby): ${skippedInvalidCount} puutteellista ilmoitusriviä ohitettiin.`
    );
  }

  return {
    rawJobs,
    retrievedAt: nowIso,
    warnings,
  };
}
