export type RecommendationCategory =
  | "Ensisijainen hakukohde"
  | "Harkinnan arvoinen"
  | "Matala prioriteetti"
  | "Jätä väliin";

export type CybersecurityRelevance =
  | "Korkea"
  | "Kohtalainen"
  | "Välillinen"
  | "Vähäinen";

export type ProgressionPath =
  | "Suora"
  | "Välillinen"
  | "Vahvistamaton";

export type SavedJobStatus =
  | "Tallennettu"
  | "Harkinnassa"
  | "Haettu"
  | "Haastattelussa"
  | "Hylätty"
  | "Ohitettu";

export type EligibilityStatus =
  | "Täyttyy"
  | "Tarkistettava"
  | "Puuttuu"
  | "Ei ilmoitettu";

export type ApplicationAvailabilityStatus =
  | "Avoinna"
  | "Päättynyt"
  | "Ei tarkistettu";

export interface CandidateProfile {
  headline: string;
  institutionAndDegree: string;
  studyProgress: string;
  previousItInternship: string;
  coursework: string;
  technicalSkills: string;
  aiExperienceNote: string;
  otherWorkExperience: string;
  careerGoals: string;
  availabilityAndLocation: string;
  strictConstraints: string;
  updatedAt: string;
}

export interface ExtractedItemWithEvidence {
  item: string;
  evidence: string | null;
}

export interface ApplicationStepItem {
  step: string;
  isMandatory: boolean;
  parts: string[];
  evidence: string | null;
  candidateCaution: string | null;
}

export interface MandatoryEligibilityItem {
  requirement: string;
  status: EligibilityStatus;
  detail: string;
  evidence: string | null;
}

export interface StrongMatchItem {
  skillOrRequirement: string;
  candidateBasis: string;
  jobEvidence: string;
}

export interface PartialMatchItem {
  skillOrRequirement: string;
  candidateBasis: string;
  gapOrNote: string;
  jobEvidence: string;
}

export interface SignificantGapItem {
  requirement: string;
  gapDetail: string;
  jobEvidence: string;
}

export interface LearningOpportunityItem {
  technologyOrTopic: string;
  contextInJob: string;
  evidence: string | null;
}

export interface UnknownInfoItem {
  topic: string;
  reason: string;
}

export interface PracticalConsiderations {
  locationAndCommute: string;
  shiftAndScheduleFeasibility?: string;
  scheduleAndStart: string;
  employmentTypeNote: string;
  salaryNote: string;
  internshipCreditAssessment: string;
}

export interface EvidenceHighlight {
  claim: string;
  excerpt: string;
  kind: "Fakta" | "Vaatimus" | "Ehto";
}

export interface JobAnalysisResult {
  extracted: {
    company: string;
    position: string;
    location: string;
    workModel: string;
    employmentType: string;
    deadline: string;
    salaryInfo: string;
    requiredQualifications: ExtractedItemWithEvidence[];
    preferredQualifications: ExtractedItemWithEvidence[];
    mainResponsibilities: ExtractedItemWithEvidence[];
    applicationSteps?: ApplicationStepItem[];
  };
  mandatoryEligibility?: MandatoryEligibilityItem[];
  skillsComparison: {
    strongMatches: StrongMatchItem[];
    partialMatches: PartialMatchItem[];
    significantGaps: SignificantGapItem[];
    learningOpportunities?: LearningOpportunityItem[];
    unknownInformation: UnknownInfoItem[];
  };
  practicalConsiderations?: PracticalConsiderations;
  cybersecurityEvaluation: {
    relevanceLevel: CybersecurityRelevance;
    progressionPath: ProgressionPath;
    taskDomains?: string[];
    relevantDomains: string[];
    factsSummary: string;
    interpretationSummary: string;
    transferableCyberSkills?: string;
    verifiedInternalOpportunities?: string;
    internalCareerOpportunities?: {
      confirmed: string;
      plausible: string;
      unknown: string;
    };
  };
  recommendation: {
    category: RecommendationCategory;
    criticalReasons: string[];
    nextAction: string;
  };
  evidenceHighlights: EvidenceHighlight[];
  urlVerificationNotice: string;
}

export interface SavedJobEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  jobUrl: string;
  rawJobText: string;
  status: SavedJobStatus;
  availabilityStatus?: ApplicationAvailabilityStatus;
  availabilityVerifiedAt?: string;
  availabilitySourceUrl?: string;
  notes: string;
  targetDate: string;
  analysis: JobAnalysisResult;
}

export interface CareerBackupPayload {
  version: 1;
  exportedAt: string;
  profile: CandidateProfile;
  savedJobs: SavedJobEntry[];
}

