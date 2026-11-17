import { z } from "zod";
import type {
  JobAnalysisResult,
  LearningOpportunityItem,
  MandatoryEligibilityItem,
  PartialMatchItem,
  SignificantGapItem,
  StrongMatchItem,
} from "../types/career.ts";

export const MISSING_VALUE = "Ei ilmoitettu";

function normalizeFieldText(val: unknown): string {
  if (typeof val !== "string") return MISSING_VALUE;
  const trimmed = val.trim();
  if (!trimmed) return MISSING_VALUE;
  const lowered = trimmed.toLowerCase();
  if (
    lowered === "null" ||
    lowered === "undefined" ||
    lowered === "n/a" ||
    lowered === "unknown" ||
    lowered === "not specified" ||
    lowered === "not mentioned" ||
    lowered === "none" ||
    lowered === "-"
  ) {
    return MISSING_VALUE;
  }
  return trimmed;
}

function normalizeOptionalEvidence(val: unknown): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (
    !trimmed ||
    trimmed.toLowerCase() === "null" ||
    trimmed === MISSING_VALUE
  ) {
    return null;
  }
  return trimmed;
}

function normalizeTextForDedupe(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9äöå]+/g, " ")
    .trim();
}

const PRACTICAL_CONDITION_ONLY_PATTERN =
  /^(sijainti|asuinpaikka|tyopaikan sijainti|työpaikan sijainti|tyosuhde|työsuhde|tyosuhteen tyyppi|työsuhteen tyyppi|palkka|palkkaus|hakuaika|aloitus|tyoaika|työaika|hybridimalli|etatyo|etätyö)\b/i;

function isPurePracticalConditionLeak(text: string): boolean {
  const cleaned = text.trim();
  if (PRACTICAL_CONDITION_ONLY_PATTERN.test(cleaned)) {
    return true;
  }
  return false;
}

const INTERNSHIP_AS_GAP_PATTERN =
  /(harjoittelu|tyoharjoittelu|työharjoittelu).*(suorittamatta|puuttuu|kesken|vakinainen|toistaiseksi)|(vakinainen|toistaiseksi).*(harjoittelu)/i;

function isInternshipPermanentConflictMistake(
  requirement: string,
  gapDetail: string
): boolean {
  return INTERNSHIP_AS_GAP_PATTERN.test(`${requirement} ${gapDetail}`);
}

const MATCH_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "on",
  "at",
  "for",
  "to",
  "and",
  "or",
  "with",
  "least",
  "years",
  "year",
  "missing",
  "required",
  "mandatory",
  "preferred",
  "valid",
  "experience",
  "skills",
  "skill",
  "knowledge",
  "understanding",
  "ability",
  "proficiency",
  "ja",
  "tai",
  "seka",
  "vahintaan",
  "vuoden",
  "vuotta",
  "puuttuva",
  "puuttuu",
  "vaadittu",
  "vaaditaan",
  "pakollinen",
  "voimassa",
  "oleva",
  "kokemus",
  "kokemusta",
  "osaaminen",
  "osaamista",
  "taito",
  "taidot",
  "tuntemus",
  "ymmarrys",
  "aiempi",
  "usean",
]);

const EXPLICIT_MANDATORY_SIGNAL =
  /\b(required|must have|mandatory|at least \d+|minimum \d+|certification|certified|pakollinen|vaaditaan|vaatimus|edellyt\w*|sertifikaatti|vahintaan \d+|vähintään \d+)\b/i;

const EXPLICIT_OPTIONAL_SIGNAL =
  /\b(mahdollisesti|ei vaadittu|valinnainen|optional|nice to have|bonus|eduksi)\b/i;

function tokenizeNormalized(text: string): string[] {
  const norm = normalizeTextForDedupe(text);
  return norm ? norm.split(/\s+/).filter(Boolean) : [];
}

function extractDomainTokens(text: string): string[] {
  return tokenizeNormalized(text).filter(
    (token) => !MATCH_STOPWORDS.has(token) && !/^\d+$/.test(token)
  );
}

