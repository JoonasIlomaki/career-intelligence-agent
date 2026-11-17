import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookmarkPlus,
  Check,
  Globe,
  Info,
  Loader2,
  OctagonX,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type {
  ApplicationAvailabilityStatus,
  CandidateProfile,
  FetchedJobResult,
  JobAnalysisResult,
  SavedJobEntry,
  SavedJobStatus,
} from "../types/career.ts";
import { AnalysisRequestCoordinator } from "../lib/analysisRunner.ts";
import { findPotentialDuplicates } from "../lib/duplicates.ts";
import { formatSavedJobTimestamp } from "../lib/timestamps.ts";
import { AnalysisResultView } from "./AnalysisResultView.tsx";
import {
  type FormattedDiscoveryTransfer,
  shouldConfirmDiscoveryTransfer,
} from "../lib/discoveryHandoff.ts";

interface AnalyzeViewProps {
  profile: CandidateProfile;
  savedJobs: SavedJobEntry[];
  onSaveNewJob: (entry: SavedJobEntry) => void;
  onUpdateExistingJob: (id: string, analysis: JobAnalysisResult, rawJobText: string, jobUrl: string) => void;
  onInspectSavedJob: (entry: SavedJobEntry) => void;
  pendingDiscoveryTransfer?: FormattedDiscoveryTransfer | null;
  onConsumeDiscoveryTransfer?: (transferId: string) => void;
}

const SAMPLE_JOB_TEXT = `Haemme Kyberturvallisuusharjoittelijaa (IAM / GRC Trainee) – Espoo / hybridi

Tietoturvatiimimme kasvaa ja etsimme loppuvaiheen AMK- tai yliopisto-opiskelijaa palkalliseen harjoitteluun (6 kk, aloitus sopimuksen mukaan alkuvuodesta).

Tehtäväsi:
- Osallistut käyttöoikeuksien hallinnan (IAM) prosessien dokumentointiin ja tarkastuksiin.
- Tuet tietoturvan hallintajärjestelmän (ISO 27001 / GRC) ylläpitoa ja sisäisiä raportointeja.
- Seuraat lokitietoja ja osallistut tietoturvapoikkeamien ensiselvitykseen tiimin tukena.

Odotamme sinulta:
- Soveltuvia korkeakouluopintoja (esim. tietojenkäsittely tai kyberturvallisuus).
- Tietoturvan perusteiden ja verkkojen toiminnan ymmärrystä.
- Huolellisuutta, hyvää dokumentointikykyä suomeksi ja englanniksi sekä oma-aloitteisuutta.

Eduksi katsomme:
- Kokemuksen lokianalyysityökaluista (esim. Splunk) tai SQL:n/Pythonin perusteista.
- Aiemman työkokemuksen vastuullisista asiakaspalvelu- tai operatiivisista tehtävistä.

Hakuaika päättyy 30.11.2026.`;

