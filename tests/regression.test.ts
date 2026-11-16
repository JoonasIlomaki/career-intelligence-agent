import test from "node:test";
import assert from "node:assert/strict";
import {
  candidateProfileSchema,
  careerBackupSchema,
  MISSING_VALUE,
  savedJobEntrySchema,
  validateAndNormalizeAnalysis,
} from "../src/lib/validation.ts";
import type { JobAnalysisResult } from "../src/types/career.ts";
import { DEFAULT_CANDIDATE_PROFILE } from "../src/data/defaultProfile.ts";
import {
  analyzeJobPosting,
  AnalysisError,
  buildPrompt,
  SYSTEM_INSTRUCTION,
} from "../server/analyzeJob.ts";
import { getActionabilityGuidance } from "../src/lib/availability.ts";
import {
  AnalysisRequestCoordinator,
  SimultaneousAnalysisError,
} from "../src/lib/analysisRunner.ts";
import {
  applySavedJobMetaPatch,
  formatSavedJobTimestamp,
} from "../src/lib/timestamps.ts";
import { loadCandidateProfile, loadSavedJobs } from "../src/lib/storage.ts";

function makeBaseRawAnalysis(): JobAnalysisResult {
  return {
    extracted: {
      company: "Sofigate",
      position: "Junior AI Advisor (Generation AI Team)",
      location: "Helsinki",
      workModel: "Hybridi",
      employmentType: "Toistaiseksi voimassa oleva (vakinainen)",
      deadline: "Ei ilmoitettu",
      salaryInfo: "Ei ilmoitettu",
      requiredQualifications: [
        {
          item: "Kiinnostus ja perusymmärrys tekoälyratkaisuista ja automaatiosta",
          evidence: "kiinnostusta tekoälyratkaisujen hyödyntämiseen",
        },
      ],
      preferredQualifications: [],
      mainResponsibilities: [
        {
          item: "Asiakasprojektien tukeminen mahdollisesti ServiceNow-alustalla",
          evidence: "työskentelet mahdollisesti esimerkiksi ServiceNow-alustan parissa",
        },
      ],
      applicationSteps: [],
    },
    mandatoryEligibility: [],
    skillsComparison: {
      strongMatches: [],
      partialMatches: [],
      significantGaps: [],
      learningOpportunities: [],
      unknownInformation: [],
    },
    practicalConsiderations: {
      locationAndCommute: "Helsinki (hybridi), saavutettavissa Lohjalta",
      scheduleAndStart: "Ei ilmoitettu",
      employmentTypeNote: "Vakinainen kokoaikainen junior-tehtävä",
      salaryNote: "Ei ilmoitettu",
      internshipCreditAssessment:
        "Tarkistettava korkeakoululta (Laurea): voidaanko vakinainen junior-työsuhde opinnollistaa tutkinnon toiseksi harjoitteluksi.",
    },
    cybersecurityEvaluation: {
      relevanceLevel: "Välillinen",
      progressionPath: "Välillinen",
      taskDomains: ["Tekoälyratkaisut", "Automaatio", "IT-konsultointi"],
      relevantDomains: ["Tekoälyratkaisut", "Automaatio", "IT-konsultointi"],
      factsSummary:
        "Ilmoitus koskee tekoäly- ja automaatiokonsultointia, ei suoraa tietoturvatiimiä.",
      interpretationSummary:
        "Tarjoaa realistista IT-konsultointi- ja tekoälykokemusta, josta on välillinen polku kohti turvallisen tekoälyn (secure AI) tai GRC-rooleja.",
    },
    recommendation: {
      category: "Harkinnan arvoinen",
      criticalReasons: [
        "Tehtävä ei ole suora kyberturvallisuusrooli, mutta tarjoaa arvokasta IT- ja AI-kokemusta.",
      ],
      nextAction:
        "Tarkista Laurealta opinnollistamismahdollisuus ja valmistele hakemus.",
    },
    evidenceHighlights: [
      {
        claim: "ServiceNow mainitaan mahdollisena työvälineenä",
        excerpt: "mahdollisesti esimerkiksi ServiceNow-alustan parissa",
        kind: "Fakta",
      },
    ],
    urlVerificationNotice: "placeholder",
  };
}

