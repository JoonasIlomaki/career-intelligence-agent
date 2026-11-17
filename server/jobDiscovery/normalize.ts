import type {
  DiscoveredJob,
  DiscoveryRemoteType,
} from "../../src/types/career.ts";
import { sanitizeExternalHtmlToPlainText } from "./htmlSanitizer.ts";
import type { RawAtsJobRecord } from "./types.ts";

export const ANALYSIS_RECOMMENDED_CHAR_BUDGET = 28_500;

const FINLAND_LOCATIONS = [
  "finland",
  "suomi",
  "helsinki",
  "espoo",
  "vantaa",
  "kauniainen",
  "uusimaa",
  "tampere",
  "pirkanmaa",
  "turku",
  "oulu",
  "jyväskylä",
  "jyvaskyla",
  "kuopio",
  "lahti",
  "porvoo",
  "lohja",
  "järvenpää",
  "jarvenpaa",
  "kerava",
  "tuusula",
  "nurmijärvi",
  "nurmijarvi",
  "kirkkonummi",
  "hyvinkää",
  "hyvinkaa",
  "vaasa",
  "joensuu",
  "lappeenranta",
  "rovaniemi",
];

const NON_FINLAND_COUNTRIES_AND_CITIES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(usa|u\.s\.a\.|united states|us only|new york|san francisco|minneapolis|austin|chicago|boston|seattle)\b/i, label: "Yhdysvallat" },
  { pattern: /\b(uk|united kingdom|london|manchester)\b/i, label: "Iso-Britannia" },
  { pattern: /\b(singapore)\b/i, label: "Singapore" },
  { pattern: /\b(philippines|manila)\b/i, label: "Filippiinit" },
  { pattern: /\b(mexico|mexico city)\b/i, label: "Meksiko" },
  { pattern: /\b(india|bangalore|bengaluru)\b/i, label: "Intia" },
  { pattern: /\b(germany|berlin|munich|frankfurt)\b/i, label: "Saksa" },
  { pattern: /\b(sweden|stockholm|gothenburg|malmö|malmo)\b/i, label: "Ruotsi" },
  { pattern: /\b(norway|oslo)\b/i, label: "Norja" },
  { pattern: /\b(denmark|copenhagen)\b/i, label: "Tanska" },
  { pattern: /\b(netherlands|amsterdam)\b/i, label: "Alankomaat" },
  { pattern: /\b(france|paris)\b/i, label: "Ranska" },
  { pattern: /\b(spain|madrid|barcelona)\b/i, label: "Espanja" },
  { pattern: /\b(canada|toronto|vancouver)\b/i, label: "Kanada" },
  { pattern: /\b(australia|sydney|melbourne)\b/i, label: "Australia" },
];

export function inferCountryFromMetadata(
  countryRaw: string | null,
  locationText: string
): string {
  if (countryRaw && countryRaw.trim()) {
    const c = countryRaw.trim();
    if (/^fi$/i.test(c)) return "Finland";
    if (/^se$/i.test(c)) return "Sweden";
    if (/^us$/i.test(c)) return "USA";
    if (/^gb$/i.test(c)) return "United Kingdom";
    return c;
  }

  const lower = locationText.toLowerCase();
  if (FINLAND_LOCATIONS.some((loc) => lower.includes(loc))) {
    return "Finland";
  }

  for (const item of NON_FINLAND_COUNTRIES_AND_CITIES) {
    if (item.pattern.test(locationText)) {
      return item.label;
    }
  }

  return "Ei ilmoitettu";
}

