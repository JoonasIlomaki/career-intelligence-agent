import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  ClipboardCheck,
  HelpCircle,
  Info,
  ListChecks,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type {
  ApplicationAvailabilityStatus,
  EligibilityStatus,
  JobAnalysisResult,
  RecommendationCategory,
  SavedJobEntry,
} from "../types/career.ts";
import { MISSING_VALUE } from "../lib/validation.ts";
import { getActionabilityGuidance } from "../lib/availability.ts";
import type { DuplicateMatch } from "../lib/duplicates.ts";

interface AnalysisResultViewProps {
  analysis: JobAnalysisResult;
  jobUrl?: string;
  availabilityStatus?: ApplicationAvailabilityStatus;
  availabilityVerifiedAt?: string;
  availabilitySourceUrl?: string;
  duplicates?: DuplicateMatch[];
  onInspectExisting?: (entry: SavedJobEntry) => void;
}

function getRecommendationPresentation(category: RecommendationCategory) {
  switch (category) {
    case "Ensisijainen hakukohde":
      return {
        colorClass: "text-emerald-800 bg-emerald-50 border-emerald-200",
        icon: CheckCircle2,
      };
    case "Harkinnan arvoinen":
      return {
        colorClass: "text-amber-800 bg-amber-50 border-amber-200",
        icon: Info,
      };
    case "Matala prioriteetti":
      return {
        colorClass: "text-slate-700 bg-slate-100 border-slate-200",
        icon: HelpCircle,
      };
    case "Jätä väliin":
      return {
        colorClass: "text-red-800 bg-red-50 border-red-200",
        icon: CircleSlash,
      };
  }
}

function getEligibilityStatusClass(status: EligibilityStatus): string {
  switch (status) {
    case "Täyttyy":
      return "text-emerald-800 font-medium";
    case "Tarkistettava":
      return "text-amber-800 font-medium";
    case "Puuttuu":
      return "text-red-700 font-medium";
    case "Ei ilmoitettu":
      return "text-slate-500";
  }
}