test("Tapaus 1: Valinnainen teknologia (ServiceNow) pysyy oppimismahdollisuutena eikä merkittävänä puutteena", () => {
  const raw = makeBaseRawAnalysis();
  raw.skillsComparison.learningOpportunities = [
    {
      technologyOrTopic: "ServiceNow",
      contextInJob: "Mainittu mahdollisena alustana projektityössä, ei vaadittu etukäteen.",
      evidence: "mahdollisesti esimerkiksi ServiceNow-alustan parissa",
    },
  ];
  // Simuloidaan tilanne, jossa malli olisi silti yrittänyt lisätä ServiceNow'n puutteeksi
  raw.skillsComparison.significantGaps = [
    {
      requirement: "ServiceNow-kokemus",
      gapDetail: "Hakijalla ei ole aiempaa ServiceNow-kokemusta.",
      jobEvidence: "mahdollisesti esimerkiksi ServiceNow-alustan parissa",
    },
  ];

  const normalized = validateAndNormalizeAnalysis(raw, "");
  assert.equal(normalized.skillsComparison.learningOpportunities?.length, 1);
  assert.equal(
    normalized.skillsComparison.learningOpportunities?.[0].technologyOrTopic,
    "ServiceNow"
  );
  assert.equal(normalized.skillsComparison.significantGaps.length, 0);
  assert.match(SYSTEM_INSTRUCTION, /ServiceNow/);
});

test("Tapaus 2: Vakinainen junior-tehtävä ja puuttuva harjoittelu ei muodosta automaattista osaamispuutetta vaan opinnollistamistarkistuksen", () => {
  const raw = makeBaseRawAnalysis();
  // Simuloidaan mallin virheellinen puutemerkintä vakinaisen tehtävän ja harjoittelun välillä
  raw.skillsComparison.significantGaps = [
    {
      requirement: "Tutkinnon toinen harjoittelu vielä suorittamatta vakinaiseen tehtävään",
      gapDetail: "Vakinainen työsuhde ei ole harjoittelu.",
      jobEvidence: "Toistaiseksi voimassa oleva työsuhde",
    },
  ];

  const normalized = validateAndNormalizeAnalysis(raw, "");
  assert.equal(normalized.skillsComparison.significantGaps.length, 0);
  assert.match(
    normalized.practicalConsiderations?.internshipCreditAssessment ?? "",
    /opinnollistaa/i
  );
});

test("Tapaus 3: Pakollinen puuttuva ammattisertifikaatti tunnistetaan merkittäväksi puutteeksi ja kelpoisuusehdoksi", () => {
  const raw = makeBaseRawAnalysis();
  raw.extracted.position = "SOC Analyst";
  raw.mandatoryEligibility = [
    {
      requirement: "Voimassa oleva CISSP- tai CompTIA Security+ -sertifikaatti",
      status: "Puuttuu",
      detail: "Hakijaprofiilissa ei ole mainittu kyberturvallisuussertifikaatteja.",
      evidence: "Required: valid CompTIA Security+ or CISSP certification",
    },
  ];
  raw.skillsComparison.significantGaps = [
    {
      requirement: "CompTIA Security+ tai CISSP -sertifikaatti",
      gapDetail: "Ilmoitus edellyttää pakollista sertifikaattia, jota hakijalla ei ole.",
      jobEvidence: "Required: valid CompTIA Security+ or CISSP certification",
    },
  ];

  const normalized = validateAndNormalizeAnalysis(raw, "");
  assert.equal(normalized.mandatoryEligibility?.[0].status, "Puuttuu");
  assert.equal(normalized.skillsComparison.significantGaps.length, 1);
});

test("Tapaus 4: Junior IT -rooli välillisellä kyberturvallisuuspolulla erottaa tehtävän osaamisalueet suorasta kyberrelevanssista", () => {
  const raw = makeBaseRawAnalysis();
  const normalized = validateAndNormalizeAnalysis(raw, "");

  assert.equal(normalized.cybersecurityEvaluation.relevanceLevel, "Välillinen");
  assert.equal(normalized.cybersecurityEvaluation.progressionPath, "Välillinen");
  assert.deepEqual(normalized.cybersecurityEvaluation.taskDomains, [
    "Tekoälyratkaisut",
    "Automaatio",
    "IT-konsultointi",
  ]);
});

test("Tapaus 5: Moniosainen pakollinen videotehtävä purkaa kaikki osat ja varoittaa esittämästä keskeneräistä harjoitusta valmiina projektina", () => {
  const raw = makeBaseRawAnalysis();
  raw.extracted.applicationSteps = [
    {
      step: "Pakollinen 2-osainen videotehtävä hakemuksen yhteydessä",
      isMandatory: true,
      parts: [
        "Esittele yksi jo aiemmin toteuttamasi tekoälyprojekti.",
        "Kerro unelmastasi tekoälyn hyödyntämisestä tulevaisuudessa.",
      ],
      evidence:
        "Lähetä lyhyt video, jossa kerrot toteuttamastasi AI-projektista sekä unelmastasi AI:n käytössä.",
      candidateCaution:
        "Profiilin M365 Copilot -agenttiharjoitus on ohjattu opintoharjoitus, ei itsenäinen valmis tuotantoprojekti; kuvaa se rehellisesti ohjattuna harjoituksena.",
    },
  ];

  const normalized = validateAndNormalizeAnalysis(raw, "");
  assert.equal(normalized.extracted.applicationSteps?.length, 1);
  assert.equal(normalized.extracted.applicationSteps?.[0].parts.length, 2);
  assert.match(
    normalized.extracted.applicationSteps?.[0].candidateCaution ?? "",
    /ohjattu/i
  );
});

