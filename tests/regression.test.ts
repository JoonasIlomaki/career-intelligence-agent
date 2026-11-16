import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import test from "node:test";
import assert from "node:assert/strict";
import {
  candidateProfileSchema,
  careerBackupSchema,
  fetchJobRequestSchema,
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
import {
  DEADLINE_CONFLICT_WARNING,
  executePinnedHttpsGet,
  extractJobContentFromHtml,
  fetchJobFromUrl,
  isPublicIpAddress,
  JobFetchError,
  validateFetchJobUrl,
} from "../server/fetchJob.ts";

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

test("Tapaus 21: schema.org/JobPosting-poiminta käsittelee suoran olion, taulukon ja @graph-rakenteen ilman HTML-roskaa", () => {
  const graphHtml = `<!doctype html>
  <html lang="fi">
    <head>
      <title>SOC Analyst - Yritys Oy</title>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "WebPage", "name": "Työpaikkailmoitus" },
            {
              "@type": ["JobPosting"],
              "title": "Junior SOC Analyst",
              "hiringOrganization": { "@type": "Organization", "name": "Nordic Cyber Oy" },
              "validThrough": "2026-12-15",
              "jobLocation": {
                "@type": "Place",
                "address": { "@type": "PostalAddress", "addressLocality": "Espoo", "addressCountry": "FI" }
              },
              "description": "<p>Haemme Junior SOC Analystia vakituiseen työsuhteeseen tietoturvakeskukseemme.</p><ul><li>Lokien seuranta ja ensiselvitys</li><li>Tietoturvahavaintojen dokumentointi &amp; raportointi</li></ul><p>Edellytämme soveltuvia IT-opintoja sekä verkkojen perustuntemusta. Hae 15.12.2026 mennessä.</p>"
            }
          ]
        }
      </script>
    </head>
    <body><nav>Etusivu | Kirjaudu</nav><main><h1>Junior SOC Analyst</h1></main></body>
  </html>`;

  const extracted = extractJobContentFromHtml(
    graphHtml,
    "https://duunitori.fi/tyopaikat/tyo/junior-soc-1"
  );
  assert.equal(extracted.fetchMethod, "schema_org_jsonld");
  assert.equal(extracted.coverageStatus, "complete");
  assert.equal(extracted.confidence, "high");
  assert.equal(extracted.warning, null);
  assert.equal(extracted.title, "Junior SOC Analyst");
  assert.equal(extracted.company, "Nordic Cyber Oy");
  assert.equal(extracted.deadline, "2026-12-15");
  assert.match(extracted.extractedText, /Junior SOC Analyst/);
  assert.match(extracted.extractedText, /Nordic Cyber Oy/);
  assert.match(extracted.extractedText, /- Lokien seuranta ja ensiselvitys/);
  assert.match(extracted.extractedText, /dokumentointi & raportointi/);
  assert.doesNotMatch(extracted.extractedText, /<script|<p>|<li>|Etusivu \| Kirjaudu/i);

  // Taulukkomuotoinen JSON-LD (aito tiivis mutta täydellinen ilmoitus)
  const arrayHtml = `<html><head><script type="application/ld+json">[
    {"@type": "BreadcrumbList"},
    {
      "@type": "https://schema.org/JobPosting",
      "title": "IT-harjoittelija",
      "hiringOrganization": { "name": "Valtiokonttori" },
      "description": "<p>Etsimme IT-harjoittelijaa kehitystiimiin (harjoittelu 4 kk, palkka 1800 €/kk). Tehtävässä tuet järjestelmäylläpitoa ja tietoturvadokumentointia. Edellytämme tietojenkäsittelyopintoja ja sujuvaa suomea. Hae sähköpostilla 30.11.2026 mennessä.</p>"
    }
  ]</script></head><body></body></html>`;
  const arrayExtracted = extractJobContentFromHtml(
    arrayHtml,
    "https://www.valtiolle.fi/fi-FI/ilmoitus?id=123"
  );
  assert.equal(arrayExtracted.fetchMethod, "schema_org_jsonld");
  assert.equal(arrayExtracted.coverageStatus, "complete");
  assert.equal(arrayExtracted.company, "Valtiokonttori");
  assert.match(arrayExtracted.extractedText, /IT-harjoittelijaa kehitystiimiin/);
});

test("Tapaus 22: HTML-varamenetelmä poimii varsinaisen sisältöalueen, säilyttää listat ja varoittaa epävarmasta poiminnasta", () => {
  const html = `<!doctype html>
  <html lang="fi">
    <head>
      <title>Junior IAM Specialist - Jobly</title>
      <script>window.__EVIL__ = "alert(1)";</script>
    </head>
    <body>
      <header><nav>Työpaikat | Yritykset | Kirjaudu</nav></header>
      <div id="onetrust-banner-sdk" class="cookie-banner">Hyväksy evästeet ja seuranta</div>
      <main>
        <h1>Junior IAM Specialist</h1>
        <p>Etsimme käyttöoikeushallinnan harjoittelijaa tai junior-osaajaa tiimiimme Helsinkiin.</p>
        <h2>Tehtäväsi</h2>
        <ul>
          <li>Käyttöoikeuksien tarkastus ja roolimallinnus</li>
          <li>Prosessien dokumentointi ja lokiseuranta</li>
        </ul>
      </main>
      <footer>© Jobly.fi - Tietosuojaseloste</footer>
    </body>
  </html>`;

  const extracted = extractJobContentFromHtml(
    html,
    "https://www.jobly.fi/tyopaikka/junior-iam-123"
  );
  assert.equal(extracted.fetchMethod, "html_fallback");
  assert.equal(extracted.confidence, "uncertain");
  assert.ok(extracted.warning && extracted.warning.length > 10);
  assert.match(extracted.extractedText, /Junior IAM Specialist/);
  assert.match(extracted.extractedText, /- Käyttöoikeuksien tarkastus ja roolimallinnus/);
  assert.doesNotMatch(extracted.extractedText, /Hyväksy evästeet|Tietosuojaseloste|window\.__EVIL__/);
});

test("Tapaus 23: Puutteellinen ilmoitus, JS-sovelluskuori ja kirjautumisesto tuottavat rehellisen virheen", () => {
  const jsShell = `<!doctype html><html><head><title>Ladataan</title></head><body><div id="root"></div><noscript>Please enable JavaScript to view this job posting.</noscript></body></html>`;
  assert.throws(
    () =>
      extractJobContentFromHtml(
        jsShell,
        "https://ats.talentadore.com/apply/abc"
      ),
    (err: unknown) => err instanceof JobFetchError && err.statusCode === 422
  );

  const thinHtml = `<html><body><main><p>Lyhyt sivu</p></main></body></html>`;
  assert.throws(
    () => extractJobContentFromHtml(thinHtml, "https://duunitori.fi/tyopaikat/tyo/1"),
    (err: unknown) => err instanceof JobFetchError && err.statusCode === 422
  );
});

test("Tapaus 24: URL-validointi sallii vain listatut HTTPS-työpaikkasivustot ja estää vaaralliset osoitteet", () => {
  assert.equal(
    fetchJobRequestSchema.safeParse({ url: "https://duunitori.fi/tyopaikat/tyo/1" }).success,
    true
  );

  const allowedUrls = [
    "https://valtiolle.fi/fi-FI/ilmoitus?id=1",
    "https://www.valtiolle.fi/fi-FI/ilmoitus?id=1",
    "https://jobly.fi/tyopaikka/123",
    "https://www.jobly.fi/tyopaikka/123",
    "https://duunitori.fi/tyopaikat/tyo/123",
    "https://www.duunitori.fi/tyopaikat/tyo/123",
    "https://ats.talentadore.com/apply/123",
  ];
  for (const okUrl of allowedUrls) {
    assert.equal(validateFetchJobUrl(okUrl).protocol, "https:");
  }

  const blockedUrls = [
    "http://duunitori.fi/tyopaikat/tyo/1",
    "https://user:pass@duunitori.fi/tyopaikat/tyo/1",
    "https://duunitori.fi:8443/tyopaikat/tyo/1",
    "https://127.0.0.1/job",
    "https://169.254.169.254/latest/meta-data/",
    "https://localhost/job",
    "https://[::1]/job",
    "https://evil.example.com/job",
    "https://duunitori.fi.evil.com/job",
    "javascript:alert(1)",
  ];
  for (const badUrl of blockedUrls) {
    assert.throws(
      () => validateFetchJobUrl(badUrl),
      (err: unknown) => err instanceof JobFetchError && err.statusCode === 400
    );
  }
});

test("Tapaus 25: Estää vaaralliset DNS-kohteet, sitoo IP:n rebinding-suojaksi ja torjuu uudelleenohjaukset sekä ylisuuret tai väärän tyyppiset vastaukset", async () => {
  // Aidot julkiset IPv4- ja IPv6-osoitteet sallitaan
  assert.equal(isPublicIpAddress("93.184.216.34"), true);
  assert.equal(isPublicIpAddress("1.1.1.1"), true);
  assert.equal(isPublicIpAddress("2606:2800:220:1:248:1893:25c8:1946"), true);
  assert.equal(isPublicIpAddress("2a00:1450:400f:80d::200e"), true);
  assert.equal(isPublicIpAddress("2001:4860:4860::8888"), true);
  assert.equal(isPublicIpAddress("2001:67c:2e8:22::c100:68b"), true);

  // Yksityiset ja IANA:n erityiskäyttöön varatut IPv4-, IPv6- ja käännösosoitteet estetään
  const blockedIps = [
    "0.0.0.0",
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "172.16.0.1",
    "169.254.169.254",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.10",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "100::1",
    "2001::1",
    "2001:2::1",
    "2001:20::1",
    "2001:db8::1",
    "2002::1",
    "3fff::1",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b:1::1",
    "::ffff:127.0.0.1",
    "::ffff:93.184.216.34",
  ];
  for (const blockedIp of blockedIps) {
    assert.equal(
      isPublicIpAddress(blockedIp),
      false,
      `Osoitteen ${blockedIp} täytyy estyä`
    );
  }

  // Vaarallinen DNS-vastaus -> httpGet ei saa koskaan lähteä
  let httpCalled = false;
  await assert.rejects(
    () =>
      fetchJobFromUrl("https://duunitori.fi/tyopaikat/tyo/123", {
        dnsLookup: async () => [{ address: "169.254.169.254", family: 4 }],
        httpGet: async () => {
          httpCalled = true;
          return {
            statusCode: 200,
            headers: { "content-type": "text/html" },
            body: "<html></html>",
          };
        },
      }),
    (err: unknown) => err instanceof JobFetchError && err.statusCode === 403
  );
  assert.equal(httpCalled, false);

  // Uudelleenohjaus -> hylätään eikä seurata
  await assert.rejects(
    () =>
      fetchJobFromUrl("https://duunitori.fi/tyopaikat/tyo/123", {
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        httpGet: async (opts) => {
          assert.equal(opts.resolvedIp, "93.184.216.34");
          return {
            statusCode: 302,
            headers: { location: "https://internal.local/secret" },
            body: "",
          };
        },
      }),
    (err: unknown) => err instanceof JobFetchError && err.statusCode === 422
  );

  // Väärä Content-Type -> hylätään
  await assert.rejects(
    () =>
      fetchJobFromUrl("https://duunitori.fi/tyopaikat/tyo/123", {
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        httpGet: async () => ({
          statusCode: 200,
          headers: { "content-type": "application/pdf" },
          body: "%PDF-1.7",
        }),
      }),
    (err: unknown) => err instanceof JobFetchError && err.statusCode === 415
  );

  // Liian suuri vastaus -> hylätään
  await assert.rejects(
    () =>
      fetchJobFromUrl("https://duunitori.fi/tyopaikat/tyo/123", {
        maxBytes: 100,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        httpGet: async ({ maxBytes }) => {
          throw new JobFetchError(
            `Sivun koko ylittää sallitun enimmäiskoon (${maxBytes} tavua).`,
            413,
            "PAYLOAD_TOO_LARGE"
          );
        },
      }),
    (err: unknown) => err instanceof JobFetchError && err.statusCode === 413
  );

  // Onnistunut simuloitu nouto käyttää täsmälleen DNS-pinnoitettua julkista IP:tä
  const okResult = await fetchJobFromUrl(
    "https://ats.talentadore.com/apply/soc-trainee",
    {
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      httpGet: async (opts) => {
        assert.equal(opts.resolvedIp, "93.184.216.34");
        assert.equal(opts.resolvedFamily, 4);
        return {
          statusCode: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
          body: `<html><head><script type="application/ld+json">${JSON.stringify({
            "@type": "JobPosting",
            title: "SOC Trainee",
            hiringOrganization: { name: "CyberTest Oy" },
            description:
              "<p>Haemme SOC-harjoittelijaa 6 kk määräaikaiseen harjoitteluun valvontakeskukseemme. Tehtäviin kuuluu lokianalyysi ja hälytysten ensiselvitys. Edellytämme alan korkeakouluopintoja. Palkka 2000 €/kk, lähetä hakemus 10.12.2026 mennessä.</p>",
          })}</script></head><body></body></html>`,
        };
      },
    }
  );
  assert.equal(okResult.sourceUrl, "https://ats.talentadore.com/apply/soc-trainee");
  assert.equal(okResult.title, "SOC Trainee");
  assert.equal(okResult.company, "CyberTest Oy");
  assert.equal(okResult.fetchMethod, "schema_org_jsonld");
  assert.equal(okResult.networkStatus, "ok");
  assert.equal(okResult.coverageStatus, "complete");
  assert.ok(okResult.fetchedAt);
});

test("Tapaus 26: Lyhyt JobPosting-tiivistelmä ei ohita kattavaa HTML-ilmoitusta vaan yhdistää perustiedot ja täydellisen sisällön", () => {
  const valtiolleLikeHtml = `<!doctype html>
  <html lang="fi">
    <head>
      <title>Korkeakouluharjoittelija, Kyberrikoskeskus, ilmiöanalyysi | Valtiolle.fi</title>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Korkeakouluharjoittelija, Kyberrikoskeskus, ilmiöanalyysi",
        hiringOrganization: "Keskusrikospoliisi",
        jobLocation: {
          "@type": "Place",
          address: {
            "@type": "PostalAddress",
            addressRegion: "Uusimaa",
            addressLocality: "Vantaa",
          },
        },
        baseSalary: {
          "@type": "MonetaryAmount",
          currency: "EUR",
          value: "1531,50 €/kk - 2042 €/kk",
        },
        employmentType: "Korkeakouluharjoittelu, Määräaikainen, Virkasuhde",
        validThrough: "2026-11-23T16:15:00+02:00",
        description:
          "Keskusrikospoliisin korkeakouluharjoittelijana pääset tekemään yhteiskunnallisesti merkityksellistä työtä suomalaisten turvallisuuden hyväksi. Korkeakouluharjoittelija työskentelee kyberrikoskeskuksessa. Tehtävä sisältää kyberrikollisuuden ilmiöanalyysitehtäviä. Edellyttää nopeaa tietojärjestelmien käytännön omaksumista.",
      })}</script>
    </head>
    <body>
      <header><nav>Etusivu | Avoimet työpaikat | Kirjaudu</nav></header>
      <div class="cookie-consent-banner">Hyväksy kaikki evästeet tai hallitse asetuksia</div>
      <main>
        <article>
          <h1>Korkeakouluharjoittelija, Kyberrikoskeskus, ilmiöanalyysi</h1>
          <a href="#apply">Hae työpaikkaa</a>
          <button type="button">Lisää suosikiksi</button>
          <p>Keskusrikospoliisin korkeakouluharjoittelijana pääset tekemään yhteiskunnallisesti merkityksellistä työtä suomalaisten turvallisuuden hyväksi. Korkeakouluharjoittelija työskentelee kyberrikoskeskuksessa. Tehtävä sisältää kyberrikollisuuden ilmiöanalyysitehtäviä. Edellyttää nopeaa tietojärjestelmien käytännön omaksumista.</p>
          <p>Harjoittelijan tulee olla kirjoilla korkeakoulussa tai yliopistossa, eikä olla vielä suorittanut tutkintoa. Tehtävän menestyksellisen hoitaminen edellyttää toimenkuvaan sopivia korkeakouluopintoja esimerkiksi yhteiskuntatieteiden, valtiotieteiden, kriminologian ja hallintotieteiden aloilta.</p>
          <p>Henkilökohtaisina ominaisuuksina arvostamme aitoa kiinnostusta teemaa kohtaan, kykyä omaksua uusia järjestelmiä, analyysiosaamista sekä hyviä yhteistyö- ja vuorovaikutustaitoja.</p>
          <p>Harjoittelun kesto on enintään 3 kk (1.3.2027 - 31.5.2027). Etätyö on työn luonteen takia rajoitetusti mahdollista eikä kokoaikainen etätyö ole mahdollista.</p>
          <p>Virkaan valittavasta henkilöstä voidaan tehdä hakijan suostumuksella perusmuotoinen henkilöturvallisuusselvitys (turvallisuusselvityslaki 726/2014).</p>
          <p>Palkkatiedot: Yliopisto-opiskelijoilla palkkaus on 1531,50 € - 2042 €/kk opintopisteiden mukaan. Ammattikorkeakouluopiskelijoiden palkka on 1531 €/kk.</p>
          <p>Lähetä hakemus Valtiolle.fi-palvelun kautta viimeistään 23.11.2026 klo 16:15.</p>
        </article>
      </main>
      <footer>© Valtiolle.fi - Tietosuojaseloste</footer>
    </body>
  </html>`;

  const result = extractJobContentFromHtml(
    valtiolleLikeHtml,
    "https://valtiolle.fi/fi/tyopaikat/korkeakouluharjoittelija-kyberrikoskeskus-ilmioanalyysi-25695/"
  );

  assert.equal(result.networkStatus, "ok");
  assert.equal(result.fetchMethod, "jsonld_and_html");
  assert.equal(result.coverageStatus, "complete");
  assert.equal(result.confidence, "high");
  assert.equal(result.warning, null);
  assert.equal(result.company, "Keskusrikospoliisi");
  assert.equal(result.deadline, "2026-11-23T16:15:00+02:00");

  // Mukana ovat sekä perustiedot että kaikki varsinaisen ilmoituksen keskeiset ehdot
  assert.match(result.extractedText, /Sijainti: Vantaa, Uusimaa/);
  assert.match(result.extractedText, /Palkkaus: 1531,50 €\/kk - 2042 €\/kk/);
  assert.match(result.extractedText, /kirjoilla korkeakoulussa tai yliopistossa/);
  assert.match(result.extractedText, /kriminologian ja hallintotieteiden/);
  assert.match(result.extractedText, /analyysiosaamista/);
  assert.match(result.extractedText, /enintään 3 kk/);
  assert.match(result.extractedText, /kokoaikainen etätyö ole mahdollista/);
  assert.match(result.extractedText, /henkilöturvallisuusselvitys/);
  assert.match(result.extractedText, /1531 €\/kk/);

  // Navigaatio, evästebannerit ja painiketekstit eivät vuoda ilmoitukseen
  assert.doesNotMatch(
    result.extractedText,
    /Avoimet työpaikat \| Kirjaudu|Hyväksy kaikki evästeet|Tietosuojaseloste|Lisää suosikiksi|Hae työpaikkaa/
  );
});

test("Tapaus 27: Suppea JobPosting-tiivistelmä ilman HTML-lisätietoja palauttaa partial-tilan ja selkeän varoituksen", () => {
  const partialSpaHtml = `<!doctype html>
  <html lang="fi">
    <head>
      <title>Kyberharjoittelija</title>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Korkeakouluharjoittelija, Kyberrikoskeskus",
        hiringOrganization: { "@type": "Organization", name: "Keskusrikospoliisi" },
        validThrough: "2026-11-23",
        description:
          "Keskusrikospoliisin korkeakouluharjoittelijana pääset tekemään yhteiskunnallisesti merkityksellistä työtä kyberrikoskeskuksessa. Tehtävä sisältää ilmiöanalyysitehtäviä.",
      })}</script>
    </head>
    <body>
      <div id="root"></div>
      <noscript>Please enable JavaScript to view the full job details.</noscript>
    </body>
  </html>`;

  const result = extractJobContentFromHtml(
    partialSpaHtml,
    "https://ats.talentadore.com/apply/krp-25695"
  );

  assert.equal(result.networkStatus, "ok");
  assert.equal(result.coverageStatus, "partial");
  assert.equal(result.confidence, "partial");
  assert.equal(
    result.warning,
    "Ilmoituksesta saatiin vain osa tiedoista. Tarkista alkuperäinen ilmoitus ja täydennä teksti ennen analysointia."
  );

  // Myös pelkkä ohut HTML ilman JS-shelliä mutta suppealla JobPostingilla merkitään partial-tilaan
  const emptyBodyPartialHtml = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "Kyberanalyytikko",
    description:
      "Tehtävässä pääset työskentelemään tietoturvakeskuksessa mielenkiintoisten analyysitehtävien parissa...",
  })}</script></head><body><main><h1>Kyberanalyytikko</h1></main></body></html>`;

  const emptyResult = extractJobContentFromHtml(
    emptyBodyPartialHtml,
    "https://valtiolle.fi/fi/tyopaikat/123"
  );
  assert.equal(emptyResult.coverageStatus, "partial");
  assert.equal(emptyResult.confidence, "partial");
  assert.equal(
    emptyResult.warning,
    "Ilmoituksesta saatiin vain osa tiedoista. Tarkista alkuperäinen ilmoitus ja täydennä teksti ennen analysointia."
  );
});

test("Tapaus 28: Oikeasti lyhyt mutta täydellinen ilmoitus ei hylkäänny eikä leimaudu osittaiseksi", () => {
  const shortCompleteJsonLdHtml = `<!doctype html>
  <html lang="fi">
    <head>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Junior IT-tukihenkilö",
        hiringOrganization: { name: "KuntaIT Oy" },
        validThrough: "2026-12-01",
        description:
          "<p>Haemme osa-aikaista IT-tukihenkilöä (20 h/vko, hybridi). Tehtäviin kuuluu käyttäjätuki ja työasemien asennus. Edellytämme tietotekniikan opintoja sekä sujuvaa suomea. Palkka 15 €/h. Lähetä hakemus 1.12.2026 mennessä osoitteeseen rekry@kuntait.fi.</p>",
      })}</script>
    </head>
    <body></body>
  </html>`;

  const jsonResult = extractJobContentFromHtml(
    shortCompleteJsonLdHtml,
    "https://duunitori.fi/tyopaikat/tyo/lyhyt-tuki"
  );
  assert.equal(jsonResult.coverageStatus, "complete");
  assert.equal(jsonResult.confidence, "high");
  assert.equal(jsonResult.warning, null);
  assert.match(jsonResult.extractedText, /Palkka 15 €\/h/);

  // Myös HTML-muotoinen lyhyt mutta täydellinen ilmoitus hyväksytään
  const shortCompleteHtmlOnly = `<!doctype html>
  <html lang="fi">
    <body>
      <main>
        <h1>Junior IT-tukihenkilö</h1>
        <p>Haemme määräaikaista IT-tukihenkilöä (20 h/vko, hybridi). Tehtäviin kuuluu käyttäjätuki ja työasemien asennus. Edellytämme tietotekniikan opintoja sekä sujuvaa suomea. Palkka 15 €/h. Lähetä hakemus 1.12.2026 mennessä osoitteeseen rekry@kuntait.fi.</p>
      </main>
    </body>
  </html>`;

  const htmlResult = extractJobContentFromHtml(
    shortCompleteHtmlOnly,
    "https://www.jobly.fi/tyopaikka/lyhyt-tuki"
  );
  assert.equal(htmlResult.fetchMethod, "html_fallback");
  assert.notEqual(htmlResult.coverageStatus, "partial");
  assert.match(htmlResult.extractedText, /käyttäjätuki ja työasemien asennus/);
});

test("Tapaus 29: Yhdistäminen ei toista samoja kappaleita tai otsikkoa eikä vuoda navigaatiota tai evästeitä", () => {
  const repeatedSnippet =
    "Haemme tietoturvaharjoittelijaa kybervalvontatiimiin tekemään lokianalyysiä ja hälytysten ensiselvitystä.";
  const htmlWithOverlap = `<!doctype html>
  <html lang="fi">
    <head>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Tietoturvaharjoittelija",
        hiringOrganization: { name: "Turva Oy" },
        description: `${repeatedSnippet}\n\nLisätietoa tehtävän projektikierrosta annetaan haastattelussa.`,
      })}</script>
    </head>
    <body>
      <nav>Etusivu | Työpaikat | Kirjaudu sisään</nav>
      <div id="cookiebot-banner" class="gdpr-consent">Käytämme evästeitä käyttökokemuksen parantamiseksi</div>
      <main>
        <h1>Tietoturvaharjoittelija</h1>
        <p>${repeatedSnippet}</p>
        <p>Kelpoisuusvaatimuksena on käynnissä olevat korkeakouluopinnot tietoturvan tai tietojenkäsittelyn alalta.</p>
        <p>Harjoittelun kesto on 5 kuukautta ja palkka on 2100 €/kk. Lähetä hakemus 20.12.2026 mennessä.</p>
      </main>
      <footer>© Turva Oy - Tietosuoja</footer>
    </body>
  </html>`;

  const extracted = extractJobContentFromHtml(
    htmlWithOverlap,
    "https://duunitori.fi/tyopaikat/tyo/turva-1"
  );
  assert.equal(extracted.fetchMethod, "jsonld_and_html");
  assert.equal(extracted.coverageStatus, "complete");

  const snippetOccurrences = extracted.extractedText.split(repeatedSnippet).length - 1;
  assert.equal(snippetOccurrences, 1);

  const titleLineOccurrences =
    extracted.extractedText
      .split("\n")
      .filter((line) => line.trim() === "Tietoturvaharjoittelija").length;
  assert.equal(titleLineOccurrences, 0);

  assert.match(extracted.extractedText, /Lisätietoa tehtävän projektikierrosta/);
  assert.doesNotMatch(
    extracted.extractedText,
    /Kirjaudu sisään|Käytämme evästeitä|Tietosuoja/
  );
});

test("Tapaus 30: Valtiolle.fi-rakenne muotoilee hakuajan aikavyöhykkeellä, poistaa toistuvan hakuaikalohkon ja säilyttää ehdot", () => {
  const valtiolleFixture = `<!doctype html>
  <html lang="fi">
    <head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Korkeakouluharjoittelija, Kyberrikoskeskus, ilmiöanalyysi",
        hiringOrganization: "Keskusrikospoliisi",
        jobLocation: {
          "@type": "Place",
          address: { "@type": "PostalAddress", addressLocality: "Vantaa", addressRegion: "Uusimaa" },
        },
        baseSalary: { "@type": "MonetaryAmount", currency: "EUR", value: "1531,50 €/kk - 2042 €/kk" },
        employmentType: "Korkeakouluharjoittelu, Määräaikainen, Kaikki työpaikat, Virkasuhde",
        validThrough: "2026-11-23T16:15:00+02:00",
        description:
          "Keskusrikospoliisin korkeakouluharjoittelija työskentelee kyberrikoskeskuksessa. Tehtävä sisältää kyberrikollisuuden ilmiöanalyysitehtäviä.",
      })}</script>
    </head>
    <body>
      <main>
        <article>
          <h1>Korkeakouluharjoittelija, Kyberrikoskeskus, ilmiöanalyysi</h1>
          <div>Hakuaika päättyy 23.11.2026 klo 16:15</div>
          <a href="#apply">Hae työpaikkaa</a>
          <p>Harjoittelijan tulee olla kirjoilla korkeakoulussa tai yliopistossa. Edellytämme soveltuvia korkeakouluopintoja ja analyysiosaamista.</p>
          <p>Harjoittelun kesto on enintään 3 kk. Kokoaikainen etätyö ei ole mahdollista. Valittavasta henkilöstä voidaan tehdä henkilöturvallisuusselvitys.</p>
          <p>Lähetä hakemus sähköisesti Valtiolle.fi-palvelun kautta.</p>
        </article>
      </main>
    </body>
  </html>`;

  const result = extractJobContentFromHtml(
    valtiolleFixture,
    "https://valtiolle.fi/fi/tyopaikat/korkeakouluharjoittelija-kyberrikoskeskus-ilmioanalyysi-25695/"
  );
  assert.equal(result.fetchMethod, "jsonld_and_html");
  assert.equal(result.coverageStatus, "complete");
  assert.match(result.extractedText, /Hakuaika päättyy: 23\.11\.2026 klo 16:15 \(UTC\+2\)/);
  assert.doesNotMatch(result.extractedText, /Kaikki työpaikat/);
  const deadlineMatches =
    result.extractedText.match(/23\.11\.2026 klo 16:15/g) ?? [];
  assert.equal(deadlineMatches.length, 1);
  assert.match(result.extractedText, /henkilöturvallisuusselvitys/);
});

test("Tapaus 31: Jobly.fi-rakenne poistaa tyhjän palkkarivin, normalisoi työsuhdetyypit ja torjuu käyttöliittymä- sekä samankaltaiset työpaikat -roskan", () => {
  const joblyFixture = `<!doctype html>
  <html lang="fi">
    <head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Data Analyst Trainee, Digimyynti",
        hiringOrganization: { "@type": "Organization", name: "Terveystalo" },
        employmentType: ["INTERN", "FULL_TIME", "FULL_TIME", "TEMPORARY"],
        baseSalary: {
          "@type": "MonetaryAmount",
          currency: "EUR",
          value: { "@type": "QuantitativeValue", minValue: "", maxValue: "", unitText: "" },
        },
        validThrough: "2027-01-12",
        description:
          "<p><span>E</span>tsimme osaavaan joukkoomme Data Analyst Traineeta määräaikaiseen harjoitteluun Helsinkiin. Tehtävässä tuet digimyynnin analytiikkaa.</p><p>Odotamme soveltuvia korkeakouluopintoja sekä kiinnostusta dataan ja SQL-osaamiseen. Hae hakulomakkeen kautta viimeistään 12.1.2027.</p>",
      })}</script>
    </head>
    <body>
      <div class="skip-link"><a href="#main">Skip to main content</a></div>
      <div class="l-main-content">
        <div class="pane-node-links"><ul><li>Hae paikkaa</li><li>Tallenna työpaikka</li></ul></div>
        <div class="field field--name-body">
          <p><span>E</span>tsimme osaavaan joukkoomme Data Analyst Traineeta määräaikaiseen harjoitteluun Helsinkiin. Tehtävässä tuet digimyynnin analytiikkaa.</p>
          <p>Odotamme soveltuvia korkeakouluopintoja sekä kiinnostusta dataan ja SQL-osaamiseen. Hae hakulomakkeen kautta viimeistään 12.1.2027.</p>
        </div>
        <div class="similar-jobs"><h2>Samankaltaisia työpaikkoja</h2><p>Nokia Espoo Trainee</p></div>
      </div>
    </body>
  </html>`;

  const result = extractJobContentFromHtml(
    joblyFixture,
    "https://www.jobly.fi/tyopaikka/data-analyst-trainee-digimyynti-2799261"
  );
  assert.equal(result.coverageStatus, "complete");
  assert.equal(result.title, "Data Analyst Trainee, Digimyynti");
  assert.match(result.extractedText, /Työsuhteen tyyppi: Harjoittelu, Kokoaikainen, Määräaikainen/);
  assert.match(result.extractedText, /Hakuaika päättyy: 12\.1\.2027/);
  assert.match(result.extractedText, /Etsimme osaavaan joukkoomme/);
  assert.match(result.extractedText, /SQL-osaamiseen/);
  assert.doesNotMatch(result.extractedText, /Palkkaus:|-\s*EUR|\bINTERN\b|\bFULL_TIME\b/i);
  assert.doesNotMatch(
    result.extractedText,
    /Skip to main content|Hae paikkaa|Tallenna työpaikka|Samankaltaisia työpaikkoja|Nokia Espoo Trainee/
  );
});

test("Tapaus 32: Duunitori.fi-rakenne valitsee tarkan H1-tehtävänimikkeen, muotoilee hakuajan ja suodattaa navigointi- sekä kirjautumisroskat", () => {
  const duunitoriFixture = `<!doctype html>
  <html lang="fi">
    <head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "harjoittelija",
        hiringOrganization: { "@type": "Organization", name: "laurea-ammattikorkeakoulu" },
        employmentType: "INTERN",
        validThrough: "2026-11-22T21:59:59+00:00",
        description:
          "<p>Etsimme markkinointi- ja viestintätiimiin korkeakouluopiskelijaa verkkopalvelujen kehitys- ja ylläpitotehtäviin.</p><p>Edellytämme soveltuvia opintoja, WordPress- ja SharePoint-kiinnostusta sekä sujuvaa suomea ja englantia. Harjoittelu on määräaikainen. Lähetä hakemus 22.11.2026 mennessä.</p>",
      })}</script>
    </head>
    <body>
      <main role="main" class="grid">
        <div class="skip-to-content">Siirry suoraan pääsisältöön</div>
        <div class="skip-to-content">Siirry suoraan työpaikkahakuun</div>
        <div class="previous-searches">Viimeisimmät haut</div>
        <a href="/tyopaikat">Takaisin hakuun</a>
        <h1>Verkkopalvelujen korkeakouluharjoittelija</h1>
        <div class="gtm-apply-clicks description description--jobentry">
          <p>Etsimme markkinointi- ja viestintätiimiin korkeakouluopiskelijaa verkkopalvelujen kehitys- ja ylläpitotehtäviin.</p>
          <p>Edellytämme soveltuvia opintoja, WordPress- ja SharePoint-kiinnostusta sekä sujuvaa suomea ja englantia. Harjoittelu on määräaikainen. Lähetä hakemus 22.11.2026 mennessä.</p>
        </div>
        <div class="job-box"><h3>Vastaava työpaikka</h3><p>Muuta sisältöä</p></div>
        <div class="login-prompt"><p>Kirjaudu sisään tai luo tili, jotta voit tallentaa työpaikkailmoituksia suosikkeihisi.</p></div>
      </main>
    </body>
  </html>`;

  const result = extractJobContentFromHtml(
    duunitoriFixture,
    "https://duunitori.fi/tyopaikat/tyo/verkkopalvelujen-korkeakouluharjoittelija-slsau-20730547"
  );
  assert.equal(result.title, "Verkkopalvelujen korkeakouluharjoittelija");
  assert.equal(result.coverageStatus, "complete");
  assert.match(result.extractedText, /Tehtävä: Verkkopalvelujen korkeakouluharjoittelija/);
  assert.match(result.extractedText, /Työsuhteen tyyppi: Harjoittelu/);
  assert.match(result.extractedText, /Hakuaika päättyy: 22\.11\.2026 klo 21:59 \(UTC\)/);
  assert.match(result.extractedText, /WordPress- ja SharePoint-kiinnostusta/);
  assert.doesNotMatch(
    result.extractedText,
    /Siirry suoraan pääsisältöön|Siirry suoraan työpaikkahakuun|Viimeisimmät haut|Takaisin hakuun|Kirjaudu sisään|Vastaava työpaikka/
  );
});

test("Tapaus 33: Navigointi- ja hakutunnisteiden esiintyminen ilman varsinaista rekrytointikuvausta ei tuota complete-tilaa", () => {
  const navHeavyHtml = `<!doctype html>
  <html lang="fi">
    <head>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Harjoittelija",
        description:
          "Haemme harjoittelijaa avustamaan tiimiämme päivittäisissä tehtävissä ja osallistumaan kehitystyöhön mielenkiintoisessa toimintaympäristössä.",
      })}</script>
    </head>
    <body>
      <div class="breadcrumb">Etusivu / Työpaikat</div>
      <div>
        <a href="/1">Harjoittelupaikat</a>
        <a href="/2">Määräaikainen</a>
        <a href="/3">Korkeakouluopiskelijat</a>
        <a href="/4">Osaaminen</a>
        <a href="/5">Palkka ja edut</a>
        <a href="/6">Hakuaika</a>
        <a href="/7">Kirjaudu sisään</a>
      </div>
    </body>
  </html>`;

  const jsonPartialResult = extractJobContentFromHtml(
    navHeavyHtml,
    "https://duunitori.fi/tyopaikat/tyo/nav-only-1"
  );
  assert.notEqual(jsonPartialResult.coverageStatus, "complete");
  assert.notEqual(jsonPartialResult.confidence, "high");

  // Myös pelkät lyhyet navigointi-, kategoria- ja suodatintunnisteet HTML:ssä (> 220 merkkiä)
  // eivät saa tuottaa complete-tilaa ilman varsinaisia lauseita tai vaatimuslistoja
  const htmlTagCloudOnly = `<!doctype html>
  <html lang="fi">
    <body>
      <main>
        <div>Harjoittelupaikat Helsinki ja Espoo</div>
        <div>Korkeakouluopiskelijoille</div>
        <div>Määräaikainen työsuhde</div>
        <div>Palkkaus ja työsuhde-edut</div>
        <div>Hakuaika päättyy pian</div>
        <div>Osaamisalueet: IT, data ja analyysi</div>
        <div>Avainsanat: ohjelmointi, pilvipalvelut</div>
        <div>Toimiala: julkishallinto ja teknologia</div>
      </main>
    </body>
  </html>`;

  const htmlResult = extractJobContentFromHtml(
    htmlTagCloudOnly,
    "https://www.jobly.fi/tyopaikka/tags-only"
  );
  assert.notEqual(htmlResult.coverageStatus, "complete");
  assert.notEqual(htmlResult.confidence, "high");
  assert.ok(
    htmlResult.coverageStatus === "partial" ||
      htmlResult.coverageStatus === "uncertain"
  );

  // Pelkkä hyvin lyhyt navigointi ilman sisältöä hylätään rehellisesti
  assert.throws(
    () =>
      extractJobContentFromHtml(
        "<!doctype html><html><body><nav><a href='/1'>Avoimet työpaikat</a><a href='/2'>Kirjaudu sisään</a></nav></body></html>",
        "https://www.jobly.fi/tyopaikka/empty-nav"
      ),
    /riittävästi varsinaista työpaikkailmoituksen tekstiä/i
  );
});

test("Tapaus 34: Ristiriitaiset hakuajat (Jobly validThrough 2027-01-12 vs. ilmoitusteksti 22.11.2026) tuottavat ristiriitavaroituksen eivätkä vahvista kumpaakaan", () => {
  const conflictHtml = `<!doctype html>
  <html lang="fi">
    <head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Data Analyst Trainee, Digimyynti",
        datePosted: "2026-11-13",
        validThrough: "2027-01-12",
        hiringOrganization: { "@type": "Organization", name: "Terveystalo" },
        employmentType: ["INTERN", "FULL_TIME", "TEMPORARY"],
        description:
          "<p>Etsimme Data Analyst Traineeta määräaikaiseen harjoitteluun Helsinkiin. Tehtävässä tuet digimyynnin analytiikkaa ja raportointia.</p><p>Odotamme soveltuvia korkeakouluopintoja ja SQL-osaamista.</p><p>Jätä yhteystietosi hakulomakkeen kautta viimeistään 22.11.2026.</p><p>Mahdollisiin kysymyksiin vastaa yhteyshenkilö maanantaina 16.11. kello 13.00-14.00.</p>",
      })}</script>
    </head>
    <body>
      <main>
        <div class="field field--name-body">
          <p>Etsimme Data Analyst Traineeta määräaikaiseen harjoitteluun Helsinkiin. Tehtävässä tuet digimyynnin analytiikkaa ja raportointia.</p>
          <p>Odotamme soveltuvia korkeakouluopintoja ja SQL-osaamista.</p>
          <p>Jätä yhteystietosi hakulomakkeen kautta viimeistään 22.11.2026.</p>
        </div>
      </main>
    </body>
  </html>`;

  const result = extractJobContentFromHtml(
    conflictHtml,
    "https://www.jobly.fi/tyopaikka/data-analyst-trainee-digimyynti-2799261"
  );

  // Ristiriitatilanteessa ei valita myöhempää eikä kumpaakaan päivämäärää vahvistetuksi
  assert.equal(result.deadline, null);
  assert.equal(result.deadlineInfo.status, "conflict");
  assert.equal(result.deadlineInfo.hasConflict, true);
  assert.equal(result.deadlineInfo.isConfirmed, false);
  assert.equal(result.deadlineInfo.structuredDeadline?.value, "12.1.2027");
  assert.equal(result.deadlineInfo.structuredDeadline?.rawValue, "2027-01-12");
  assert.match(
    result.deadlineInfo.structuredDeadline?.sourceLabel ?? "",
    /validThrough/
  );
  assert.equal(result.deadlineInfo.bodyDeadline?.value, "22.11.2026");
  assert.equal(result.deadlineInfo.bodyDeadline?.isoDate, "2026-11-22");
  assert.match(
    result.deadlineInfo.bodyDeadline?.excerpt ?? "",
    /viimeistään 22\.11\.2026/
  );
  assert.equal(result.deadlineInfo.conflictWarning, DEADLINE_CONFLICT_WARNING);
  assert.ok(result.warning?.includes("Hakuaika on ristiriitainen"));
  assert.doesNotMatch(result.extractedText, /^Hakuaika päättyy:\s*12\.1\.2027/m);
  assert.match(
    result.extractedText,
    /Hakuaika \(RISTIRIITAINEN, tarkistettava\):.*12\.1\.2027.*22\.11\.2026/
  );
  assert.match(result.extractedText, /viimeistään 22\.11\.2026/);

  // Gemini-validointi ei salli yksittäisen ristiriitaisen päivän päätymistä vahvistetuksi deadlineksi
  const modelTriedSingleDate = makeBaseRawAnalysis();
  modelTriedSingleDate.extracted.deadline = "12.1.2027";
  const validated = validateAndNormalizeAnalysis(
    modelTriedSingleDate,
    result.sourceUrl,
    result.extractedText
  );
  assert.match(validated.extracted.deadline, /^Ristiriitainen \(tarkistettava\):/);
  assert.match(validated.extracted.deadline, /12\.1\.2027/);
  assert.match(validated.extracted.deadline, /22\.11\.2026/);
  assert.match(SYSTEM_INSTRUCTION, /RISTIRIITAINEN HAKUAIKA/);
});

test("Tapaus 35: Yhtenevät hakuajat tunnistetaan ristiriidattomiksi ja vuodeton lyhyt merkintä tarkistetaan oikein", () => {
  const consistentHtml = `<!doctype html>
  <html lang="fi">
    <head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Tietoturvaharjoittelija",
        validThrough: "2026-11-22",
        description:
          "Haemme tietoturvaharjoittelijaa kehitys- ja valvontatehtäviin. Edellytämme soveltuvia korkeakouluopintoja sekä verkkojen ja lokianalyysin tuntemusta. Työsuhde on määräaikainen 6 kk. Lähetä hakemus viimeistään 22.11.2026.",
      })}</script>
    </head>
    <body><main><article><p>Lähetä hakemus viimeistään 22.11.2026.</p></article></main></body>
  </html>`;

  const consistentResult = extractJobContentFromHtml(
    consistentHtml,
    "https://duunitori.fi/tyopaikat/tyo/consistent-deadline-test"
  );
  assert.equal(consistentResult.deadline, "2026-11-22");
  assert.equal(consistentResult.deadlineInfo.status, "consistent");
  assert.equal(consistentResult.deadlineInfo.hasConflict, false);
  assert.equal(consistentResult.deadlineInfo.isConfirmed, false);
  assert.equal(consistentResult.deadlineInfo.conflictWarning, null);
  assert.equal(consistentResult.warning, null);
  assert.match(consistentResult.extractedText, /Hakuaika päättyy: 22\.11\.2026/);

  // Vuodeton "(Päättyy 22.11.)" 2027-01-12 rinnalla tunnistetaan ristiriidaksi
  const yearlessMismatchHtml = `<!doctype html>
  <html lang="fi">
    <head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Harjoittelija",
        validThrough: "2027-01-12",
        description:
          "Haemme harjoittelijaa IT-tehtäviin. Edellytämme korkeakouluopintoja ja kiinnostusta pilvipalveluihin. Harjoittelu on määräaikainen 4 kk. Julkaistu 13.11. (Päättyy 22.11.)",
      })}</script>
    </head>
    <body></body>
  </html>`;
  const mismatchResult = extractJobContentFromHtml(
    yearlessMismatchHtml,
    "https://duunitori.fi/tyopaikat/tyo/yearless-mismatch"
  );
  assert.equal(mismatchResult.deadlineInfo.hasConflict, true);
  assert.equal(mismatchResult.deadline, null);
  assert.equal(mismatchResult.deadlineInfo.bodyDeadline?.value, "22.11.");
});

test("Tapaus 36: Puuttuva hakuaika ei aiheuta väärää ristiriitaa eikä puhelinajat tai aloitusajat tulkitseudu hakuajaksi", () => {
  const noDeadlineHtml = `<!doctype html>
  <html lang="fi">
    <head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Junior SOC Analyst",
        description:
          "Haemme Junior SOC Analystia vakituiseen tehtävään Espooseen. Tehtävä sisältää lokien seurantaa ja tietoturvapoikkeamien analysointia. Edellytämme tietoturvaopintoja sekä sujuvaa suomea ja englantia. Aloitus 1.1.2027 tai sopimuksen mukaan. Lisätietoja antaa yhteyshenkilö maanantaina 16.11. kello 13.00-14.00. Palkka sopimuksen mukaan.",
      })}</script>
    </head>
    <body></body>
  </html>`;

  const result = extractJobContentFromHtml(
    noDeadlineHtml,
    "https://www.jobly.fi/tyopaikka/no-deadline-1"
  );
  assert.equal(result.deadline, null);
  assert.equal(result.deadlineInfo.status, "missing");
  assert.equal(result.deadlineInfo.hasConflict, false);
  assert.equal(result.deadlineInfo.structuredDeadline, null);
  assert.equal(result.deadlineInfo.bodyDeadline, null);
  assert.equal(result.deadlineInfo.conflictWarning, null);
  assert.equal(result.warning, null);
});

test("Tapaus 37: Aikavyöhykkeiden tulkinta erottaa aidon muunnoksen ja todellisen päivämääräristiriidan", () => {
  // 1) +02:00 keskiyön jälkeen ei saa siirtyä edelliseen päivään (esim. America/Los_Angeles -palvelimella)
  const plusTwoMidnightHtml = `<!doctype html>
  <html lang="fi">
    <head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Harjoittelija",
        validThrough: "2026-11-23T00:15:00+02:00",
        description:
          "Tehtävään haetaan korkeakouluopiskelijaa lokianalyysiin. Edellytämme soveltuvia opintoja. Kesto 6 kk. Hakuaika päättyy 23.11.2026.",
      })}</script>
    </head>
    <body></body>
  </html>`;
  const plusTwoResult = extractJobContentFromHtml(
    plusTwoMidnightHtml,
    "https://valtiolle.fi/fi/tyopaikat/tz-midnight-test"
  );
  assert.equal(plusTwoResult.deadlineInfo.hasConflict, false);
  assert.equal(plusTwoResult.deadlineInfo.status, "consistent");
  assert.equal(
    plusTwoResult.deadlineInfo.structuredDeadline?.value,
    "23.11.2026 klo 00:15 (UTC+2)"
  );

  // 2) Talviajan UTC-aika 14:15:00Z == 16:15 Europe/Helsinki (UTC+2) -> yhtenevä
  const utcWinterMatchHtml = `<!doctype html>
  <html lang="fi">
    <head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Kyberharjoittelija",
        validThrough: "2026-11-23T14:15:00Z",
        description:
          "Tehtävä sisältää tietoturvapoikkeamien selvitystä. Edellytämme soveltuvia korkeakouluopintoja. Harjoittelu on määräaikainen. Hakuaika päättyy 23.11.2026 klo 16:15.",
      })}</script>
    </head>
    <body></body>
  </html>`;
  const utcWinterResult = extractJobContentFromHtml(
    utcWinterMatchHtml,
    "https://valtiolle.fi/fi/tyopaikat/tz-winter-match"
  );
  assert.equal(utcWinterResult.deadlineInfo.hasConflict, false);
  assert.equal(utcWinterResult.deadlineInfo.status, "consistent");

  // 3) Kesäajan UTC-aika 12:00:00Z == 15:00 Europe/Helsinki (UTC+3 EEST) -> yhtenevä
  const utcSummerMatchHtml = `<!doctype html>
  <html lang="fi">
    <head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Kesäharjoittelija",
        validThrough: "2026-07-15T12:00:00Z",
        description:
          "Kesäharjoittelu IT-tiimissä. Edellytämme korkeakouluopintoja. Määräaikainen työsuhde 3 kk. Hakuaika päättyy 15.7.2026 klo 15:00.",
      })}</script>
    </head>
    <body></body>
  </html>`;
  const utcSummerResult = extractJobContentFromHtml(
    utcSummerMatchHtml,
    "https://valtiolle.fi/fi/tyopaikat/tz-summer-match"
  );
  assert.equal(utcSummerResult.deadlineInfo.hasConflict, false);
  assert.equal(utcSummerResult.deadlineInfo.status, "consistent");

  // 4) Todellinen päivämääräero (+02:00 vs edellinen päivä) -> ristiriita
  const realOffsetConflictHtml = `<!doctype html>
  <html lang="fi">
    <head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Analyst Trainee",
        validThrough: "2026-11-25T16:15:00+02:00",
        description:
          "Tehtävässä osallistut tietoturva- ja data-analyysiin. Edellytämme soveltuvia opintoja. Määräaikainen harjoittelu. Hakuaika päättyy 22.11.2026.",
      })}</script>
    </head>
    <body></body>
  </html>`;
  const realConflictResult = extractJobContentFromHtml(
    realOffsetConflictHtml,
    "https://www.jobly.fi/tyopaikka/tz-real-conflict"
  );
  assert.equal(realConflictResult.deadlineInfo.hasConflict, true);
  assert.equal(realConflictResult.deadlineInfo.status, "conflict");
  assert.equal(realConflictResult.deadline, null);
});

test("Tapaus 38: Eksplisiittisten kellonaikojen vertailu ei salli virheellisiä toleransseja kesä- eikä talviajassa", () => {
  const buildTimedHtml = (validThrough: string, bodySentence: string) => `<!doctype html>
  <html lang="fi">
    <head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Kyberturvallisuusharjoittelija",
        validThrough,
        description: `Tehtävä sisältää lokien analysointia ja tietoturvapoikkeamien selvitystä. Edellytämme soveltuvia korkeakouluopintoja. Määräaikainen harjoittelu 6 kk. ${bodySentence}`,
      })}</script>
    </head>
    <body></body>
  </html>`;

  // 1. Rakenteinen 23.11.2026 klo 14:00 (+02:00) vs ilmoitusteksti klo 16:00 -> RISTIRIITA (ei 2h toleranssia)
  const twoHourDiff = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-11-23T14:00:00+02:00",
      "Hakuaika päättyy 23.11.2026 klo 16:00."
    ),
    "https://valtiolle.fi/fi/tyopaikat/time-diff-2h"
  );
  assert.equal(twoHourDiff.deadlineInfo.hasConflict, true);
  assert.equal(twoHourDiff.deadlineInfo.status, "conflict");
  assert.equal(twoHourDiff.deadline, null);

  // 2. Rakenteinen klo 14:00 (+02:00) vs ilmoitusteksti klo 23:59 -> RISTIRIITA (23:59 ei ohita vertailua)
  const endOfDayVsAfternoon = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-11-23T14:00:00+02:00",
      "Hakuaika päättyy 23.11.2026 klo 23:59."
    ),
    "https://valtiolle.fi/fi/tyopaikat/time-diff-2359"
  );
  assert.equal(endOfDayVsAfternoon.deadlineInfo.hasConflict, true);
  assert.equal(endOfDayVsAfternoon.deadlineInfo.status, "conflict");
  assert.equal(endOfDayVsAfternoon.deadline, null);

  // 3. Metatiedon tekninen oletusarvo 23:59 vs tekstin täsmällinen 16:15 -> säilyttää ristiriidan (ei consistent)
  const technicalDefaultVsSpecific = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-11-23T23:59:00+02:00",
      "Hakuaika päättyy 23.11.2026 klo 16:15."
    ),
    "https://valtiolle.fi/fi/tyopaikat/time-default-vs-specific"
  );
  assert.equal(technicalDefaultVsSpecific.deadlineInfo.hasConflict, true);
  assert.notEqual(technicalDefaultVsSpecific.deadlineInfo.status, "consistent");

  // 4. Tekstin sisäinen kellonaikaristiriita samana päivänä -> RISTIRIITA
  const internalTimeMismatch = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-11-23T14:00:00+02:00",
      "Hakuaika päättyy 23.11.2026 klo 14:00. Lähetä hakemus viimeistään 23.11.2026 klo 16:00."
    ),
    "https://valtiolle.fi/fi/tyopaikat/internal-time-diff"
  );
  assert.equal(internalTimeMismatch.deadlineInfo.hasConflict, true);

  // 5. Talviaika (UTC+2): 12:00Z == 14:00 EET (yhtenevä), 12:00Z != 15:00 EET (ristiriita)
  const winterExact = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-11-23T12:00:00Z",
      "Hakuaika päättyy 23.11.2026 klo 14:00."
    ),
    "https://valtiolle.fi/fi/tyopaikat/winter-exact"
  );
  assert.equal(winterExact.deadlineInfo.hasConflict, false);
  assert.equal(winterExact.deadlineInfo.status, "consistent");

  const winterOff = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-11-23T12:00:00Z",
      "Hakuaika päättyy 23.11.2026 klo 15:00."
    ),
    "https://valtiolle.fi/fi/tyopaikat/winter-off"
  );
  assert.equal(winterOff.deadlineInfo.hasConflict, true);

  // 6. Kesäaika (UTC+3 EEST): 11:00Z == 14:00 EEST (yhtenevä), 11:00Z != 13:00 EEST (väärä talvioffset -> ristiriita)
  const summerExact = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-07-15T11:00:00Z",
      "Hakuaika päättyy 15.7.2026 klo 14:00."
    ),
    "https://valtiolle.fi/fi/tyopaikat/summer-exact"
  );
  assert.equal(summerExact.deadlineInfo.hasConflict, false);
  assert.equal(summerExact.deadlineInfo.status, "consistent");

  const summerWrongDst = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-07-15T11:00:00Z",
      "Hakuaika päättyy 15.7.2026 klo 13:00."
    ),
    "https://valtiolle.fi/fi/tyopaikat/summer-wrong-dst"
  );
  assert.equal(summerWrongDst.deadlineInfo.hasConflict, true);

  // 7. Eksakti minuuttitarkkuus ilman 1 minuutin toleranssia (14:00 vs 14:00 / 14:01 / 14:02)
  const exactSameMinute = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-11-23T14:00:00+02:00",
      "Hakuaika päättyy 23.11.2026 klo 14:00."
    ),
    "https://valtiolle.fi/fi/tyopaikat/time-exact-1400"
  );
  assert.equal(exactSameMinute.deadlineInfo.hasConflict, false);
  assert.equal(exactSameMinute.deadlineInfo.status, "consistent");

  const oneMinuteDiff = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-11-23T14:00:00+02:00",
      "Hakuaika päättyy 23.11.2026 klo 14:01."
    ),
    "https://valtiolle.fi/fi/tyopaikat/time-diff-1401"
  );
  assert.equal(oneMinuteDiff.deadlineInfo.hasConflict, true);
  assert.equal(oneMinuteDiff.deadlineInfo.status, "conflict");
  assert.equal(oneMinuteDiff.deadline, null);

  const twoMinuteDiff = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-11-23T14:00:00+02:00",
      "Hakuaika päättyy 23.11.2026 klo 14:02."
    ),
    "https://valtiolle.fi/fi/tyopaikat/time-diff-1402"
  );
  assert.equal(twoMinuteDiff.deadlineInfo.hasConflict, true);
  assert.equal(twoMinuteDiff.deadlineInfo.status, "conflict");
  assert.equal(twoMinuteDiff.deadline, null);

  // Sekuntierotus saman minuutin sisällä (14:00:59 vs 14:00 -> consistent), mutta ei minuuttirajan yli (13:59:59 vs 14:00 -> conflict)
  const sameMinuteWithSeconds = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-11-23T14:00:59+02:00",
      "Hakuaika päättyy 23.11.2026 klo 14:00."
    ),
    "https://valtiolle.fi/fi/tyopaikat/time-same-minute-seconds"
  );
  assert.equal(sameMinuteWithSeconds.deadlineInfo.hasConflict, false);
  assert.equal(sameMinuteWithSeconds.deadlineInfo.status, "consistent");

  const crossMinuteBoundary = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-11-23T13:59:59+02:00",
      "Hakuaika päättyy 23.11.2026 klo 14:00."
    ),
    "https://valtiolle.fi/fi/tyopaikat/time-cross-minute-seconds"
  );
  assert.equal(crossMinuteBoundary.deadlineInfo.hasConflict, true);
  assert.equal(crossMinuteBoundary.deadlineInfo.status, "conflict");

  // Kesä- ja talviaikamuunnoksessa 1 minuutin ero on myös ristiriita
  const winterOneMinuteOff = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-11-23T12:00:00Z",
      "Hakuaika päättyy 23.11.2026 klo 14:01."
    ),
    "https://valtiolle.fi/fi/tyopaikat/winter-1min-off"
  );
  assert.equal(winterOneMinuteOff.deadlineInfo.hasConflict, true);
  assert.equal(winterOneMinuteOff.deadlineInfo.status, "conflict");

  const summerOneMinuteOff = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-07-15T11:00:00Z",
      "Hakuaika päättyy 15.7.2026 klo 14:01."
    ),
    "https://valtiolle.fi/fi/tyopaikat/summer-1min-off"
  );
  assert.equal(summerOneMinuteOff.deadlineInfo.hasConflict, true);
  assert.equal(summerOneMinuteOff.deadlineInfo.status, "conflict");

  // 8. Ilmoitustekstin sisäinen kellonaikavertailu ei salli 1 minuutin toleranssia
  const internalOneMinuteConflict = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-11-23T14:00:00+02:00",
      "Hakuaika päättyy 23.11.2026 klo 14:00. Lähetä hakemus viimeistään 23.11.2026 klo 14:01."
    ),
    "https://valtiolle.fi/fi/tyopaikat/internal-time-diff-1min"
  );
  assert.equal(internalOneMinuteConflict.deadlineInfo.hasConflict, true);
  assert.equal(internalOneMinuteConflict.deadlineInfo.status, "conflict");
  assert.equal(internalOneMinuteConflict.deadline, null);

  const internalBodyOnlyOneMinuteConflict = extractJobContentFromHtml(
    `<!doctype html><html lang="fi"><body><main>
      <h1>Kyberturvallisuusharjoittelija</h1>
      <p>Tehtävä sisältää lokien analysointia ja tietoturvapoikkeamien selvitystä. Edellytämme soveltuvia korkeakouluopintoja. Määräaikainen harjoittelu 6 kk.</p>
      <p>Hakuaika päättyy 23.11.2026 klo 14:00. Lähetä hakemus viimeistään 23.11.2026 klo 14:01.</p>
    </main></body></html>`,
    "https://valtiolle.fi/fi/tyopaikat/internal-body-only-1min"
  );
  assert.equal(internalBodyOnlyOneMinuteConflict.deadlineInfo.hasConflict, true);
  assert.equal(internalBodyOnlyOneMinuteConflict.deadlineInfo.status, "conflict");
  assert.equal(internalBodyOnlyOneMinuteConflict.deadline, null);

  const internalBodyDuplicateSameMinute = extractJobContentFromHtml(
    buildTimedHtml(
      "2026-11-23T14:00:00+02:00",
      "Hakuaika päättyy 23.11.2026 klo 14:00. Lähetä hakemus viimeistään 23.11.2026 klo 14:00."
    ),
    "https://valtiolle.fi/fi/tyopaikat/internal-time-same-1400"
  );
  assert.equal(internalBodyDuplicateSameMinute.deadlineInfo.hasConflict, false);
  assert.equal(internalBodyDuplicateSameMinute.deadlineInfo.status, "consistent");
});

function generateSelfSignedCertForHost(
  tempDir: string,
  prefix: string,
  hostname: string
): { key: string; cert: string } {
  const keyPath = path.join(tempDir, `${prefix}-key.pem`);
  const certPath = path.join(tempDir, `${prefix}-cert.pem`);
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      `/CN=${hostname}`,
      "-addext",
      `subjectAltName=DNS:${hostname}`,
    ],
    { stdio: "ignore" }
  );
  return {
    key: fs.readFileSync(keyPath, "utf8"),
    cert: fs.readFileSync(certPath, "utf8"),
  };
}

test("Tapaus 39: Eristetyt todellisen HTTPS-kuljetuskerroksen ja DNS-aikakatkaisun integraatiotestit", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cia-https-test-"));
  const validCreds = generateSelfSignedCertForHost(
    tempDir,
    "valid",
    "duunitori.fi"
  );
  const wrongHostCreds = generateSelfSignedCertForHost(
    tempDir,
    "wrong",
    "wrong.example.com"
  );

  let serverMode:
    | "ok"
    | "redirect"
    | "wire_oversize"
    | "gzip_oversize"
    | "slow"
    | "abort_wait" = "ok";
  let observedHostHeader = "";
  let redirectTargetHitCount = 0;
  let holdResponseFinish: (() => void) | null = null;
  const releaseHeldResponse = () => {
    const fn = holdResponseFinish;
    holdResponseFinish = null;
    if (fn) fn();
  };
  let waitSignalConnected: (() => void) | null = null;

  const server = https.createServer(
    { key: validCreds.key, cert: validCreds.cert },
    (req, res) => {
      observedHostHeader = req.headers.host ?? "";
      if (req.url === "/redirect-target") {
        redirectTargetHitCount++;
        res.writeHead(200, { "content-type": "text/html" });
        res.end("reached");
        return;
      }

      if (serverMode === "redirect") {
        res.writeHead(302, {
          location: "https://duunitori.fi/redirect-target",
        });
        res.end();
        return;
      }

      if (serverMode === "wire_oversize") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<html><body>" + "A".repeat(2500) + "</body></html>");
        return;
      }

      if (serverMode === "gzip_oversize") {
        // Pieni pakattu hyötykuorma, joka purkautuu yli maxBytes-rajan
        const uncompressed = Buffer.from(
          `<html><body><main><p>${"X".repeat(4000)}</p></main></body></html>`,
          "utf8"
        );
        const gzipped = zlib.gzipSync(uncompressed);
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-encoding": "gzip",
        });
        res.end(gzipped);
        return;
      }

      if (serverMode === "slow" || serverMode === "abort_wait") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.write("<html><body>");
        waitSignalConnected?.();
        holdResponseFinish = () => {
          if (!res.writableEnded) {
            res.end("</body></html>");
          }
        };
        return;
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body><main><p>TLS OK</p></main></body></html>");
    }
  );

  const wrongHostServer = https.createServer(
    { key: wrongHostCreds.key, cert: wrongHostCreds.cert },
    (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("should never verify");
    }
  );

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    await new Promise<void>((resolve) =>
      wrongHostServer.listen(0, "127.0.0.1", resolve)
    );

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const port = address.port;

    const wrongAddress = wrongHostServer.address();
    assert.ok(wrongAddress && typeof wrongAddress === "object");
    const wrongPort = wrongAddress.port;

    const targetUrl = new URL("https://duunitori.fi/tyopaikat/tyo/tls-test");

    // 1. Onnistunut DNS-pinnoitettu HTTPS-yhteys luotetulla testivarmenteella + Host-otsake
    serverMode = "ok";
    const okRes = await executePinnedHttpsGet({
      url: targetUrl,
      resolvedIp: "127.0.0.1",
      resolvedFamily: 4,
      timeoutMs: 2_000,
      maxBytes: 10_000,
      portOverride: port,
      caOverride: validCreds.cert,
    });
    assert.equal(okRes.statusCode, 200);
    assert.equal(observedHostHeader, "duunitori.fi");
    assert.match(okRes.body, /TLS OK/);

    // 2a. Itseallekirjoitettu varmenne ilman caOverride-luottamusta hylätään (rejectUnauthorized: true)
    await assert.rejects(
      () =>
        executePinnedHttpsGet({
          url: targetUrl,
          resolvedIp: "127.0.0.1",
          resolvedFamily: 4,
          timeoutMs: 2_000,
          maxBytes: 10_000,
          portOverride: port,
        }),
      (err: unknown) => err instanceof JobFetchError && err.code === "NETWORK_ERROR"
    );

    // 2b. Väärän palvelinnimen varmenne (wrong.example.com vs duunitori.fi) hylätään TLS-tarkistuksessa
    await assert.rejects(
      () =>
        executePinnedHttpsGet({
          url: targetUrl,
          resolvedIp: "127.0.0.1",
          resolvedFamily: 4,
          timeoutMs: 2_000,
          maxBytes: 10_000,
          portOverride: wrongPort,
          caOverride: wrongHostCreds.cert,
        }),
      (err: unknown) => err instanceof JobFetchError && err.code === "NETWORK_ERROR"
    );

    // 3. HTTP-uudelleenohjaus estetään kuljetuskerroksessa eikä kohdepolkua kutsuta koskaan
    serverMode = "redirect";
    redirectTargetHitCount = 0;
    await assert.rejects(
      () =>
        executePinnedHttpsGet({
          url: targetUrl,
          resolvedIp: "127.0.0.1",
          resolvedFamily: 4,
          timeoutMs: 2_000,
          maxBytes: 10_000,
          portOverride: port,
          caOverride: validCreds.cert,
        }),
      (err: unknown) =>
        err instanceof JobFetchError &&
        err.statusCode === 422 &&
        err.code === "REDIRECT_BLOCKED"
    );
    assert.equal(redirectTargetHitCount, 0);

    // 4a. Siirtokoko yli maxBytes -> 413 PAYLOAD_TOO_LARGE
    serverMode = "wire_oversize";
    await assert.rejects(
      () =>
        executePinnedHttpsGet({
          url: targetUrl,
          resolvedIp: "127.0.0.1",
          resolvedFamily: 4,
          timeoutMs: 2_000,
          maxBytes: 500,
          portOverride: port,
          caOverride: validCreds.cert,
        }),
      (err: unknown) =>
        err instanceof JobFetchError &&
        err.statusCode === 413 &&
        err.code === "PAYLOAD_TOO_LARGE"
    );

    // 4b. Gzip-pakattu koko pieni, mutta purettu koko ylittää maxBytes -> 413 PAYLOAD_TOO_LARGE
    serverMode = "gzip_oversize";
    await assert.rejects(
      () =>
        executePinnedHttpsGet({
          url: targetUrl,
          resolvedIp: "127.0.0.1",
          resolvedFamily: 4,
          timeoutMs: 2_000,
          maxBytes: 500,
          portOverride: port,
          caOverride: validCreds.cert,
        }),
      (err: unknown) =>
        err instanceof JobFetchError &&
        err.statusCode === 413 &&
        err.code === "PAYLOAD_TOO_LARGE"
    );

    // 5a. Todellisen HTTPS-pyynnön aikakatkaisu
    serverMode = "slow";
    await assert.rejects(
      () =>
        executePinnedHttpsGet({
          url: targetUrl,
          resolvedIp: "127.0.0.1",
          resolvedFamily: 4,
          timeoutMs: 80,
          maxBytes: 10_000,
          portOverride: port,
          caOverride: validCreds.cert,
        }),
      (err: unknown) =>
        err instanceof JobFetchError &&
        err.statusCode === 504 &&
        err.code === "TIMEOUT"
    );
    releaseHeldResponse();

    // 5b. Kesken lennon tapahtuva AbortSignal-keskeytys
    serverMode = "abort_wait";
    const abortController = new AbortController();
    const requestPromise = executePinnedHttpsGet({
      url: targetUrl,
      resolvedIp: "127.0.0.1",
      resolvedFamily: 4,
      timeoutMs: 2_000,
      maxBytes: 10_000,
      signal: abortController.signal,
      portOverride: port,
      caOverride: validCreds.cert,
    });
    await new Promise<void>((resolve) => {
      waitSignalConnected = resolve;
    });
    abortController.abort();
    await assert.rejects(
      () => requestPromise,
      (err: unknown) =>
        err instanceof JobFetchError &&
        err.statusCode === 499 &&
        err.code === "ABORTED"
    );
    releaseHeldResponse();

    // 6a. Nimipalveluselvityksen aikakatkaisu (DNS_TIMEOUT)
    await assert.rejects(
      () =>
        fetchJobFromUrl("https://duunitori.fi/tyopaikat/tyo/dns-timeout", {
          dnsTimeoutMs: 40,
          dnsLookup: () =>
            new Promise(() => {
              // Tarkoituksella ratkeamaton DNS-haku
            }),
        }),
      (err: unknown) =>
        err instanceof JobFetchError &&
        err.statusCode === 504 &&
        err.code === "DNS_TIMEOUT"
    );

    // 6b. Keskeytetty DNS-haku (ABORTED)
    const dnsAbort = new AbortController();
    const dnsPromise = fetchJobFromUrl(
      "https://duunitori.fi/tyopaikat/tyo/dns-abort",
      {
        signal: dnsAbort.signal,
        dnsTimeoutMs: 2_000,
        dnsLookup: () =>
          new Promise(() => {
            // Odottaa keskeytystä
          }),
      }
    );
    dnsAbort.abort();
    await assert.rejects(
      () => dnsPromise,
      (err: unknown) =>
        err instanceof JobFetchError &&
        err.statusCode === 499 &&
        err.code === "ABORTED"
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => wrongHostServer.close(() => resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Tapaus 40: Analyysin urlVerificationNotice kuvaa syötetekstin totuudenmukaisesti eikä sekoita URL-noutoa haun voimassaoloon", () => {
  const raw = makeBaseRawAnalysis();

  const withUrl = validateAndNormalizeAnalysis(
    raw,
    "https://www.jobly.fi/tyopaikka/data-analyst-trainee-digimyynti-2799261"
  );
  assert.doesNotMatch(withUrl.urlVerificationNotice, /ei ole avattu/i);
  assert.match(withUrl.urlVerificationNotice, /syötettyyn ilmoitustekstiin/i);
  assert.match(withUrl.urlVerificationNotice, /URL-noudolla/i);
  assert.match(
    withUrl.urlVerificationNotice,
    /ei yksinään todista, että haku on avoinna/i
  );

  const withoutUrl = validateAndNormalizeAnalysis(raw, "");
  assert.match(withoutUrl.urlVerificationNotice, /URL-osoitetta ei annettu/i);
  assert.match(
    withoutUrl.urlVerificationNotice,
    /eikä se yksinään todista, että haku on avoinna/i
  );
});