function hasContiguousTokenSubsequence(
  tokensA: string[],
  tokensB: string[]
): boolean {
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  const [shorter, longer] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];

  for (let i = 0; i <= longer.length - shorter.length; i++) {
    let matches = true;
    for (let j = 0; j < shorter.length; j++) {
      if (longer[i + j] !== shorter[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function evidenceTextsAlign(
  evidenceA: string | null | undefined,
  evidenceB: string | null | undefined
): boolean {
  const normA = normalizeTextForDedupe(evidenceA ?? "");
  const normB = normalizeTextForDedupe(evidenceB ?? "");
  if (normA.length < 12 || normB.length < 12) return false;
  if (normA === normB) return true;
  return hasContiguousTokenSubsequence(
    tokenizeNormalized(normA),
    tokenizeNormalized(normB)
  );
}

function matchesRequirementTarget(
  gap: SignificantGapItem,
  targetText: string,
  targetEvidence?: string | null
): boolean {
  const normGap = normalizeTextForDedupe(gap.requirement);
  const normTarget = normalizeTextForDedupe(targetText);
  if (!normGap || !normTarget) return false;
  if (normGap === normTarget) return true;

  if (
    evidenceTextsAlign(gap.jobEvidence, targetEvidence) ||
    evidenceTextsAlign(gap.jobEvidence, targetText)
  ) {
    return true;
  }

  const gapDomain = extractDomainTokens(gap.requirement);
  const targetDomain = extractDomainTokens(targetText);
  if (gapDomain.length === 0 || targetDomain.length === 0) {
    return false;
  }

  if (
    gapDomain.length >= 1 &&
    targetDomain.length >= 1 &&
    hasContiguousTokenSubsequence(
      tokenizeNormalized(normGap),
      tokenizeNormalized(normTarget)
    ) &&
    gapDomain.some((token) => targetDomain.includes(token))
  ) {
    return true;
  }

  const targetDomainSet = new Set(targetDomain);
  const gapDomainSet = new Set(gapDomain);
  let sharedCount = 0;
  for (const token of gapDomainSet) {
    if (targetDomainSet.has(token)) sharedCount++;
  }

  const minSize = Math.min(gapDomainSet.size, targetDomainSet.size);
  if (sharedCount >= 2) return true;
  if (minSize === 1 && sharedCount === 1) return true;

  return false;
}

function matchesPreferredOnlyTarget(
  gap: SignificantGapItem,
  preferredText: string,
  preferredEvidence?: string | null
): boolean {
  const normGap = normalizeTextForDedupe(gap.requirement);
  const normPref = normalizeTextForDedupe(preferredText);
  if (!normGap || !normPref) return false;
  if (normGap === normPref) return true;

  if (
    evidenceTextsAlign(gap.jobEvidence, preferredEvidence) ||
    evidenceTextsAlign(gap.jobEvidence, preferredText)
  ) {
    const gapDomain = extractDomainTokens(gap.requirement);
    const prefDomainSet = new Set(extractDomainTokens(preferredText));
    return (
      gapDomain.length > 0 &&
      gapDomain.every((token) => prefDomainSet.has(token))
    );
  }

  const gapDomain = extractDomainTokens(gap.requirement);
  const prefDomainSet = new Set(extractDomainTokens(preferredText));
  if (gapDomain.length === 0 || prefDomainSet.size === 0) return false;

  return gapDomain.every((token) => prefDomainSet.has(token));
}

function overlapsLearningAsOptional(
  gap: SignificantGapItem,
  learning: LearningOpportunityItem
): boolean {
  const gapDomain = extractDomainTokens(gap.requirement);
  const learningDomain = extractDomainTokens(learning.technologyOrTopic);
  if (gapDomain.length === 0 || learningDomain.length === 0) {
    return false;
  }

  const learningDomainSet = new Set(learningDomain);
  const allGapDomainTokensCovered = gapDomain.every((token) =>
    learningDomainSet.has(token)
  );
  if (!allGapDomainTokensCovered) {
    return false;
  }

  const gapHasMandatorySignal = EXPLICIT_MANDATORY_SIGNAL.test(
    `${gap.requirement} ${gap.jobEvidence}`
  );
  const learningHasOptionalSignal = EXPLICIT_OPTIONAL_SIGNAL.test(
    `${learning.contextInJob} ${learning.evidence ?? ""}`
  );
  if (gapHasMandatorySignal && !learningHasOptionalSignal) {
    return false;
  }

  return true;
}

export function deduplicateGaps(
  gaps: SignificantGapItem[],
  learningOpportunities: LearningOpportunityItem[],
  requiredQualifications: Array<{ item: string; evidence?: string | null }> = [],
  preferredQualifications: Array<{ item: string; evidence?: string | null }> = [],
  mandatoryEligibility: MandatoryEligibilityItem[] = []
): SignificantGapItem[] {
  const activeMandatoryEligibility = mandatoryEligibility.filter(
    (item) => item.status !== "Täyttyy"
  );

  const seenTokenLists: string[][] = [];
  const seenKeys = new Set<string>();
  const result: SignificantGapItem[] = [];

  for (const gap of gaps) {
    if (isInternshipPermanentConflictMistake(gap.requirement, gap.gapDetail)) {
      continue;
    }
    if (isPurePracticalConditionLeak(gap.requirement)) {
      continue;
    }

    const key = normalizeTextForDedupe(gap.requirement);
    if (!key) continue;

    // Explicitly required qualifications and mandatory eligibility gaps always take precedence
    const isExplicitlyRequired =
      requiredQualifications.some((req) =>
        matchesRequirementTarget(gap, req.item, req.evidence)
      ) ||
      activeMandatoryEligibility.some((elig) =>
        matchesRequirementTarget(gap, elig.requirement, elig.evidence)
      );

    if (!isExplicitlyRequired) {
      // Only remove a gap as an optional learning opportunity when it unambiguously
      // refers to the optional technology without carrying unaddressed mandatory scope
      const overlapsOptionalLearning = learningOpportunities.some((lo) =>
        overlapsLearningAsOptional(gap, lo)
      );
      if (overlapsOptionalLearning) continue;

      // Only suppress purely preferred ("nice-to-have") items when not required
      const isPreferredOnly = preferredQualifications.some((pref) =>
        matchesPreferredOnlyTarget(gap, pref.item, pref.evidence)
      );
      if (isPreferredOnly) continue;
    }

    // Prevent double-counting identical or near-identical missing skills using token boundaries
    const gapTokens = tokenizeNormalized(key);
    const alreadySeen =
      seenKeys.has(key) ||
      seenTokenLists.some(
        (existingTokens) =>
          existingTokens.length >= 2 &&
          gapTokens.length >= 2 &&
          hasContiguousTokenSubsequence(existingTokens, gapTokens)
      );
    if (alreadySeen) continue;

    seenKeys.add(key);
    seenTokenLists.push(gapTokens);
    result.push(gap);
  }

  return result;
}

function deduplicateLearningOpportunities(
  items: LearningOpportunityItem[],
  preservedRequiredGaps: SignificantGapItem[] = []
): LearningOpportunityItem[] {
  const seen = new Set<string>();
  const result: LearningOpportunityItem[] = [];
  for (const item of items) {
    const key = normalizeTextForDedupe(item.technologyOrTopic);
    if (!key || seen.has(key)) continue;

    const conflictsWithRequiredGap = preservedRequiredGaps.some((gap) =>
      matchesRequirementTarget(gap, item.technologyOrTopic, item.evidence)
    );
    if (conflictsWithRequiredGap) continue;

    seen.add(key);
    result.push(item);
  }
  return result;
}

function filterSkillMatchesFromPracticalLeaks<
  T extends StrongMatchItem | PartialMatchItem,
>(items: T[]): T[] {
  return items.filter(
    (item) => !isPurePracticalConditionLeak(item.skillOrRequirement)
  );
}

export const candidateProfileSchema = z.object({
  headline: z.string().trim().min(1),
  institutionAndDegree: z.string().trim().min(1),
  studyProgress: z.string().trim().min(1),
  previousItInternship: z.string().trim().min(1),
  coursework: z.string().trim().min(1),
  technicalSkills: z.string().trim().min(1),
  aiExperienceNote: z.string().trim().min(1),
  otherWorkExperience: z.string().trim().min(1),
  careerGoals: z.string().trim().min(1),
  availabilityAndLocation: z.string().trim().min(1),
  strictConstraints: z.string().trim().min(1),
  updatedAt: z.string().default(() => new Date().toISOString()),
});

const extractedItemSchema = z.object({
  item: z.string().transform((v) => normalizeFieldText(v)),
  evidence: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => normalizeOptionalEvidence(v)),
});

const applicationStepSchema = z.object({
  step: z.string().trim().min(1),
  isMandatory: z.boolean().default(true),
  parts: z.array(z.string().trim().min(1)).default([]),
  evidence: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => normalizeOptionalEvidence(v)),
  candidateCaution: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => normalizeOptionalEvidence(v)),
});

const mandatoryEligibilitySchema = z.object({
  requirement: z.string().trim().min(1),
  status: z.enum(["Täyttyy", "Tarkistettava", "Puuttuu", "Ei ilmoitettu"]),
  detail: z.string().trim().min(1),
  evidence: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => normalizeOptionalEvidence(v)),
});