test("Estää tuplalaskennan ja sijainti-/työsuhdetietojen vuotamisen osaamisvertailuun", () => {
  const raw = makeBaseRawAnalysis();
  raw.skillsComparison.strongMatches = [
    {
      skillOrRequirement: "Sijainti Helsinki / Lohja",
      candidateBasis: "Asuu Lohjalla",
      jobEvidence: "Sijainti Helsinki",
    },
    {
      skillOrRequirement: "Dokumentointi ja raportointi",
      candidateBasis: "Aiempi IT-harjoittelu sisälsi dokumentointia.",
      jobEvidence: "dokumentointitaidot",
    },
  ];
  raw.skillsComparison.significantGaps = [
    {
      requirement: "Usean vuoden konsultointikokemus",
      gapDetail: "Hakijalla ei ole konsultointikokemusta.",
      jobEvidence: "2+ years of consulting experience",
    },
    {
      requirement: "Usean vuoden konsultointikokemus (IT-konsultointi)",
      gapDetail: "Toistuva merkintä samasta puutteesta.",
      jobEvidence: "2+ years of consulting experience",
    },
  ];

  const normalized = validateAndNormalizeAnalysis(raw, "");
  assert.equal(normalized.skillsComparison.strongMatches.length, 1);
  assert.equal(
    normalized.skillsComparison.strongMatches[0].skillOrRequirement,
    "Dokumentointi ja raportointi"
  );
  assert.equal(normalized.skillsComparison.significantGaps.length, 1);
});

test("Taaksepäin yhteensopivuus: vanha v1-tallenne ja JSON-varmuuskopio ilman uusia kenttiä validoidaan virheettä", () => {
  const legacyJob = {
    id: "legacy-1",
    createdAt: "2026-10-30T10:00:00.000Z",
    updatedAt: "2026-10-30T10:00:00.000Z",
    jobUrl: "https://example.com/job",
    rawJobText: "Vanha ilmoitusteksti...",
    status: "Tallennettu",
    notes: "Säilytettävä muistiinpano",
    targetDate: "2026-11-15",
    analysis: {
      extracted: {
        company: "Yritys Oy",
        position: "SOC Trainee",
        location: "Espoo",
        workModel: "Hybridi",
        employmentType: "Harjoittelu",
        deadline: MISSING_VALUE,
        salaryInfo: MISSING_VALUE,
        requiredQualifications: [],
        preferredQualifications: [],
        mainResponsibilities: [],
      },
      skillsComparison: {
        strongMatches: [],
        partialMatches: [],
        significantGaps: [],
        unknownInformation: [],
      },
      cybersecurityEvaluation: {
        relevanceLevel: "Korkea",
        progressionPath: "Suora",
        relevantDomains: ["SOC"],
        factsSummary: "SOC-harjoittelu",
        interpretationSummary: "Suora polku",
      },
      recommendation: {
        category: "Ensisijainen hakukohde",
        criticalReasons: ["Suora kyberrooli"],
        nextAction: "Hae heti",
      },
      evidenceHighlights: [],
      urlVerificationNotice: "Ei avattu",
    },
  };

  const parsedJob = savedJobEntrySchema.parse(legacyJob);
  assert.equal(parsedJob.notes, "Säilytettävä muistiinpano");
  assert.equal(parsedJob.availabilityStatus, "Ei tarkistettu");

  const legacyBackup = {
    version: 1,
    exportedAt: "2026-10-30T10:00:00.000Z",
    profile: DEFAULT_CANDIDATE_PROFILE,
    savedJobs: [legacyJob],
  };

  const parsedBackup = careerBackupSchema.parse(legacyBackup);
  assert.equal(parsedBackup.savedJobs.length, 1);

  const prompt = buildPrompt(
    DEFAULT_CANDIDATE_PROFILE,
    "Haemme Junior AI Advisoria Helsinkiin.",
    ""
  );
  assert.match(prompt, /<UNTRUSTED_JOB_POSTING>/);
});

