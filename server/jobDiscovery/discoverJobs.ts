import type {
  CandidateProfile,
  DiscoveredJob,
  DiscoverJobsResponse,
  DiscoverySearchPreferences,
  DiscoverySourceStatus,
} from "../../src/types/career.ts";
import { fetchAshbyJobs } from "./adapters/ashby.ts";
import { fetchGreenhouseJobs } from "./adapters/greenhouse.ts";
import { fetchLeverJobs } from "./adapters/lever.ts";
import { deduplicateDiscoveredJobs } from "./dedupe.ts";
import {
  DEFAULT_DISCOVERY_CACHE_TTL_MS,
  DiscoverySourceError,
} from "./httpClient.ts";
import { normalizeRawAtsJob } from "./normalize.ts";
import { getEmployerSourceRegistry, validateEmployerSource } from "./registry.ts";
import { scoreAndFilterDiscoveredJobs } from "./scoring.ts";
import type {
  AdapterFetchResult,
  DiscoveryCacheEntry,
  EmployerSourceEntry,
  JobDiscoveryDependencies,
} from "./types.ts";

// Cache stores strictly public raw ATS board payloads keyed by source+identifier+host (never user profile data)
const defaultRawBoardCache = new Map<string, DiscoveryCacheEntry>();

function buildBoardCacheKey(entry: EmployerSourceEntry): string {
  return `${entry.source}:${entry.identifier.toLowerCase()}:${entry.apiHost.toLowerCase()}`;
}

async function fetchSourceRawBoard(
  entry: EmployerSourceEntry,
  deps: JobDiscoveryDependencies
): Promise<AdapterFetchResult> {
  const nowDate = deps.now?.() ?? new Date();
  const nowMs = nowDate.getTime();
  const cache = deps.cache ?? defaultRawBoardCache;
  const ttlMs = deps.cacheTtlMs ?? DEFAULT_DISCOVERY_CACHE_TTL_MS;
  const cacheKey = buildBoardCacheKey(entry);

  if (!deps.bypassCache && ttlMs > 0) {
    const cached = cache.get(cacheKey);
    if (cached && nowMs - cached.fetchedAtMs < ttlMs) {
      return {
        rawJobs: cached.rawJobs,
        retrievedAt: cached.retrievedAt,
        warnings: [],
      };
    }
  }

  let fetched: AdapterFetchResult;
  switch (entry.source) {
    case "ashby":
      fetched = await fetchAshbyJobs(entry, deps);
      break;
    case "greenhouse":
      fetched = await fetchGreenhouseJobs(entry, deps);
      break;
    case "lever":
      fetched = await fetchLeverJobs(entry, deps);
      break;
  }

  if (ttlMs > 0) {
    cache.set(cacheKey, {
      fetchedAtMs: nowMs,
      retrievedAt: fetched.retrievedAt,
      rawJobs: fetched.rawJobs,
    });
  }

  return fetched;
}

export interface DiscoverJobsInput {
  preferences: DiscoverySearchPreferences;
  profile?: CandidateProfile;
  isDefaultProfile?: boolean;
  sourceIds?: string[];
}