export function classifyRemoteType(
  raw: RawAtsJobRecord,
  plainDescription: string
): {
  remoteType: DiscoveryRemoteType;
  remoteEligibilityNote: string;
} {
  const wp = (raw.workplaceTypeRaw ?? "").toLowerCase();
  const loc = (raw.locationRaw ?? "").toLowerCase();
  const titleLower = raw.title.toLowerCase();
  const descSample = plainDescription.slice(0, 1500).toLowerCase();

  let remoteType: DiscoveryRemoteType = "unknown";

  // Explicit workplaceType takes precedence over Ashby's boolean `isRemote`
  // because Ashby marks Hybrid roles in Helsinki/Singapore/USA with `isRemote: true`.
  if (/\bhybrid\b|hybridi/.test(wp)) {
    remoteType = "hybrid";
  } else if (/\bon[-\s]?site\b|\bin[-\s]?person\b|lähityö|toimisto/.test(wp)) {
    remoteType = "onsite";
  } else if (/\bremote\b|etätyö/.test(wp)) {
    remoteType = "remote";
  } else if (raw.isRemoteFlag === true) {
    if (/\bhybrid\b|hybridi/.test(descSample) || /\bhybrid\b|hybridi/.test(loc)) {
      remoteType = "hybrid";
    } else {
      remoteType = "remote";
    }
  } else if (/\bhybrid\b|hybridi/.test(`${titleLower} ${loc} ${descSample}`)) {
    remoteType = "hybrid";
  } else if (/\b(fully remote|100% remote|remote[-\s]?first|etätyö|etänä)\b/.test(`${titleLower} ${loc} ${descSample}`)) {
    remoteType = "remote";
  } else if (/\b(on[-\s]?site|lähityö|office[-\s]?based)\b/.test(`${titleLower} ${loc} ${descSample}`)) {
    remoteType = "onsite";
  }

  const locationCombined = [raw.locationRaw, raw.countryRaw]
    .filter(Boolean)
    .join(" ");
  const hasFinlandLocation = FINLAND_LOCATIONS.some((city) =>
    locationCombined.toLowerCase().includes(city)
  );
  const nonFinlandMatch = NON_FINLAND_COUNTRIES_AND_CITIES.find((c) =>
    c.pattern.test(locationCombined)
  );

  if (remoteType === "remote") {
    if (hasFinlandLocation || /\bremote\b[^.\n]{0,40}\b(finland|suomi)\b/i.test(plainDescription)) {
      return {
        remoteType,
        remoteEligibilityNote: "Etätyö (Suomi mainittu)",
      };
    }
    if (nonFinlandMatch) {
      return {
        remoteType,
        remoteEligibilityNote: `Etätyö (${nonFinlandMatch.label} — oikeutta Suomesta työskentelyyn ei ole vahvistettu)`,
      };
    }
    return {
      remoteType,
      remoteEligibilityNote:
        "Etätyö (sijaintirajoitus Suomesta tarkistettava ilmoituksesta)",
    };
  }

  if (remoteType === "hybrid") {
    return {
      remoteType,
      remoteEligibilityNote: raw.locationRaw
        ? `Hybridi (${raw.locationRaw})`
        : "Hybridi (sijainti tarkistettava)",
    };
  }

  if (remoteType === "onsite") {
    return {
      remoteType,
      remoteEligibilityNote: raw.locationRaw
        ? `Lähityö (${raw.locationRaw})`
        : "Lähityö",
    };
  }

  return {
    remoteType: "unknown",
    remoteEligibilityNote: "Ei ilmoitettu",
  };
}

export function detectJobLanguage(
  languageRaw: string | null,
  title: string,
  plainDescription: string
): "fi" | "en" | "other" | "Ei ilmoitettu" {
  if (languageRaw) {
    const low = languageRaw.trim().toLowerCase();
    if (low === "fi" || low === "fi-fi" || low === "finnish") return "fi";
    if (low === "en" || low === "en-us" || low === "en-gb" || low === "english") {
      return "en";
    }
  }

  const sample = `${title} ${plainDescription.slice(0, 1200)}`.toLowerCase();
  if (sample.trim().length < 25) return "Ei ilmoitettu";

  const fiHits = (
    sample.match(
      /\b(haemme|etsimme|tehtävä|työpaikka|hakuaika|osaaminen|kokemus|opiskelija|harjoittelija|tarjoamme|edellytämme|viimeistään|ja|tai|sekä|kanssa)\b/g
    ) ?? []
  ).length;
  const enHits = (
    sample.match(
      /\b(we are looking|responsibilities|requirements|experience|skills|about the role|what you will|apply|team|company|with|and|the|for|you)\b/g
    ) ?? []
  ).length;

  if (fiHits >= 3 && fiHits >= enHits) return "fi";
  if (enHits >= 3) return "en";
  if (/[äöå]/i.test(sample) && fiHits >= 1) return "fi";
  if (enHits >= 1) return "en";
  return "other";
}

function normalizeEmploymentType(raw: string | null, title: string, desc: string): string {
  if (raw && raw.trim()) {
    const low = raw.trim().toLowerCase();
    if (low === "fulltime" || low === "full-time" || low === "full_time") {
      return "Kokoaikainen";
    }
    if (low === "parttime" || low === "part-time" || low === "part_time") {
      return "Osa-aikainen";
    }
    if (low === "intern" || low === "internship") {
      return "Harjoittelu";
    }
    if (low === "contract" || low === "temporary") {
      return "Määräaikainen / projekti";
    }
    return raw.trim();
  }

  const combined = `${title} ${desc.slice(0, 800)}`.toLowerCase();
  if (/\b(internship|intern|trainee|harjoittelija|harjoittelu|kesätyö)\b/.test(combined)) {
    return "Harjoittelu / Trainee";
  }
  return "Ei ilmoitettu";
}