test("Tapaus 6: Kilpailuedut (preferredQualifications) eivät päädy merkittäviksi puutteiksi ilman nimenomaista vaatimusta", () => {
  const raw = makeBaseRawAnalysis();
  raw.extracted.preferredQualifications = [
    {
      item: "Aiempi konsultointikokemus",
      evidence: "Aiempi konsultointikokemus katsotaan eduksi",
    },
  ];
  raw.skillsComparison.significantGaps = [
    {
      requirement: "Aiempi konsultointikokemus",
      gapDetail: "Hakijalla ei ole konsultointikokemusta.",
      jobEvidence: "Aiempi konsultointikokemus katsotaan eduksi",
    },
    {
      requirement: "Sujuva suomen ja englannin kieli",
      gapDetail: "Esimerkki nimenomaisesta vaatimuksesta, jos puuttuisi.",
      jobEvidence: "Vaatimus: sujuva suomi ja englanti",
    },
  ];

  const normalized = validateAndNormalizeAnalysis(raw, "");
  assert.equal(normalized.skillsComparison.significantGaps.length, 1);
  assert.equal(
    normalized.skillsComparison.significantGaps[0].requirement,
    "Sujuva suomen ja englannin kieli"
  );
});

test("Tapaus 7: Ohjeet kieltävät opinnäytetyön kielen päättelyn, erottavat siirrettävän osaamisen sisäisistä urapoluista ja tunnistavat automaatio-/AI-kokeilut", () => {
  assert.match(SYSTEM_INSTRUCTION, /opinnäytetyön kieltä/);
  assert.match(SYSTEM_INSTRUCTION, /automaatio- tai kehitystehtävät/);
  assert.match(SYSTEM_INSTRUCTION, /ohjatut tekoälykokeilut/);
  assert.match(SYSTEM_INSTRUCTION, /sertifiointikoulutukseen linjattu opintosisältö/);
  assert.match(SYSTEM_INSTRUCTION, /transferableCyberSkills/);
  assert.match(SYSTEM_INSTRUCTION, /internalCareerOpportunities/);

  const raw = makeBaseRawAnalysis();
  raw.cybersecurityEvaluation.transferableCyberSkills =
    "Automaatio-, dokumentointi- ja tekoälyosaaminen tukee myöhempiä turvallisen tekoälyn ja GRC-rooleja.";
  raw.cybersecurityEvaluation.internalCareerOpportunities = {
    confirmed: "Ei ilmoitettu",
    plausible: "Kasvavassa IT-talossa voi olla myöhempiä tietoturva- ja hallintatehtäviä.",
    unknown: "Ilmoitus ei vahvista suoria siirtymiä kyberturvallisuustiimeihin.",
  };

  const normalized = validateAndNormalizeAnalysis(raw, "");
  assert.match(
    normalized.cybersecurityEvaluation.transferableCyberSkills ?? "",
    /GRC/
  );
  assert.equal(
    normalized.cybersecurityEvaluation.internalCareerOpportunities?.confirmed,
    "Ei ilmoitettu"
  );
});

test("Tapaus 8: Erittäin soveltuva mutta vahvistetusti päättynyt työpaikka säilyttää soveltuvuuden ja merkitään ei-ajankohtaiseksi", () => {
  const guidance = getActionabilityGuidance(
    "Ensisijainen hakukohde",
    "Päättynyt",
    "2026-11-15",
    "https://example.com/junior-soc"
  );
  assert.equal(guidance.status, "Päättynyt");
  assert.equal(guidance.isActionable, false);
  assert.equal(guidance.tone, "closed");
  assert.match(guidance.detail, /Ensisijainen hakukohde/);
  assert.match(guidance.headline, /päättynyt/i);
});

test("Tapaus 9: Erittäin soveltuva työpaikka tarkistamattomalla hakutilanteella kehottaa tarkistamaan voimassaolon ennen hakemista", () => {
  const guidance = getActionabilityGuidance(
    "Ensisijainen hakukohde",
    "Ei tarkistettu"
  );
  assert.equal(guidance.status, "Ei tarkistettu");
  assert.equal(guidance.requiresVerificationCheck, true);
  assert.equal(guidance.tone, "unverified");
  assert.match(guidance.headline, /tarkista voimassaolo/i);
  assert.match(guidance.detail, /ei ole avannut/i);
});

test("Tapaus 10: Vahvistetusti avoin työpaikka heikolla osaamisvastaavuudella säilyttää kriittisen varoituksen", () => {
  const guidance = getActionabilityGuidance(
    "Matala prioriteetti",
    "Avoinna",
    "2026-11-15",
    "https://example.com/senior-role"
  );
  assert.equal(guidance.status, "Avoinna");
  assert.equal(guidance.isActionable, true);
  assert.equal(guidance.tone, "caution");
  assert.match(guidance.headline, /heikko/i);
  assert.match(guidance.detail, /Matala prioriteetti/);
});