export async function discoverJobs(
  input: DiscoverJobsInput,
  deps: JobDiscoveryDependencies = {}
): Promise<DiscoverJobsResponse> {
  if (deps.signal?.aborted) {
    throw new DiscoverySourceError("Haku keskeytettiin.", 499, "ABORTED");
  }

  const nowDate = deps.now?.() ?? new Date();
  const fetchedAt = nowDate.toISOString();
  const registry = getEmployerSourceRegistry(deps.registry);

  const requestedIds =
    input.sourceIds && input.sourceIds.length > 0
      ? new Set(input.sourceIds)
      : null;

  const targetEntries = registry.filter(
    (entry) => entry.active && (!requestedIds || requestedIds.has(entry.id))
  );

  const allNormalizedJobs: DiscoveredJob[] = [];
  const queriedSources: DiscoverySourceStatus[] = [];
  const succeededSources: string[] = [];
  const failedSources: DiscoverJobsResponse["failedSources"] = [];
  const warnings: string[] = [];

  const sourceFetchTasks = targetEntries.map(async (entry) => {
    const startMs = Date.now();
    const validation = validateEmployerSource(entry);
    if (!validation.valid) {
      return {
        entry,
        status: {
          employerId: entry.id,
          company: entry.company,
          source: entry.source,
          apiHost: entry.apiHost,
          status: "error",
          fetchedCount: 0,
          matchedCount: 0,
          retrievedAt: fetchedAt,
          errorCode: "INVALID_REGISTRY_ENTRY",
          errorMessage: validation.reason ?? "Virheellinen lähdeasetus.",
          durationMs: Date.now() - startMs,
        } satisfies DiscoverySourceStatus,
        normalizedJobs: [] as DiscoveredJob[],
        warnings: [] as string[],
      };
    }

    try {
      const adapterResult = await fetchSourceRawBoard(entry, deps);
      entry.lastSuccessfulFetchAt = adapterResult.retrievedAt;
      const normalized = adapterResult.rawJobs.map((raw) =>
        normalizeRawAtsJob(raw, adapterResult.retrievedAt, nowDate)
      );

      return {
        entry,
        status: {
          employerId: entry.id,
          company: entry.company,
          source: entry.source,
          apiHost: entry.apiHost,
          status: "ok",
          fetchedCount: normalized.length,
          matchedCount: 0,
          retrievedAt: adapterResult.retrievedAt,
          durationMs: Date.now() - startMs,
        } satisfies DiscoverySourceStatus,
        normalizedJobs: normalized,
        warnings: adapterResult.warnings,
      };
    } catch (err) {
      if (err instanceof DiscoverySourceError && err.code === "ABORTED") {
        throw err;
      }

      const errorCode =
        err instanceof DiscoverySourceError ? err.code : "SOURCE_FETCH_FAILED";
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Lähteen haku epäonnistui tuntemattoman virheen vuoksi.";
      const rateLimited =
        err instanceof DiscoverySourceError ? err.rateLimited : false;

      return {
        entry,
        status: {
          employerId: entry.id,
          company: entry.company,
          source: entry.source,
          apiHost: entry.apiHost,
          status: "error",
          fetchedCount: 0,
          matchedCount: 0,
          retrievedAt: fetchedAt,
          errorCode,
          errorMessage,
          rateLimited,
          durationMs: Date.now() - startMs,
        } satisfies DiscoverySourceStatus,
        normalizedJobs: [] as DiscoveredJob[],
        warnings: [
          `${entry.company} (${entry.source}): ${errorMessage}`,
        ],
      };
    }
  });

  const outcomes = await Promise.all(sourceFetchTasks);

  let totalFetchedCount = 0;
  for (const outcome of outcomes) {
    queriedSources.push(outcome.status);
    warnings.push(...outcome.warnings);

    if (outcome.status.status === "ok") {
      succeededSources.push(outcome.entry.id);
      totalFetchedCount += outcome.normalizedJobs.length;
      allNormalizedJobs.push(...outcome.normalizedJobs);
    } else {
      failedSources.push({
        employerId: outcome.entry.id,
        company: outcome.entry.company,
        source: outcome.entry.source,
        reason:
          outcome.status.errorMessage ?? "Lähteen haku epäonnistui.",
      });
    }
  }

  const deduped = deduplicateDiscoveredJobs(allNormalizedJobs);
  const effectiveProfile = input.preferences.useSavedProfile
    ? input.profile
    : undefined;

  const { matchedJobs, matchedCountByEmployerId } = scoreAndFilterDiscoveredJobs(
    deduped.jobs,
    input.preferences,
    effectiveProfile
  );

  for (const srcStatus of queriedSources) {
    if (srcStatus.status === "ok") {
      srcStatus.matchedCount =
        matchedCountByEmployerId.get(srcStatus.employerId) ?? 0;
    }
  }

  const profileMode: DiscoverJobsResponse["profileMode"] = !effectiveProfile
    ? "no_profile"
    : input.isDefaultProfile
    ? "default_example_profile"
    : "saved_profile";

  if (failedSources.length > 0 && succeededSources.length > 0) {
    warnings.unshift(
      `Osittainen haku: ${succeededSources.length}/${targetEntries.length} lähdettä vastasi onnistuneesti; ${failedSources.length} lähdettä epäonnistui.`
    );
  } else if (failedSources.length > 0 && succeededSources.length === 0) {
    warnings.unshift(
      "Kaikki valitut rekrytointilähteet epäonnistuivat tässä haussa."
    );
  }

  return {
    jobs: matchedJobs,
    totalFetchedCount,
    totalDeduplicatedCount: deduped.jobs.length,
    matchedCount: matchedJobs.length,
    queriedSources,
    succeededSources,
    failedSources,
    fetchedAt,
    warnings,
    profileMode,
    registryEmployers: registry.map((e) => ({
      id: e.id,
      company: e.company,
      source: e.source,
      active: e.active,
    })),
  };
}