const learningOpportunitySchema = z.object({
  technologyOrTopic: z.string().trim().min(1),
  contextInJob: z.string().trim().min(1),
  evidence: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => normalizeOptionalEvidence(v)),
});

const practicalConsiderationsSchema = z.object({
  locationAndCommute: z.string().transform((v) => normalizeFieldText(v)),
  shiftAndScheduleFeasibility: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : normalizeFieldText(v))),
  scheduleAndStart: z.string().transform((v) => normalizeFieldText(v)),
  employmentTypeNote: z.string().transform((v) => normalizeFieldText(v)),
  salaryNote: z.string().transform((v) => normalizeFieldText(v)),
  internshipCreditAssessment: z
    .string()
    .transform((v) => normalizeFieldText(v)),
});

export const jobAnalysisResultSchema = z.object({
  extracted: z.object({
    company: z.string().transform((v) => normalizeFieldText(v)),
    position: z.string().transform((v) => normalizeFieldText(v)),
    location: z.string().transform((v) => normalizeFieldText(v)),
    workModel: z.string().transform((v) => normalizeFieldText(v)),
    employmentType: z.string().transform((v) => normalizeFieldText(v)),
    deadline: z.string().transform((v) => normalizeFieldText(v)),
    salaryInfo: z.string().transform((v) => normalizeFieldText(v)),
    requiredQualifications: z.array(extractedItemSchema).default([]),
    preferredQualifications: z.array(extractedItemSchema).default([]),
    mainResponsibilities: z.array(extractedItemSchema).default([]),
    applicationSteps: z.array(applicationStepSchema).optional().default([]),
  }),
  mandatoryEligibility: z
    .array(mandatoryEligibilitySchema)
    .optional()
    .default([]),
  skillsComparison: z.object({
    strongMatches: z
      .array(
        z.object({
          skillOrRequirement: z.string().trim().min(1),
          candidateBasis: z.string().trim().min(1),
          jobEvidence: z.string().trim().min(1),
        })
      )
      .default([]),
    partialMatches: z
      .array(
        z.object({
          skillOrRequirement: z.string().trim().min(1),
          candidateBasis: z.string().trim().min(1),
          gapOrNote: z.string().trim().min(1),
          jobEvidence: z.string().trim().min(1),
        })
      )
      .default([]),
    significantGaps: z
      .array(
        z.object({
          requirement: z.string().trim().min(1),
          gapDetail: z.string().trim().min(1),
          jobEvidence: z.string().trim().min(1),
        })
      )
      .default([]),
    learningOpportunities: z
      .array(learningOpportunitySchema)
      .optional()
      .default([]),
    unknownInformation: z
      .array(
        z.object({
          topic: z.string().trim().min(1),
          reason: z.string().trim().min(1),
        })
      )
      .default([]),
  }),
  practicalConsiderations: practicalConsiderationsSchema.optional(),
  cybersecurityEvaluation: z.object({
    relevanceLevel: z.enum(["Korkea", "Kohtalainen", "Välillinen", "Vähäinen"]),
    progressionPath: z.enum(["Suora", "Välillinen", "Vahvistamaton"]),
    taskDomains: z.array(z.string().trim().min(1)).optional().default([]),
    relevantDomains: z.array(z.string().trim().min(1)).default([]),
    factsSummary: z.string().trim().min(1),
    interpretationSummary: z.string().trim().min(1),
    transferableCyberSkills: z.string().trim().optional(),
    verifiedInternalOpportunities: z.string().trim().optional(),
    internalCareerOpportunities: z
      .object({
        confirmed: z.string().transform((v) => normalizeFieldText(v)),
        plausible: z.string().transform((v) => normalizeFieldText(v)),
        unknown: z.string().transform((v) => normalizeFieldText(v)),
      })
      .optional(),
  }),
  recommendation: z.object({
    category: z.enum([
      "Ensisijainen hakukohde",
      "Harkinnan arvoinen",
      "Matala prioriteetti",
      "Jätä väliin",
    ]),
    criticalReasons: z.array(z.string().trim().min(1)).min(1),
    nextAction: z.string().trim().min(1),
  }),
  evidenceHighlights: z
    .array(
      z.object({
        claim: z.string().trim().min(1),
        excerpt: z.string().trim().min(1),
        kind: z.enum(["Fakta", "Vaatimus", "Ehto"]),
      })
    )
    .default([]),
  urlVerificationNotice: z.string().trim().min(1),
});

