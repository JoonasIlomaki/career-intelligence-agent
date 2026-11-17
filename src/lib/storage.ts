import { DEFAULT_CANDIDATE_PROFILE } from "../data/defaultProfile.ts";
import {
  candidateProfileSchema,
  careerBackupSchema,
  discoveryPreferencesSchema,
  savedJobEntrySchema,
} from "./validation.ts";
import type {
  CandidateProfile,
  CareerBackupPayload,
  DiscoverySearchPreferences,
  SavedJobEntry,
} from "../types/career.ts";

const PROFILE_STORAGE_KEY = "cia_candidate_profile_v1";
const JOBS_STORAGE_KEY = "cia_saved_jobs_v1";
const DISCOVERY_PREFS_STORAGE_KEY = "cia_discovery_preferences_v1";

export const DEFAULT_DISCOVERY_PREFERENCES: DiscoverySearchPreferences = {
  useSavedProfile: true,
  seniorityLevel: "intern_trainee_junior",
  locationQuery: "Uusimaa",
  remotePreference: "finland_compatible",
  industryFocus: "it_cyber_and_pathways",
  languages: ["fi", "en"],
  keyword: "",
};

export function isDefaultCandidateProfile(profile: CandidateProfile): boolean {
  const keys: Array<keyof Omit<CandidateProfile, "updatedAt">> = [
    "headline",
    "institutionAndDegree",
    "studyProgress",
    "previousItInternship",
    "coursework",
    "technicalSkills",
    "aiExperienceNote",
    "otherWorkExperience",
    "careerGoals",
    "availabilityAndLocation",
    "strictConstraints",
  ];
  return keys.every(
    (key) => profile[key].trim() === DEFAULT_CANDIDATE_PROFILE[key].trim()
  );
}

export function loadDiscoveryPreferences(
  storage: Pick<Storage, "getItem"> | undefined =
    typeof window !== "undefined" ? window.localStorage : undefined
): DiscoverySearchPreferences {
  try {
    const raw = storage?.getItem(DISCOVERY_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DISCOVERY_PREFERENCES };
    const parsed = JSON.parse(raw);
    const validated = discoveryPreferencesSchema.safeParse(parsed);
    if (!validated.success) return { ...DEFAULT_DISCOVERY_PREFERENCES };
    return validated.data;
  } catch {
    return { ...DEFAULT_DISCOVERY_PREFERENCES };
  }
}

export function saveDiscoveryPreferences(
  preferences: DiscoverySearchPreferences,
  storage: Pick<Storage, "setItem"> | undefined =
    typeof window !== "undefined" ? window.localStorage : undefined
): void {
  storage?.setItem(DISCOVERY_PREFS_STORAGE_KEY, JSON.stringify(preferences));
}

export function loadCandidateProfile(
  storage: Pick<Storage, "getItem"> | undefined =
    typeof window !== "undefined" ? window.localStorage : undefined
): CandidateProfile {
  try {
    const raw = storage?.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return DEFAULT_CANDIDATE_PROFILE;
    const parsed = JSON.parse(raw);
    const validated = candidateProfileSchema.safeParse(parsed);
    if (!validated.success) return DEFAULT_CANDIDATE_PROFILE;
    return validated.data;
  } catch {
    return DEFAULT_CANDIDATE_PROFILE;
  }
}

export function saveCandidateProfile(profile: CandidateProfile): void {
  const withTimestamp: CandidateProfile = {
    ...profile,
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(
    PROFILE_STORAGE_KEY,
    JSON.stringify(withTimestamp)
  );
}

export function resetCandidateProfile(): CandidateProfile {
  const fresh: CandidateProfile = {
    ...DEFAULT_CANDIDATE_PROFILE,
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

export function loadSavedJobs(
  storage: Pick<Storage, "getItem"> | undefined =
    typeof window !== "undefined" ? window.localStorage : undefined
): SavedJobEntry[] {
  try {
    const raw = storage?.getItem(JOBS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const validJobs: SavedJobEntry[] = [];
    for (const item of parsed) {
      const result = savedJobEntrySchema.safeParse(item);
      if (result.success) {
        validJobs.push(result.data);
      }
    }
    return validJobs;
  } catch {
    return [];
  }
}

export function saveSavedJobs(jobs: SavedJobEntry[]): void {
  window.localStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(jobs));
}

export function createBackupJson(
  profile: CandidateProfile,
  savedJobs: SavedJobEntry[]
): string {
  const payload: CareerBackupPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    profile,
    savedJobs,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseBackupJson(rawJson: string): CareerBackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("Tiedosto ei ole kelvollista JSON-muotoa.");
  }

  const result = careerBackupSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      "Varmuuskopiotiedoston rakenne ei vastaa Career Intelligence Agent -muotoa."
    );
  }

  return result.data;
}

