import type {
  DiscoveredJob,
  DiscoveryRemoteType,
  DiscoverySearchPreferences,
  DiscoverySourceStatus,
  JobDiscoverySourceType,
} from "../../src/types/career.ts";
import type { DnsAddressRecord } from "../fetchJob.ts";

export interface EmployerSourceEntry {
  id: string;
  company: string;
  source: JobDiscoverySourceType;
  identifier: string;
  apiHost: string;
  active: boolean;
  lastSuccessfulFetchAt: string | null;
}

export interface DiscoveryHttpGetOptions {
  url: URL;
  resolvedIp: string;
  resolvedFamily: number;
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
  portOverride?: number;
  caOverride?: string | Buffer | Array<string | Buffer>;
}

export interface DiscoveryHttpGetResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface DiscoveryCacheEntry {
  fetchedAtMs: number;
  retrievedAt: string;
  rawJobs: RawAtsJobRecord[];
}

export interface JobDiscoveryDependencies {
  dnsLookup?: (hostname: string) => Promise<DnsAddressRecord[]>;
  httpGet?: (options: DiscoveryHttpGetOptions) => Promise<DiscoveryHttpGetResponse>;
  registry?: EmployerSourceEntry[];
  cache?: Map<string, DiscoveryCacheEntry>;
  cacheTtlMs?: number;
  bypassCache?: boolean;
  timeoutMs?: number;
  dnsTimeoutMs?: number;
  maxBytes?: number;
  maxPagesPerSource?: number;
  now?: () => Date;
  signal?: AbortSignal;
}

export interface RawAtsJobRecord {
  source: JobDiscoverySourceType;
  employerId: string;
  company: string;
  sourceJobId: string;
  title: string;
  locationRaw: string | null;
  secondaryLocationsRaw: string[];
  countryRaw: string | null;
  workplaceTypeRaw: string | null;
  isRemoteFlag: boolean | null;
  employmentTypeRaw: string | null;
  departmentRaw: string | null;
  descriptionHtmlOrText: string;
  jobUrl: string;
  publishedAt: string | null;
  updatedAt: string | null;
  deadlineRaw: string | null;
  languageRaw: string | null;
}

export interface AdapterFetchResult {
  rawJobs: RawAtsJobRecord[];
  retrievedAt: string;
  warnings: string[];
}

export type AtsAdapter = (
  entry: EmployerSourceEntry,
  deps: JobDiscoveryDependencies
) => Promise<AdapterFetchResult>;

export interface ScoreJobInput {
  job: DiscoveredJob;
  preferences: DiscoverySearchPreferences;
  rawDescriptionText: string;
}

export interface DiscoveryNormalizedContext {
  locationNorm: string;
  remoteType: DiscoveryRemoteType;
  sourceStatus?: DiscoverySourceStatus;
}