function normalizeConflictingDeadlineOutput(
  modelDeadline: string,
  rawJobText?: string
): string {
  if (!rawJobText) return modelDeadline;
  const conflictHeaderMatch =
    /^Hakuaika\s*\(RISTIRIITAINEN[^)]*\)\s*:\s*(.+)$/im.exec(rawJobText);
  if (!conflictHeaderMatch) return modelDeadline;

  const conflictSummary = conflictHeaderMatch[1].trim();
  const normalizedModel = modelDeadline.trim();
  if (/ristiriit|konflikti|tarkistettava/i.test(normalizedModel)) {
    return normalizedModel;
  }

  return `Ristiriitainen (tarkistettava): ${conflictSummary}`;
}

export function validateAndNormalizeAnalysis(
  raw: unknown,
  providedUrl: string,
  rawJobText?: string
): JobAnalysisResult {
  const parsed = jobAnalysisResultSchema.parse(raw);
  const cleanUrl = providedUrl.trim();
  const enforcedUrlNotice = cleanUrl
    ? `Analyysi perustuu syötettyyn ilmoitustekstiin (käsin liitettyyn tai erillisellä URL-noudolla haettuun viiteosoitteesta ${cleanUrl}). Tämä analyysi ei tarkista haun voimassaoloa verkosta; pelkkä teksti, onnistunut URL-nouto tai viite-URL ei yksinään todista, että haku on avoinna.`
    : "URL-osoitetta ei annettu. Analyysi perustuu syötettyyn ilmoitustekstiin, eikä se yksinään todista, että haku on avoinna.";

  const normalizedDeadline = normalizeConflictingDeadlineOutput(
    parsed.extracted.deadline,
    rawJobText
  );

  const rawLearningOpportunities = deduplicateLearningOpportunities(
    parsed.skillsComparison.learningOpportunities ?? []
  );

  const significantGaps = deduplicateGaps(
    parsed.skillsComparison.significantGaps,
    rawLearningOpportunities,
    parsed.extracted.requiredQualifications,
    parsed.extracted.preferredQualifications,
    parsed.mandatoryEligibility ?? []
  );

  const activeMandatoryEligibility = (parsed.mandatoryEligibility ?? []).filter(
    (item) => item.status !== "Täyttyy"
  );
  const preservedRequiredGaps = significantGaps.filter(
    (gap) =>
      parsed.extracted.requiredQualifications.some((req) =>
        matchesRequirementTarget(gap, req.item, req.evidence)
      ) ||
      activeMandatoryEligibility.some((elig) =>
        matchesRequirementTarget(gap, elig.requirement, elig.evidence)
      )
  );

  const learningOpportunities = deduplicateLearningOpportunities(
    rawLearningOpportunities,
    preservedRequiredGaps
  );

  const strongMatches = filterSkillMatchesFromPracticalLeaks(
    parsed.skillsComparison.strongMatches
  );
  const partialMatches = filterSkillMatchesFromPracticalLeaks(
    parsed.skillsComparison.partialMatches
  );

  const taskDomains =
    parsed.cybersecurityEvaluation.taskDomains &&
    parsed.cybersecurityEvaluation.taskDomains.length > 0
      ? parsed.cybersecurityEvaluation.taskDomains
      : parsed.cybersecurityEvaluation.relevantDomains;

  const practicalConsiderations = parsed.practicalConsiderations ?? {
    locationAndCommute:
      parsed.extracted.location !== MISSING_VALUE
        ? `${parsed.extracted.location} (${parsed.extracted.workModel})`
        : MISSING_VALUE,
    scheduleAndStart: normalizedDeadline,
    employmentTypeNote: parsed.extracted.employmentType,
    salaryNote: parsed.extracted.salaryInfo,
    internshipCreditAssessment: MISSING_VALUE,
  };

  return {
    ...parsed,
    extracted: {
      ...parsed.extracted,
      deadline: normalizedDeadline,
    },
    skillsComparison: {
      ...parsed.skillsComparison,
      strongMatches,
      partialMatches,
      significantGaps,
      learningOpportunities,
    },
    practicalConsiderations,
    cybersecurityEvaluation: {
      ...parsed.cybersecurityEvaluation,
      taskDomains,
      relevantDomains:
        parsed.cybersecurityEvaluation.relevantDomains.length > 0
          ? parsed.cybersecurityEvaluation.relevantDomains
          : taskDomains,
    },
    urlVerificationNotice: enforcedUrlNotice,
  };
}