test("Tapaus 11: Yövuorot ja pitkä työmatka erottavat maantieteellisen sijainnin ja vuorotyön toteutettavuuden", () => {
  assert.match(SYSTEM_INSTRUCTION, /yövuoroja/);
  assert.match(SYSTEM_INSTRUCTION, /shiftAndScheduleFeasibility/);

  const raw = makeBaseRawAnalysis();
  raw.extracted.position = "Junior SOC Analyst (24/7)";
  raw.practicalConsiderations = {
    locationAndCommute:
      "Helsinki / Espoo kuuluu hakualueeseen Lohjalta päiväsaikaan.",
    shiftAndScheduleFeasibility:
      "24/7-vuorotyö ja yövuorot voivat aiheuttaa kohtuuttoman kuormituksen pitkän työmatkan (Lohja) ja yöaikaisen julkisen liikenteen puutteen vuoksi; turvallisuus ja palautuminen tarkistettava ennen hakemista.",
    scheduleAndStart: "Vuorotyö 24/7",
    employmentTypeNote: "Vakinainen",
    salaryNote: "Ei ilmoitettu",
    internshipCreditAssessment:
      "Tarkistettava Laurealta opinnollistamismahdollisuus.",
  };

  const normalized = validateAndNormalizeAnalysis(raw, "https://example.com/soc");
  assert.match(
    normalized.practicalConsiderations?.shiftAndScheduleFeasibility ?? "",
    /yövuorot/i
  );
  assert.match(
    normalized.urlVerificationNotice,
    /ei yksinään todista, että haku on avoinna/i
  );
});

test("Tapaus 12: Analyysin keskeytys abortoi pyynnön välittömästi ja hylkää myöhässä saapuvan vastauksen", async () => {
  const coordinator = new AnalysisRequestCoordinator<JobAnalysisResult>();
  let capturedSignal: AbortSignal | undefined;
  let resolveLateResponse!: (value: JobAnalysisResult) => void;

  const firstRun = coordinator.run(
    (signal) =>
      new Promise<JobAnalysisResult>((resolve) => {
        capturedSignal = signal;
        resolveLateResponse = resolve;
      })
  );

  assert.equal(coordinator.isRunning(), true);
  assert.equal(capturedSignal?.aborted, false);

  const didCancel = coordinator.cancel();
  assert.equal(didCancel, true);
  assert.equal(coordinator.isRunning(), false);
  assert.equal(capturedSignal?.aborted, true);

  // Myöhässä saapuva vastaus ei saa koskaan päätyä valmiiksi tulokseksi
  const lateResult = makeBaseRawAnalysis();
  lateResult.extracted.company = "Myöhäinen vastaus Oy";
  resolveLateResponse(lateResult);

  const outcome = await firstRun;
  assert.deepEqual(outcome, { status: "ignored" });

  // AbortError-hylkäys tuottaa cancelled-tilan eikä virheilmoitusta
  const abortedRun = coordinator.run(
    (signal) =>
      new Promise<JobAnalysisResult>((_, reject) => {
        signal.addEventListener("abort", () => {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        });
      })
  );
  assert.equal(coordinator.cancel(), true);
  const abortedOutcome = await abortedRun;
  assert.deepEqual(abortedOutcome, { status: "cancelled" });
});

test("Tapaus 13: Estää samanaikaiset analyysit ja mahdollistaa uuden analyysin eri syötteellä ilman vanhan vastauksen ylikirjoitusta", async () => {
  const coordinator = new AnalysisRequestCoordinator<string>();
  let resolveOldRequest!: (value: string) => void;

  const oldRun = coordinator.run(
    () =>
      new Promise<string>((resolve) => {
        resolveOldRequest = resolve;
      })
  );

  await assert.rejects(
    () => coordinator.run(async () => "Kilpaileva pyyntö"),
    SimultaneousAnalysisError
  );

  assert.equal(coordinator.cancel(), true);
  assert.equal(coordinator.isRunning(), false);

  // Käynnistetään heti uusi analyysi eri syötteellä
  let resolveNewRequest!: (value: string) => void;
  const newRun = coordinator.run(
    () =>
      new Promise<string>((resolve) => {
        resolveNewRequest = resolve;
      })
  );

  // Vanha pyyntö valmistuu myöhässä uuden pyynnön ollessa yhä käynnissä
  resolveOldRequest("Vanha peruttu analyysi");
  assert.deepEqual(await oldRun, { status: "ignored" });
  assert.equal(coordinator.isRunning(), true);

  // Uusi analyysi valmistuu puhtaasti eikä vanha vastaus ylikirjoita sitä
  resolveNewRequest("Uusi analyysi SOC-roolista");
  assert.deepEqual(await newRun, {
    status: "completed",
    data: "Uusi analyysi SOC-roolista",
  });
  assert.equal(coordinator.isRunning(), false);
});

