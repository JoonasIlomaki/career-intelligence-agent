import type {
  CandidateProfile,
  DiscoveredJob,
  DiscoverySearchPreferences,
  DiscoverySuitabilityCategory,
} from "../../src/types/career.ts";

const UUSIMAA_LOCATIONS = [
  "helsinki",
  "espoo",
  "vantaa",
  "kauniainen",
  "uusimaa",
  "kirkkonummi",
  "kerava",
  "järvenpää",
  "jarvenpaa",
  "tuusula",
  "nurmijärvi",
  "nurmijarvi",
  "hyvinkää",
  "hyvinkaa",
  "porvoo",
  "lohja",
  "sipoo",
  "vihti",
  "mäntsälä",
  "mantsala",
];

const FINLAND_WORDS = [
  "finland",
  "suomi",
  ...UUSIMAA_LOCATIONS,
  "tampere",
  "pirkanmaa",
  "turku",
  "oulu",
  "jyväskylä",
  "jyvaskyla",
  "kuopio",
  "lahti",
  "vaasa",
  "joensuu",
  "lappeenranta",
  "rovaniemi",
];

const FINLAND_COUNTRY_VALUES = new Set(["finland", "suomi", "fi", "fin"]);

const NON_FINLAND_COUNTRIES = new Set([
  "USA",
  "US",
  "United States",
  "Yhdysvallat",
  "Iso-Britannia",
  "United Kingdom",
  "UK",
  "GB",
  "Singapore",
  "SG",
  "Filippiinit",
  "Philippines",
  "PH",
  "Meksiko",
  "Mexico",
  "MX",
  "Intia",
  "India",
  "IN",
  "Saksa",
  "Germany",
  "DE",
  "Ruotsi",
  "Sweden",
  "SE",
  "Norja",
  "Norway",
  "NO",
  "Tanska",
  "Denmark",
  "DK",
  "Alankomaat",
  "Netherlands",
  "NL",
  "Ranska",
  "France",
  "FR",
  "Espanja",
  "Spain",
  "ES",
  "Kanada",
  "Canada",
  "CA",
  "Australia",
  "AU",
  "Viro",
  "Estonia",
  "EE",
  "Puola",
  "Poland",
  "PL",
  "Irlanti",
  "Ireland",
  "IE",
  "Sveitsi",
  "Switzerland",
  "CH",
]);

const NON_FINLAND_COUNTRY_LOWER = new Set(
  [...NON_FINLAND_COUNTRIES].map((c) => c.toLowerCase())
);

const FOREIGN_LOCATION_PATTERN =
  /\b(usa|u\.s\.a\.|united\s+states|yhdysvallat|minneapolis|singapore|manila|philippines|filippiinit|mexico|meksiko|bangalore|bengaluru|india|intia|berlin|munich|münchen|frankfurt|hamburg|germany|saksa|london|manchester|united\s+kingdom|iso-britannia|stockholm|gothenburg|malmö|malmo|sweden|ruotsi|oslo|norway|norja|copenhagen|denmark|tanska|amsterdam|netherlands|alankomaat|paris|france|ranska|madrid|barcelona|spain|espanja|toronto|vancouver|canada|kanada|sydney|melbourne|australia|tallinn|estonia|viro|warsaw|poland|puola|dublin|ireland|irlanti|zurich|zürich|switzerland|sveitsi)\b/i;

const MISSING_LOCATION_TOKENS = new Set([
  "",
  "ei ilmoitettu",
  "unknown",
  "tbd",
  "not specified",
  "n/a",
]);

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

const EXPLICIT_ENTRY_TITLE_OR_DESC =
  /\b(intern|internship|trainee|harjoittelija|harjoittelu|kesätyö|kesäharjoittelija|summer\s+intern|summer\s+trainee|junior|jr\.?|entry[-\s]?level|opinnäytetyö|thesis\s+worker|graduate\s+program|apprentice)\b/i;

const EXPLICIT_SENIOR_TITLE =
  /\b(senior|sr\.?|staff|principal|lead\b|tech\s+lead|team\s+lead|architect|head\s+of|vp\b|vice\s+president|director|chief|ciso|cto|cio|engineering\s+manager|chapter\s+lead|people\s+lead)\b/i;

const HIGH_EXPERIENCE_REQUIREMENT =
  /\b(?:at\s+least|minimum(?:\s+of)?|vähintään|\+)?\s*([3-9]|1\d)\+?\s*(?:years?|yrs?|vuoden|vuotta)\s+(?:of\s+)?(?:relevant\s+|work\s+|industry\s+|professional\s+|hands-on\s+)?(?:experience|kokemus)/i;

const ENTRY_ACCESSIBLE_IT_TITLE =
  /\b(it\s+support|service\s+desk|help\s*desk|desktop\s+support|ict[-\s]?tuki|käyttötuki|järjestelmätuki|sovellustuki|soc\s+analyst|security\s+analyst|cyber\s+analyst|information\s+security|tietoturva|iam\b|associate|system\s+administrator|systems\s+administrator|sysadmin|järjestelmäasiantuntija|data\s+analyst|software\s+developer|software\s+engineer|junior|trainee|intern|harjoittelija|assistant|assistentti|specialist|coordinator|koordinaattori)\b/i;

const DIRECT_CYBER_TITLE =
  /\b(cyber|security|tietoturva|kyberturva|kyber|soc\b|siem|iam\b|grc\b|infosec|appsec|secops|devsecops|threat|vulnerability|incident\s+response|red\s+team|blue\s+team|penetration|pentest|hoxhunt)\b/i;

