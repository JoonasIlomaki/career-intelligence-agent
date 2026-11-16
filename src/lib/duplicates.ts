import type { SavedJobEntry } from "../types/career.ts";
import { MISSING_VALUE } from "./validation.ts";

export function normalizeDuplicateKeyPart(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(oyj|oy|ab|inc|ltd|gmbh|finland)\b/g, "")
    .replace(/[^a-z0-9äöå]+/g, " ")
    .trim();
}

export function buildCompanyPositionSignature(
  company: string,
  position: string
): string | null {
  if (
    !company ||
    !position ||
    company === MISSING_VALUE ||
    position === MISSING_VALUE
  ) {
    return null;
  }
  const c = normalizeDuplicateKeyPart(company);
  const p = normalizeDuplicateKeyPart(position);
  if (!c || !p) return null;
  return `${c}::${p}`;
}

export function normalizeUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

export interface DuplicateMatch {
  entry: SavedJobEntry;
  reason: "Yritys ja tehtävänimike täsmäävät" | "Sama URL-osoite";
}

export function findPotentialDuplicates(
  savedJobs: SavedJobEntry[],
  company: string,
  position: string,
  jobUrl: string,
  excludeId?: string
): DuplicateMatch[] {
  const targetSig = buildCompanyPositionSignature(company, position);
  const targetUrl = jobUrl.trim() ? normalizeUrl(jobUrl) : "";
  const matches: DuplicateMatch[] = [];

  for (const job of savedJobs) {
    if (excludeId && job.id === excludeId) continue;

    const jobSig = buildCompanyPositionSignature(
      job.analysis.extracted.company,
      job.analysis.extracted.position
    );

    if (targetSig && jobSig && targetSig === jobSig) {
      matches.push({
        entry: job,
        reason: "Yritys ja tehtävänimike täsmäävät",
      });
      continue;
    }

    if (targetUrl && job.jobUrl.trim()) {
      const existingUrl = normalizeUrl(job.jobUrl);
      if (existingUrl && existingUrl === targetUrl) {
        matches.push({
          entry: job,
          reason: "Sama URL-osoite",
        });
      }
    }
  }

  return matches;
}

export function getDuplicateIdSet(savedJobs: SavedJobEntry[]): Set<string> {
  const bySignature = new Map<string, string[]>();
  for (const job of savedJobs) {
    const sig = buildCompanyPositionSignature(
      job.analysis.extracted.company,
      job.analysis.extracted.position
    );
    if (!sig) continue;
    const list = bySignature.get(sig) ?? [];
    list.push(job.id);
    bySignature.set(sig, list);
  }

  const duplicateIds = new Set<string>();
  for (const ids of bySignature.values()) {
    if (ids.length > 1) {
      for (const id of ids) duplicateIds.add(id);
    }
  }
  return duplicateIds;
}