test("Tapaus 14: Palvelimen analyzeJobPosting kunnioittaa keskeytettyä AbortSignalia", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () =>
      analyzeJobPosting({
        jobText:
          "Haemme Junior SOC Analystia Helsinkiin. Edellytämme tietoturvan perusteiden hallintaa.",
        jobUrl: "",
        profile: DEFAULT_CANDIDATE_PROFILE,
        signal: controller.signal,
      }),
    (err: unknown) =>
      err instanceof AnalysisError &&
      err.statusCode === 499 &&
      err.message === "Analyysi keskeytetty."
  );
});

test("Tapaus 15: Aikaleimojen muotoilu käyttää dd.MM.yyyy klo HH:mm -muotoa eikä keksi puuttuvaa kellonaikaa", () => {
  // Paikallinen aikavyöhyke luodaan eksplisiittisesti testin luotettavuutta varten
  const localDate = new Date(2026, 2, 5, 9, 4, 0, 0); // 05.03.2026 klo 09:04 paikallista aikaa
  assert.equal(
    formatSavedJobTimestamp(localDate.toISOString()),
    "05.03.2026 klo 09:04"
  );

  // Pelkän päivämäärän sisältävät vanhat merkinnät eivät saa keksittyä kellonaikaa
  assert.equal(formatSavedJobTimestamp("2026-10-27"), "27.10.2026");
  assert.equal(formatSavedJobTimestamp("5.11.2026"), "05.11.2026");
  assert.equal(formatSavedJobTimestamp(""), "—");
});

test("Tapaus 16: Muokkaus päivittää updatedAt-aikaleiman muuttamatta alkuperäistä createdAt-aikaleimaa ja säilyttää vanhat tietueet", () => {
  const analysis = makeBaseRawAnalysis();
  const originalCreatedAt = "2026-10-27T08:15:00.000Z";
  const initialEntry = savedJobEntrySchema.parse({
    id: "job-ts-1",
    createdAt: originalCreatedAt,
    updatedAt: originalCreatedAt,
    jobUrl: "https://example.com/job",
    rawJobText: "Ilmoituksen teksti...",
    status: "Tallennettu",
    notes: "",
    targetDate: "2026-10-27",
    analysis,
  });

  const edited = applySavedJobMetaPatch(
    initialEntry,
    { notes: "Lähetetty hakemus", status: "Haettu" },
    "2026-11-15T14:30:00.000Z"
  );

  assert.equal(edited.createdAt, originalCreatedAt);
  assert.equal(edited.updatedAt, "2026-11-15T14:30:00.000Z");
  assert.equal(edited.notes, "Lähetetty hakemus");
  assert.equal(edited.status, "Haettu");

  // Muuttumaton päivitys ei muuta updatedAt-kenttää
  const noop = applySavedJobMetaPatch(
    edited,
    { notes: "Lähetetty hakemus" },
    "2026-11-16T10:00:00.000Z"
  );
  assert.equal(noop.updatedAt, "2026-11-15T14:30:00.000Z");

  // Vanha tietue pelkällä päivämäärällä ja ilman updatedAt-kenttää säilyy kelvollisena
  const legacyEntry = savedJobEntrySchema.parse({
    id: "legacy-date-only",
    createdAt: "2026-10-20",
    jobUrl: "",
    rawJobText: "Vanha teksti...",
    status: "Tallennettu",
    notes: "Vanha muistiinpano",
    targetDate: "2026-10-20",
    analysis,
  });
  assert.equal(formatSavedJobTimestamp(legacyEntry.createdAt), "20.10.2026");
  assert.equal(legacyEntry.updatedAt, "");
});