export const savedJobStatusSchema = z.enum([
  "Tallennettu",
  "Harkinnassa",
  "Haettu",
  "Haastattelussa",
  "Hylätty",
  "Ohitettu",
]);

export const applicationAvailabilitySchema = z.enum([
  "Avoinna",
  "Päättynyt",
  "Ei tarkistettu",
]);

export const savedJobEntrySchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().optional().default(""),
  jobUrl: z.string().default(""),
  rawJobText: z.string().min(1),
  status: savedJobStatusSchema,
  availabilityStatus: applicationAvailabilitySchema
    .optional()
    .default("Ei tarkistettu"),
  availabilityVerifiedAt: z.string().optional().default(""),
  availabilitySourceUrl: z.string().optional().default(""),
  notes: z.string().default(""),
  targetDate: z.string().default(""),
  analysis: jobAnalysisResultSchema,
});

export const careerBackupSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().min(1),
  profile: candidateProfileSchema,
  savedJobs: z.array(savedJobEntrySchema),
});

export const analyzeRequestSchema = z.object({
  jobText: z
    .string()
    .trim()
    .min(
      40,
      "Liitä riittävän kattava työpaikkailmoituksen teksti (vähintään 40 merkkiä)."
    )
    .max(30000, "Ilmoitusteksti on liian pitkä (enintään 30 000 merkkiä)."),
  jobUrl: z
    .string()
    .trim()
    .max(2048, "URL-osoite on liian pitkä.")
    .optional()
    .default(""),
  profile: candidateProfileSchema,
});

export const fetchJobRequestSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Anna työpaikkailmoituksen URL-osoite.")
    .max(2048, "URL-osoite on liian pitkä."),
});

export const discoveryPreferencesSchema = z.object({
  useSavedProfile: z.boolean().default(true),
  seniorityLevel: z
    .enum(["intern_trainee_junior", "all"])
    .default("intern_trainee_junior"),
  locationQuery: z.string().trim().max(120).default("Uusimaa"),
  remotePreference: z
    .enum(["finland_compatible", "onsite_or_hybrid", "remote_only", "any"])
    .default("finland_compatible"),
  industryFocus: z
    .enum(["it_cyber_and_pathways", "all"])
    .default("it_cyber_and_pathways"),
  languages: z
    .array(z.enum(["fi", "en"]))
    .min(1)
    .max(2)
    .default(["fi", "en"]),
  keyword: z.string().trim().max(120).default(""),
});

export const discoverJobsRequestSchema = z.object({
  preferences: discoveryPreferencesSchema,
  profile: candidateProfileSchema.optional(),
  isDefaultProfile: z.boolean().optional().default(false),
  sourceIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
});

