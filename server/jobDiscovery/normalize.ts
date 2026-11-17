import type {
  DiscoveredJob,
  DiscoveryRemoteType,
} from "../../src/types/career.ts";
import {
  getTimeZoneDateParts,
  helsinkiLocalDateTimeToEpochMs,
  toValidIsoDate,
} from "../fetchJob.ts";
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWholePlaceTerm(text: string, term: string): boolean {
  if (!text || !term) return false;
  const pattern = new RegExp(
    `(?:^|[^a-z0-9äöå])${escapeRegExp(term)}(?:$|[^a-z0-9äöå])`,
    "i"
  );
  return pattern.test(text);
}

const COUNTRY_RAW_MAP: Record<string, string> = {
  fi: "Finland",
  fin: "Finland",
  finland: "Finland",
  suomi: "Finland",
  se: "Sweden",
  swe: "Sweden",
  sweden: "Sweden",
  ruotsi: "Ruotsi",
  de: "Saksa",
  deu: "Saksa",
  germany: "Saksa",
  saksa: "Saksa",
  no: "Norja",
  norway: "Norja",
  norja: "Norja",
  dk: "Tanska",
  denmark: "Tanska",
  tanska: "Tanska",
  nl: "Alankomaat",
  netherlands: "Alankomaat",
  alankomaat: "Alankomaat",
  fr: "Ranska",
  france: "Ranska",
  ranska: "Ranska",
  es: "Espanja",
  spain: "Espanja",
  espanja: "Espanja",
  us: "USA",
  usa: "USA",
  "united states": "USA",
  yhdysvallat: "Yhdysvallat",
  gb: "United Kingdom",
  uk: "United Kingdom",
  "united kingdom": "United Kingdom",
  "iso-britannia": "Iso-Britannia",
  ca: "Kanada",
  canada: "Kanada",
  kanada: "Kanada",
  au: "Australia",
  australia: "Australia",
  sg: "Singapore",
  singapore: "Singapore",
  in: "Intia",
  india: "Intia",
  intia: "Intia",
  mx: "Meksiko",
  mexico: "Meksiko",
  meksiko: "Meksiko",
  ph: "Filippiinit",
  philippines: "Filippiinit",
  filippiinit: "Filippiinit",
  ee: "Viro",
  estonia: "Viro",
  viro: "Viro",
  pl: "Puola",
  poland: "Puola",
  puola: "Puola",
  ie: "Irlanti",
  ireland: "Irlanti",
  irlanti: "Irlanti",
  ch: "Sveitsi",
  switzerland: "Sveitsi",
  sveitsi: "Sveitsi",
};

const NON_FINLAND_COUNTRIES_AND_CITIES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(usa|u\.s\.a\.|united states|us only|new york|san francisco|minneapolis|austin|chicago|boston|seattle)\b/i, label: "Yhdysvallat" },
  { pattern: /\b(uk|united kingdom|london|manchester)\b/i, label: "Iso-Britannia" },
  { pattern: /\b(singapore)\b/i, label: "Singapore" },
  { pattern: /\b(philippines|manila)\b/i, label: "Filippiinit" },
  { pattern: /\b(mexico|mexico city)\b/i, label: "Meksiko" },
  { pattern: /\b(india|bangalore|bengaluru)\b/i, label: "Intia" },
  { pattern: /\b(germany|saksa|berlin|munich|münchen|frankfurt|hamburg)\b/i, label: "Saksa" },
  { pattern: /\b(sweden|ruotsi|stockholm|gothenburg|malmö|malmo)\b/i, label: "Ruotsi" },
  { pattern: /\b(norway|norja|oslo)\b/i, label: "Norja" },
  { pattern: /\b(denmark|tanska|copenhagen)\b/i, label: "Tanska" },
  { pattern: /\b(netherlands|alankomaat|amsterdam)\b/i, label: "Alankomaat" },
  { pattern: /\b(france|ranska|paris)\b/i, label: "Ranska" },
  { pattern: /\b(spain|espanja|madrid|barcelona)\b/i, label: "Espanja" },
  { pattern: /\b(canada|kanada|toronto|vancouver)\b/i, label: "Kanada" },
  { pattern: /\b(australia|sydney|melbourne)\b/i, label: "Australia" },
  { pattern: /\b(estonia|viro|tallinn)\b/i, label: "Viro" },
  { pattern: /\b(poland|puola|warsaw|krakow)\b/i, label: "Puola" },
  { pattern: /\b(ireland|irlanti|dublin)\b/i, label: "Irlanti" },
  { pattern: /\b(switzerland|sveitsi|zurich|zürich|geneva)\b/i, label: "Sveitsi" },
];

