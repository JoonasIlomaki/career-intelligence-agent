import { useCallback, useEffect, useState } from "react";
import {
  BookmarkCheck,
  Columns2,
  Compass,
  FileSearch,
  Menu,
  UserCheck,
  X,
} from "lucide-react";
import type {
  CandidateProfile,
  CareerBackupPayload,
  DiscoveredJob,
  JobAnalysisResult,
  SavedJobEntry,
} from "./types/career.ts";
import {
  loadCandidateProfile,
  loadSavedJobs,
  resetCandidateProfile,
  saveCandidateProfile,
  saveSavedJobs,
} from "./lib/storage.ts";
import {
  applySavedJobMetaPatch,
  type SavedJobMetaPatch,
} from "./lib/timestamps.ts";
import {
  formatDiscoveredJobForAnalysis,
  type FormattedDiscoveryTransfer,
} from "./lib/discoveryHandoff.ts";
import { AnalyzeView } from "./components/AnalyzeView.tsx";
import { DiscoverJobsView } from "./components/DiscoverJobsView.tsx";
import { SavedJobsView } from "./components/SavedJobsView.tsx";
import { CompareView } from "./components/CompareView.tsx";
import { ProfileView } from "./components/ProfileView.tsx";

type ActiveTab = "analyze" | "discover" | "saved" | "compare" | "profile";