export function AnalyzeView({
  profile,
  savedJobs,
  onSaveNewJob,
  onUpdateExistingJob,
  onInspectSavedJob,
  pendingDiscoveryTransfer = null,
  onConsumeDiscoveryTransfer,
}: AnalyzeViewProps) {
  const [jobText, setJobText] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cancelledMessage, setCancelledMessage] = useState<string | null>(null);
  const [result, setResult] = useState<JobAnalysisResult | null>(null);

  const [isFetchingJob, setIsFetchingJob] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchResult, setFetchResult] = useState<FetchedJobResult | null>(null);
  const [deadlineConflictAcknowledged, setDeadlineConflictAcknowledged] =
    useState(false);
  const [pendingOverwriteUrl, setPendingOverwriteUrl] = useState<string | null>(
    null
  );
  const [activeTransferBanner, setActiveTransferBanner] =
    useState<FormattedDiscoveryTransfer | null>(null);
  const [queuedDiscoveryTransfer, setQueuedDiscoveryTransfer] =
    useState<FormattedDiscoveryTransfer | null>(null);

  const coordinatorRef = useRef(
    new AnalysisRequestCoordinator<JobAnalysisResult>()
  );
  const fetchAbortRef = useRef<AbortController | null>(null);
  const handledTransferIdRef = useRef<string | null>(null);

  useEffect(() => {
    const coordinator = coordinatorRef.current;
    return () => {
      coordinator.cancel();
      fetchAbortRef.current?.abort();
    };
  }, []);

  const [saveStatus, setSaveStatus] = useState<SavedJobStatus>("Tallennettu");
  const [availabilityStatus, setAvailabilityStatus] =
    useState<ApplicationAvailabilityStatus>("Ei tarkistettu");
  const [availabilityVerifiedAt, setAvailabilityVerifiedAt] = useState("");
  const [availabilitySourceUrl, setAvailabilitySourceUrl] = useState("");
  const [saveNotes, setSaveNotes] = useState("");
  const [targetDate, setTargetDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [savedSuccessId, setSavedSuccessId] = useState<string | null>(null);

  function applyDiscoveryTransfer(
    transfer: FormattedDiscoveryTransfer,
    forceCancelRunning: boolean
  ) {
    if (forceCancelRunning) {
      coordinatorRef.current.cancel();
      fetchAbortRef.current?.abort();
      fetchAbortRef.current = null;
      setIsLoading(false);
      setIsFetchingJob(false);
    }

    setJobText(transfer.text);
    setJobUrl(transfer.url);
    setResult(null);
    setErrorMessage(null);
    setCancelledMessage(null);
    setFetchError(null);
    setFetchResult(null);
    setDeadlineConflictAcknowledged(false);
    setPendingOverwriteUrl(null);
    setSavedSuccessId(null);
    setSaveNotes("");
    setAvailabilityStatus("Ei tarkistettu");
    setAvailabilityVerifiedAt("");
    setAvailabilitySourceUrl(transfer.url);
    setActiveTransferBanner(transfer);
    setQueuedDiscoveryTransfer(null);
  }

  useEffect(() => {
    if (!pendingDiscoveryTransfer) return;
    if (handledTransferIdRef.current === pendingDiscoveryTransfer.transferId) {
      return;
    }
    handledTransferIdRef.current = pendingDiscoveryTransfer.transferId;

    const needsConfirm = shouldConfirmDiscoveryTransfer({
      isLoading: isLoading || coordinatorRef.current.isRunning(),
      isFetchingJob,
      jobText,
      hasResult: result !== null,
    });

    if (needsConfirm) {
      setQueuedDiscoveryTransfer(pendingDiscoveryTransfer);
    } else {
      applyDiscoveryTransfer(pendingDiscoveryTransfer, false);
    }

    onConsumeDiscoveryTransfer?.(pendingDiscoveryTransfer.transferId);
  }, [
    pendingDiscoveryTransfer,
    isLoading,
    isFetchingJob,
    jobText,
    result,
    onConsumeDiscoveryTransfer,
  ]);

  function handleCancelAnalysis() {
    const didCancel = coordinatorRef.current.cancel();
    if (didCancel) {
      setIsLoading(false);
      setErrorMessage(null);
      setCancelledMessage("Analyysi keskeytetty");
    }
  }

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    if (coordinatorRef.current.isRunning() || isLoading) {
      return;
    }

    setErrorMessage(null);
    setCancelledMessage(null);
    setSavedSuccessId(null);
    setPendingOverwriteUrl(null);

    const hasUnresolvedConflictHeader =
      Boolean(fetchResult?.deadlineInfo?.hasConflict) &&
      /Hakuaika\s*\(RISTIRIITAINEN/i.test(jobText);

    if (hasUnresolvedConflictHeader && !deadlineConflictAcknowledged) {
      setErrorMessage(
        "Hakuaika on ristiriitainen. Tarkista tai korjaa poimittu hakuaika yllä olevaan tekstikenttään tai kuittaa ristiriitavaroitus ennen analyysin käynnistämistä."
      );
      return;
    }

    if (jobText.trim().length < 40) {
      setErrorMessage(
        "Liitä vähintään 40 merkkiä työpaikkailmoituksen tekstiä ennen analysointia."
      );
      return;
    }

    const requestJobUrl = jobUrl.trim();
    const requestJobText = jobText.trim();

    setIsLoading(true);
    try {
      const outcome = await coordinatorRef.current.run(async (signal) => {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobText: requestJobText,
            jobUrl: requestJobUrl,
            profile,
          }),
          signal,
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(
            payload?.error || "Ilmoituksen analysointi epäonnistui."
          );
        }

        return payload.analysis as JobAnalysisResult;
      });

      if (outcome.status !== "completed") {
        return;
      }

      setResult(outcome.data);
      const recommended = outcome.data.recommendation.category;
      setSaveStatus(
        recommended === "Jätä väliin" ? "Ohitettu" : "Tallennettu"
      );
      setAvailabilityStatus("Ei tarkistettu");
      setAvailabilityVerifiedAt("");
      setAvailabilitySourceUrl(requestJobUrl);
      setIsLoading(false);
    } catch (err) {
      if (!coordinatorRef.current.isRunning()) {
        setIsLoading(false);
      }
      const msg =
        err instanceof Error
          ? err.message
          : "Verkkovirhe analysoinnin aikana.";
      setErrorMessage(msg);
    }
  }

  async function executeFetchJobUrl(targetUrl: string) {
    if (isFetchingJob || isLoading) return;

    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    setIsFetchingJob(true);
    setFetchError(null);
    setFetchResult(null);
    setDeadlineConflictAcknowledged(false);
    setPendingOverwriteUrl(null);

    try {
      const response = await fetch("/api/fetch-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
        signal: controller.signal,
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload?.error ||
            "Ilmoituksen sisällön nouto epäonnistui. Liitä ilmoitusteksti käsin."
        );
      }

      const fetched = payload as FetchedJobResult;
      setJobText(fetched.extractedText);
      setJobUrl(fetched.sourceUrl);
      setFetchResult(fetched);
      setDeadlineConflictAcknowledged(false);
      setErrorMessage(null);
      setCancelledMessage(null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setFetchError(
        err instanceof Error
          ? err.message
          : "Ilmoituksen nouto epäonnistui. Voit liittää ilmoitustekstin käsin."
      );
    } finally {
      if (fetchAbortRef.current === controller) {
        fetchAbortRef.current = null;
      }
      setIsFetchingJob(false);
    }
  }

  function handleRequestFetchJob() {
    if (isFetchingJob || isLoading) return;
    const trimmedUrl = jobUrl.trim();
    if (!trimmedUrl) {
      setFetchError("Anna ensin työpaikkailmoituksen HTTPS-osoite.");
      return;
    }

    setFetchError(null);
    if (jobText.trim().length > 0) {
      setPendingOverwriteUrl(trimmedUrl);
      return;
    }

    void executeFetchJobUrl(trimmedUrl);
  }

  function handleReset() {
    if (coordinatorRef.current.isRunning() || isFetchingJob) {
      return;
    }
    setJobText("");
    setJobUrl("");
    setResult(null);
    setErrorMessage(null);
    setCancelledMessage(null);
    setFetchError(null);
    setFetchResult(null);
    setDeadlineConflictAcknowledged(false);
    setPendingOverwriteUrl(null);
    setActiveTransferBanner(null);
    setQueuedDiscoveryTransfer(null);
    setSavedSuccessId(null);
    setSaveNotes("");
    setAvailabilityStatus("Ei tarkistettu");
    setAvailabilityVerifiedAt("");
    setAvailabilitySourceUrl("");
  }

  function handleAvailabilityChange(next: ApplicationAvailabilityStatus) {
    setAvailabilityStatus(next);
    if (next === "Ei tarkistettu") {
      setAvailabilityVerifiedAt("");
    } else if (!availabilityVerifiedAt) {
      setAvailabilityVerifiedAt(new Date().toISOString().slice(0, 10));
    }
  }

  function handleSaveNew() {
    if (!result) return;
    const now = new Date().toISOString();
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `job-${Date.now()}`;

    const newEntry: SavedJobEntry = {
      id,
      createdAt: now,
      updatedAt: now,
      jobUrl: jobUrl.trim(),
      rawJobText: jobText.trim(),
      status: saveStatus,
      availabilityStatus,
      availabilityVerifiedAt:
        availabilityStatus === "Ei tarkistettu" ? "" : availabilityVerifiedAt,
      availabilitySourceUrl: availabilitySourceUrl.trim() || jobUrl.trim(),
      notes: saveNotes.trim(),
      targetDate,
      analysis: result,
    };

    onSaveNewJob(newEntry);
    setSavedSuccessId(id);
  }

  const duplicates = result
    ? findPotentialDuplicates(
        savedJobs,
        result.extracted.company,
        result.extracted.position,
        jobUrl
      )
    : [];

  return (
    <div className="space-y-8">
      {/* Input Form */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Analysoi työpaikka- tai harjoitteluilmoitus
            </h1>
            <p className="text-sm text-slate-600 mt-0.5">
              Liitä ilmoituksen teksti sellaisenaan. Analyysi käyttää muokattavaa
              hakijaprofiiliasi eikä keksi puuttuvia tietoja.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setJobText(SAMPLE_JOB_TEXT);
              setErrorMessage(null);
            }}
            className="text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-200 rounded-md px-3 py-1.5 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Täytä esimerkkiteksti
          </button>
        </div>

        {queuedDiscoveryTransfer && (
          <div
            role="alertdialog"
            aria-label="Vahvista työpaikkahaun ilmoituksen tuonti"
            className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">
                  Analyysinäkymässä on jo syötettyä sisältöä, tulos tai
                  keskeneräinen toiminto.
                </p>
                <p className="text-xs text-amber-900 mt-0.5">
                  Haluatko korvata nykyisen näkymän työpaikkahausta valitulla
                  ilmoituksella:{" "}
                  <span className="font-semibold">
                    {queuedDiscoveryTransfer.title} ({queuedDiscoveryTransfer.company})
                  </span>
                  ?
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  applyDiscoveryTransfer(queuedDiscoveryTransfer, true)
                }
                className="px-3 py-1.5 text-xs font-medium text-white bg-amber-800 rounded-md hover:bg-amber-900 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Korvaa ja tuo löydetty ilmoitus
              </button>
              <button
                type="button"
                onClick={() => setQueuedDiscoveryTransfer(null)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Säilytä nykyinen työ
              </button>
            </div>
          </div>
        )}

        {activeTransferBanner && (
          <div
            role="status"
            className={`mt-4 rounded-md border p-3.5 text-xs space-y-1.5 ${
              activeTransferBanner.warnings.length > 0
                ? "border-amber-300 bg-amber-50 text-amber-950"
                : "border-emerald-200 bg-emerald-50 text-emerald-950"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">
                Tuotu työpaikkahausta: {activeTransferBanner.title} (
                {activeTransferBanner.company})
              </p>
              <button
                type="button"
                onClick={() => setActiveTransferBanner(null)}
                className="text-[11px] underline opacity-80 hover:opacity-100 cursor-pointer"
              >
                Piilota ilmoitus
              </button>
            </div>
            <p>
              Tarkista ja tarvittaessa muokkaa ilmoitustekstiä alla ennen kuin
              käynnistät Gemini-analyysin painamalla &quot;Analysoi ilmoitus&quot;.
            </p>
            {activeTransferBanner.warnings.map((w, idx) => (
              <p key={idx} className="font-medium text-amber-900">
                {w}
              </p>
            ))}
          </div>
        )}

        <form onSubmit={handleAnalyze} className="mt-5 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="job-text-input"
                className="text-sm font-medium text-slate-800"
              >
                Ilmoituksen teksti
              </label>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {jobText.length.toLocaleString("fi-FI")} / 30 000 merkkiä
              </span>
            </div>
            <textarea
              id="job-text-input"
              value={jobText}
              onChange={(e) => setJobText(e.target.value)}
              placeholder="Liitä työpaikka- tai harjoitteluilmoituksen koko teksti tähän..."
              rows={10}
              className="w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>

          <div>
            <label
              htmlFor="job-url-input"
              className="block text-sm font-medium text-slate-800 mb-1.5"
            >
              Ilmoituksen URL-osoite (valinnainen)
            </label>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                id="job-url-input"
                type="url"
                value={jobUrl}
                onChange={(e) => {
                  setJobUrl(e.target.value);
                  setFetchError(null);
                  setPendingOverwriteUrl(null);
                }}
                placeholder="https://duunitori.fi/tyopaikat/tyo/..."
                className="flex-1 min-w-0 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
              <button
                type="button"
                onClick={handleRequestFetchJob}
                disabled={isFetchingJob || isLoading || jobUrl.trim().length === 0}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isFetchingJob ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-slate-700" />
                    Haetaan ilmoitusta...
                  </>
                ) : (
                  <>
                    <Globe className="h-4 w-4 text-slate-700" />
                    Hae ilmoituksen sisältö
                  </>
                )}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Tuettu ensimmäisessä versiossa (HTTPS):{" "}
              <span className="font-mono text-slate-600">
                valtiolle.fi, jobly.fi, duunitori.fi, ats.talentadore.com
              </span>
              . Sisältö tuodaan yllä olevaan tekstikenttään tarkistettavaksi;
              haku ei todista työpaikan olevan avoinna. Voit aina liittää tekstin
              myös käsin.
            </p>
          </div>

          {pendingOverwriteUrl && (
            <div
              role="alertdialog"
              aria-label="Vahvista ilmoitustekstin korvaaminen"
              className="rounded-md border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">
                    Tekstikentässä on jo ilmoitustekstiä.
                  </p>
                  <p className="text-xs text-amber-900 mt-0.5">
                    Korvataanko nykyinen sisältö osoitteesta haettavalla tekstillä?
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void executeFetchJobUrl(pendingOverwriteUrl)}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-amber-800 rounded-md hover:bg-amber-900 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Korvaa nykyinen teksti
                </button>
                <button
                  type="button"
                  onClick={() => setPendingOverwriteUrl(null)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Peruuta
                </button>
              </div>
            </div>
          )}

          {fetchError && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3.5 text-sm text-red-900 flex items-start gap-2.5"
            >
              <AlertCircle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium">Ilmoituksen nouto URL-osoitteesta epäonnistui</p>
                <p className="text-xs text-red-800 mt-0.5">{fetchError}</p>
              </div>
            </div>
          )}

          {fetchResult && (() => {
            const deadlineInfo = fetchResult.deadlineInfo;
            const hasConflict = Boolean(deadlineInfo?.hasConflict);
            const hasUnresolvedConflictHeader =
              hasConflict && /Hakuaika\s*\(RISTIRIITAINEN/i.test(jobText);
            const isHealthyComplete =
              fetchResult.coverageStatus === "complete" &&
              fetchResult.confidence === "high" &&
              !hasConflict &&
              !fetchResult.warning;

            return (
              <div
                role="status"
                className={`rounded-md border p-3.5 text-sm flex items-start gap-2.5 ${
                  isHealthyComplete
                    ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                    : "border-amber-300 bg-amber-50 text-amber-950"
                }`}
              >
                {isHealthyComplete ? (
                  <Check className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {hasConflict
                        ? "Ilmoitusteksti haettu — hakuaika ristiriitainen"
                        : fetchResult.coverageStatus === "partial"
                        ? "Verkkonouto onnistui — osittainen ilmoitussisältö (partial)"
                        : fetchResult.coverageStatus === "uncertain"
                        ? "Verkkonouto onnistui — sisällön kattavuus epävarma"
                        : "Ilmoitusteksti haettu tarkistettavaksi"}
                      {fetchResult.title ? `: ${fetchResult.title}` : ""}
                      {fetchResult.company ? ` (${fetchResult.company})` : ""}
                    </p>
                    <span className="font-mono text-xs tabular-nums opacity-80">
                      {fetchResult.fetchMethod === "jsonld_and_html"
                        ? "schema.org + HTML"
                        : fetchResult.fetchMethod === "schema_org_jsonld"
                        ? "schema.org/JobPosting"
                        : "HTML-sisältöpoiminta"}{" "}
                      · {formatSavedJobTimestamp(fetchResult.fetchedAt)}
                    </span>
                  </div>

                  {hasConflict && deadlineInfo && (
                    <div
                      role="alert"
                      className="rounded-md border border-amber-400 bg-white/80 p-3 text-xs text-amber-950 space-y-2"
                    >
                      <p className="font-semibold text-amber-950">
                        {deadlineInfo.conflictWarning ??
                          "Hakuaika on ristiriitainen. Tarkista oikea määräaika työnantajan alkuperäisestä ilmoituksesta."}
                      </p>
                      <ul className="space-y-1 text-amber-900 list-disc pl-4">
                        {deadlineInfo.structuredDeadline && (
                          <li>
                            <span className="font-medium">
                              Rakenteinen lähde ({deadlineInfo.structuredDeadline.sourceLabel}):
                            </span>{" "}
                            <span className="font-mono">
                              {deadlineInfo.structuredDeadline.value}
                            </span>
                            {deadlineInfo.structuredDeadline.rawValue !==
                              deadlineInfo.structuredDeadline.value && (
                              <span className="opacity-75">
                                {" "}
                                ({deadlineInfo.structuredDeadline.rawValue})
                              </span>
                            )}
                          </li>
                        )}
                        {deadlineInfo.bodyDeadline && (
                          <li>
                            <span className="font-medium">
                              {deadlineInfo.bodyDeadline.sourceLabel}:
                            </span>{" "}
                            <span className="font-mono">
                              {deadlineInfo.bodyDeadline.value}
                            </span>
                            {deadlineInfo.bodyDeadline.excerpt && (
                              <span className="block text-[11px] opacity-85 mt-0.5">
                                &ldquo;{deadlineInfo.bodyDeadline.excerpt}&rdquo;
                              </span>
                            )}
                          </li>
                        )}
                      </ul>
                      <p className="text-[11px] text-amber-900">
                        Hakuaikaa ei ole merkitty vahvistetuksi eikä sen perusteella päätellä haun olevan avoinna. Voit muokata poimittua tekstiä yllä olevassa kentässä ennen analysointia.
                      </p>
                      {hasUnresolvedConflictHeader ? (
                        <label
                          htmlFor="deadline-conflict-ack"
                          className="flex items-start gap-2 pt-1 cursor-pointer select-none font-medium text-amber-950"
                        >
                          <input
                            id="deadline-conflict-ack"
                            type="checkbox"
                            checked={deadlineConflictAcknowledged}
                            onChange={(e) => {
                              setDeadlineConflictAcknowledged(e.target.checked);
                              if (e.target.checked) {
                                setErrorMessage(null);
                              }
                            }}
                            className="mt-0.5 h-3.5 w-3.5 rounded border-amber-500 text-amber-900 focus:ring-amber-700"
                          />
                          <span>
                            Olen huomioinut ristiriitaisen hakuajan ennen analyysiä (lähteiden ero säilytetään analyysissä).
                          </span>
                        </label>
                      ) : (
                        <p className="text-[11px] font-medium text-emerald-900">
                          Poimittua tekstiä on muokattu; voit käynnistää analyysin tarkistamallasi tekstillä.
                        </p>
                      )}
                    </div>
                  )}

                  {fetchResult.warning && !hasConflict ? (
                    <p className="text-xs font-medium text-amber-900">
                      {fetchResult.warning}
                    </p>
                  ) : !hasConflict ? (
                    <p className="text-xs text-emerald-900">
                      Tarkista teksti yllä olevassa kentässä ja käynnistä analyysi
                      painamalla &quot;Analysoi ilmoitus&quot;.
                    </p>
                  ) : null}

                  {fetchResult.coverageSummary && (
                    <p className="text-xs opacity-85">
                      {fetchResult.coverageSummary}
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
            {(jobText || jobUrl || result) && (
              <button
                type="button"
                onClick={handleReset}
                disabled={isLoading || isFetchingJob}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                Tyhjennä
              </button>
            )}

            {isLoading ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span
                  role="status"
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-md whitespace-nowrap shrink-0"
                >
                  <Loader2 className="h-4 w-4 animate-spin text-slate-700" />
                  Analysoidaan...
                </span>
                <button
                  type="button"
                  onClick={handleCancelAnalysis}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-800 bg-red-50 border border-red-300 rounded-md hover:bg-red-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <OctagonX className="h-3.5 w-3.5 shrink-0" />
                  Keskeytä
                </button>
              </div>
            ) : (
              <button
                type="submit"
                disabled={isFetchingJob || jobText.trim().length === 0}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles className="h-4 w-4" />
                Analysoi ilmoitus
              </button>
            )}
          </div>
        </form>

        {cancelledMessage && (
          <div
            role="status"
            className="mt-4 rounded-md border border-slate-300 bg-slate-50 p-3.5 text-sm text-slate-800 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5">
              <Info className="h-4 w-4 text-slate-600 shrink-0" />
              <span className="font-medium">{cancelledMessage}</span>
            </div>
            <span className="text-xs text-slate-500">
              Syötetty ilmoitusteksti ja asetukset säilytettiin.
            </span>
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 p-3.5 text-sm text-red-900 flex items-start gap-2.5"
          >
            <AlertCircle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium">Analyysi epäonnistui</p>
              <p className="text-xs text-red-800 mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}
      </section>

      {/* Loading Skeleton */}
      {isLoading && (
        <section
          aria-busy="true"
          className="rounded-lg border border-slate-200 bg-white p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
              <Loader2 className="h-4 w-4 animate-spin text-slate-700" />
              <span>Analysoidaan ilmoitusta hakijaprofiilia vasten...</span>
            </div>
            <button
              type="button"
              onClick={handleCancelAnalysis}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-800 bg-red-50 border border-red-300 rounded-md hover:bg-red-100 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <OctagonX className="h-3.5 w-3.5 shrink-0" />
              Keskeytä
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-pulse">
            <div className="h-14 bg-slate-100 rounded" />
            <div className="h-14 bg-slate-100 rounded" />
            <div className="h-14 bg-slate-100 rounded" />
            <div className="h-14 bg-slate-100 rounded" />
          </div>
          <div className="h-28 bg-slate-100 rounded animate-pulse" />
        </section>
      )}

      {/* Results & Save Bar */}
      {!isLoading && result && (
        <div className="space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 flex-1">
                <div>
                  <label
                    htmlFor="save-status-select"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Oma seurantatila
                  </label>
                  <select
                    id="save-status-select"
                    value={saveStatus}
                    onChange={(e) =>
                      setSaveStatus(e.target.value as SavedJobStatus)
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  >
                    <option value="Tallennettu">Tallennettu</option>
                    <option value="Harkinnassa">Harkinnassa</option>
                    <option value="Haettu">Haettu</option>
                    <option value="Haastattelussa">Haastattelussa</option>
                    <option value="Hylätty">Hylätty</option>
                    <option value="Ohitettu">Ohitettu</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="save-date-input"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Tallennuspäivä
                  </label>
                  <input
                    id="save-date-input"
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono tabular-nums text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="save-notes-input"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Omat muistiinpanot
                  </label>
                  <input
                    id="save-notes-input"
                    type="text"
                    value={saveNotes}
                    onChange={(e) => setSaveNotes(e.target.value)}
                    placeholder="Esim. yhteyshenkilö, kysyttävät asiat..."
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                {duplicates.length > 0 && !savedSuccessId && (
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateExistingJob(
                        duplicates[0].entry.id,
                        result,
                        jobText.trim(),
                        jobUrl.trim()
                      );
                      setSavedSuccessId(duplicates[0].entry.id);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-amber-900 bg-amber-50 border border-amber-300 rounded-md hover:bg-amber-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Päivitä olemassa oleva
                  </button>
                )}

                {savedSuccessId ? (
                  <span className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md whitespace-nowrap shrink-0">
                    <Check className="h-4 w-4" />
                    Tallennettu hakukohteisiin
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleSaveNew}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <BookmarkPlus className="h-4 w-4" />
                    {duplicates.length > 0
                      ? "Tallenna silti uutena"
                      : "Tallenna hakukohteisiin"}
                  </button>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="analyze-availability-select"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  Haun voimassaolo (manuaalinen tarkistus)
                </label>
                <select
                  id="analyze-availability-select"
                  value={availabilityStatus}
                  onChange={(e) =>
                    handleAvailabilityChange(
                      e.target.value as ApplicationAvailabilityStatus
                    )
                  }
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  <option value="Ei tarkistettu">Ei tarkistettu</option>
                  <option value="Avoinna">Avoinna (vahvistettu)</option>
                  <option value="Päättynyt">Päättynyt (vahvistettu)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="analyze-verified-date"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  Tarkistuspäivämäärä
                </label>
                <input
                  id="analyze-verified-date"
                  type="date"
                  value={availabilityVerifiedAt}
                  disabled={availabilityStatus === "Ei tarkistettu"}
                  onChange={(e) => setAvailabilityVerifiedAt(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono tabular-nums text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>

              <div>
                <label
                  htmlFor="analyze-source-url"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  Tarkistuksen lähde-URL
                </label>
                <input
                  id="analyze-source-url"
                  type="url"
                  value={availabilitySourceUrl}
                  onChange={(e) => setAvailabilitySourceUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>
          </section>

          <AnalysisResultView
            analysis={result}
            jobUrl={jobUrl}
            availabilityStatus={availabilityStatus}
            availabilityVerifiedAt={availabilityVerifiedAt}
            availabilitySourceUrl={availabilitySourceUrl}
            duplicates={savedSuccessId ? [] : duplicates}
            onInspectExisting={onInspectSavedJob}
          />
        </div>
      )}
    </div>
  );
}