test("Tapaus 17: Nimenomaisesti vaadittu osaamispuute (Python) säilyy merkittävänä puutteena vaikka se esiintyisi myös oppimismahdollisuuksissa", () => {
  const raw = makeBaseRawAnalysis();
  raw.extracted.requiredQualifications = [
    {
      item: "At least 3 years of professional Python development experience.",
      evidence: "At least 3 years of professional Python development experience.",
    },
  ];
  raw.skillsComparison.significantGaps = [
    {
      requirement: "Missing professional Python development experience",
      gapDetail:
        "Hakijalla on vain alkeistason Python-kokemus, mutta tehtävässä vaaditaan vähintään 3 vuoden ammattimainen kehityskokemus.",
      jobEvidence:
        "At least 3 years of professional Python development experience.",
    },
  ];
  raw.skillsComparison.learningOpportunities = [
    {
      technologyOrTopic: "Python",
      contextInJob: "Python-kehitys roolissa.",
      evidence:
        "At least 3 years of professional Python development experience.",
    },
  ];

  const normalized = validateAndNormalizeAnalysis(raw, "");
  assert.equal(normalized.skillsComparison.significantGaps.length, 1);
  assert.equal(
    normalized.skillsComparison.significantGaps[0].requirement,
    "Missing professional Python development experience"
  );
  // Kun Python on pakollinen puute, se ei saa jäädä pelkkänä valinnaisena oppimismahdollisuutena kilpailemaan
  assert.equal(
    normalized.skillsComparison.learningOpportunities?.some(
      (l) => l.technologyOrTopic.toLowerCase() === "python"
    ),
    false
  );
});

test("Tapaus 18: Pakollinen kelpoisuusehto ohittaa oppimismahdollisuuden eikä kapea tai osittainen tekstiosuma poista eri osaamispuutteita", () => {
  const raw = makeBaseRawAnalysis();
  raw.extracted.requiredQualifications = [
    {
      item: "JavaScript-osaaminen ja Python-kehitys",
      evidence: "Vaatimus: JavaScript-osaaminen ja Python-kehitys",
    },
  ];
  raw.mandatoryEligibility = [
    {
      requirement: "Voimassa oleva CISSP-sertifikaatti",
      status: "Puuttuu",
      detail: "Pakollinen sertifikaatti puuttuu.",
      evidence: "Mandatory: valid CISSP certification",
    },
  ];
  raw.skillsComparison.significantGaps = [
    {
      requirement: "CISSP-sertifikaatti",
      gapDetail: "Hakijalla ei ole CISSP-sertifikaattia.",
      jobEvidence: "Mandatory: valid CISSP certification",
    },
    {
      requirement: "JavaScript-kehitys",
      gapDetail: "Hakijalta puuttuu vaadittu JavaScript-kehityskokemus.",
      jobEvidence: "Vaatimus: JavaScript-kehitys",
    },
    {
      requirement: "Security audit experience",
      gapDetail: "Hakijalla ei ole tietoturva-auditointikokemusta.",
      jobEvidence: "Required: security audit experience",
    },
    // Tuplamerkintä samasta puutteesta tulee edelleen suodattaa pois
    {
      requirement: "CISSP-sertifikaatti (pakollinen)",
      gapDetail: "Toistuva merkintä CISSP-sertifikaatista.",
      jobEvidence: "Mandatory: valid CISSP certification",
    },
  ];
  raw.skillsComparison.learningOpportunities = [
    {
      technologyOrTopic: "CISSP",
      contextInJob: "Mainittu ilmoituksessa.",
      evidence: "Mandatory: valid CISSP certification",
    },
    {
      technologyOrTopic: "Java",
      contextInJob: "Valinnainen taustateknologia.",
      evidence: "Java katsotaan eduksi",
    },
    {
      technologyOrTopic: "IT",
      contextInJob: "Yleinen IT-ympäristö.",
      evidence: "IT-ympäristö",
    },
    {
      technologyOrTopic: "ServiceNow",
      contextInJob: "Mahdollinen alusta.",
      evidence: "mahdollisesti ServiceNow",
    },
  ];

  const normalized = validateAndNormalizeAnalysis(raw, "");
  assert.deepEqual(
    normalized.skillsComparison.significantGaps.map((g) => g.requirement),
    [
      "CISSP-sertifikaatti",
      "JavaScript-kehitys",
      "Security audit experience",
    ]
  );
  // Aito valinnainen teknologia (ServiceNow) ja erillinen Java säilyvät oppimismahdollisuuksissa
  assert.equal(
    normalized.skillsComparison.learningOpportunities?.some(
      (l) => l.technologyOrTopic === "ServiceNow"
    ),
    true
  );
  assert.equal(
    normalized.skillsComparison.learningOpportunities?.some(
      (l) => l.technologyOrTopic === "Java"
    ),
    true
  );
  // Pakollisen kelpoisuuspuutteen kanssa ristiriidassa ollut CISSP ei jää valinnaiseksi oppimismahdollisuudeksi
  assert.equal(
    normalized.skillsComparison.learningOpportunities?.some(
      (l) => l.technologyOrTopic === "CISSP"
    ),
    false
  );
});