const TAB_LABELS: Record<ActiveTab, string> = {
  analyze: "Analysoi ilmoitus",
  discover: "Löydä työpaikkoja",
  saved: "Hakukohteet",
  compare: "Vertailu",
  profile: "Hakijaprofiili",
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("analyze");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [profile, setProfile] = useState<CandidateProfile>(() =>
    loadCandidateProfile()
  );
  const [savedJobs, setSavedJobs] = useState<SavedJobEntry[]>(() =>
    loadSavedJobs()
  );
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [pendingDiscoveryTransfer, setPendingDiscoveryTransfer] =
    useState<FormattedDiscoveryTransfer | null>(null);

  useEffect(() => {
    saveSavedJobs(savedJobs);
  }, [savedJobs]);

  function handleSaveProfile(updated: CandidateProfile) {
    saveCandidateProfile(updated);
    setProfile(loadCandidateProfile());
  }

  function handleResetProfile(): CandidateProfile {
    const fresh = resetCandidateProfile();
    setProfile(fresh);
    return fresh;
  }

  function handleSaveNewJob(entry: SavedJobEntry) {
    setSavedJobs((prev) => [entry, ...prev]);
  }

  function handleUpdateExistingJob(
    id: string,
    analysis: JobAnalysisResult,
    rawJobText: string,
    jobUrl: string
  ) {
    const now = new Date().toISOString();
    setSavedJobs((prev) =>
      prev.map((job) =>
        job.id === id
          ? {
              ...job,
              createdAt: job.createdAt,
              updatedAt: now,
              rawJobText,
              jobUrl,
              analysis,
            }
          : job
      )
    );
  }

  function handleUpdateJobMeta(id: string, patch: SavedJobMetaPatch) {
    const now = new Date().toISOString();
    setSavedJobs((prev) =>
      prev.map((job) =>
        job.id === id ? applySavedJobMetaPatch(job, patch, now) : job
      )
    );
  }

  function handleDeleteJob(id: string) {
    setSavedJobs((prev) => prev.filter((job) => job.id !== id));
    setSelectedForCompare((prev) => prev.filter((itemId) => itemId !== id));
    if (activeJobId === id) {
      setActiveJobId(null);
    }
  }

  function handleToggleCompare(id: string) {
    setSelectedForCompare((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  }

  function handleImportBackup(
    payload: CareerBackupPayload,
    mode: "merge" | "replace"
  ) {
    if (mode === "replace") {
      saveCandidateProfile(payload.profile);
      setProfile(loadCandidateProfile());
      setSavedJobs(payload.savedJobs);
      setSelectedForCompare([]);
      setActiveJobId(null);
      return;
    }

    setSavedJobs((prev) => {
      const existingIds = new Set(prev.map((j) => j.id));
      const newOnes = payload.savedJobs.filter((j) => !existingIds.has(j.id));
      return [...newOnes, ...prev];
    });
  }

  function handleInspectSavedJob(entry: SavedJobEntry) {
    setActiveJobId(entry.id);
    setActiveTab("saved");
  }

  function navigateTo(tab: ActiveTab) {
    setActiveTab(tab);
    setMobileMenuOpen(false);
    if (tab !== "saved") {
      setActiveJobId(null);
    }
  }

  function handleSelectDiscoveredJobForAnalysis(job: DiscoveredJob) {
    const formatted = formatDiscoveredJobForAnalysis(job);
    setPendingDiscoveryTransfer(formatted);
    navigateTo("analyze");
  }

  const handleConsumeDiscoveryTransfer = useCallback((transferId: string) => {
    setPendingDiscoveryTransfer((prev) =>
      prev?.transferId === transferId ? null : prev
    );
  }, []);

  const navItems: Array<{
    id: ActiveTab;
    label: string;
    icon: typeof FileSearch;
    count?: number;
  }> = [
    { id: "analyze", label: "Analysoi ilmoitus", icon: FileSearch },
    { id: "discover", label: "Löydä työpaikkoja", icon: Compass },
    {
      id: "saved",
      label: "Hakukohteet",
      icon: BookmarkCheck,
      count: savedJobs.length,
    },
    {
      id: "compare",
      label: "Vertailu",
      icon: Columns2,
      count: selectedForCompare.length > 0 ? selectedForCompare.length : undefined,
    },
    { id: "profile", label: "Hakijaprofiili", icon: UserCheck },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:shrink-0 border-r border-slate-200 bg-white">
        <div className="h-14 px-5 flex items-center border-b border-slate-200">
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Career Intelligence Agent
          </span>
        </div>

        <nav
          aria-label="Päänavigaatio"
          className="flex-1 p-3 space-y-1"
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? "bg-slate-900 text-white"
                    : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {typeof item.count === "number" && (
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      active ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 text-xs text-slate-500 space-y-1">
          <p className="font-medium text-slate-700">Paikallinen työtila</p>
          <p>
            Tiedot tallennetaan vain selaimeesi. Varmuuskopiointi JSON-muodossa
            Hakukohteet-välilehdellä.
          </p>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Avaa valikko"
              className="lg:hidden p-2 -ml-2 text-slate-700 hover:text-slate-900 cursor-pointer"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="font-display font-semibold text-slate-900 lg:hidden truncate">
                Career Intelligence Agent
              </span>
              <span className="hidden lg:inline text-slate-500 whitespace-nowrap">
                Työtila
              </span>
              <span
                aria-hidden="true"
                className="hidden lg:inline text-slate-300"
              >
                /
              </span>
              <span className="hidden lg:inline font-medium text-slate-900 whitespace-nowrap">
                {TAB_LABELS[activeTab]}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {activeTab !== "analyze" ? (
              <button
                type="button"
                onClick={() => navigateTo("analyze")}
                className="px-4 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Uusi analyysi
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigateTo("saved")}
                className="px-4 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Hakukohteet (
                <span className="font-mono tabular-nums">
                  {savedJobs.length}
                </span>
                )
              </button>
            )}
          </div>
        </header>

        {/* Mobile Nav Drawer */}
        {mobileMenuOpen && (
          <nav
            aria-label="Mobiilinavigaatio"
            className="lg:hidden border-b border-slate-200 bg-white px-4 py-3 space-y-1"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-sm font-medium cursor-pointer ${
                    active
                      ? "bg-slate-900 text-white"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </span>
                  {typeof item.count === "number" && (
                    <span className="font-mono text-xs tabular-nums">
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        )}

        {/* Viewport Container */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto">
          <div className={activeTab === "analyze" ? "block" : "hidden"}>
            <AnalyzeView
              profile={profile}
              savedJobs={savedJobs}
              onSaveNewJob={handleSaveNewJob}
              onUpdateExistingJob={handleUpdateExistingJob}
              onInspectSavedJob={handleInspectSavedJob}
              pendingDiscoveryTransfer={pendingDiscoveryTransfer}
              onConsumeDiscoveryTransfer={handleConsumeDiscoveryTransfer}
            />
          </div>

          <div className={activeTab === "discover" ? "block" : "hidden"}>
            <DiscoverJobsView
              profile={profile}
              onSelectJobForAnalysis={handleSelectDiscoveredJobForAnalysis}
              onGoToProfile={() => navigateTo("profile")}
            />
          </div>

          {activeTab === "saved" && (
            <SavedJobsView
              savedJobs={savedJobs}
              profile={profile}
              selectedForCompare={selectedForCompare}
              activeJobId={activeJobId}
              onSelectActiveJob={setActiveJobId}
              onToggleCompare={handleToggleCompare}
              onOpenCompare={() => navigateTo("compare")}
              onUpdateJobMeta={handleUpdateJobMeta}
              onDeleteJob={handleDeleteJob}
              onImportBackup={handleImportBackup}
              onGoToAnalyze={() => navigateTo("analyze")}
            />
          )}

          {activeTab === "compare" && (
            <CompareView
              savedJobs={savedJobs}
              selectedIds={selectedForCompare}
              onToggleCompare={handleToggleCompare}
              onOpenJob={(id) => {
                setActiveJobId(id);
                setActiveTab("saved");
              }}
              onGoToSavedJobs={() => navigateTo("saved")}
            />
          )}

          {activeTab === "profile" && (
            <ProfileView
              profile={profile}
              onSaveProfile={handleSaveProfile}
              onResetProfile={handleResetProfile}
            />
          )}
        </main>
      </div>
    </div>
  );
}