function parseDeadlineAssessment(
  deadlineRaw: string | null,
  plainDescription: string,
  nowDate: Date
): {
  deadline: string | null;
  deadlineStatus: "valid" | "expired" | "conflicting" | "unknown";
} {
  const todayIso = nowDate.toISOString().slice(0, 10);
  const candidates: Array<{ display: string; isoDate: string }> = [];

  if (deadlineRaw && deadlineRaw.trim()) {
    const trimmed = deadlineRaw.trim();
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (isoMatch) {
      const isoDate = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
      candidates.push({
        display: `${Number(isoMatch[3])}.${Number(isoMatch[2])}.${isoMatch[1]}`,
        isoDate,
      });
    } else {
      return { deadline: trimmed, deadlineStatus: "valid" };
    }
  }

  const fiDeadlineRegex =
    /(?:hakuaika\s+(?:päättyy|on)|haku\s+päättyy|viimeinen\s+hakupäivä|application\s+deadline|closing\s+date|apply\s+(?:by|before|until))\s*:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/gi;
  for (const m of plainDescription.matchAll(fiDeadlineRegex)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2020 && y <= 2100) {
      const isoDate = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(
        2,
        "0"
      )}`;
      candidates.push({ display: `${d}.${mo}.${y}`, isoDate });
    }
  }

  const isoBodyRegex =
    /(?:application\s+deadline|closing\s+date|apply\s+(?:by|before|until)|hakuaika\s+päättyy)\s*:?\s*(\d{4})-(\d{2})-(\d{2})/gi;
  for (const m of plainDescription.matchAll(isoBodyRegex)) {
    const isoDate = `${m[1]}-${m[2]}-${m[3]}`;
    candidates.push({
      display: `${Number(m[3])}.${Number(m[2])}.${m[1]}`,
      isoDate,
    });
  }

  if (candidates.length === 0) {
    return { deadline: null, deadlineStatus: "unknown" };
  }

  const uniqueDates = [...new Set(candidates.map((c) => c.isoDate))];
  if (uniqueDates.length > 1) {
    return {
      deadline: `Ristiriitainen (${candidates.map((c) => c.display).join(" / ")})`,
      deadlineStatus: "conflicting",
    };
  }

  const only = candidates[0];
  return {
    deadline: only.display,
    deadlineStatus: only.isoDate < todayIso ? "expired" : "valid",
  };
}

export function normalizeRawAtsJob(
  raw: RawAtsJobRecord,
  retrievedAt: string,
  nowDate: Date = new Date()
): DiscoveredJob {
  const plainDescription = sanitizeExternalHtmlToPlainText(
    raw.descriptionHtmlOrText
  );

  const locationParts = [
    raw.locationRaw?.trim(),
    ...raw.secondaryLocationsRaw.slice(0, 3),
  ].filter((v): v is string => Boolean(v));
  const uniqueLocationParts = [...new Set(locationParts)];
  const location =
    uniqueLocationParts.length > 0
      ? uniqueLocationParts.join(" / ")
      : "Ei ilmoitettu";

  const country = inferCountryFromMetadata(raw.countryRaw, location);
  const { remoteType, remoteEligibilityNote } = classifyRemoteType(
    raw,
    plainDescription
  );
  const employmentType = normalizeEmploymentType(
    raw.employmentTypeRaw,
    raw.title,
    plainDescription
  );
  const department = raw.departmentRaw?.trim() || "Ei ilmoitettu";
  const language = detectJobLanguage(
    raw.languageRaw,
    raw.title,
    plainDescription
  );
  const { deadline, deadlineStatus } = parseDeadlineAssessment(
    raw.deadlineRaw,
    plainDescription,
    nowDate
  );

  const descriptionFullLength = plainDescription.length;
  const isDescriptionTruncatedForAnalysis =
    descriptionFullLength > ANALYSIS_RECOMMENDED_CHAR_BUDGET;

  return {
    id: `${raw.source}:${raw.employerId}:${raw.sourceJobId}`,
    source: raw.source,
    employerId: raw.employerId,
    sourceJobId: raw.sourceJobId,
    company: raw.company.trim() || "Ei ilmoitettu",
    title: raw.title.trim(),
    location,
    country,
    remoteType,
    remoteEligibilityNote,
    employmentType,
    department,
    description: plainDescription,
    descriptionFullLength,
    isDescriptionTruncatedForAnalysis,
    jobUrl: raw.jobUrl,
    publishedAt: raw.publishedAt,
    updatedAt: raw.updatedAt,
    retrievedAt,
    deadline,
    deadlineStatus,
    language,
    discoveryScore: 0,
    suitabilityCategory: "Vaatii lisätarkistusta",
    matchReasons: [],
    uncertainties: [],
    cyberPathwayNote: null,
  };
}