const DIRECT_CYBER_BODY =
  /\b(cybersecurity|cyber\s+security|tietoturva|kyberturvallisuus|soc\s+analyst|siem|splunk|sentinel|incident\s+response|tietoturvapoikkeama|identity\s+and\s+access|iam\b|entra\s+id|active\s+directory|grc\b|iso\s*27001|vulnerability|haavoittuvuus|threat\s+intel|lokianalyysi|log\s+analysis|phishing|zero\s+trust|dlp\b|firewall|palomuuri|hardening)\b/i;

const INDIRECT_IT_TITLE =
  /\b(it\s+support|service\s+desk|help\s*desk|desktop\s+support|ict|sysadmin|system\s+admin|systems\s+admin|järjestelmä|cloud|pilvi|infra|infrastructure|network|verkko|devops|platform|sre|data\s+analyst|data\s+engineer|analytics|machine\s+learning|ai\s+engineer|software\s+developer|software\s+engineer|full[-\s]?stack|backend|frontend|web\s+developer|qa\b|test\s+engineer|automation|ohjelmisto)\b/i;

const NON_IT_ROLE_TITLE =
  /\b(marketing|markkinointi|sales\b|myynti|account\s+executive|business\s+development|bdr\b|sdr\b|recruiter|rekrytointi|talent\s+acquisition|hr\b|human\s+resources|people\s+partner|people\s+operations|finance|accounting|accountant|controller|taloushallinto|legal|counsel|office\s+manager|receptionist|copywriter|brand\s+manager|customer\s+success\s+manager|client\s+partner|partner\s+manager|media\s+buyer|paid\s+social)\b/i;

const CERTIFICATION_MATCH_PATTERN =
  /(?:^|[^a-z0-9äöå])(cissp|cism|cisa|oscp|ceh|security\+|az-500|sc-200|sc-300|ccsp|giac|gsec)(?=$|[^a-z0-9äöå])/gi;

const FINNISH_LANGUAGE_REQUIRED_PATTERN =
  /\b(fluent\s+finnish|sujuva(?:a)?\s+suome(?:a|n)|erinomainen\s+suomen\s+kieli|finnish\s+(?:is\s+)?required|edellytämme\s+(?:hyvää|sujuvaa)\s+suomen)\b/i;

const SECURITY_CLEARANCE_PATTERN =
  /\b(turvallisuusselvitys|henkilöturvallisuusselvitys|security\s+clearance)\b/i;

const ELIGIBILITY_CLAUSE_PATTERN =
  /\b(opiskelija|kirjoilla\s+korkeakoulussa|currently\s+enrolled|student\s+status|graduat(?:e|ing)|opinnäytetyö|harjoittelutuki|työharjoittelu\s+osana\s+opintoja)\b/i;

export interface JobDomainAssessment {
  domainKind: "direct_cyber" | "indirect_it_pathway" | "non_it" | "general";
  cyberPathwayNote: string | null;
}

export function classifyJobDomain(job: DiscoveredJob): JobDomainAssessment {
  const titleOnly = job.title;
  const titleAndDept = `${job.title} ${job.department}`.trim();
  const titleHasDirectCyber =
    /\b(cyber|security|tietoturva|kyberturva|kyber|soc\b|siem|iam\b|grc\b|infosec|appsec|secops|devsecops|threat|vulnerability|incident|pentest)\b/i.test(
      titleOnly
    );
  const titleHasIndirectIt = INDIRECT_IT_TITLE.test(titleOnly);
  const titleIsNonIt = NON_IT_ROLE_TITLE.test(titleOnly);

  // Title determines role identity even when employer/department mentions cybersecurity (e.g. "Account Executive" in a security firm)
  if (titleIsNonIt && !titleHasDirectCyber && !titleHasIndirectIt) {
    return {
      domainKind: "non_it",
      cyberPathwayNote: null,
    };
  }

  if (
    titleHasDirectCyber ||
    (/\b(cyber|security|tietoturva|kyberturva|kyber|soc\b|infosec)\b/i.test(
      titleAndDept
    ) &&
      !titleIsNonIt)
  ) {
    return {
      domainKind: "direct_cyber",
      cyberPathwayNote:
        "Suora kyberturvallisuusrooli: tehtävänimike ja osasto viittaavat suoraan tietoturvatehtäviin.",
    };
  }

  // Strip common employer intro ("About <company>") influence by checking title + core body when title already points to IT/tech
  if (titleHasIndirectIt) {
    const descNoCompanyBoilerplate = job.description.slice(0, 3500);
    const strongCyberSignals =
      (descNoCompanyBoilerplate.match(DIRECT_CYBER_BODY) ?? []).length >= 2 ||
      /\b(access\s+control|käyttöoikeus|iso\s*27001|siem|soc\b|audit|lokien|tietoturva)\b/i.test(
        descNoCompanyBoilerplate
      );

    return {
      domainKind: "indirect_it_pathway",
      cyberPathwayNote: strongCyberSignals
        ? "Välillinen kyberpolku: tekninen IT-, tuki-, pilvi- tai data-rooli, jossa on siirrettävää tietoturvakosketuspintaa (käyttöoikeudet, lokit tai järjestelmäympäristöt). Sisäinen eteneminen tietoturvatiimiin on kuitenkin vahvistamaton, ellei ilmoitus sitä lupaa."
        : "Välillinen polku kyberturvallisuuteen: IT-, infra-, tuki- tai kehitysrooli kerryttää siirrettävää teknistä pohjaosaamista. Mahdollinen eteneminen varsinaisiin kyberturvallisuustehtäviin vaatii lisätarkistusta eikä ole taattu.",
    };
  }

  if (DIRECT_CYBER_TITLE.test(job.department) && !titleIsNonIt) {
    return {
      domainKind: "direct_cyber",
      cyberPathwayNote:
        "Suora kyberturvallisuusosasto ilmoituksen rakenteisten tietojen perusteella.",
    };
  }

  if (!titleIsNonIt && DIRECT_CYBER_BODY.test(job.description.slice(0, 2000))) {
    return {
      domainKind: "indirect_it_pathway",
      cyberPathwayNote:
        "Mahdollinen välillinen tietoturvayhteys kuvauksen perusteella — tehtävän tekninen painotus kannattaa varmistaa ilmoituksesta.",
    };
  }

  return {
    domainKind: titleIsNonIt ? "non_it" : "general",
    cyberPathwayNote: null,
  };
}