test("Tapaus 19: Kuvitteellinen oletusprofiili latautuu vain tyhjästä tallennustilasta ja tallennettu profiili ohittaa oletusprofiilin", () => {
  // Oletusprofiili täyttää CandidateProfile-rakenteen eikä sisällä aiempia henkilötietoja
  const parsedDefault = candidateProfileSchema.parse(DEFAULT_CANDIDATE_PROFILE);
  const serializedDefault = JSON.stringify(parsedDefault);
  assert.doesNotMatch(
    serializedDefault,
    /Laurea|Lohja|197\/210|varaustietojen|logistiikka/i
  );

  // Tyhjä tallennustila -> käyttää oletusprofiilia
  const emptyStorage = {
    getItem: () => null,
  };
  assert.deepEqual(loadCandidateProfile(emptyStorage), DEFAULT_CANDIDATE_PROFILE);

  // Aiemmin tallennettu profiili ja tallennetut työpaikat säilyvät ja ohittavat oletusprofiilin
  const savedCustomProfile = {
    ...DEFAULT_CANDIDATE_PROFILE,
    headline: "Käyttäjän oma tallennettu profiili",
    institutionAndDegree: "Käyttäjän oma korkeakoulu",
    studyProgress: "Käyttäjän oma opintovaihe",
    availabilityAndLocation: "Käyttäjän oma sijainti",
    updatedAt: "2026-11-10T12:00:00.000Z",
  };
  const savedJob = {
    id: "saved-job-preserve-1",
    createdAt: "2026-11-10T12:05:00.000Z",
    updatedAt: "2026-11-10T12:05:00.000Z",
    jobUrl: "https://example.com/role",
    rawJobText: "Tallennettu työpaikkailmoitus säilyy muuttumattomana.",
    status: "Haettu",
    notes: "Tärkeä oma muistiinpano",
    targetDate: "2026-11-10",
    analysis: makeBaseRawAnalysis(),
  };
  const populatedStorage = {
    getItem: (key: string) => {
      if (key === "cia_candidate_profile_v1") {
        return JSON.stringify(savedCustomProfile);
      }
      if (key === "cia_saved_jobs_v1") {
        return JSON.stringify([savedJob]);
      }
      return null;
    },
  };

  const loadedProfile = loadCandidateProfile(populatedStorage);
  assert.equal(loadedProfile.headline, "Käyttäjän oma tallennettu profiili");
  assert.equal(loadedProfile.institutionAndDegree, "Käyttäjän oma korkeakoulu");
  assert.notEqual(loadedProfile.headline, DEFAULT_CANDIDATE_PROFILE.headline);

  const loadedJobs = loadSavedJobs(populatedStorage);
  assert.equal(loadedJobs.length, 1);
  assert.equal(loadedJobs[0].notes, "Tärkeä oma muistiinpano");
});

test("Tapaus 20: SYSTEM_INSTRUCTION ei sisällä alkuperäisen hakijan henkilökohtaisia tietoja ja buildPrompt käyttää annettua profiilia", () => {
  assert.doesNotMatch(
    SYSTEM_INSTRUCTION,
    /laurea|lohja|197\/210|27\.10\.2026|varaustietojen|copilot|toinen harjoittelu|logistiik/i
  );

  // Varmistetaan keskeiset yleiset säännöt
  assert.match(SYSTEM_INSTRUCTION, /<CANDIDATE_PROFILE>/);
  assert.match(SYSTEM_INSTRUCTION, /<UNTRUSTED_JOB_POSTING>/);
  assert.match(SYSTEM_INSTRUCTION, /ei ole voimassa oleva ammattisertifikaatti/i);
  assert.match(SYSTEM_INSTRUCTION, /älä oleta tiettyä oppilaitosta/i);

  const customProfile = {
    ...DEFAULT_CANDIDATE_PROFILE,
    headline: "Kuvitteellinen pilvipalveluharjoittelija",
    institutionAndDegree: "Oulun ammattikorkeakoulu, Tietojenkäsittely",
    studyProgress: "Valmistunut 2025, ei harjoittelutarvetta.",
    availabilityAndLocation: "Oulu ja etätyö",
  };

  const prompt = buildPrompt(
    customProfile,
    "Haemme Junior Cloud Engineer -osaajaa.",
    "https://example.com/cloud"
  );
  assert.match(prompt, /Kuvitteellinen pilvipalveluharjoittelija/);
  assert.match(prompt, /Oulun ammattikorkeakoulu/);
  assert.match(prompt, /Oulu ja etätyö/);
  assert.doesNotMatch(prompt, /Laurea|Lohja|197\/210/);
});








