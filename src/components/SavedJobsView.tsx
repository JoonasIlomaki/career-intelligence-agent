import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Columns2,
  Download,
  ExternalLink,
  FileText,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  ApplicationAvailabilityStatus,
  CandidateProfile,
  CareerBackupPayload,
  RecommendationCategory,
  SavedJobEntry,
  SavedJobStatus,
} from "../types/career.ts";
import { formatAvailabilityLabel } from "../lib/availability.ts";
import { getDuplicateIdSet } from "../lib/duplicates.ts";
import { createBackupJson, parseBackupJson } from "../lib/storage.ts";
import { formatSavedJobTimestamp } from "../lib/timestamps.ts";
import { AnalysisResultView } from "./AnalysisResultView.tsx";

interface SavedJobsViewProps {
  savedJobs: SavedJobEntry[];
  profile: CandidateProfile;
  selectedForCompare: string[];
  activeJobId: string | null;
  onSelectActiveJob: (id: string | null) => void;
  onToggleCompare: (id: string) => void;
  onOpenCompare: () => void;
  onUpdateJobMeta: (
    id: string,
    patch: Partial<
      Pick<
        SavedJobEntry,
        | "status"
        | "notes"
        | "targetDate"
        | "jobUrl"
        | "availabilityStatus"
        | "availabilityVerifiedAt"
        | "availabilitySourceUrl"
      >
    >
  ) => void;
  onDeleteJob: (id: string) => void;
  onImportBackup: (payload: CareerBackupPayload, mode: "merge" | "replace") => void;
  onGoToAnalyze: () => void;
}

type FilterTab =
  | "Kaikki"
  | "Ensisijainen hakukohde"
  | "Harkinnan arvoinen"
  | "Avoinna"
  | "Haettu"
  | "Duplikaatit";

const STATUS_OPTIONS: SavedJobStatus[] = [
  "Tallennettu",
  "Harkinnassa",
  "Haettu",
  "Haastattelussa",
  "Hylätty",
  "Ohitettu",
];

function recommendationTextColor(cat: RecommendationCategory): string {
  switch (cat) {
    case "Ensisijainen hakukohde":
      return "text-emerald-800 font-semibold";
    case "Harkinnan arvoinen":
      return "text-amber-800 font-medium";
    case "Matala prioriteetti":
      return "text-slate-600";
    case "Jätä väliin":
      return "text-red-700";
  }
}