export interface JobSeniorityAssessment {
  kind: "explicit_entry" | "accessible_entry" | "explicit_senior" | "unclear";
  reason: string | null;
}

export function classifyJobSeniority(job: DiscoveredJob): JobSeniorityAssessment {
  const title = job.title;
  const desc = job.description.slice(0, 3500);

  if (EXPLICIT_SENIOR_TITLE.test(title)) {
    return {
      kind: "explicit_senior",
      reason: `Tehtävänimike ("${title}") viittaa senior-, lead- tai johtotason rooliin.`,
    };
  }

  if (EXPLICIT_ENTRY_TITLE_OR_DESC.test(title)) {
    return {
      kind: "explicit_entry",
      reason: "Tehtävänimike viittaa harjoittelu-, trainee- tai junior-tason rooliin.",
    };
  }

  const highExpMatch = HIGH_EXPERIENCE_REQUIREMENT.exec(desc);
  if (highExpMatch && !EXPLICIT_ENTRY_TITLE_OR_DESC.test(desc)) {
    return {
      kind: "explicit_senior",
      reason: `Ilmoituksessa mainitaan korkeampi kokemusvaatimus ("${highExpMatch[0].trim()}").`,
    };
  }

  if (EXPLICIT_ENTRY_TITLE_OR_DESC.test(desc)) {
    return {
      kind: "explicit_entry",
      reason: "Ilmoitustekstissä mainitaan harjoittelu-, opiskelija- tai alkuvaiheen rooli.",
    };
  }

  if (ENTRY_ACCESSIBLE_IT_TITLE.test(title)) {
    return {
      kind: "accessible_entry",
      reason:
        "Tehtävänimike voi sopia uran alkuvaiheeseen (ilman erillistä junior-/intern-sanaa), mutta vaadittu kokemustaso kannattaa tarkistaa ilmoituksesta.",
    };
  }

  return {
    kind: "unclear",
    reason: "Tehtävän kokemustaso ei käy yksiselitteisesti ilmi otsikosta.",
  };
}

interface LocationEvaluation {
  matchesFilter: boolean;
  isFinlandConfirmed: boolean;
  isLocationUncertain: boolean;
  isExplicitlyForeign: boolean;
  reason: string | null;
  uncertainty: string | null;
}

