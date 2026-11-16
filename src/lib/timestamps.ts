import type { SavedJobEntry } from "../types/career.ts";

export type SavedJobMetaPatch = Partial<
  Pick<
    SavedJobEntry,
    | "status"
    | "notes"
    | "targetDate"
    | "jobUrl"
    | "availabilityStatus"
    | "availabilityVerifiedAt"
    | "availabilitySourceUrl"
  >
>;

/**
 * Formats an ISO timestamp into Finnish local format "dd.MM.yyyy klo HH:mm".
 * For legacy date-only values (e.g. "2026-10-27" or "27.10.2026"), formats
 * strictly as "dd.MM.yyyy" without inventing a missing time component.
 */
export function formatSavedJobTimestamp(value: string | undefined | null): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "—";

  const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoDateOnly) {
    const [, year, month, day] = isoDateOnly;
    return `${day}.${month}.${year}`;
  }

  const fiDateOnly = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (fiDateOnly) {
    const [, day, month, year] = fiDateOnly;
    return `${day.padStart(2, "0")}.${month.padStart(2, "0")}.${year}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }

  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = String(parsed.getFullYear());
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");

  return `${day}.${month}.${year} klo ${hours}:${minutes}`;
}

/**
 * Applies metadata edits to a SavedJobEntry while preserving the original
 * createdAt timestamp and updating updatedAt whenever any field changes.
 */
export function applySavedJobMetaPatch(
  job: SavedJobEntry,
  patch: SavedJobMetaPatch,
  nowIso: string = new Date().toISOString()
): SavedJobEntry {
  const keys = Object.keys(patch) as Array<keyof SavedJobMetaPatch>;
  const hasChange = keys.some(
    (key) => patch[key] !== undefined && patch[key] !== job[key]
  );

  if (!hasChange) {
    return job;
  }

  return {
    ...job,
    ...patch,
    createdAt: job.createdAt,
    updatedAt: nowIso,
  };
}
