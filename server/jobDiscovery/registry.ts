import type { EmployerSourceEntry } from "./types.ts";
import type { JobDiscoverySourceType } from "../../src/types/career.ts";

export const ALLOWED_ATS_HOSTS: Record<JobDiscoverySourceType, Set<string>> = {
  ashby: new Set(["api.ashbyhq.com"]),
  greenhouse: new Set(["boards-api.greenhouse.io"]),
  lever: new Set(["api.lever.co", "api.eu.lever.co"]),
};

export const EMPLOYER_IDENTIFIER_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export const DEFAULT_EMPLOYER_SOURCE_REGISTRY: readonly EmployerSourceEntry[] = [
  {
    id: "ashby-hoxhunt",
    company: "Hoxhunt",
    source: "ashby",
    identifier: "hoxhunt",
    apiHost: "api.ashbyhq.com",
    active: true,
    lastSuccessfulFetchAt: null,
  },
  {
    id: "greenhouse-smartlyio",
    company: "Smartly",
    source: "greenhouse",
    identifier: "smartlyio",
    apiHost: "boards-api.greenhouse.io",
    active: true,
    lastSuccessfulFetchAt: null,
  },
  {
    id: "lever-netlight",
    company: "Netlight",
    source: "lever",
    identifier: "netlight",
    apiHost: "api.lever.co",
    active: true,
    lastSuccessfulFetchAt: null,
  },
];

// Runtime mutable copy for recording lastSuccessfulFetchAt without mutating the exported default constant
const runtimeRegistry: EmployerSourceEntry[] = DEFAULT_EMPLOYER_SOURCE_REGISTRY.map(
  (entry) => ({ ...entry })
);

export function getEmployerSourceRegistry(
  override?: EmployerSourceEntry[]
): EmployerSourceEntry[] {
  return override ?? runtimeRegistry;
}

export function validateEmployerSource(entry: EmployerSourceEntry): {
  valid: boolean;
  reason?: string;
} {
  if (!entry.id || !entry.company.trim()) {
    return { valid: false, reason: "Työnantajan nimi tai tunniste puuttuu." };
  }

  if (!EMPLOYER_IDENTIFIER_REGEX.test(entry.identifier)) {
    return {
      valid: false,
      reason: `Työnantajan rajapintatunniste "${entry.identifier}" on virheellinen.`,
    };
  }

  const allowedHosts = ALLOWED_ATS_HOSTS[entry.source];
  const normalizedHost = entry.apiHost.trim().toLowerCase().replace(/\.$/, "");
  if (!allowedHosts || !allowedHosts.has(normalizedHost)) {
    return {
      valid: false,
      reason: `Palvelinosoite "${entry.apiHost}" ei ole sallittu lähteelle ${entry.source}.`,
    };
  }

  return { valid: true };
}

export function isAllowedAtsJobUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