export type JobFetchMethod =
  | "schema_org_jsonld"
  | "jsonld_and_html"
  | "html_fallback";

export type JobFetchConfidence = "high" | "uncertain" | "partial";

export type JobCoverageStatus = "complete" | "partial" | "uncertain";

export type DeadlineSourceType = "structured_jsonld" | "body_text";

export type DeadlineAssessmentStatus =
  | "consistent"
  | "structured_only"
  | "body_only"
  | "conflict"
  | "missing";

export interface ExtractedDeadlineCandidate {
  value: string;
  rawValue: string;
  isoDate: string | null;
  source: DeadlineSourceType;
  sourceLabel: string;
  excerpt?: string | null;
}

export interface JobDeadlineAssessment {
  status: DeadlineAssessmentStatus;
  hasConflict: boolean;
  isConfirmed: boolean;
  structuredDeadline: ExtractedDeadlineCandidate | null;
  bodyDeadline: ExtractedDeadlineCandidate | null;
  conflictWarning: string | null;
}

export interface FetchedJobResult {
  sourceUrl: string;
  title: string | null;
  company: string | null;
  deadline: string | null;
  deadlineInfo: JobDeadlineAssessment;
  extractedText: string;
  fetchMethod: JobFetchMethod;
  networkStatus: "ok";
  coverageStatus: JobCoverageStatus;
  confidence: JobFetchConfidence;
  detectedSections: string[];
  coverageSummary: string;
  warning: string | null;
  fetchedAt: string;
}

export type JobDiscoverySourceType = "ashby" | "greenhouse" | "lever";

export type DiscoveryRemoteType = "remote" | "hybrid" | "onsite" | "unknown";

export type DiscoverySuitabilityCategory =
  | "Erittäin kiinnostava"
  | "Mahdollisesti sopiva"
  | "Vaatii lisätarkistusta"
  | "Heikko vastaavuus";

export type DiscoverySeniorityFilter = "intern_trainee_junior" | "all";

export type DiscoveryRemoteFilter =
  | "finland_compatible"
  | "onsite_or_hybrid"
  | "remote_only"
  | "any";

export type DiscoveryIndustryFilter = "it_cyber_and_pathways" | "all";

export type DiscoveryLanguageCode = "fi" | "en";

export interface DiscoverySearchPreferences {
  useSavedProfile: boolean;
  seniorityLevel: DiscoverySeniorityFilter;
  locationQuery: string;
  remotePreference: DiscoveryRemoteFilter;
  industryFocus: DiscoveryIndustryFilter;
  languages: DiscoveryLanguageCode[];
  keyword: string;
}

export interface DiscoveredJob {
  id: string;
  source: JobDiscoverySourceType;
  employerId: string;
  sourceJobId: string;
  company: string;
  title: string;
  location: string;
  country: string;
  remoteType: DiscoveryRemoteType;
  remoteEligibilityNote: string;
  employmentType: string;
  department: string;
  description: string;
  descriptionFullLength: number;
  isDescriptionTruncatedForAnalysis: boolean;
  jobUrl: string;
  publishedAt: string | null;
  updatedAt: string | null;
  retrievedAt: string;
  deadline: string | null;
  deadlineStatus: "valid" | "expired" | "conflicting" | "unknown";
  language: "fi" | "en" | "other" | "Ei ilmoitettu";
  discoveryScore: number;
  suitabilityCategory: DiscoverySuitabilityCategory;
  matchReasons: string[];
  uncertainties: string[];
  cyberPathwayNote: string | null;
  alternateSources?: Array<{
    source: JobDiscoverySourceType;
    jobUrl: string;
    company: string;
  }>;
}

export interface DiscoverySourceStatus {
  employerId: string;
  company: string;
  source: JobDiscoverySourceType;
  apiHost: string;
  status: "ok" | "error" | "skipped";
  fetchedCount: number;
  matchedCount: number;
  retrievedAt: string;
  errorCode?: string;
  errorMessage?: string;
  rateLimited?: boolean;
  durationMs: number;
}

export interface DiscoverJobsResponse {
  jobs: DiscoveredJob[];
  totalFetchedCount: number;
  totalDeduplicatedCount: number;
  matchedCount: number;
  queriedSources: DiscoverySourceStatus[];
  succeededSources: string[];
  failedSources: Array<{
    employerId: string;
    company: string;
    source: JobDiscoverySourceType;
    reason: string;
  }>;
  fetchedAt: string;
  warnings: string[];
  profileMode: "saved_profile" | "default_example_profile" | "no_profile";
  registryEmployers: Array<{
    id: string;
    company: string;
    source: JobDiscoverySourceType;
    active: boolean;
  }>;
}