export function inferCountryFromMetadata(
  countryRaw: string | null,
  locationText: string
): string {
  if (countryRaw && countryRaw.trim()) {
    const c = countryRaw.trim();
    const mapped = COUNTRY_RAW_MAP[c.toLowerCase()];
    if (mapped) return mapped;
    return c;
  }

  const hasFinlandLocation = FINLAND_LOCATIONS.some((loc) =>
    containsWholePlaceTerm(locationText, loc)
  );
  const foreignMatch = NON_FINLAND_COUNTRIES_AND_CITIES.find((item) =>
    item.pattern.test(locationText)
  );

  if (hasFinlandLocation && foreignMatch) {
    return "Useita maita (sis. Suomi)";
  }
  if (hasFinlandLocation) {
    return "Finland";
  }
  if (foreignMatch) {
    return foreignMatch.label;
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

  const countryMapped = raw.countryRaw?.trim()
    ? COUNTRY_RAW_MAP[raw.countryRaw.trim().toLowerCase()] ?? raw.countryRaw.trim()
    : null;
  const countryIsExplicitlyForeign =
    Boolean(countryMapped) &&
    countryMapped !== "Finland" &&
    countryMapped !== "Ei ilmoitettu";
  const hasFinlandLocation =
    !countryIsExplicitlyForeign &&
    (countryMapped === "Finland" ||
      FINLAND_LOCATIONS.some((city) =>
        containsWholePlaceTerm(raw.locationRaw ?? "", city)
      ));
  const locationCombined = [raw.locationRaw, raw.countryRaw]
    .filter(Boolean)
    .join(" ");
  const nonFinlandMatch = NON_FINLAND_COUNTRIES_AND_CITIES.find((c) =>
    c.pattern.test(locationCombined)
  );

  if (remoteType === "remote") {
    if (countryIsExplicitlyForeign) {
      return {
        remoteType,
        remoteEligibilityNote: `Etätyö (${countryMapped} — oikeutta Suomesta työskentelyyn ei ole vahvistettu)`,
      };
    }
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

interface ParsedDiscoveryDeadlineCandidate {
  display: string;
  isoDate: string;
  minuteKey: string;
  timestampMs: number | null;
}

function parseSingleDeadlineString(raw: string): {
  candidate: ParsedDiscoveryDeadlineCandidate | null;
  invalidDate: boolean;
  unparseable: boolean;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { candidate: null, invalidDate: false, unparseable: false };
  }

  // 1. Date-only ISO: YYYY-MM-DD
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const y = Number(dateOnlyMatch[1]);
    const mo = Number(dateOnlyMatch[2]);
    const d = Number(dateOnlyMatch[3]);
    const isoDate = toValidIsoDate(y, mo, d);
    if (!isoDate) {
      return { candidate: null, invalidDate: true, unparseable: false };
    }
    return {
      candidate: {
        display: `${d}.${mo}.${y}`,
        isoDate,
        minuteKey: isoDate,
        timestampMs: null,
      },
      invalidDate: false,
      unparseable: false,
    };
  }

  // 2. ISO datetime with optional timezone offset: YYYY-MM-DDTHH:mm(:ss(.sss)?)?(Z|+HH:MM|-HH:MM)?
  const dateTimeMatch =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      trimmed
    );
  if (dateTimeMatch) {
    const y = Number(dateTimeMatch[1]);
    const mo = Number(dateTimeMatch[2]);
    const d = Number(dateTimeMatch[3]);
    const hour = Number(dateTimeMatch[4]);
    const minute = Number(dateTimeMatch[5]);
    const second = Number(dateTimeMatch[6] ?? "0");
    const tzRaw = dateTimeMatch[7] ?? "";
    const isoDate = toValidIsoDate(y, mo, d);
    if (!isoDate || hour > 23 || minute > 59 || second > 59) {
      return { candidate: null, invalidDate: true, unparseable: false };
    }

    let epochMs: number | null = null;
    if (tzRaw) {
      const normalizedTz = /^z$/i.test(tzRaw)
        ? "Z"
        : /^([+-])(\d{2})(\d{2})$/.test(tzRaw)
        ? tzRaw.replace(/^([+-])(\d{2})(\d{2})$/, "$1$2:$3")
        : tzRaw;
      const parsedMs = Date.parse(
        `${isoDate}T${dateTimeMatch[4]}:${dateTimeMatch[5]}:${String(second).padStart(
          2,
          "0"
        )}${normalizedTz}`
      );
      if (Number.isFinite(parsedMs)) {
        epochMs = parsedMs;
      }
    } else {
      epochMs = helsinkiLocalDateTimeToEpochMs(isoDate, hour, minute);
      if (epochMs !== null && second > 0) {
        epochMs += second * 1000;
      }
    }

    if (epochMs === null) {
      return { candidate: null, invalidDate: true, unparseable: false };
    }

    const helsinkiParts = getTimeZoneDateParts(epochMs, "Europe/Helsinki");
    if (!helsinkiParts) {
      return { candidate: null, invalidDate: true, unparseable: false };
    }
    const hm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(helsinkiParts.isoDate);
    const hHour = String(Math.floor(helsinkiParts.minutes / 60)).padStart(2, "0");
    const hMin = String(helsinkiParts.minutes % 60).padStart(2, "0");
    const displayDate = hm
      ? `${Number(hm[3])}.${Number(hm[2])}.${hm[1]}`
      : `${d}.${mo}.${y}`;
    return {
      candidate: {
        display: `${displayDate} klo ${hHour}:${hMin}`,
        isoDate: helsinkiParts.isoDate,
        minuteKey: `${helsinkiParts.isoDate}T${hHour}:${hMin}`,
        timestampMs: epochMs,
      },
      invalidDate: false,
      unparseable: false,
    };
  }

  // 3. Finnish/European numeric date D.M.YYYY with optional time
  const fiMatch =
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s*(?:klo|at)?\s*(\d{1,2})[:.](\d{2}))?$/i.exec(
      trimmed
    );
  if (fiMatch) {
    const d = Number(fiMatch[1]);
    const mo = Number(fiMatch[2]);
    const y = Number(fiMatch[3]);
    const isoDate = toValidIsoDate(y, mo, d);
    if (!isoDate) {
      return { candidate: null, invalidDate: true, unparseable: false };
    }
    if (fiMatch[4] !== undefined && fiMatch[5] !== undefined) {
      const hour = Number(fiMatch[4]);
      const minute = Number(fiMatch[5]);
      if (hour > 23 || minute > 59) {
        return { candidate: null, invalidDate: true, unparseable: false };
      }
      const epochMs = helsinkiLocalDateTimeToEpochMs(isoDate, hour, minute);
      const hh = String(hour).padStart(2, "0");
      const mm = String(minute).padStart(2, "0");
      return {
        candidate: {
          display: `${d}.${mo}.${y} klo ${hh}:${mm}`,
          isoDate,
          minuteKey: `${isoDate}T${hh}:${mm}`,
          timestampMs: epochMs,
        },
        invalidDate: false,
        unparseable: false,
      };
    }
    return {
      candidate: {
        display: `${d}.${mo}.${y}`,
        isoDate,
        minuteKey: isoDate,
        timestampMs: null,
      },
      invalidDate: false,
      unparseable: false,
    };
  }

  return { candidate: null, invalidDate: false, unparseable: true };
}

