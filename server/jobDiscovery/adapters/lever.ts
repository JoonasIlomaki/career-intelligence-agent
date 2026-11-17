import { DiscoverySourceError, fetchAtsJson } from "../httpClient.ts";
import { isAllowedAtsJobUrl } from "../registry.ts";
import type {
  AdapterFetchResult,
  EmployerSourceEntry,
  JobDiscoveryDependencies,
  RawAtsJobRecord,
} from "../types.ts";

export const LEVER_PAGE_LIMIT = 100;
export const LEVER_DEFAULT_MAX_PAGES = 10;

interface LeverListBlock {
  text?: unknown;
  content?: unknown;
}

interface LeverPostingRaw {
  id?: unknown;
  text?: unknown;
  hostedUrl?: unknown;
  applyUrl?: unknown;
  createdAt?: unknown;
  country?: unknown;
  workplaceType?: unknown;
  description?: unknown;
  descriptionPlain?: unknown;
  additional?: unknown;
  additionalPlain?: unknown;
  lists?: unknown;
  categories?: {
    location?: unknown;
    allLocations?: unknown;
    commitment?: unknown;
    department?: unknown;
    team?: unknown;
  } | null;
}

function asNonEmptyString(val: unknown): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildLeverDescription(item: LeverPostingRaw): string {
  const parts: string[] = [];
  const main =
    asNonEmptyString(item.description) ??
    asNonEmptyString(item.descriptionPlain);
  if (main) parts.push(main);

  if (Array.isArray(item.lists)) {
    for (const block of item.lists as LeverListBlock[]) {
      if (!block || typeof block !== "object") continue;
      const heading = asNonEmptyString(block.text);
      const content = asNonEmptyString(block.content);
      if (heading || content) {
        parts.push(
          [heading ? `<h3>${heading}</h3>` : "", content ?? ""]
            .filter(Boolean)
            .join("\n")
        );
      }
    }
  }

  const additional =
    asNonEmptyString(item.additional) ?? asNonEmptyString(item.additionalPlain);
  if (additional) parts.push(additional);

  return parts.join("\n\n");
}

function extractAllLocations(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => asNonEmptyString(v))
    .filter((v): v is string => v !== null);
}

export async function fetchLeverJobs(
  entry: EmployerSourceEntry,
  deps: JobDiscoveryDependencies = {}
): Promise<AdapterFetchResult> {
  const maxPages = Math.max(
    1,
    Math.min(20, deps.maxPagesPerSource ?? LEVER_DEFAULT_MAX_PAGES)
  );
  const nowIso = (deps.now?.() ?? new Date()).toISOString();
  const warnings: string[] = [];
  const rawJobs: RawAtsJobRecord[] = [];
  const seenIds = new Set<string>();
  let skippedInvalidCount = 0;

  for (let page = 0; page < maxPages; page++) {
    const skip = page * LEVER_PAGE_LIMIT;
    const endpoint = `https://${entry.apiHost}/v0/postings/${encodeURIComponent(
      entry.identifier
    )}?mode=json&skip=${skip}&limit=${LEVER_PAGE_LIMIT}`;

    const payload = await fetchAtsJson<unknown>(endpoint, "lever", deps);
    if (!Array.isArray(payload)) {
      throw new DiscoverySourceError(
        "Lever-rajapinnan vastaus ei ollut odotettu taulukko.",
        502,
        "INVALID_PAYLOAD"
      );
    }

    if (payload.length === 0) {
      break;
    }

    let addedOnPage = 0;
    for (const rawItem of payload as LeverPostingRaw[]) {
      if (!rawItem || typeof rawItem !== "object") {
        skippedInvalidCount++;
        continue;
      }

      const id = asNonEmptyString(rawItem.id);
      const title = asNonEmptyString(rawItem.text);
      if (!id || !title) {
        skippedInvalidCount++;
        continue;
      }

      if (seenIds.has(id)) {
        continue;
      }
      seenIds.add(id);
      addedOnPage++;

      const cats = rawItem.categories;
      const locationRaw = asNonEmptyString(cats?.location);
      const allLocations = extractAllLocations(cats?.allLocations);
      const secondaryLocationsRaw = allLocations.filter(
        (loc) => !locationRaw || loc.toLowerCase() !== locationRaw.toLowerCase()
      );

      const dept = asNonEmptyString(cats?.department);
      const team = asNonEmptyString(cats?.team);
      const departmentRaw =
        dept && team && dept !== team ? `${dept} / ${team}` : dept ?? team;

      const rawUrl =
        asNonEmptyString(rawItem.hostedUrl) ??
        asNonEmptyString(rawItem.applyUrl);
      const jobUrl = rawUrl && isAllowedAtsJobUrl(rawUrl) ? rawUrl : "";

      const createdAtMs =
        typeof rawItem.createdAt === "number" &&
        Number.isFinite(rawItem.createdAt) &&
        rawItem.createdAt > 0
          ? new Date(rawItem.createdAt).toISOString()
          : null;

      rawJobs.push({
        source: "lever",
        employerId: entry.id,
        company: entry.company,
        sourceJobId: id,
        title,
        locationRaw,
        secondaryLocationsRaw,
        countryRaw: asNonEmptyString(rawItem.country),
        workplaceTypeRaw: asNonEmptyString(rawItem.workplaceType),
        isRemoteFlag: null,
        employmentTypeRaw: asNonEmptyString(cats?.commitment),
        departmentRaw,
        descriptionHtmlOrText: buildLeverDescription(rawItem),
        jobUrl,
        publishedAt: createdAtMs,
        updatedAt: null,
        deadlineRaw: null,
        languageRaw: null,
      });
    }

    // Stop if fewer than page limit returned or server ignored skip (all IDs repeated)
    if (payload.length < LEVER_PAGE_LIMIT || addedOnPage === 0) {
      break;
    }

    if (page === maxPages - 1) {
      warnings.push(
        `${entry.company} (Lever): Haku rajattiin turvallisuussyistä enintään ${maxPages} sivuun (${rawJobs.length} ilmoitusta).`
      );
    }
  }

  if (skippedInvalidCount > 0) {
    warnings.push(
      `${entry.company} (Lever): ${skippedInvalidCount} puutteellista ilmoitusriviä ohitettiin.`
    );
  }

  return {
    rawJobs,
    retrievedAt: nowIso,
    warnings,
  };
}
