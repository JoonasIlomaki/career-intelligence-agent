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

const NON_FINLAND_COUNTRIES = new Set([
  "USA",
  "Yhdysvallat",
  "Iso-Britannia",
  "United Kingdom",
  "Singapore",
  "Filippiinit",
  "Meksiko",
  "Intia",
  "Saksa",
  "Ruotsi",
  "Sweden",
  "Norja",
  "Tanska",
  "Alankomaat",
  "Ranska",
  "Espanja",
  "Kanada",
  "Australia",
]);

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

const CERTIFICATION_REQUIREMENT_PATTERN =
  /\b(cissp|cism|cisa|oscp|ceh|security\+|az-500|sc-200|sc-300|ccsp|giac|gsec)\b/gi;

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
  const locLower = `${job.location} ${job.country}`.toLowerCase();
  const queryLower = preferences.locationQuery.trim().toLowerCase();

  const mentionsUusimaa = UUSIMAA_LOCATIONS.some((city) => locLower.includes(city));
  const mentionsFinland =
    job.country === "Finland" || FINLAND_WORDS.some((w) => locLower.includes(w));
  const isForeignCountry =
    !mentionsFinland &&
    (NON_FINLAND_COUNTRIES.has(job.country) ||
      /\b(usa|united states|minneapolis|singapore|manila|mexico|bangalore|bengaluru|berlin|london|stockholm|oslo|copenhagen)\b/i.test(
        locLower
      ));
  const isRemoteFinlandConfirmed =
    job.remoteType === "remote" &&
    (mentionsFinland || /suomi mainittu/i.test(job.remoteEligibilityNote));
  const isRemoteWithoutFinland =
    job.remoteType === "remote" && !isRemoteFinlandConfirmed && !isForeignCountry;
  const isMissingLocation =
    job.location === "Ei ilmoitettu" && job.country === "Ei ilmoitettu";

  // 1. Remote mode filter
  if (preferences.remotePreference === "onsite_or_hybrid" && job.remoteType === "remote") {
    return {
      matchesFilter: false,
      isFinlandConfirmed: isRemoteFinlandConfirmed,
      isLocationUncertain: false,
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
      isFinlandConfirmed: mentionsFinland,
      isLocationUncertain: false,
      isExplicitlyForeign: isForeignCountry,
      reason: null,
      uncertainty: null,
    };
  }

  // 2. Foreign rejection when Finland-compatible or Finnish location query active
  const wantsFinland =
    preferences.remotePreference === "finland_compatible" ||
    Boolean(
      queryLower &&
        (FINLAND_WORDS.some((w) => queryLower.includes(w)) ||
          queryLower.includes("suomi") ||
          queryLower.includes("finland"))
    );

  if (wantsFinland && isForeignCountry) {
    return {
      matchesFilter: false,
      isFinlandConfirmed: false,
      isLocationUncertain: false,
      isExplicitlyForeign: true,
      reason: null,
      uncertainty: null,
    };
  }

  // 3. Explicit non-remote location query check
  if (queryLower) {
    const queryTokens = queryLower
      .split(/[,/\s]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    const wantsUusimaa = UUSIMAA_LOCATIONS.some((u) => queryLower.includes(u));

    const directQueryHit =
      queryTokens.some((tok) => locLower.includes(tok)) ||
      (wantsUusimaa && mentionsUusimaa);

    if (directQueryHit) {
      return {
        matchesFilter: true,
        isFinlandConfirmed: true,
        isLocationUncertain: false,
        isExplicitlyForeign: false,
        reason: `Sijainti (${job.location}) vastaa hakuehtoa "${preferences.locationQuery}".`,
        uncertainty: null,
      };
    }

    // Remote explicitly confirmed for Finland satisfies Finnish location queries (e.g. Uusimaa)
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
    if (isRemoteWithoutFinland && preferences.remotePreference !== "onsite_or_hybrid") {
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

    // Another Finnish city (e.g. Tampere when user typed Uusimaa)
    if (mentionsFinland) {
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

  return {
    matchesFilter: true,
    isFinlandConfirmed: mentionsFinland || isRemoteFinlandConfirmed,
    isLocationUncertain: false,
    isExplicitlyForeign: isForeignCountry,
    reason:
      mentionsFinland || isRemoteFinlandConfirmed
        ? `Sijainti (${job.location}) sopii Suomesta työskentelyyn.`
        : null,
    uncertainty: isForeignCountry
      ? `Sijainti (${job.location}) on Suomen ulkopuolella.`
      : null,
  };
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
  { label: "Tietoturva", pattern: /\b(security|tietoturva|kyber|iam|soc|siem|splunk)\b/i },
  { label: "IT-tuki / Service Desk", pattern: /\b(it\s+support|service\s+desk|helpdesk|käyttäjätuki|it-tuki|tikett|käyttötuki)\b/i },
  { label: "AI / kielimallit", pattern: /\b(ai\b|llm|machine\s+learning|kielimalli|tekoäly)\b/i },
];

function computeProfileOverlap(
  job: DiscoveredJob,
  profile: CandidateProfile
): ProfileKeywordOverlap {
  const profileCorpus = [
    profile.headline,
    profile.institutionAndDegree,
    profile.previousItInternship,
    profile.coursework,
    profile.technicalSkills,
    profile.aiExperienceNote,
    profile.otherWorkExperience,
    profile.careerGoals,
  ].join("\n");

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
  const uncertainties: string[] = [];
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

  // Check concrete requirement friction in description
  const profileLower = profile
    ? `${profile.technicalSkills} ${profile.coursework} ${profile.previousItInternship}`.toLowerCase()
    : "";

  const certMatches = job.description.match(CERTIFICATION_REQUIREMENT_PATTERN) ?? [];
  const uniqueCerts = [...new Set(certMatches.map((c) => c.toUpperCase()))];
  const unverifiedCerts = uniqueCerts.filter(
    (cert) => !profileLower.includes(cert.toLowerCase())
  );
  if (unverifiedCerts.length > 0) {
    const certContext = job.description.slice(0, 4000);
    const certMandatoryCue = /\b(required|mandatory|vaaditaan|edellytämme|pakollinen)\b[^.\n]{0,60}\b(cissp|cism|cisa|oscp|ceh|security\+|az-500)\b/i.test(
      certContext
    );
    if (certMandatoryCue) {
      score -= 18;
      uncertainties.push(
        `Ilmoitus mainitsee pakollisena tai keskeisenä sertifikaatin (${unverifiedCerts.join(", ")}), jota ei löydy profiilista.`
      );
    } else {
      uncertainties.push(
        `Ilmoituksessa mainitaan sertifikaatti (${unverifiedCerts.join(", ")}) — tarkista, onko kyse pakollisesta vai toivotusta edellytyksestä.`
      );
    }
  }

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
    unverifiedCerts.length > 0 ||
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
      uncertainties,
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
