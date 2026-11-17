import { DiscoverySourceError, fetchAtsJson } from "../httpClient.ts";
import { isAllowedAtsJobUrl } from "../registry.ts";
import type {
  AdapterFetchResult,
  EmployerSourceEntry,
  JobDiscoveryDependencies,
  RawAtsJobRecord,
} from "../types.ts";

interface GreenhouseJobRaw {
  id?: unknown;
  title?: unknown;
  company_name?: unknown;
  absolute_url?: unknown;
  location?: { name?: unknown } | null;
  offices?: unknown;
  departments?: unknown;
  first_published?: unknown;
  updated_at?: unknown;
  application_deadline?: unknown;
  language?: unknown;
  content?: unknown;
  metadata?: unknown;
}

interface GreenhouseBoardResponse {
  jobs?: unknown;
}

function asNonEmptyString(val: unknown): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asIdString(val: unknown): string | null {
  if (typeof val === "number" && Number.isFinite(val)) return String(val);
  return asNonEmptyString(val);
}

function extractNamedArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const item of raw) {
    if (item && typeof item === "object") {
      const name = asNonEmptyString((item as { name?: unknown }).name);
      if (name) names.push(name);
    }
  }
  return names;
}

function extractWorkModelFromMetadata(metadata: unknown): string | null {
  if (!Array.isArray(metadata)) return null;
  for (const entry of metadata) {
    if (!entry || typeof entry !== "object") continue;
    const name = asNonEmptyString((entry as { name?: unknown }).name)?.toLowerCase() ?? "";
    const value = asNonEmptyString((entry as { value?: unknown }).value);
    if (!value) continue;
    if (
      name.includes("remote") ||
      name.includes("workplace") ||
      name.includes("work model") ||
      name.includes("hybrid") ||
      name.includes("location type")
    ) {
      return value;
    }
  }
  return null;
}

export async function fetchGreenhouseJobs(
  entry: EmployerSourceEntry,
  deps: JobDiscoveryDependencies = {}
): Promise<AdapterFetchResult> {
  const endpoint = `https://${entry.apiHost}/v1/boards/${encodeURIComponent(
    entry.identifier
  )}/jobs?content=true`;

  const payload = await fetchAtsJson<GreenhouseBoardResponse>(
    endpoint,
    "greenhouse",
    deps
  );

  if (!payload || typeof payload !== "object" || !Array.isArray(payload.jobs)) {
    throw new DiscoverySourceError(
      "Greenhouse-rajapinnan vastaus ei sisältänyt odotettua jobs-listaa.",
      502,
      "INVALID_PAYLOAD"
    );
  }

  const nowIso = (deps.now?.() ?? new Date()).toISOString();
  const warnings: string[] = [];
  const rawJobs: RawAtsJobRecord[] = [];
  let skippedInvalidCount = 0;

  for (const rawItem of payload.jobs as GreenhouseJobRaw[]) {
    if (!rawItem || typeof rawItem !== "object") {
      skippedInvalidCount++;
      continue;
    }

    const id = asIdString(rawItem.id);
    const title = asNonEmptyString(rawItem.title);
    if (!id || !title) {
      skippedInvalidCount++;
      continue;
    }

    const locationRaw = asNonEmptyString(rawItem.location?.name);
    const officeNames = extractNamedArray(rawItem.offices);
    const secondaryLocationsRaw = officeNames.filter(
      (office) => !locationRaw || office.toLowerCase() !== locationRaw.toLowerCase()
    );
    const departments = extractNamedArray(rawItem.departments);
    const rawUrl = asNonEmptyString(rawItem.absolute_url);
    const jobUrl = rawUrl && isAllowedAtsJobUrl(rawUrl) ? rawUrl : "";

    rawJobs.push({
      source: "greenhouse",
      employerId: entry.id,
      company: asNonEmptyString(rawItem.company_name) ?? entry.company,
      sourceJobId: id,
      title,
      locationRaw,
      secondaryLocationsRaw,
      countryRaw: null,
      workplaceTypeRaw: extractWorkModelFromMetadata(rawItem.metadata),
      isRemoteFlag: null,
      employmentTypeRaw: null,
      departmentRaw: departments.length > 0 ? departments.join(" / ") : null,
      descriptionHtmlOrText: asNonEmptyString(rawItem.content) ?? "",
      jobUrl,
      // Greenhouse exposes first_published and updated_at separately; never treat updated_at as publishedAt
      publishedAt: asNonEmptyString(rawItem.first_published),
      updatedAt: asNonEmptyString(rawItem.updated_at),
      deadlineRaw: asNonEmptyString(rawItem.application_deadline),
      languageRaw: asNonEmptyString(rawItem.language),
    });
  }

  if (skippedInvalidCount > 0) {
    warnings.push(
      `${entry.company} (Greenhouse): ${skippedInvalidCount} puutteellista ilmoitusriviä ohitettiin.`
    );
  }

  return {
    rawJobs,
    retrievedAt: nowIso,
    warnings,
  };
}