export function SavedJobsView({
  savedJobs,
  profile,
  selectedForCompare,
  activeJobId,
  onSelectActiveJob,
  onToggleCompare,
  onOpenCompare,
  onUpdateJobMeta,
  onDeleteJob,
  onImportBackup,
  onGoToAnalyze,
}: SavedJobsViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("Kaikki");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [showRawText, setShowRawText] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingBackup, setPendingBackup] = useState<CareerBackupPayload | null>(
    null
  );
  const [backupMessage, setBackupMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const duplicateIds = useMemo(
    () => getDuplicateIdSet(savedJobs),
    [savedJobs]
  );

  const filteredJobs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return savedJobs.filter((job) => {
      if (filterTab === "Ensisijainen hakukohde") {
        if (job.analysis.recommendation.category !== "Ensisijainen hakukohde")
          return false;
      } else if (filterTab === "Harkinnan arvoinen") {
        if (job.analysis.recommendation.category !== "Harkinnan arvoinen")
          return false;
      } else if (filterTab === "Avoinna") {
        if ((job.availabilityStatus ?? "Ei tarkistettu") !== "Avoinna")
          return false;
      } else if (filterTab === "Haettu") {
        if (job.status !== "Haettu" && job.status !== "Haastattelussa")
          return false;
      } else if (filterTab === "Duplikaatit") {
        if (!duplicateIds.has(job.id)) return false;
      }

      if (!q) return true;
      const hay = [
        job.analysis.extracted.company,
        job.analysis.extracted.position,
        job.analysis.extracted.location,
        job.notes,
        job.status,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [savedJobs, filterTab, searchQuery, duplicateIds]);

  const activeJob = useMemo(
    () => savedJobs.find((j) => j.id === activeJobId) ?? null,
    [savedJobs, activeJobId]
  );

  function handleExportJson() {
    setBackupMessage(null);
    const json = createBackupJson(profile, savedJobs);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `career-intelligence-backup-${dateStamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setBackupMessage({
      type: "success",
      text: `Varmuuskopio viety (${savedJobs.length} hakukohdetta ja hakijaprofiili).`,
    });
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    setBackupMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = typeof reader.result === "string" ? reader.result : "";
        const payload = parseBackupJson(text);
        setPendingBackup(payload);
      } catch (err) {
        setBackupMessage({
          type: "error",
          text:
            err instanceof Error
              ? err.message
              : "Varmuuskopiotiedoston lukeminen epäonnistui.",
        });
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  }

  if (activeJob) {
    const isDuplicate = duplicateIds.has(activeJob.id);
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => {
              onSelectActiveJob(null);
              setShowRawText(false);
            }}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Takaisin hakukohteisiin
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowRawText((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5" />
              {showRawText
                ? "Piilota alkuperäinen teksti"
                : "Näytä alkuperäinen ilmoitus"}
            </button>
            {pendingDeleteId === activeJob.id ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onDeleteJob(activeJob.id);
                    onSelectActiveJob(null);
                    setPendingDeleteId(null);
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-red-700 rounded-md hover:bg-red-800 cursor-pointer"
                >
                  Vahvista poisto
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDeleteId(null)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                >
                  Peruuta
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPendingDeleteId(activeJob.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-md hover:bg-red-50 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Poista kohde
              </button>
            )}
          </div>
        </div>

        {isDuplicate && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
            <span>
              Tallennetuissa hakukohteissa on toinen merkintä samalla yrityksellä
              ja tehtävänimikkeellä.
            </span>
          </div>
        )}

        {/* Editable Tracking Fields */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              Hakukohteen seuranta ja muistiinpanot
            </h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-slate-500 tabular-nums">
              <span>
                Tallennettu: {formatSavedJobTimestamp(activeJob.createdAt)}
              </span>
              <span
                aria-hidden="true"
                className="text-slate-300 hidden sm:inline"
              >
                ·
              </span>
              <span>
                Muokattu:{" "}
                {activeJob.updatedAt
                  ? formatSavedJobTimestamp(activeJob.updatedAt)
                  : "Ei muokattu"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="detail-status"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Tila
              </label>
              <select
                id="detail-status"
                value={activeJob.status}
                onChange={(e) =>
                  onUpdateJobMeta(activeJob.id, {
                    status: e.target.value as SavedJobStatus,
                  })
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="detail-date"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Päivämäärä
              </label>
              <input
                id="detail-date"
                type="date"
                value={activeJob.targetDate}
                onChange={(e) =>
                  onUpdateJobMeta(activeJob.id, { targetDate: e.target.value })
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono tabular-nums text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="detail-url"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Viite-URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="detail-url"
                  type="url"
                  value={activeJob.jobUrl}
                  onChange={(e) =>
                    onUpdateJobMeta(activeJob.id, { jobUrl: e.target.value })
                  }
                  placeholder="https://..."
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
                {activeJob.jobUrl.trim() && (
                  <a
                    href={activeJob.jobUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Avaa viite-URL uudessa välilehdessä"
                    className="p-2 text-slate-600 hover:text-slate-900 border border-slate-300 rounded-md shrink-0"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="detail-availability-status"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Haun voimassaolo (manuaalinen tarkistus)
              </label>
              <select
                id="detail-availability-status"
                value={activeJob.availabilityStatus ?? "Ei tarkistettu"}
                onChange={(e) => {
                  const next = e.target.value as ApplicationAvailabilityStatus;
                  const nextDate =
                    next === "Ei tarkistettu"
                      ? ""
                      : activeJob.availabilityVerifiedAt ||
                        new Date().toISOString().slice(0, 10);
                  onUpdateJobMeta(activeJob.id, {
                    availabilityStatus: next,
                    availabilityVerifiedAt: nextDate,
                  });
                }}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="Ei tarkistettu">Ei tarkistettu</option>
                <option value="Avoinna">Avoinna (vahvistettu)</option>
                <option value="Päättynyt">Päättynyt (vahvistettu)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="detail-availability-date"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Tarkistuspäivämäärä
              </label>
              <input
                id="detail-availability-date"
                type="date"
                value={activeJob.availabilityVerifiedAt ?? ""}
                disabled={
                  (activeJob.availabilityStatus ?? "Ei tarkistettu") ===
                  "Ei tarkistettu"
                }
                onChange={(e) =>
                  onUpdateJobMeta(activeJob.id, {
                    availabilityVerifiedAt: e.target.value,
                  })
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono tabular-nums text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>

            <div>
              <label
                htmlFor="detail-availability-source"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Tarkistuksen lähde-URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="detail-availability-source"
                  type="url"
                  value={activeJob.availabilitySourceUrl ?? activeJob.jobUrl}
                  onChange={(e) =>
                    onUpdateJobMeta(activeJob.id, {
                      availabilitySourceUrl: e.target.value,
                    })
                  }
                  placeholder="https://..."
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
                {(activeJob.availabilitySourceUrl || activeJob.jobUrl).trim() && (
                  <a
                    href={
                      (
                        activeJob.availabilitySourceUrl || activeJob.jobUrl
                      ).trim()
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Avaa lähde-URL tarkistusta varten"
                    className="p-2 text-slate-600 hover:text-slate-900 border border-slate-300 rounded-md shrink-0"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </div>
          </div>

          <div>
            <label
              htmlFor="detail-notes"
              className="block text-xs font-medium text-slate-600 mb-1"
            >
              Muistiinpanot
            </label>
            <textarea
              id="detail-notes"
              rows={3}
              value={activeJob.notes}
              onChange={(e) =>
                onUpdateJobMeta(activeJob.id, { notes: e.target.value })
              }
              placeholder="Kirjaa huomiot, hakemusversio tai haastattelumuistiinpanot..."
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>
        </section>

        {showRawText && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-2">
            <h3 className="text-xs font-semibold text-slate-700">
              Alkuperäinen liitetty ilmoitusteksti
            </h3>
            <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md p-4 max-h-96 overflow-y-auto leading-relaxed">
              {activeJob.rawJobText}
            </pre>
          </section>
        )}

        <AnalysisResultView
          analysis={activeJob.analysis}
          jobUrl={activeJob.jobUrl}
          availabilityStatus={activeJob.availabilityStatus ?? "Ei tarkistettu"}
          availabilityVerifiedAt={activeJob.availabilityVerifiedAt ?? ""}
          availabilitySourceUrl={
            activeJob.availabilitySourceUrl || activeJob.jobUrl
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Backup Controls */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Hakukohteet
            </h1>
            <p className="text-sm text-slate-600 mt-0.5">
              Tallennetut analyysit selaimen paikallisessa tallennustilassa.
              Voit muokata tilaa, vertailla kohteita ja ottaa
              JSON-varmuuskopion.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {selectedForCompare.length >= 2 && (
              <button
                type="button"
                onClick={onOpenCompare}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Columns2 className="h-3.5 w-3.5" />
                Vertaile valittuja (
                <span className="font-mono tabular-nums">
                  {selectedForCompare.length}
                </span>
                )
              </button>
            )}

            <button
              type="button"
              onClick={handleExportJson}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              Vie JSON
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" />
              Tuo JSON
            </button>
          </div>
        </div>

        {backupMessage && (
          <div
            role="status"
            className={`rounded-md border px-3.5 py-2.5 text-xs ${
              backupMessage.type === "error"
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            {backupMessage.text}
          </div>
        )}

        {pendingBackup && (
          <div className="rounded-md border border-slate-300 bg-slate-50 p-4 space-y-3 text-sm">
            <p className="font-medium text-slate-900">
              Varmuuskopio valmis tuotavaksi:{" "}
              <span className="font-mono tabular-nums">
                {pendingBackup.savedJobs.length}
              </span>{" "}
              hakukohdetta (viety{" "}
              {new Date(pendingBackup.exportedAt).toLocaleString("fi-FI")}).
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  onImportBackup(pendingBackup, "merge");
                  setPendingBackup(null);
                  setBackupMessage({
                    type: "success",
                    text: "Varmuuskopion puuttuvat hakukohteet yhdistettiin nykyisiin tietoihin.",
                  });
                }}
                className="px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer"
              >
                Yhdistä olemassa oleviin
              </button>
              <button
                type="button"
                onClick={() => {
                  onImportBackup(pendingBackup, "replace");
                  setPendingBackup(null);
                  setBackupMessage({
                    type: "success",
                    text: "Hakukohteet ja hakijaprofiili korvattiin varmuuskopiolla.",
                  });
                }}
                className="px-3.5 py-1.5 text-xs font-medium text-red-800 bg-white border border-red-300 rounded-md hover:bg-red-50 cursor-pointer"
              >
                Korvaa nykyiset tiedot
              </button>
              <button
                type="button"
                onClick={() => setPendingBackup(null)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
              >
                Peruuta
              </button>
            </div>
          </div>
        )}

        {/* Search and Segmented Filter */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2 border-t border-slate-200">
          <div className="relative flex-1 max-w-md">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Hae yritystä, tehtävää tai muistiinpanoa..."
              className="w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div
            role="tablist"
            aria-label="Suodata hakukohteita"
            className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg"
          >
            {(
              [
                "Kaikki",
                "Ensisijainen hakukohde",
                "Harkinnan arvoinen",
                "Avoinna",
                "Haettu",
                "Duplikaatit",
              ] as FilterTab[]
            ).map((tab) => {
              const active = filterTab === tab;
              const label =
                tab === "Ensisijainen hakukohde"
                  ? "Ensisijaiset"
                  : tab === "Avoinna"
                  ? "Vahv. avoimet"
                  : tab === "Duplikaatit" && duplicateIds.size > 0
                  ? `Duplikaatit (${duplicateIds.size})`
                  : tab;
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilterTab(tab)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {duplicateIds.size > 0 && filterTab !== "Duplikaatit" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
            <span>
              Havaittu{" "}
              <strong className="font-mono tabular-nums">
                {duplicateIds.size}
              </strong>{" "}
              mahdollista duplikaattia yrityksen ja tehtävänimikkeen perusteella.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setFilterTab("Duplikaatit")}
            className="font-medium underline hover:text-amber-950 cursor-pointer"
          >
            Näytä duplikaatit
          </button>
        </div>
      )}

      {/* Empty State or Table */}
      {savedJobs.length === 0 ? (
        <section className="rounded-lg border border-slate-200 bg-white p-10 text-center space-y-3">
          <h2 className="text-base font-semibold text-slate-900">
            Ei vielä tallennettuja hakukohteita
          </h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Kun analysoit työpaikkailmoituksen ja tallennat sen, se ilmestyy
            tähän listaan seurantaa ja vertailua varten. Voit myös tuoda
            aiemman JSON-varmuuskopion.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={onGoToAnalyze}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer"
            >
              Analysoi ensimmäinen ilmoitus
            </button>
          </div>
        </section>
      ) : filteredJobs.length === 0 ? (
        <section className="rounded-lg border border-slate-200 bg-white p-8 text-center space-y-2">
          <p className="text-sm font-medium text-slate-900">
            Hakuehdoilla ei löytynyt hakukohteita
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setFilterTab("Kaikki");
            }}
            className="text-xs font-medium text-slate-700 underline cursor-pointer"
          >
            Tyhjennä suodattimet
          </button>
        </section>
      ) : (
        <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-3 px-3 w-12 text-center">Vertaa</th>
                  <th className="py-3 px-4">Yritys & tehtävä</th>
                  <th className="py-3 px-4">Soveltuvuus</th>
                  <th className="py-3 px-4">Hakutilanne</th>
                  <th className="py-3 px-4">Kyberlinkki</th>
                  <th className="py-3 px-4">Hakuaika / Pvm</th>
                  <th className="py-3 px-4">Oma tila</th>
                  <th className="py-3 px-4 text-right">Toiminnot</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredJobs.map((job) => {
                  const isChecked = selectedForCompare.includes(job.id);
                  const isDup = duplicateIds.has(job.id);
                  const availability = job.availabilityStatus ?? "Ei tarkistettu";
                  return (
                    <tr
                      key={job.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Valitse ${job.analysis.extracted.position} vertailuun`}
                          checked={isChecked}
                          onChange={() => onToggleCompare(job.id)}
                          disabled={!isChecked && selectedForCompare.length >= 4}
                          className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => onSelectActiveJob(job.id)}
                          className="text-left group cursor-pointer"
                        >
                          <p className="font-medium text-slate-900 group-hover:underline">
                            {job.analysis.extracted.position}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {job.analysis.extracted.company}
                            <span aria-hidden="true" className="mx-1.5">
                              ·
                            </span>
                            {job.analysis.extracted.location}
                            {isDup && (
                              <>
                                <span aria-hidden="true" className="mx-1.5">
                                  ·
                                </span>
                                <span className="text-amber-700 font-medium">
                                  Mahdollinen duplikaatti
                                </span>
                              </>
                            )}
                          </p>
                        </button>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-xs">
                        <span
                          className={recommendationTextColor(
                            job.analysis.recommendation.category
                          )}
                        >
                          {job.analysis.recommendation.category}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-xs">
                        <span
                          className={
                            availability === "Avoinna"
                              ? "text-emerald-800 font-medium"
                              : availability === "Päättynyt"
                              ? "text-red-700 font-medium"
                              : "text-amber-800"
                          }
                        >
                          {formatAvailabilityLabel(availability)}
                        </span>
                        {job.availabilityVerifiedAt && (
                          <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                            {job.availabilityVerifiedAt}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                        {job.analysis.cybersecurityEvaluation.relevanceLevel}
                        <span
                          aria-hidden="true"
                          className="mx-1.5 text-slate-400"
                        >
                          /
                        </span>
                        {job.analysis.cybersecurityEvaluation.progressionPath}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        <div className="font-mono tabular-nums">
                          {job.targetDate || "—"}
                        </div>
                        <div className="text-slate-400 truncate max-w-[160px]">
                          DL: {job.analysis.extracted.deadline}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          aria-label={`Tila kohteelle ${job.analysis.extracted.position}`}
                          value={job.status}
                          onChange={(e) =>
                            onUpdateJobMeta(job.id, {
                              status: e.target.value as SavedJobStatus,
                            })
                          }
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-slate-900 focus:outline-none"
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onSelectActiveJob(job.id)}
                            className="text-xs font-medium text-slate-700 hover:text-slate-900 underline cursor-pointer"
                          >
                            Avaa
                          </button>
                          {pendingDeleteId === job.id ? (
                            <span className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteJob(job.id);
                                  setPendingDeleteId(null);
                                }}
                                className="text-xs font-medium text-red-700 hover:text-red-900 underline cursor-pointer"
                              >
                                Vahvista
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDeleteId(null)}
                                className="text-xs text-slate-500 hover:text-slate-700 cursor-pointer"
                              >
                                Peru
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPendingDeleteId(job.id)}
                              title="Poista hakukohde"
                              className="p-1 text-slate-400 hover:text-red-700 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
