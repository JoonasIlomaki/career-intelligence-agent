import type { SavedJobEntry } from "../types/career.ts";
import { MISSING_VALUE } from "../lib/validation.ts";
import { formatAvailabilityLabel } from "../lib/availability.ts";

interface CompareViewProps {
  savedJobs: SavedJobEntry[];
  selectedIds: string[];
  onToggleCompare: (id: string) => void;
  onOpenJob: (id: string) => void;
  onGoToSavedJobs: () => void;
}

export function CompareView({
  savedJobs,
  selectedIds,
  onToggleCompare,
  onOpenJob,
  onGoToSavedJobs,
}: CompareViewProps) {
  const comparedJobs = savedJobs.filter((j) => selectedIds.includes(j.id));

  if (savedJobs.length < 2) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-10 text-center space-y-3">
        <h1 className="text-lg font-semibold text-slate-900">
          Hakukohteiden vertailu
        </h1>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Vertailuun tarvitaan vähintään kaksi tallennettua hakukohdetta.
          Tallenna ensin analysoituja ilmoituksia Hakukohteet-näkymään.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={onGoToSavedJobs}
            className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer"
          >
            Siirry hakukohteisiin
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Hakukohteiden rinnakkaisvertailu
            </h1>
            <p className="text-sm text-slate-600">
              Valitse 2–4 tallennettua hakukohdetta vertaillaksesi vaatimuksia,
              kyberturvallisuusyhteyttä ja suosituksia.
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            Valittu: {comparedJobs.length} / 4
          </span>
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200">
          {savedJobs.map((job) => {
            const checked = selectedIds.includes(job.id);
            const disabled = !checked && selectedIds.length >= 4;
            return (
              <label
                key={job.id}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                  checked
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggleCompare(job.id)}
                  className="sr-only"
                />
                <span className="truncate max-w-[220px]">
                  {job.analysis.extracted.company} —{" "}
                  {job.analysis.extracted.position}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      {comparedJobs.length < 2 ? (
        <section className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          Valitse yllä vähintään kaksi hakukohdetta vertailutaulukon
          näyttämiseksi.
        </section>
      ) : (
        <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="py-3 px-4 w-48 text-xs font-medium text-slate-500 align-top">
                    Kriteeri
                  </th>
                  {comparedJobs.map((job) => (
                    <th
                      key={job.id}
                      className="py-3 px-4 min-w-[240px] align-top"
                    >
                      <button
                        type="button"
                        onClick={() => onOpenJob(job.id)}
                        className="text-left hover:underline cursor-pointer"
                      >
                        <div className="font-semibold text-slate-900">
                          {job.analysis.extracted.position}
                        </div>
                        <div className="text-xs font-normal text-slate-500 mt-0.5">
                          {job.analysis.extracted.company}
                        </div>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <CompareRow
                  label="Soveltuvuussuositus"
                  jobs={comparedJobs}
                  render={(j) => (
                    <span className="font-semibold text-slate-900">
                      {j.analysis.recommendation.category}
                    </span>
                  )}
                />
                <CompareRow
                  label="Hakutilanne (varmistettu)"
                  jobs={comparedJobs}
                  render={(j) => (
                    <div className="text-xs">
                      <span className="font-medium text-slate-900">
                        {formatAvailabilityLabel(j.availabilityStatus)}
                      </span>
                      {j.availabilityVerifiedAt && (
                        <div className="font-mono text-slate-500 tabular-nums mt-0.5">
                          {j.availabilityVerifiedAt}
                        </div>
                      )}
                    </div>
                  )}
                />
                <CompareRow
                  label="Oma seurantatila"
                  jobs={comparedJobs}
                  render={(j) => j.status}
                />
                <CompareRow
                  label="Tehtävän teknologia- ja osaamisalueet"
                  jobs={comparedJobs}
                  render={(j) => {
                    const domains =
                      j.analysis.cybersecurityEvaluation.taskDomains &&
                      j.analysis.cybersecurityEvaluation.taskDomains.length > 0
                        ? j.analysis.cybersecurityEvaluation.taskDomains
                        : j.analysis.cybersecurityEvaluation.relevantDomains;
                    return domains.length > 0
                      ? domains.join(" · ")
                      : MISSING_VALUE;
                  }}
                />
                <CompareRow
                  label="Suora kyberrelevanssi"
                  jobs={comparedJobs}
                  render={(j) =>
                    `${j.analysis.cybersecurityEvaluation.relevanceLevel} · ${j.analysis.cybersecurityEvaluation.progressionPath} polku`
                  }
                />
                <CompareRow
                  label="Sijainti & työskentelymalli"
                  jobs={comparedJobs}
                  render={(j) =>
                    `${j.analysis.extracted.location} · ${j.analysis.extracted.workModel}`
                  }
                />
                <CompareRow
                  label="Vuorotyö ja työajan toteutettavuus"
                  jobs={comparedJobs}
                  render={(j) => (
                    <span className="text-xs">
                      {j.analysis.practicalConsiderations
                        ?.shiftAndScheduleFeasibility ?? MISSING_VALUE}
                    </span>
                  )}
                />
                <CompareRow
                  label="Työsuhteen tyyppi & opinnollistaminen"
                  jobs={comparedJobs}
                  render={(j) => (
                    <div className="space-y-1 text-xs">
                      <p className="text-slate-900 font-medium">
                        {j.analysis.extracted.employmentType}
                      </p>
                      {j.analysis.practicalConsiderations
                        ?.internshipCreditAssessment &&
                        j.analysis.practicalConsiderations
                          .internshipCreditAssessment !== MISSING_VALUE && (
                          <p className="text-slate-600">
                            {
                              j.analysis.practicalConsiderations
                                .internshipCreditAssessment
                            }
                          </p>
                        )}
                    </div>
                  )}
                />
                <CompareRow
                  label="Hakuaika (deadline)"
                  jobs={comparedJobs}
                  render={(j) => (
                    <span className="font-mono text-xs tabular-nums">
                      {j.analysis.extracted.deadline}
                    </span>
                  )}
                />
                <CompareRow
                  label="Palkkatiedot"
                  jobs={comparedJobs}
                  render={(j) => j.analysis.extracted.salaryInfo}
                />
                <CompareRow
                  label="Vahvat vastaavuudet"
                  jobs={comparedJobs}
                  render={(j) =>
                    j.analysis.skillsComparison.strongMatches.length === 0 ? (
                      <span className="text-slate-400">Ei mainittuja</span>
                    ) : (
                      <ul className="list-disc pl-4 space-y-1 text-xs">
                        {j.analysis.skillsComparison.strongMatches.map(
                          (m, i) => (
                            <li key={i}>{m.skillOrRequirement}</li>
                          )
                        )}
                      </ul>
                    )
                  }
                />
                <CompareRow
                  label="Oppimismahdollisuudet"
                  jobs={comparedJobs}
                  render={(j) => {
                    const lo =
                      j.analysis.skillsComparison.learningOpportunities ?? [];
                    return lo.length === 0 ? (
                      <span className="text-slate-400 text-xs">
                        Ei erikseen mainittuja
                      </span>
                    ) : (
                      <ul className="list-disc pl-4 space-y-1 text-xs text-slate-700">
                        {lo.map((item, i) => (
                          <li key={i}>{item.technologyOrTopic}</li>
                        ))}
                      </ul>
                    );
                  }}
                />
                <CompareRow
                  label="Merkittävät puutteet"
                  jobs={comparedJobs}
                  render={(j) =>
                    j.analysis.skillsComparison.significantGaps.length === 0 ? (
                      <span className="text-emerald-700 text-xs">
                        Ei merkittäviä puutteita
                      </span>
                    ) : (
                      <ul className="list-disc pl-4 space-y-1 text-xs text-red-900">
                        {j.analysis.skillsComparison.significantGaps.map(
                          (g, i) => (
                            <li key={i}>{g.requirement}</li>
                          )
                        )}
                      </ul>
                    )
                  }
                />
                <CompareRow
                  label="Pakolliset hakuohjeet"
                  jobs={comparedJobs}
                  render={(j) => {
                    const steps = j.analysis.extracted.applicationSteps ?? [];
                    return steps.length === 0 ? (
                      <span className="text-slate-400 text-xs">
                        Normaali hakemus / {MISSING_VALUE}
                      </span>
                    ) : (
                      <ul className="list-disc pl-4 space-y-1 text-xs text-slate-700">
                        {steps.map((s, i) => (
                          <li key={i}>{s.step}</li>
                        ))}
                      </ul>
                    );
                  }}
                />
                <CompareRow
                  label="Seuraava suositeltu askel"
                  jobs={comparedJobs}
                  render={(j) => (
                    <span className="text-xs leading-relaxed">
                      {j.analysis.recommendation.nextAction}
                    </span>
                  )}
                />
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function CompareRow({
  label,
  jobs,
  render,
}: {
  label: string;
  jobs: SavedJobEntry[];
  render: (job: SavedJobEntry) => React.ReactNode;
}) {
  return (
    <tr>
      <th className="py-3 px-4 text-xs font-medium text-slate-500 bg-slate-50/50 align-top">
        {label}
      </th>
      {jobs.map((job) => (
        <td key={job.id} className="py-3 px-4 text-slate-800 align-top">
          {render(job)}
        </td>
      ))}
    </tr>
  );
}