function parseDeadlineAssessment(
  deadlineRaw: string | null,
  plainDescription: string,
  nowDate: Date
): {
  deadline: string | null;
  deadlineStatus: "valid" | "expired" | "conflicting" | "unknown";
} {
  const nowEpochMs = nowDate.getTime();
  const helsinkiNow = getTimeZoneDateParts(nowEpochMs, "Europe/Helsinki");
  const todayHelsinkiIso =
    helsinkiNow?.isoDate ?? nowDate.toISOString().slice(0, 10);

  const candidates: ParsedDiscoveryDeadlineCandidate[] = [];
  const trimmedRaw = deadlineRaw?.trim() ?? "";

  if (trimmedRaw) {
    const parsedRaw = parseSingleDeadlineString(trimmedRaw);
    if (parsedRaw.invalidDate || parsedRaw.unparseable) {
      // Unparseable free-text (e.g. "end of November") or invalid calendar date (e.g. "31.02.2026")
      // must NEVER be marked "valid".
      return {
        deadline: trimmedRaw,
        deadlineStatus: "unknown",
      };
    }
    if (parsedRaw.candidate) {
      candidates.push(parsedRaw.candidate);
    }
  }

  let hasInvalidBodyDate = false;
  const fiDeadlineRegex =
    /(?:hakuaika\s+(?:päättyy|on)|haku\s+päättyy|viimeinen\s+hakupäivä|hakemukset\s+viimeistään|lähetä\s+hakemus\s+viimeistään|application\s+deadline|closing\s+date|apply\s+(?:by|before|until))\s*:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s*(?:klo|at)?\s*(\d{1,2})[:.](\d{2}))?/gi;
  for (const m of plainDescription.matchAll(fiDeadlineRegex)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    const isoDate = toValidIsoDate(y, mo, d);
    if (!isoDate) {
      hasInvalidBodyDate = true;
      continue;
    }
    if (m[4] !== undefined && m[5] !== undefined) {
      const hour = Number(m[4]);
      const minute = Number(m[5]);
      if (hour <= 23 && minute <= 59) {
        const hh = String(hour).padStart(2, "0");
        const mm = String(minute).padStart(2, "0");
        candidates.push({
          display: `${d}.${mo}.${y} klo ${hh}:${mm}`,
          isoDate,
          minuteKey: `${isoDate}T${hh}:${mm}`,
          timestampMs: helsinkiLocalDateTimeToEpochMs(isoDate, hour, minute),
        });
      }
    } else {
      candidates.push({
        display: `${d}.${mo}.${y}`,
        isoDate,
        minuteKey: isoDate,
        timestampMs: null,
      });
    }
  }

  const isoBodyRegex =
    /(?:application\s+deadline|closing\s+date|apply\s+(?:by|before|until)|hakuaika\s+(?:päättyy|on)|haku\s+päättyy|viimeinen\s+hakupäivä)\s*:?\s*(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?/gi;
  for (const m of plainDescription.matchAll(isoBodyRegex)) {
    const rawSlice = m[0].slice(m[0].search(/\d{4}-\d{2}-\d{2}/));
    const parsedBodyIso = parseSingleDeadlineString(rawSlice);
    if (parsedBodyIso.invalidDate) {
      hasInvalidBodyDate = true;
      continue;
    }
    if (parsedBodyIso.candidate) {
      candidates.push(parsedBodyIso.candidate);
    }
  }

  if (candidates.length === 0) {
    return {
      deadline: hasInvalidBodyDate ? "Epäkelpo hakuaika ilmoituksessa" : null,
      deadlineStatus: "unknown",
    };
  }

  const uniqueDates = [...new Set(candidates.map((c) => c.isoDate))];
  const uniqueTimedMinutes = [
    ...new Set(
      candidates
        .filter((c) => c.timestampMs !== null)
        .map((c) => c.minuteKey)
    ),
  ];

  if (uniqueDates.length > 1 || uniqueTimedMinutes.length > 1) {
    const distinctDisplays = [...new Set(candidates.map((c) => c.display))];
    return {
      deadline: `Ristiriitainen (${distinctDisplays.join(" / ")})`,
      deadlineStatus: "conflicting",
    };
  }

  // Prefer a timestamped candidate if both date-only and timestamped exist for the same day
  const preferred =
    candidates.find((c) => c.timestampMs !== null) ?? candidates[0];

  const isExpired =
    preferred.timestampMs !== null
      ? preferred.timestampMs < nowEpochMs
      : preferred.isoDate < todayHelsinkiIso;

  return {
    deadline: preferred.display,
    deadlineStatus: isExpired ? "expired" : "valid",
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
