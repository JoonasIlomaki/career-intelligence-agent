import { useState } from "react";
import { Check, Info, RotateCcw, Save } from "lucide-react";
import type { CandidateProfile } from "../types/career.ts";

interface ProfileViewProps {
  profile: CandidateProfile;
  onSaveProfile: (updated: CandidateProfile) => void;
  onResetProfile: () => CandidateProfile;
}

const FIELD_CONFIG: Array<{
  key: keyof Omit<CandidateProfile, "updatedAt">;
  label: string;
  rows: number;
  helper?: string;
}> = [
  {
    key: "headline",
    label: "Profiilin otsikko",
    rows: 1,
  },
  {
    key: "institutionAndDegree",
    label: "Korkeakoulu ja tutkinto",
    rows: 2,
  },
  {
    key: "studyProgress",
    label: "Opintojen vaihe ja opintopisteet",
    rows: 2,
  },
  {
    key: "previousItInternship",
    label: "Aiempi IT-harjoittelukokemus",
    rows: 2,
  },
  {
    key: "coursework",
    label: "Keskeiset opintojaksot",
    rows: 2,
  },
  {
    key: "technicalSkills",
    label: "Tekniset taidot ja harjoitukset",
    rows: 2,
  },
  {
    key: "aiExperienceNote",
    label: "Tekoälyharjoitukset ja rajaukset",
    rows: 2,
    helper:
      "Erottele selkeästi ohjatut harjoitukset ammatillisesta kehityskokemuksesta.",
  },
  {
    key: "otherWorkExperience",
    label: "Muu työkokemus (esim. logistiikka)",
    rows: 2,
  },
  {
    key: "careerGoals",
    label: "Uratavoitteet ja hyväksyttävät roolit",
    rows: 3,
  },
  {
    key: "availabilityAndLocation",
    label: "Saatavuus ja sijaintitoiveet",
    rows: 2,
  },
  {
    key: "strictConstraints",
    label: "Tiukat tulkintarajoitteet tekoälylle",
    rows: 2,
  },
];

export function ProfileView({
  profile,
  onSaveProfile,
  onResetProfile,
}: ProfileViewProps) {
  const [draft, setDraft] = useState<CandidateProfile>(profile);
  const [savedNotice, setSavedNotice] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  function handleChange(
    key: keyof Omit<CandidateProfile, "updatedAt">,
    value: string
  ) {
    setSavedNotice(false);
    setDraft((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSaveProfile(draft);
    setSavedNotice(true);
  }

  function handleResetConfirmed() {
    const fresh = onResetProfile();
    setDraft(fresh);
    setConfirmReset(false);
    setSavedNotice(true);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Hakijaprofiili
            </h1>
            <p className="text-sm text-slate-600 mt-0.5">
              Gemini vertaa jokaista työpaikkailmoitusta täsmälleen tähän
              tallennettuun profiiliin. Muutokset tallentuvat selaimeesi.
            </p>
          </div>
          <div className="text-xs font-mono text-slate-500 tabular-nums shrink-0">
            Päivitetty:{" "}
            {new Date(profile.updatedAt).toLocaleDateString("fi-FI")}
          </div>
        </div>

        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700 flex items-start gap-2.5">
          <Info className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
          <p>
            Profiili on esitäytetty esimerkkihakijan (kuvitteellinen suomalainen
            IT-opiskelija) tiedoilla, joita voit muokata vapaasti. Älä lisää
            taitoja tai sertifikaatteja, joita et pysty todentamaan.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {FIELD_CONFIG.map((field) => (
              <div
                key={field.key}
                className={field.key === "headline" ? "lg:col-span-2" : ""}
              >
                <label
                  htmlFor={`profile-${field.key}`}
                  className="block text-sm font-medium text-slate-800 mb-1.5"
                >
                  {field.label}
                </label>
                {field.rows === 1 ? (
                  <input
                    id={`profile-${field.key}`}
                    type="text"
                    required
                    value={draft[field.key]}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                ) : (
                  <textarea
                    id={`profile-${field.key}`}
                    rows={field.rows}
                    required
                    value={draft[field.key]}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                )}
                {field.helper && (
                  <p className="mt-1 text-xs text-slate-500">{field.helper}</p>
                )}
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4">
            <div>
              {confirmReset ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-700">
                    Palautetaanko alkuperäinen oletusprofiili?
                  </span>
                  <button
                    type="button"
                    onClick={handleResetConfirmed}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-red-700 rounded-md hover:bg-red-800 cursor-pointer"
                  >
                    Kyllä, palauta
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                  >
                    Peruuta
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Palauta oletusprofiili
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              {savedNotice && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800">
                  <Check className="h-4 w-4" />
                  Profiili tallennettu
                </span>
              )}
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer"
              >
                <Save className="h-4 w-4" />
                Tallenna profiili
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