function FactCell({ label, value }: { label: string; value: string }) {
  const isMissing = value === MISSING_VALUE;
  return (
    <div className="p-3.5 bg-white">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd
        className={`mt-1 text-sm ${
          isMissing
            ? "text-slate-400 italic"
            : "text-slate-900 font-medium"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

export function AnalysisResultView({
  analysis,
  jobUrl,
  availabilityStatus = "Ei tarkistettu",
  availabilityVerifiedAt = "",
  availabilitySourceUrl = "",
  duplicates = [],
  onInspectExisting,
}: AnalysisResultViewProps) {
  const rec = getRecommendationPresentation(analysis.recommendation.category);
  const RecIcon = rec.icon;
  const actionability = getActionabilityGuidance(
    analysis.recommendation.category,
    availabilityStatus,
    availabilityVerifiedAt,
    availabilitySourceUrl
  );

  const taskDomains =
    analysis.cybersecurityEvaluation.taskDomains &&
    analysis.cybersecurityEvaluation.taskDomains.length > 0
      ? analysis.cybersecurityEvaluation.taskDomains
      : analysis.cybersecurityEvaluation.relevantDomains;

  const applicationSteps = analysis.extracted.applicationSteps ?? [];
  const mandatoryEligibility = analysis.mandatoryEligibility ?? [];
  const learningOpportunities =
    analysis.skillsComparison.learningOpportunities ?? [];
  const practical = analysis.practicalConsiderations;
  const internalOpps =
    analysis.cybersecurityEvaluation.internalCareerOpportunities;

  return (
    <div className="space-y-6">
      {duplicates.length > 0 && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-2 flex-1">
              <p className="font-semibold">
                Mahdollinen duplikaatti havaittu tallennetuissa hakukohteissa
              </p>
              <ul className="space-y-1 text-xs text-amber-900">
                {duplicates.map((dup) => (
                  <li
                    key={dup.entry.id}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span>
                      {dup.entry.analysis.extracted.company} —{" "}
                      {dup.entry.analysis.extracted.position} ({dup.reason},
                      tila: {dup.entry.status})
                    </span>
                    {onInspectExisting && (
                      <button
                        type="button"
                        onClick={() => onInspectExisting(dup.entry)}
                        className="font-medium underline hover:text-amber-950 cursor-pointer"
                      >
                        Avaa tallennettu kohde
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* URL verification notice */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 flex items-start gap-2.5">
        <Info className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p>{analysis.urlVerificationNotice}</p>
          {jobUrl && jobUrl.trim() && (
            <p className="font-mono text-slate-500 break-all">
              Viite-URL: {jobUrl.trim()}
            </p>
          )}
        </div>
      </div>

      {/* Recommendation & Application Availability */}
      <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500">
              Soveltuvuussuositus (osaaminen ja uratavoite)
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold ${rec.colorClass}`}
              >
                <RecIcon className="h-4 w-4 shrink-0" />
                {analysis.recommendation.category}
              </span>
              <span className="text-xs text-slate-500">
                Suora kyberturvallisuusrelevanssi:{" "}
                <strong className="text-slate-900">
                  {analysis.cybersecurityEvaluation.relevanceLevel}
                </strong>
                <span aria-hidden="true" className="mx-2">
                  ·
                </span>
                Etenemispolku:{" "}
                <strong className="text-slate-900">
                  {analysis.cybersecurityEvaluation.progressionPath}
                </strong>
              </span>
            </div>
          </div>
          <div className="lg:text-right">
            <p className="text-xs font-medium text-slate-500">
              Tehtävä & työnantaja
            </p>
            <p className="text-sm font-semibold text-slate-900 mt-0.5">
              {analysis.extracted.position} · {analysis.extracted.company}
            </p>
          </div>
        </div>

        <div
          className={`px-5 py-3.5 border-b border-slate-200 flex items-start gap-3 text-sm ${
            actionability.tone === "closed"
              ? "bg-red-50 text-red-950"
              : actionability.tone === "unverified"
              ? "bg-amber-50 text-amber-950"
              : actionability.tone === "caution"
              ? "bg-amber-50 text-amber-950"
              : "bg-emerald-50 text-emerald-950"
          }`}
        >
          {actionability.tone === "open" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
          ) : actionability.tone === "closed" ? (
            <CircleSlash className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
          )}
          <div className="space-y-0.5">
            <p className="text-xs font-semibold">
              Hakutilanne: {actionability.statusLabel} — {actionability.headline}
            </p>
            <p className="text-xs leading-relaxed opacity-90">
              {actionability.detail}
            </p>
          </div>
        </div>

        <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Kriittiset perustelut (tulkinta)
            </h3>
            <ul className="space-y-1.5 text-sm text-slate-700 list-disc pl-5">
              {analysis.recommendation.criticalReasons.map((reason, idx) => (
                <li key={idx} className="leading-relaxed">
                  {reason}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 space-y-1.5">
            <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <ArrowRight className="h-3.5 w-3.5 text-slate-700" />
              Seuraava suositeltu askel
            </h4>
            <p className="text-sm text-slate-900 leading-relaxed">
              {analysis.recommendation.nextAction}
            </p>
          </div>
        </div>
      </section>

      {/* Extracted Facts */}
      <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Ilmoituksesta poimitut perustiedot
          </h3>
          <span className="text-xs text-slate-500">
            Puuttuvat tiedot merkitty: Ei ilmoitettu
          </span>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200">
          <FactCell label="Yritys" value={analysis.extracted.company} />
          <FactCell label="Tehtävänimike" value={analysis.extracted.position} />
          <FactCell label="Sijainti" value={analysis.extracted.location} />
          <FactCell
            label="Työskentelymalli"
            value={analysis.extracted.workModel}
          />
          <FactCell
            label="Työsuhteen tyyppi"
            value={analysis.extracted.employmentType}
          />
          <FactCell
            label="Hakuaika (deadline)"
            value={analysis.extracted.deadline}
          />
          <FactCell
            label="Palkkatiedot"
            value={analysis.extracted.salaryInfo}
          />
          <div className="p-3.5 bg-white">
            <dt className="text-xs font-medium text-slate-500">
              Tehtävän teknologia- ja osaamisalueet
            </dt>
            <dd className="mt-1 text-sm text-slate-900">
              {taskDomains.length > 0
                ? taskDomains.join(" · ")
                : MISSING_VALUE}
            </dd>
          </div>
        </dl>

        <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-t border-slate-200">
          <div className="p-5 space-y-3">
            <h4 className="text-xs font-semibold text-slate-700">
              Pakolliset vaatimukset
            </h4>
            {analysis.extracted.requiredQualifications.length === 0 ? (
              <p className="text-sm text-slate-400 italic">{MISSING_VALUE}</p>
            ) : (
              <ul className="space-y-3">
                {analysis.extracted.requiredQualifications.map((q, idx) => (
                  <li key={idx} className="space-y-1 text-sm">
                    <p className="text-slate-900">{q.item}</p>
                    {q.evidence && (
                      <blockquote className="font-mono text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
                        “{q.evidence}”
                      </blockquote>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="p-5 space-y-3">
            <h4 className="text-xs font-semibold text-slate-700">
              Eduksi katsottavat valmiudet
            </h4>
            {analysis.extracted.preferredQualifications.length === 0 ? (
              <p className="text-sm text-slate-400 italic">{MISSING_VALUE}</p>
            ) : (
              <ul className="space-y-3">
                {analysis.extracted.preferredQualifications.map((q, idx) => (
                  <li key={idx} className="space-y-1 text-sm">
                    <p className="text-slate-900">{q.item}</p>
                    {q.evidence && (
                      <blockquote className="font-mono text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
                        “{q.evidence}”
                      </blockquote>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="p-5 space-y-3">
            <h4 className="text-xs font-semibold text-slate-700">
              Keskeiset työtehtävät
            </h4>
            {analysis.extracted.mainResponsibilities.length === 0 ? (
              <p className="text-sm text-slate-400 italic">{MISSING_VALUE}</p>
            ) : (
              <ul className="space-y-3">
                {analysis.extracted.mainResponsibilities.map((r, idx) => (
                  <li key={idx} className="space-y-1 text-sm">
                    <p className="text-slate-900">{r.item}</p>
                    {r.evidence && (
                      <blockquote className="font-mono text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
                        “{r.evidence}”
                      </blockquote>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Mandatory Application Steps & Pre-Assignments */}
      {applicationSteps.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-slate-700" />
              Pakolliset hakuohjeet ja ennakkotehtävät
            </h3>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {applicationSteps.length} vaihetta
            </span>
          </div>
          <div className="divide-y divide-slate-200">
            {applicationSteps.map((step, idx) => (
              <div key={idx} className="p-5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    {step.step}
                  </p>
                  <span className="text-xs font-medium text-slate-600">
                    {step.isMandatory ? "Pakollinen vaihe" : "Valinnainen"}
                  </span>
                </div>

                {step.parts.length > 0 && (
                  <ul className="space-y-1 text-sm text-slate-800 list-disc pl-5">
                    {step.parts.map((part, pIdx) => (
                      <li key={pIdx}>{part}</li>
                    ))}
                  </ul>
                )}

                {step.candidateCaution && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                    <span>{step.candidateCaution}</span>
                  </div>
                )}

                {step.evidence && (
                  <blockquote className="font-mono text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
                    “{step.evidence}”
                  </blockquote>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Mandatory Eligibility & Practical Considerations */}
      {(mandatoryEligibility.length > 0 || practical) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {mandatoryEligibility.length > 0 && (
            <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-slate-700" />
                  Muodolliset kelpoisuusvaatimukset
                </h3>
              </div>
              <ul className="divide-y divide-slate-200">
                {mandatoryEligibility.map((el, idx) => (
                  <li key={idx} className="p-4 space-y-1.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">
                        {el.requirement}
                      </span>
                      <span
                        className={`text-xs shrink-0 ${getEligibilityStatusClass(
                          el.status
                        )}`}
                      >
                        {el.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600">{el.detail}</p>
                    {el.evidence && (
                      <blockquote className="font-mono text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-2.5 py-1">
                        “{el.evidence}”
                      </blockquote>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {practical && (
            <section
              className={`rounded-lg border border-slate-200 bg-white overflow-hidden ${
                mandatoryEligibility.length === 0 ? "lg:col-span-2" : ""
              }`}
            >
              <div className="px-5 py-3.5 border-b border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-slate-700" />
                  Käytännön tekijät ja opinnollistaminen
                </h3>
              </div>
              <dl className="divide-y divide-slate-200 text-sm">
                <div className="p-4 grid grid-cols-3 gap-3">
                  <dt className="text-xs font-medium text-slate-500">
                    Maantieteellinen sijainti ja matka
                  </dt>
                  <dd className="col-span-2 text-slate-900">
                    {practical.locationAndCommute}
                  </dd>
                </div>
                <div className="p-4 grid grid-cols-3 gap-3">
                  <dt className="text-xs font-medium text-slate-500">
                    Vuorotyö ja työajan toteutettavuus
                  </dt>
                  <dd
                    className={`col-span-2 ${
                      !practical.shiftAndScheduleFeasibility ||
                      practical.shiftAndScheduleFeasibility === MISSING_VALUE
                        ? "text-slate-500"
                        : "text-slate-900"
                    }`}
                  >
                    {practical.shiftAndScheduleFeasibility ?? MISSING_VALUE}
                  </dd>
                </div>
                <div className="p-4 grid grid-cols-3 gap-3">
                  <dt className="text-xs font-medium text-slate-500">
                    Aikataulu ja aloitus
                  </dt>
                  <dd className="col-span-2 text-slate-900">
                    {practical.scheduleAndStart}
                  </dd>
                </div>
                <div className="p-4 grid grid-cols-3 gap-3">
                  <dt className="text-xs font-medium text-slate-500">
                    Työsuhteen muoto
                  </dt>
                  <dd className="col-span-2 text-slate-900">
                    {practical.employmentTypeNote}
                  </dd>
                </div>
                <div className="p-4 grid grid-cols-3 gap-3">
                  <dt className="text-xs font-medium text-slate-500">Palkka</dt>
                  <dd className="col-span-2 text-slate-900">
                    {practical.salaryNote}
                  </dd>
                </div>
                <div className="p-4 grid grid-cols-3 gap-3 bg-slate-50">
                  <dt className="text-xs font-semibold text-slate-700">
                    Harjoittelun opinnollistaminen
                  </dt>
                  <dd className="col-span-2 text-xs text-slate-800 leading-relaxed">
                    {practical.internshipCreditAssessment}
                  </dd>
                </div>
              </dl>
            </section>
          )}
        </div>
      )}

      {/* Skills Comparison & Learning Opportunities */}
      <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Osaamisvertailu ja oppimismahdollisuudet
          </h3>
          <span className="text-xs text-slate-500">
            Vain osaamiset ja kokemus (ei sijainti- tai työsuhde-ehtoja)
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
          <div className="p-5 space-y-5">
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                Nykyiset vahvat vastaavuudet (
                <span className="font-mono tabular-nums">
                  {analysis.skillsComparison.strongMatches.length}
                </span>
                )
              </h4>
              {analysis.skillsComparison.strongMatches.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Ei tunnistettuja suoria vahvoja vastaavuuksia.
                </p>
              ) : (
                <ul className="space-y-3">
                  {analysis.skillsComparison.strongMatches.map((m, idx) => (
                    <li
                      key={idx}
                      className="rounded-md border border-slate-200 p-3 space-y-1.5 text-sm"
                    >
                      <p className="font-medium text-slate-900">
                        {m.skillOrRequirement}
                      </p>
                      <p className="text-xs text-slate-700">
                        <span className="font-medium text-slate-900">
                          Profiili:
                        </span>{" "}
                        {m.candidateBasis}
                      </p>
                      <p className="font-mono text-xs text-slate-600">
                        Ilmoitus: “{m.jobEvidence}”
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="pt-4 border-t border-slate-200 space-y-3">
              <h4 className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                <Info className="h-4 w-4 text-amber-700" />
                Osittaiset vastaavuudet ja siirrettävä kokemus (
                <span className="font-mono tabular-nums">
                  {analysis.skillsComparison.partialMatches.length}
                </span>
                )
              </h4>
              {analysis.skillsComparison.partialMatches.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Ei osittaisia vastaavuuksia.
                </p>
              ) : (
                <ul className="space-y-3">
                  {analysis.skillsComparison.partialMatches.map((m, idx) => (
                    <li
                      key={idx}
                      className="rounded-md border border-slate-200 p-3 space-y-1.5 text-sm"
                    >
                      <p className="font-medium text-slate-900">
                        {m.skillOrRequirement}
                      </p>
                      <p className="text-xs text-slate-700">
                        <span className="font-medium text-slate-900">
                          Profiili:
                        </span>{" "}
                        {m.candidateBasis}
                      </p>
                      <p className="text-xs text-amber-900">
                        <span className="font-medium">Rajoite / huomio:</span>{" "}
                        {m.gapOrNote}
                      </p>
                      <p className="font-mono text-xs text-slate-600">
                        Ilmoitus: “{m.jobEvidence}”
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="p-5 space-y-5">
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-red-800 flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4 text-red-700" />
                Merkittävät osaamispuutteet (
                <span className="font-mono tabular-nums">
                  {analysis.skillsComparison.significantGaps.length}
                </span>
                )
              </h4>
              {analysis.skillsComparison.significantGaps.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Ei kriittisiä pakollisten taitojen puutteita.
                </p>
              ) : (
                <ul className="space-y-3">
                  {analysis.skillsComparison.significantGaps.map((g, idx) => (
                    <li
                      key={idx}
                      className="rounded-md border border-slate-200 p-3 space-y-1.5 text-sm"
                    >
                      <p className="font-medium text-slate-900">
                        {g.requirement}
                      </p>
                      <p className="text-xs text-red-900">{g.gapDetail}</p>
                      <p className="font-mono text-xs text-slate-600">
                        Ilmoitus: “{g.jobEvidence}”
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="pt-4 border-t border-slate-200 space-y-3">
              <h4 className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <BookOpen className="h-4 w-4 text-slate-700" />
                Valinnaiset oppimismahdollisuudet (ei vaadittu etukäteen) (
                <span className="font-mono tabular-nums">
                  {learningOpportunities.length}
                </span>
                )
              </h4>
              {learningOpportunities.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Ei erillisiä valinnaisia alustoja tai teknologioita mainittu.
                </p>
              ) : (
                <ul className="space-y-3">
                  {learningOpportunities.map((lo, idx) => (
                    <li
                      key={idx}
                      className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-sm"
                    >
                      <p className="font-medium text-slate-900">
                        {lo.technologyOrTopic}
                      </p>
                      <p className="text-xs text-slate-700">
                        {lo.contextInJob}
                      </p>
                      {lo.evidence && (
                        <p className="font-mono text-xs text-slate-600">
                          Ilmoitus: “{lo.evidence}”
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="pt-4 border-t border-slate-200 space-y-3">
              <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <HelpCircle className="h-4 w-4 text-slate-500" />
                Puuttuvat tai epäselvät tiedot (
                <span className="font-mono tabular-nums">
                  {analysis.skillsComparison.unknownInformation.length}
                </span>
                )
              </h4>
              {analysis.skillsComparison.unknownInformation.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Kaikki keskeiset vertailutiedot olivat saatavilla.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {analysis.skillsComparison.unknownInformation.map(
                    (u, idx) => (
                      <li
                        key={idx}
                        className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm space-y-1"
                      >
                        <p className="font-medium text-slate-900">{u.topic}</p>
                        <p className="text-xs text-slate-600">{u.reason}</p>
                      </li>
                    )
                  )}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Cybersecurity Evaluation: Facts vs Interpretation */}
      <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-slate-700" />
            Kyberturvallisuusrelevanssi & urapolun arvio
          </h3>
          <span className="text-xs text-slate-500">
            Lähialat eroteltu suorasta kyberturvallisuudesta
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
          <div className="p-5 space-y-2">
            <p className="text-xs font-semibold text-slate-500">
              Faktat ilmoituksessa
            </p>
            <p className="text-sm text-slate-800 leading-relaxed">
              {analysis.cybersecurityEvaluation.factsSummary}
            </p>
          </div>
          <div className="p-5 space-y-2">
            <p className="text-xs font-semibold text-slate-500">
              Tulkinta etenemispolusta (
              {analysis.cybersecurityEvaluation.progressionPath})
            </p>
            <p className="text-sm text-slate-800 leading-relaxed">
              {analysis.cybersecurityEvaluation.interpretationSummary}
            </p>
          </div>
        </div>

        {(analysis.cybersecurityEvaluation.transferableCyberSkills ||
          analysis.cybersecurityEvaluation.verifiedInternalOpportunities ||
          internalOpps) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-t border-slate-200 bg-slate-50/50">
            <div className="p-5 space-y-1.5">
              <p className="text-xs font-semibold text-slate-600">
                Siirrettävä osaaminen tuleviin kyberrooleihin
              </p>
              <p className="text-sm text-slate-800 leading-relaxed">
                {analysis.cybersecurityEvaluation.transferableCyberSkills ??
                  MISSING_VALUE}
              </p>
            </div>
            <div className="p-5 space-y-2">
              <p className="text-xs font-semibold text-slate-600">
                Työnantajan sisäiset uramahdollisuudet
              </p>
              {internalOpps ? (
                <dl className="space-y-2 text-xs text-slate-800">
                  <div>
                    <dt className="font-semibold text-slate-700">
                      Vahvistetut mahdollisuudet (ilmoituksessa)
                    </dt>
                    <dd className="mt-0.5 leading-relaxed">
                      {internalOpps.confirmed}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-700">
                      Mahdolliset polut (tulkinta)
                    </dt>
                    <dd className="mt-0.5 leading-relaxed">
                      {internalOpps.plausible}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-700">
                      Tuntemattomat tiedot
                    </dt>
                    <dd className="mt-0.5 leading-relaxed text-slate-600">
                      {internalOpps.unknown}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-slate-800 leading-relaxed">
                  {analysis.cybersecurityEvaluation
                    .verifiedInternalOpportunities ?? MISSING_VALUE}
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Evidence Highlights Table */}
      {analysis.evidenceHighlights.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Keskeiset näyttöotteet ilmoitustekstistä
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4 w-28">Tyyppi</th>
                  <th className="py-2.5 px-4 w-1/3">Poimittu havainto</th>
                  <th className="py-2.5 px-4">Suora lainaus ilmoituksesta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {analysis.evidenceHighlights.map((ev, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 text-xs font-medium text-slate-600 align-top">
                      {ev.kind}
                    </td>
                    <td className="py-3 px-4 text-slate-900 align-top">
                      {ev.claim}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-700 align-top">
                      “{ev.excerpt}”
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