function evaluateLocationAndRemote(
  job: DiscoveredJob,
  preferences: DiscoverySearchPreferences
): LocationEvaluation {
  const locationText = job.location.trim();
  const countryText = job.country.trim();
  const locationLower = locationText.toLowerCase();
  const countryLower = countryText.toLowerCase();
  const queryLower = preferences.locationQuery.trim().toLowerCase();

  const countryExplicitFinland = FINLAND_COUNTRY_VALUES.has(countryLower);
  const countryExplicitForeign = NON_FINLAND_COUNTRY_LOWER.has(countryLower);
  const countryMixedIncludingFinland =
    countryLower.includes("useita maita") && countryLower.includes("suomi");

  const locationHasUusimaa = UUSIMAA_LOCATIONS.some((city) =>
    containsWholePlaceTerm(locationText, city)
  );
  const locationHasFinland = FINLAND_WORDS.some((w) =>
    containsWholePlaceTerm(locationText, w)
  );
  const locationHasForeign = FOREIGN_LOCATION_PATTERN.test(locationText);

  const isConflictingCountryAndCity =
    countryExplicitForeign && locationHasFinland;
  const isMultiLocationMixed =
    !countryExplicitForeign &&
    (countryMixedIncludingFinland ||
      (locationHasFinland && locationHasForeign));

  // Explicit foreign country metadata overrides city tokens (e.g. { location: "Helsinki", country: "DE" })
  const isForeignCountry =
    countryExplicitForeign || (!locationHasFinland && locationHasForeign);

  const isPureFinlandDomestic =
    !isForeignCountry &&
    !isMultiLocationMixed &&
    (countryExplicitFinland || locationHasFinland);

  const isRemoteFinlandConfirmed =
    job.remoteType === "remote" &&
    !isForeignCountry &&
    !isMultiLocationMixed &&
    (countryExplicitFinland ||
      locationHasFinland ||
      /suomi mainittu/i.test(job.remoteEligibilityNote));

  const isRemoteWithoutFinland =
    job.remoteType === "remote" &&
    !isRemoteFinlandConfirmed &&
    !isForeignCountry &&
    !isMultiLocationMixed;

  const isMissingLocation =
    MISSING_LOCATION_TOKENS.has(locationLower) &&
    MISSING_LOCATION_TOKENS.has(countryLower);

  const isFinlandCityMissingOnly =
    MISSING_LOCATION_TOKENS.has(locationLower) && countryExplicitFinland;

  // 1. Remote mode filter
  if (
    preferences.remotePreference === "onsite_or_hybrid" &&
    job.remoteType === "remote"
  ) {
    return {
      matchesFilter: false,
      isFinlandConfirmed: isRemoteFinlandConfirmed,
      isLocationUncertain: isMultiLocationMixed,
      isExplicitlyForeign: isForeignCountry,
      reason: null,
      uncertainty: null,
    };
  }
  if (
    preferences.remotePreference === "remote_only" &&
    (job.remoteType === "onsite" || job.remoteType === "hybrid")
  ) {
    return {
      matchesFilter: false,
      isFinlandConfirmed: isPureFinlandDomestic,
      isLocationUncertain: isMultiLocationMixed,
      isExplicitlyForeign: isForeignCountry,
      reason: null,
      uncertainty: null,
    };
  }

  // 2. Foreign rejection when Finland-compatible or Finnish location query active
  const queryTokens = queryLower
    .split(/[,/\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  const queryHasFinlandTerm = queryTokens.some((tok) =>
    FINLAND_WORDS.includes(tok)
  );
  const wantsFinland =
    preferences.remotePreference === "finland_compatible" ||
    queryHasFinlandTerm;

  if (wantsFinland && isForeignCountry) {
    return {
      matchesFilter: false,
      isFinlandConfirmed: false,
      isLocationUncertain: isConflictingCountryAndCity,
      isExplicitlyForeign: true,
      reason: null,
      uncertainty: null,
    };
  }

  // 3. Explicit non-remote location query check
  if (queryLower) {
    const wantsCountryWideFinland = queryTokens.some(
      (tok) => tok === "suomi" || tok === "finland"
    );
    const wantsUusimaaRegion = queryTokens.some((tok) => tok === "uusimaa");
    const specificCityTokens = queryTokens.filter(
      (tok) => tok !== "suomi" && tok !== "finland" && tok !== "uusimaa"
    );

    const specificCityHit = specificCityTokens.some((tok) =>
      containsWholePlaceTerm(locationText, tok)
    );
    const uusimaaRegionHit = wantsUusimaaRegion && locationHasUusimaa;
    const countryWideHit =
      wantsCountryWideFinland &&
      (locationHasFinland ||
        countryExplicitFinland ||
        isRemoteFinlandConfirmed ||
        isMultiLocationMixed);

    const directQueryHit =
      specificCityHit || uusimaaRegionHit || countryWideHit;

    if (directQueryHit) {
      if (isForeignCountry) {
        return {
          matchesFilter: false,
          isFinlandConfirmed: false,
          isLocationUncertain: true,
          isExplicitlyForeign: true,
          reason: null,
          uncertainty: null,
        };
      }
      if (isMultiLocationMixed) {
        return {
          matchesFilter: true,
          isFinlandConfirmed: false,
          isLocationUncertain: true,
          isExplicitlyForeign: false,
          reason: null,
          uncertainty: `Ilmoituksessa mainitaan useita toimipaikkoja (${job.location}) — varmista ensisijainen sijainti ja Suomessa työskentely ilmoituksesta.`,
        };
      }
      if (isFinlandCityMissingOnly) {
        return {
          matchesFilter: true,
          isFinlandConfirmed: false,
          isLocationUncertain: true,
          isExplicitlyForeign: false,
          reason: null,
          uncertainty:
            "Ilmoituksen maakoodi on Suomi, mutta kaupunkia ei ole erikseen ilmoitettu — tarkista tarkka sijainti.",
        };
      }
      return {
        matchesFilter: true,
        isFinlandConfirmed: true,
        isLocationUncertain: false,
        isExplicitlyForeign: false,
        reason: `Sijainti (${job.location}) vastaa hakuehtoa "${preferences.locationQuery}".`,
        uncertainty: null,
      };
    }

    // Remote explicitly confirmed for Finland satisfies Finnish location queries (e.g. Uusimaa / Suomi / Helsinki)
    if (isRemoteFinlandConfirmed && wantsFinland) {
      return {
        matchesFilter: true,
        isFinlandConfirmed: true,
        isLocationUncertain: false,
        isExplicitlyForeign: false,
        reason: "Etätyö Suomesta on mainittu ilmoituksessa.",
        uncertainty: null,
      };
    }

    // Remote without Finland confirmation is allowed ONLY with explicit uncertainty warning (never marked Finland-confirmed)
    if (
      isRemoteWithoutFinland &&
      preferences.remotePreference !== "onsite_or_hybrid"
    ) {
      return {
        matchesFilter: true,
        isFinlandConfirmed: false,
        isLocationUncertain: true,
        isExplicitlyForeign: false,
        reason: null,
        uncertainty:
          "Ilmoituksessa mainitaan etätyö, mutta oikeutta työskennellä Suomesta ei ole vahvistettu — tarkista sijaintirajoitukset ilmoituksesta.",
      };
    }

    // Missing/unknown location is not treated as confirmed domestic; keep with clear uncertainty warning
    if (isMissingLocation) {
      return {
        matchesFilter: true,
        isFinlandConfirmed: false,
        isLocationUncertain: true,
        isExplicitlyForeign: false,
        reason: null,
        uncertainty:
          "Työpaikan sijaintia ei ole ilmoitettu — ei voida vahvistaa kotimaantehtäväksi.",
      };
    }

    // Another Finnish city (e.g. Espoo when user typed Helsinki, or Tampere when user typed Uusimaa)
    if (isPureFinlandDomestic) {
      return {
        matchesFilter: false,
        isFinlandConfirmed: true,
        isLocationUncertain: false,
        isExplicitlyForeign: false,
        reason: null,
        uncertainty: null,
      };
    }

    return {
      matchesFilter: false,
      isFinlandConfirmed: false,
      isLocationUncertain: true,
      isExplicitlyForeign: isForeignCountry,
      reason: null,
      uncertainty: null,
    };
  }

  // No specific locationQuery typed
  if (isConflictingCountryAndCity) {
    return {
      matchesFilter: true,
      isFinlandConfirmed: false,
      isLocationUncertain: true,
      isExplicitlyForeign: true,
      reason: null,
      uncertainty: `Sijainti (${job.location}) ja maakoodi (${job.country}) ovat ristiriitaiset — ei voida vahvistaa Suomessa tehtäväksi työksi.`,
    };
  }

  if (isMultiLocationMixed) {
    return {
      matchesFilter: true,
      isFinlandConfirmed: false,
      isLocationUncertain: true,
      isExplicitlyForeign: false,
      reason: null,
      uncertainty: `Ilmoituksessa mainitaan useita toimipaikkoja (${job.location}) — varmista ensisijainen sijainti ja Suomessa työskentely ilmoituksesta.`,
    };
  }

  if (isRemoteWithoutFinland) {
    return {
      matchesFilter: true,
      isFinlandConfirmed: false,
      isLocationUncertain: true,
      isExplicitlyForeign: false,
      reason: null,
      uncertainty:
        "Etätyöilmoituksessa ei ole vahvistettu Suomesta työskentelyn mahdollisuutta — tarkista verotus- ja sijaintiehdot.",
    };
  }

  if (isMissingLocation) {
    return {
      matchesFilter: true,
      isFinlandConfirmed: false,
      isLocationUncertain: true,
      isExplicitlyForeign: false,
      reason: null,
      uncertainty: "Työpaikan sijaintia ei ole ilmoitettu ilmoituksen metatiedoissa.",
    };
  }

  if (isFinlandCityMissingOnly) {
    return {
      matchesFilter: true,
      isFinlandConfirmed: false,
      isLocationUncertain: true,
      isExplicitlyForeign: false,
      reason: null,
      uncertainty:
        "Ilmoituksen maakoodi on Suomi, mutta kaupunkia ei ole erikseen ilmoitettu.",
    };
  }

  return {
    matchesFilter: true,
    isFinlandConfirmed: isPureFinlandDomestic || isRemoteFinlandConfirmed,
    isLocationUncertain: false,
    isExplicitlyForeign: isForeignCountry,
    reason:
      isPureFinlandDomestic || isRemoteFinlandConfirmed
        ? `Sijainti (${job.location}) sopii Suomesta työskentelyyn.`
        : null,
    uncertainty: isForeignCountry
      ? `Sijainti (${job.location}) on Suomen ulkopuolella.`
      : null,
  };
}

function extractUniqueCertifications(text: string): string[] {
  const found = new Set<string>();
  const regex = new RegExp(CERTIFICATION_MATCH_PATTERN.source, "gi");
  for (const match of text.matchAll(regex)) {
    if (match[1]) {
      found.add(match[1].toUpperCase());
    }
  }
  return [...found];
}

function profileConfirmsEarnedCertification(
  profile: CandidateProfile | undefined,
  certUpper: string
): boolean {
  if (!profile) return false;
  const certRegex = new RegExp(
    `(?:^|[^a-z0-9äöå])${escapeRegExp(certUpper)}(?=$|[^a-z0-9äöå])`,
    "i"
  );
  const negationCue =
    /\b(ei\b|en\s+ole|puuttuu|ilman|not\s+certified|no\s+cert|without|missing)\b/i;
  const studyOrPrepCue =
    /\b(opintojakso|opintokokonaisu|kurssi|koulutus|valmistau|valmentava|harjoit|aihealue|linjattu|perustuva|tavoitteena|suunnitteilla|course|coursework|study|studying|aligned|prep|preparation|training|bootcamp)\b/i;
  const earnedCue =
    /\b(sertifikaat\w*|sertifioi\w*|voimassa\s+oleva\w*|suoritettu\w*|läpäisty|certified|certification\w*|earned|passed|active|valid|holds)\b/i;

  const profileSources = [
    { text: profile.technicalSkills, fromCourseworkField: false },
    { text: profile.headline, fromCourseworkField: false },
    { text: profile.previousItInternship, fromCourseworkField: false },
    { text: profile.otherWorkExperience, fromCourseworkField: false },
    { text: profile.coursework, fromCourseworkField: true },
  ];

  for (const source of profileSources) {
    const clauses = source.text.split(/[.\n;]+/);
    for (const rawClause of clauses) {
      const clause = rawClause.trim();
      if (!clause || !certRegex.test(clause)) continue;
      if (negationCue.test(clause)) continue;
      if (studyOrPrepCue.test(clause)) continue;
      if (earnedCue.test(clause)) {
        return true;
      }
      // In coursework, require explicit earned certification phrasing (never bare acronym)
      if (source.fromCourseworkField) continue;
    }
  }

  return false;
}

type CertRequirementKind = "mandatory" | "preferred" | "unclear";

function classifyJobCertMentions(
  description: string,
  certs: string[]
): Map<string, CertRequirementKind> {
  const result = new Map<string, CertRequirementKind>();
  const clauses = description.slice(0, 6000).split(/[.\n;!?]+/);
  const mandatoryCue =
    /\b(required|mandatory|must\s+have|must\s+hold|prerequisite|vaaditaan|edellytetään|edellytämme|pakollinen|pakollisena|ehdoton|vaatimuksena)\b/i;
  const preferredCue =
    /\b(preferred|nice\s+to\s+have|nice-to-have|bonus|plus|asset|advantage|desired|desirable|merit|eduksi|katsotaan\s+eduksi|plussaa|arvostamme|toivottavaa|ei\s+pakollinen|optional)\b/i;

  for (const cert of certs) {
    const certRegex = new RegExp(
      `(?:^|[^a-z0-9äöå])${escapeRegExp(cert)}(?=$|[^a-z0-9äöå])`,
      "i"
    );
    let sawMandatory = false;
    let sawPreferred = false;

    for (const rawClause of clauses) {
      const clause = rawClause.trim();
      if (!clause || !certRegex.test(clause)) continue;
      const hasMandatory = mandatoryCue.test(clause);
      const hasPreferred = preferredCue.test(clause);
      if (hasMandatory && !hasPreferred) {
        sawMandatory = true;
      } else if (hasPreferred && !hasMandatory) {
        sawPreferred = true;
      } else if (hasMandatory && hasPreferred) {
        // Mixed phrasing in one clause remains unclear rather than guaranteed preferred
        sawMandatory = false;
      }
    }

    if (sawMandatory) {
      result.set(cert, "mandatory");
    } else if (sawPreferred) {
      result.set(cert, "preferred");
    } else {
      result.set(cert, "unclear");
    }
  }

  return result;
}

interface ProfileKeywordOverlap {
  matchedTerms: string[];
  hasGoalAlignment: boolean;
}

const PROFILE_TRACKED_TERMS: Array<{ label: string; pattern: RegExp }> = [
  { label: "SQL", pattern: /\bsql|postgresql|mysql\b/i },
  { label: "Python", pattern: /\bpython\b/i },
  { label: "JavaScript / TypeScript", pattern: /\b(javascript|typescript)\b/i },
  { label: "Linux", pattern: /\blinux|bash\b/i },
  { label: "Docker / kontit", pattern: /\bdocker|container\b/i },
  { label: "Git", pattern: /\bgit\b/i },
  { label: "Pilvi-infra", pattern: /\b(cloud|pilvi|aws|azure|gcp)\b/i },
  { label: "Tietoverkot", pattern: /\b(network|tietoliikenneverk|verkko|tcp\/ip|dns)\b/i },
  { label: "Tietoturva", pattern: /\b(security(?!\+)|tietoturva|kyber|iam|soc|siem|splunk)\b/i },
  { label: "IT-tuki / Service Desk", pattern: /\b(it\s+support|service\s+desk|helpdesk|käyttäjätuki|it-tuki|tikett|käyttötuki)\b/i },
  { label: "AI / kielimallit", pattern: /\b(ai\b|llm|machine\s+learning|kielimalli|tekoäly)\b/i },
];

function stripUnverifiedCertClausesFromCorpus(text: string): string {
  return text
    .split(/[.\n;]+/)
    .filter((clause) => {
      const hasCert = extractUniqueCertifications(clause).length > 0;
      if (!hasCert) return true;
      const isPrepOrNegation =
        /\b(valmistau|valmentava|ei\b|puuttuu|linjattu|prep|studying)\b/i.test(
          clause
        );
      return !isPrepOrNegation;
    })
    .join(". ");
}

function computeProfileOverlap(
  job: DiscoveredJob,
  profile: CandidateProfile
): ProfileKeywordOverlap {
  const profileCorpus = stripUnverifiedCertClausesFromCorpus(
    [
      profile.headline,
      profile.institutionAndDegree,
      profile.previousItInternship,
      profile.coursework,
      profile.technicalSkills,
      profile.aiExperienceNote,
      profile.otherWorkExperience,
      profile.careerGoals,
    ].join("\n")
  );

  const jobCorpus = `${job.title}\n${job.department}\n${job.description.slice(0, 5000)}`;

  const matchedTerms: string[] = [];
  for (const term of PROFILE_TRACKED_TERMS) {
    if (term.pattern.test(profileCorpus) && term.pattern.test(jobCorpus)) {
      matchedTerms.push(term.label);
    }
  }

  const goalKeywords = [
    "harjoittelu",
    "intern",
    "trainee",
    "junior",
    "tietoturva",
    "security",
    "it-tuki",
    "it support",
    "service desk",
    "järjestelmä",
    "pilvi",
    "cloud",
    "sovellustuki",
  ];
  const profileGoalsLower = `${profile.headline} ${profile.careerGoals}`.toLowerCase();
  const jobTitleLower = job.title.toLowerCase();
  const hasGoalAlignment = goalKeywords.some(
    (kw) => profileGoalsLower.includes(kw) && jobTitleLower.includes(kw)
  );

  return { matchedTerms, hasGoalAlignment };
}

export function scoreDiscoveredJob(
  job: DiscoveredJob,
  preferences: DiscoverySearchPreferences,
  profile?: CandidateProfile
): {
  include: boolean;
  scoredJob: DiscoveredJob;
} {
  const domain = classifyJobDomain(job);
  const seniority = classifyJobSeniority(job);
  const locationEval = evaluateLocationAndRemote(job, preferences);

  // Language filter
  if (
    job.language !== "Ei ilmoitettu" &&
    job.language !== "other" &&
    !preferences.languages.includes(job.language)
  ) {
    return { include: false, scoredJob: job };
  }

  // Keyword filter
  const kw = preferences.keyword.trim().toLowerCase();
  if (kw) {
    const searchable = `${job.title} ${job.company} ${job.department} ${job.location} ${job.description}`.toLowerCase();
    const tokens = kw.split(/\s+/).filter(Boolean);
    if (!tokens.every((tok) => searchable.includes(tok))) {
      return { include: false, scoredJob: job };
    }
  }

  // Domain filter
  if (
    preferences.industryFocus === "it_cyber_and_pathways" &&
    domain.domainKind === "non_it"
  ) {
    return { include: false, scoredJob: job };
  }

  // Seniority filter
  if (
    preferences.seniorityLevel === "intern_trainee_junior" &&
    seniority.kind === "explicit_senior"
  ) {
    return { include: false, scoredJob: job };
  }

  // Location & remote filter
  if (!locationEval.matchesFilter) {
    return { include: false, scoredJob: job };
  }

  const matchReasons: string[] = [];
  const uncertainties: string[] = [...job.uncertainties];
  let score = 40;

  if (seniority.kind === "explicit_entry") {
    score += 22;
    if (seniority.reason) matchReasons.push(seniority.reason);
  } else if (seniority.kind === "accessible_entry") {
    score += 10;
    if (seniority.reason) uncertainties.push(seniority.reason);
  } else if (seniority.kind === "explicit_senior") {
    score -= 32;
    if (seniority.reason) uncertainties.push(seniority.reason);
  } else {
    uncertainties.push(
      "Tehtävän vaadittu kokemustaso ei käy yksiselitteisesti ilmi otsikosta — tarkista ilmoituksesta."
    );
  }

  if (domain.domainKind === "direct_cyber") {
    score += 18;
    matchReasons.push("Tehtävä liittyy suoraan kyber- tai tietoturva-alueeseen.");
  } else if (domain.domainKind === "indirect_it_pathway") {
    score += 12;
    matchReasons.push(
      "Tehtävä tarjoaa välillisen IT-, pilvi-, tuki- tai kehityspolun kyberturvallisuusosaamisen rinnalle."
    );
  } else if (domain.domainKind === "non_it") {
    score -= 28;
    uncertainties.push(
      "Rooli painottuu myyntiin, markkinointiin tai hallintoon eikä tekniseen IT- tai tietoturvatyöhön."
    );
  }

  if (locationEval.reason) {
    matchReasons.push(locationEval.reason);
    score += 8;
  }
  if (locationEval.uncertainty) {
    uncertainties.push(locationEval.uncertainty);
    score -= 8;
  }
  if (locationEval.isExplicitlyForeign) {
    score -= 25;
  }

  // Check certification requirements vs earned certifications in profile (distinct from coursework/prep)
  const uniqueCerts = extractUniqueCertifications(job.description);
  const unverifiedCerts = uniqueCerts.filter(
    (cert) => !profileConfirmsEarnedCertification(profile, cert)
  );
  const certKinds = classifyJobCertMentions(job.description, unverifiedCerts);
  const mandatoryUnverified = unverifiedCerts.filter(
    (c) => certKinds.get(c) === "mandatory"
  );
  const unclearUnverified = unverifiedCerts.filter(
    (c) => certKinds.get(c) === "unclear"
  );
  const preferredUnverified = unverifiedCerts.filter(
    (c) => certKinds.get(c) === "preferred"
  );

  if (mandatoryUnverified.length > 0) {
    score -= 18;
    uncertainties.push(
      `Tarkistettava kelpoisuus: ilmoitus mainitsee pakollisena sertifikaatin (${mandatoryUnverified.join(", ")}), jonka suorittamisesta ei ole profiilissa vahvistettua mainintaa.`
    );
  }
  if (unclearUnverified.length > 0) {
    uncertainties.push(
      `Tarkistettava: ilmoituksessa mainitaan sertifikaatti (${unclearUnverified.join(", ")}), jonka suorittamisesta ei ole profiilissa vahvistettua mainintaa — tarkista, onko kyse pakollisesta vai toivotusta edellytyksestä.`
    );
  }
  if (preferredUnverified.length > 0) {
    uncertainties.push(
      `Toivottu / eduksi katsottu sertifikaatti (${preferredUnverified.join(", ")}): profiilissa ei ole vahvistettua mainintaa sertifikaatin suorittamisesta, mutta kyse ei ole pakollisesta esteestä.`
    );
  }

  const hasBlockingUnverifiedCert =
    mandatoryUnverified.length > 0 || unclearUnverified.length > 0;

  if (
    ELIGIBILITY_CLAUSE_PATTERN.test(job.description) &&
    seniority.kind !== "explicit_senior"
  ) {
    uncertainties.push(
      "Ilmoitus sisältää opintoihin tai opiskelijastatukseen liittyvän kelpoisuusehdon — tarkista sen täyttyminen oman profiilisi ajantasaisesta tilanteesta."
    );
  }

  if (SECURITY_CLEARANCE_PATTERN.test(job.description)) {
    uncertainties.push(
      "Tehtävässä voidaan tehdä turvallisuusselvitys — tarkista edellytykset ilmoituksesta."
    );
  }

  if (
    FINNISH_LANGUAGE_REQUIRED_PATTERN.test(job.description) &&
    job.language === "en"
  ) {
    uncertainties.push(
      "Englanninkielisessä ilmoituksessa mainitaan suomen kielen taito — tarkista kielivaatimukset."
    );
  }

  if (job.deadlineStatus === "expired") {
    score -= 30;
    uncertainties.push(
      `Ilmoituksen hakuaika (${job.deadline ?? "tuntematon"}) vaikuttaa päättyneen — tarkista tilanne työnantajan sivulta.`
    );
  } else if (job.deadlineStatus === "conflicting") {
    score -= 10;
    uncertainties.push(
      `Ilmoituksessa havaittiin ristiriitaisia hakuaikoja (${job.deadline ?? ""}) — tarkista oikea määräaika.`
    );
  }

  // Apply Saved Profile ONLY when preferences.useSavedProfile is true and profile exists
  let profileOverlapCount = 0;
  if (preferences.useSavedProfile && profile) {
    const overlap = computeProfileOverlap(job, profile);
    profileOverlapCount = overlap.matchedTerms.length;
    if (overlap.matchedTerms.length > 0) {
      score += Math.min(18, overlap.matchedTerms.length * 5);
      matchReasons.push(
        `Profiilisi mainitsemat taidot/opinnot osuvat ilmoituksen sisältöön: ${overlap.matchedTerms
          .slice(0, 5)
          .join(", ")}.`
      );
    }
    if (overlap.hasGoalAlignment) {
      score += 6;
      matchReasons.push(
        "Tehtävä vastaa profiiliisi kirjattuja uratavoitteita tai harjoittelu-/alkuvaiheen suuntausta."
      );
    }
  } else {
    matchReasons.push(
      "Hakutuloksen järjestys perustuu pelkkiin hakuasetuksiin (tallennettua hakijaprofiilia ei käytetty)."
    );
  }

  if (job.isDescriptionTruncatedForAnalysis) {
    uncertainties.push(
      `Ilmoitusteksti on pitkä (${job.descriptionFullLength.toLocaleString("fi-FI")} merkkiä) ja ylittyy analyysikentän 30 000 merkin rajan — loppuosa vaatii manuaalista tarkistusta.`
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));

  // Conservative suitability category rules
  let suitabilityCategory: DiscoverySuitabilityCategory;
  if (
    seniority.kind === "explicit_senior" ||
    domain.domainKind === "non_it" ||
    job.deadlineStatus === "expired" ||
    locationEval.isExplicitlyForeign ||
    clampedScore < 35
  ) {
    suitabilityCategory = "Heikko vastaavuus";
  } else if (
    locationEval.isLocationUncertain ||
    job.deadlineStatus === "conflicting" ||
    hasBlockingUnverifiedCert ||
    seniority.kind === "unclear"
  ) {
    suitabilityCategory = "Vaatii lisätarkistusta";
  } else if (
    preferences.useSavedProfile &&
    profile &&
    locationEval.isFinlandConfirmed &&
    (domain.domainKind === "direct_cyber" ||
      domain.domainKind === "indirect_it_pathway") &&
    seniority.kind === "explicit_entry" &&
    profileOverlapCount >= 2 &&
    clampedScore >= 72
  ) {
    suitabilityCategory = "Erittäin kiinnostava";
  } else if (
    locationEval.isFinlandConfirmed &&
    (domain.domainKind === "direct_cyber" ||
      domain.domainKind === "indirect_it_pathway") &&
    clampedScore >= 52
  ) {
    suitabilityCategory = "Mahdollisesti sopiva";
  } else {
    suitabilityCategory = "Vaatii lisätarkistusta";
  }

  return {
    include: true,
    scoredJob: {
      ...job,
      discoveryScore: clampedScore,
      suitabilityCategory,
      matchReasons,
      uncertainties: [...new Set(uncertainties)],
      cyberPathwayNote: domain.cyberPathwayNote,
    },
  };
}

export function scoreAndFilterDiscoveredJobs(
  jobs: DiscoveredJob[],
  preferences: DiscoverySearchPreferences,
  profile?: CandidateProfile
): {
  matchedJobs: DiscoveredJob[];
  matchedCountByEmployerId: Map<string, number>;
} {
  const matchedJobs: DiscoveredJob[] = [];
  const matchedCountByEmployerId = new Map<string, number>();

  for (const job of jobs) {
    const { include, scoredJob } = scoreDiscoveredJob(job, preferences, profile);
    if (!include) continue;
    matchedJobs.push(scoredJob);
    matchedCountByEmployerId.set(
      scoredJob.employerId,
      (matchedCountByEmployerId.get(scoredJob.employerId) ?? 0) + 1
    );
  }

  matchedJobs.sort((a, b) => {
    if (b.discoveryScore !== a.discoveryScore) {
      return b.discoveryScore - a.discoveryScore;
    }
    return a.title.localeCompare(b.title, "fi");
  });

  return { matchedJobs, matchedCountByEmployerId };
}
