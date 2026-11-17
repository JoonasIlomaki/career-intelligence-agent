import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  ExternalLink,
  Info,
  Loader2,
  OctagonX,
  RotateCcw,
} from "lucide-react";
import type {
  CandidateProfile,
  DiscoveredJob,
  DiscoverJobsResponse,
  DiscoveryLanguageCode,
  DiscoveryRemoteFilter,
  DiscoverySearchPreferences,
  DiscoverySeniorityFilter,
  DiscoveryIndustryFilter,
  DiscoverySuitabilityCategory,
} from "../types/career.ts";
import {
  DEFAULT_DISCOVERY_PREFERENCES,
  isDefaultCandidateProfile,
  loadDiscoveryPreferences,
  saveDiscoveryPreferences,
} from "../lib/storage.ts";
import {
  type DiscoverySortOption,
  isSafeExternalHttpUrl,
  sortDiscoveredJobs,
} from "../lib/discoveryHandoff.ts";
import {
  createDiscoverySearchSession,
  DISCOVERY_CANCELLED_MESSAGE,
} from "../lib/discoveryRunner.ts";

interface DiscoverJobsViewProps {
  profile: CandidateProfile;
  onSelectJobForAnalysis: (job: DiscoveredJob) => void;
  onGoToProfile: () => void;
}

const KNOWN_CURATED_SOURCES = [
  { company: "Hoxhunt", source: "Ashby" },
  { company: "Smartly", source: "Greenhouse" },
  { company: "Netlight", source: "Lever" },
];

function suitabilityBadgeStyle(category: DiscoverySuitabilityCategory): string {
  switch (category) {
    case "Erittäin kiinnostava":
      return "border-emerald-300 bg-emerald-50 text-emerald-950";
    case "Mahdollisesti sopiva":
      return "border-slate-300 bg-slate-100 text-slate-900";
    case "Vaatii lisätarkistusta":
      return "border-amber-300 bg-amber-50 text-amber-950";
    case "Heikko vastaavuus":
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function formatDateLabel(iso: string | null): string {
  if (!iso) return "Ei ilmoitettu";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Ei ilmoitettu";
  return parsed.toLocaleDateString("fi-FI", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

function remoteTypeLabel(job: DiscoveredJob): string {
  switch (job.remoteType) {
    case "remote":
      return "Etätyö";
    case "hybrid":
      return "Hybridi";
    case "onsite":
      return "Lähityö";
    default:
      return "Ei ilmoitettu";
  }
}

function sourceSystemLabel(source: DiscoveredJob["source"]): string {
  switch (source) {
    case "ashby":
      return "Ashby";
    case "greenhouse":
      return "Greenhouse";
    case "lever":
      return "Lever";
  }
}

export function DiscoverJobsView({
  profile,
  onSelectJobForAnalysis,
  onGoToProfile,
}: DiscoverJobsViewProps) {
  const [preferences, setPreferences] = useState<DiscoverySearchPreferences>(() =>
    loadDiscoveryPreferences()
  );
  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cancelledMessage, setCancelledMessage] = useState<string | null>(null);
  const [response, setResponse] = useState<DiscoverJobsResponse | null>(null);
  const [sortBy, setSortBy] = useState<DiscoverySortOption>("suitability");
  const [showWeakMatches, setShowWeakMatches] = useState(false);
  const [expandedJobIds, setExpandedJobIds] = useState<Record<string, boolean>>(
    {}
  );

  const sessionRef = useRef<ReturnType<typeof createDiscoverySearchSession> | null>(
    null
  );
  if (!sessionRef.current) {
    sessionRef.current = createDiscoverySearchSession({
      onStart: () => {
        setIsSearching(true);
        setErrorMessage(null);
        setCancelledMessage(null);
      },
      onCancel: () => {
        setIsSearching(false);
        setErrorMessage(null);
        setCancelledMessage(DISCOVERY_CANCELLED_MESSAGE);
      },
      onSuccess: (payload) => {
        setResponse(payload);
        setExpandedJobIds({});
        setIsSearching(false);
      },
      onError: (msg) => {
        setErrorMessage(msg);
        setIsSearching(false);
      },
    });
  }
  const isDefaultProfile = isDefaultCandidateProfile(profile);

  useEffect(() => {
    saveDiscoveryPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    const session = sessionRef.current;
    return () => {
      session?.cancel();
    };
  }, []);

  function updatePreferences(patch: Partial<DiscoverySearchPreferences>) {
    setPreferences((prev) => ({ ...prev, ...patch }));
  }

  function toggleLanguage(code: DiscoveryLanguageCode) {
    setPreferences((prev) => {
      const exists = prev.languages.includes(code);
      if (exists && prev.languages.length === 1) {
        return prev;
      }
      const next = exists
        ? prev.languages.filter((l) => l !== code)
        : [...prev.languages, code];
      return { ...prev, languages: next };
    });
  }

  function handleResetPreferences() {
    setPreferences({ ...DEFAULT_DISCOVERY_PREFERENCES });
  }

  function handleCancelSearch() {
    sessionRef.current?.cancel();
  }

  async function runDiscovery(overridePrefs?: DiscoverySearchPreferences) {
    const session = sessionRef.current;
    if (!session || session.isRunning() || isSearching) return;
    const activePrefs = overridePrefs ?? preferences;

    await session.execute(async (signal) => {
      const res = await fetch("/api/discover-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences: activePrefs,
          profile: activePrefs.useSavedProfile ? profile : undefined,
          isDefaultProfile: activePrefs.useSavedProfile ? isDefaultProfile : false,
        }),
        signal,
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(
          payload?.error || "Työpaikkojen haku julkisista rajapinnoista epäonnistui."
        );
      }

      return payload as DiscoverJobsResponse;
    });
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    void runDiscovery();
  }

  function toggleExpanded(id: string) {
    setExpandedJobIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const allJobs = response?.jobs ?? [];
  const weakJobsCount = allJobs.filter(
    (j) => j.suitabilityCategory === "Heikko vastaavuus"
  ).length;
  const visibleBase = showWeakMatches
    ? allJobs
    : allJobs.filter((j) => j.suitabilityCategory !== "Heikko vastaavuus");
  const sortedJobs = sortDiscoveredJobs(visibleBase, sortBy);

  const allSourcesFailed =
    response !== null &&
    response.succeededSources.length === 0 &&
    response.failedSources.length > 0;
  const zeroFetchedOverall =
    response !== null &&
    response.succeededSources.length > 0 &&
    response.totalFetchedCount === 0;
  const zeroMatchedAfterFilters =
    response !== null &&
    response.totalFetchedCount > 0 &&
    response.matchedCount === 0;
  const onlyWeakHidden =
    response !== null &&
    response.matchedCount > 0 &&
    !showWeakMatches &&
    sortedJobs.length === 0 &&
    weakJobsCount > 0;

  return (
    <div className="space-y-6">
      {/* Header & Search Preferences */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Löydä työpaikkoja julkisista rekrytointirajapinnoista
            </h1>
            <p className="text-sm text-slate-600 mt-0.5">
              Hae avoimia työpaikka- ja harjoitteluilmoituksia määriteltyjen
              työnantajien julkisista rajapinnoista. Voit siirtää lupaavat
              ilmoitukset analyysinäkymään tarkempaa arviota varten.
            </p>
          </div>
          <button
            type="button"
            onClick={handleResetPreferences}
            disabled={isSearching}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Palauta oletusasetukset
          </button>
        </div>

        {/* Registry Coverage & Privacy Notice */}
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="font-semibold text-slate-900">
              Tämän version tuetut työnantajalähteet:
            </span>{" "}
            {KNOWN_CURATED_SOURCES.map(
              (s, idx) =>
                `${idx > 0 ? ", " : ""}${s.company} (${s.source})`
            )}
            . Haku on käyttäjän käynnistämä eikä tee hakemuksia automaattisesti.
          </div>
        </div>

        <form onSubmit={handleSearchSubmit} className="mt-5 space-y-5">
          {/* Profile mode toggle */}
          <div className="rounded-md border border-slate-200 p-4 space-y-2">
            <label
              htmlFor="discovery-use-profile"
              className="flex items-start gap-2.5 cursor-pointer select-none"
            >
              <input
                id="discovery-use-profile"
                type="checkbox"
                checked={preferences.useSavedProfile}
                onChange={(e) =>
                  updatePreferences({ useSavedProfile: e.target.checked })
                }
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <div>
                <span className="text-sm font-medium text-slate-900">
                  Käytä tallennettua hakijaprofiilia alustavaan soveltuvuusarvioon
                </span>
                <p className="text-xs text-slate-600 mt-0.5">
                  Hakijaprofiilia käytetään vain paikallisesti oman palvelimen
                  suodatuksessa ja alustavassa luokittelussa — sitä ei koskaan
                  lähetetä ulkoisille rekrytointirajapinnoille.
                </p>
              </div>
            </label>

            {preferences.useSavedProfile && isDefaultProfile ? (
              <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                <span>
                  Käytössä on kuvitteellinen oletusesimerkkiprofiili (TAMK-esimerkki).
                  Voit muokata oman profiilisi vastaamaan taustaasi.
                </span>
                <button
                  type="button"
                  onClick={onGoToProfile}
                  className="font-semibold underline hover:text-amber-950 whitespace-nowrap cursor-pointer"
                >
                  Muokkaa hakijaprofiilia
                </button>
              </div>
            ) : !preferences.useSavedProfile ? (
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-3 py-2">
                Hakijaprofiili on pois käytöstä: alustavat ehdotukset perustuvat
                pelkkiin alla valittuihin hakuasetuksiin.
              </p>
            ) : null}
          </div>

          {/* Filters Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="discovery-seniority"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Kokemustaso / roolitaso
              </label>
              <select
                id="discovery-seniority"
                value={preferences.seniorityLevel}
                onChange={(e) =>
                  updatePreferences({
                    seniorityLevel: e.target.value as DiscoverySeniorityFilter,
                  })
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="intern_trainee_junior">
                  Harjoittelu, trainee ja uran alkuvaihe
                </option>
                <option value="all">Kaikki kokemustasot</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="discovery-location"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Sijaintipreferenssi
              </label>
              <input
                id="discovery-location"
                type="text"
                value={preferences.locationQuery}
                onChange={(e) =>
                  updatePreferences({ locationQuery: e.target.value })
                }
                placeholder="Esim. Uusimaa, Helsinki, Suomi"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="discovery-remote"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Työskentelymalli ja maa
              </label>
              <select
                id="discovery-remote"
                value={preferences.remotePreference}
                onChange={(e) =>
                  updatePreferences({
                    remotePreference: e.target.value as DiscoveryRemoteFilter,
                  })
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="finland_compatible">
                  Suomeen sopiva (lähityö/hybridi/Suomi-etätyö)
                </option>
                <option value="onsite_or_hybrid">
                  Vain lähityö tai hybridi
                </option>
                <option value="remote_only">Vain etätyö</option>
                <option value="any">Kaikki mallit ja sijainnit</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="discovery-industry"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Toimiala ja urapolku
              </label>
              <select
                id="discovery-industry"
                value={preferences.industryFocus}
                onChange={(e) =>
                  updatePreferences({
                    industryFocus: e.target.value as DiscoveryIndustryFilter,
                  })
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="it_cyber_and_pathways">
                  IT, kyberturvallisuus ja välilliset polut
                </option>
                <option value="all">Kaikki toimialat</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="discovery-keyword"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Avainsana (valinnainen)
              </label>
              <input
                id="discovery-keyword"
                type="text"
                value={preferences.keyword}
                onChange={(e) => updatePreferences({ keyword: e.target.value })}
                placeholder="Esim. Security, Support, Data, Linux"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-700 mb-1.5">
                Ilmoituksen kieli
              </span>
              <div className="flex items-center gap-4 h-[38px]">
                <label className="inline-flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferences.languages.includes("fi")}
                    onChange={() => toggleLanguage("fi")}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <span>Suomi</span>
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferences.languages.includes("en")}
                    onChange={() => toggleLanguage("en")}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <span>Englanti</span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
            {isSearching ? (
              <div className="flex flex-wrap items-center gap-2">
                <span
                  role="status"
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-md whitespace-nowrap shrink-0"
                >
                  <Loader2 className="h-4 w-4 animate-spin text-slate-700" />
                  Haetaan ilmoituksia...
                </span>
                <button
                  type="button"
                  onClick={handleCancelSearch}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-800 bg-red-50 border border-red-300 rounded-md hover:bg-red-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <OctagonX className="h-3.5 w-3.5 shrink-0" />
                  Keskeytä haku
                </button>
              </div>
            ) : (
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Compass className="h-4 w-4" />
                Hae työpaikkoja
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
              Hakuasetukset ja mahdolliset edelliset tulokset säilytettiin.
            </span>
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 p-3.5 text-sm text-red-900 flex items-start gap-2.5"
          >
            <AlertCircle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Työpaikkahaku epäonnistui</p>
              <p className="text-xs text-red-800 mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}
      </section>

      {/* Initial guidance before first run */}
      {!response && !isSearching && !errorMessage && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
          <p className="font-medium text-slate-900">
            Aloita haku painamalla &quot;Hae työpaikkoja&quot;
          </p>
          <p className="mt-1">
            Ensimmäisessä vaiheessa sovellus hakee ilmoitukset valituista
            julkisista rekrytointirajapinnoista ja arvioi alustavan sopivuuden
            ilman automaattista Gemini-kutsua. Varsinainen syväanalyysi
            käynnistetään vasta valitsemasi tehtävän kohdalta painamalla{" "}
            <span className="font-medium text-slate-800">
              Analysoi tarkemmin
            </span>
            .
          </p>
        </section>
      )}

      {/* Search Results & Source Breakdown */}
      {response && (
        <div className="space-y-6">
          {/* Source Status Summary */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-4 border-b border-slate-200">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">
                  Haettu yhteensä
                </p>
                <p className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
                  {response.totalFetchedCount}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">
                  Deduplikoitu
                </p>
                <p className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
                  {response.totalDeduplicatedCount}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">
                  Hakuehdot täyttää
                </p>
                <p className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
                  {response.matchedCount}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">
                  Onnistuneet lähteet
                </p>
                <p className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
                  {response.succeededSources.length} /{" "}
                  {response.queriedSources.length}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Lähteiden noutotila ({formatDateLabel(response.fetchedAt)})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {response.queriedSources.map((src) => (
                  <div
                    key={src.employerId}
                    className={`rounded-md border px-3.5 py-2.5 text-xs ${
                      src.status === "ok"
                        ? "border-slate-200 bg-slate-50 text-slate-800"
                        : "border-red-200 bg-red-50 text-red-900"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-medium">
                      <span>
                        {src.company} ({sourceSystemLabel(src.source)})
                      </span>
                      {src.status === "ok" ? (
                        <span className="inline-flex items-center gap-1 text-emerald-800 font-mono tabular-nums">
                          <Check className="h-3.5 w-3.5" />
                          OK · {src.fetchedCount} / {src.matchedCount} osumaa
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-800 font-mono">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Virhe ({src.errorCode ?? "ERR"})
                        </span>
                      )}
                    </div>
                    {src.errorMessage && (
                      <p className="mt-1 text-[11px] text-red-800">
                        {src.errorMessage}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {response.warnings.length > 0 && (
              <div
                role="status"
                className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 space-y-1"
              >
                {response.warnings.map((w, idx) => (
                  <p key={idx} className="flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </p>
                ))}
              </div>
            )}
          </section>

          {/* Distinct Failure & Empty States */}
          {allSourcesFailed && (
            <section
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900 space-y-2"
            >
              <p className="font-semibold">
                Yhtään rekrytointilähdettä ei voitu noutaa
              </p>
              <p className="text-xs text-red-800">
                Kaikki kysellyt työnantajarajapinnat palauttivat virheen tai
                aikakatkaisun. Tarkista lähteiden tilat yltä tai yritä hetken
                kuluttua uudelleen.
              </p>
            </section>
          )}

          {zeroFetchedOverall && (
            <section className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-700">
              <p className="font-medium text-slate-900">
                Valituilla työnantajilla ei ole tällä hetkellä julkisia ilmoituksia
              </p>
              <p className="text-xs text-slate-600 mt-1">
                Onnistuneet rajapinnat vastasivat, mutta niissä ei ollut yhtään
                julkaistua ilmoitusta hakuhetkellä.
              </p>
            </section>
          )}

          {zeroMatchedAfterFilters && (
            <section className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-700 space-y-3">
              <div>
                <p className="font-medium text-slate-900">
                  Yksikään ilmoitus ei vastannut nykyisiä suodattimia
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  Rajapinnoista haettiin{" "}
                  <span className="font-mono tabular-nums font-medium">
                    {response.totalFetchedCount}
                  </span>{" "}
                  ilmoitusta, mutta nykyiset sijainti-, kokemustaso-, kieli- tai
                  toimialasuodattimet rajasivat ne kaikki pois.
                </p>
              </div>
              <button
                type="button"
                disabled={isSearching}
                onClick={() => {
                  if (sessionRef.current?.isRunning() || isSearching) return;
                  const broadened: DiscoverySearchPreferences = {
                    ...preferences,
                    seniorityLevel: "all",
                    industryFocus: "all",
                    remotePreference: "any",
                    locationQuery: "",
                    keyword: "",
                  };
                  setPreferences(broadened);
                  setShowWeakMatches(true);
                  void runDiscovery(broadened);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                Näytä kaikki tasot ja toimialat ilman suodatusta
              </button>
            </section>
          )}

          {/* Results Toolbar */}
          {response.matchedCount > 0 && (
            <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-4">
                <p className="text-sm font-medium text-slate-900">
                  Näytetään{" "}
                  <span className="font-mono tabular-nums">
                    {sortedJobs.length}
                  </span>{" "}
                  /{" "}
                  <span className="font-mono tabular-nums">
                    {response.matchedCount}
                  </span>{" "}
                  ilmoitusta
                </p>
                {weakJobsCount > 0 && (
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showWeakMatches}
                      onChange={(e) => setShowWeakMatches(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                    />
                    <span>
                      Näytä myös heikosti vastaavat / senior-roolit (
                      <span className="font-mono tabular-nums">
                        {weakJobsCount}
                      </span>
                      )
                    </span>
                  </label>
                )}
              </div>

              <div className="flex items-center gap-2">
                <label
                  htmlFor="discovery-sort-select"
                  className="text-xs font-medium text-slate-600 whitespace-nowrap"
                >
                  Järjestys:
                </label>
                <select
                  id="discovery-sort-select"
                  value={sortBy}
                  onChange={(e) =>
                    setSortBy(e.target.value as DiscoverySortOption)
                  }
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  <option value="suitability">Alustava sopivuus</option>
                  <option value="published_desc">Uusin julkaisu ensin</option>
                  <option value="company">Työnantaja (A–Ö)</option>
                  <option value="location">Sijainti (A–Ö)</option>
                </select>
              </div>
            </section>
          )}

          {onlyWeakHidden && (
            <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p>
                Kaikki{" "}
                <span className="font-mono tabular-nums font-medium">
                  {weakJobsCount}
                </span>{" "}
                hakuehdot läpäissyttä ilmoitusta arvioitiin heikoksi
                vastaavuudeksi tai senior-rooliksi, ja ne on piilotettu oletuksena.
              </p>
              <button
                type="button"
                onClick={() => setShowWeakMatches(true)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Näytä piilotetut ({weakJobsCount})
              </button>
            </section>
          )}

          {/* Result Cards */}
          <div className="space-y-4">
            {sortedJobs.map((job) => {
              const isExpanded = Boolean(expandedJobIds[job.id]);
              const hasSafeUrl = isSafeExternalHttpUrl(job.jobUrl);
              return (
                <article
                  key={job.id}
                  className="rounded-lg border border-slate-200 bg-white p-5 space-y-4"
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span className="font-semibold text-slate-900">
                          {job.company}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span>{sourceSystemLabel(job.source)}</span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span>{job.location}</span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span>
                          {remoteTypeLabel(job)}
                          {job.remoteEligibilityNote &&
                          job.remoteEligibilityNote !== "Ei ilmoitettu"
                            ? ` (${job.remoteEligibilityNote})`
                            : ""}
                        </span>
                      </div>

                      <h3 className="text-base font-semibold text-slate-900">
                        {job.title}
                      </h3>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span>
                          <span className="text-slate-500">Työsuhde:</span>{" "}
                          {job.employmentType}
                        </span>
                        <span>
                          <span className="text-slate-500">Osasto:</span>{" "}
                          {job.department}
                        </span>
                        <span>
                          <span className="text-slate-500">Julkaistu:</span>{" "}
                          <span className="font-mono tabular-nums">
                            {formatDateLabel(job.publishedAt)}
                          </span>
                        </span>
                        <span>
                          <span className="text-slate-500">Hakuaika:</span>{" "}
                          <span
                            className={`font-mono tabular-nums ${
                              job.deadlineStatus === "expired" ||
                              job.deadlineStatus === "conflicting"
                                ? "text-amber-900 font-medium"
                                : ""
                            }`}
                          >
                            {job.deadline ?? "Ei ilmoitettu"}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="shrink-0">
                      <span
                        className={`inline-block rounded border px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${suitabilityBadgeStyle(
                          job.suitabilityCategory
                        )}`}
                      >
                        {job.suitabilityCategory}
                      </span>
                    </div>
                  </div>

                  {/* Reasoning & Uncertainties */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-100 text-xs">
                    <div className="space-y-1.5">
                      <p className="font-semibold text-slate-800">
                        Alustavat perustelut
                      </p>
                      <ul className="space-y-1 text-slate-700 list-disc pl-4">
                        {job.matchReasons.map((reason, idx) => (
                          <li key={idx}>{reason}</li>
                        ))}
                      </ul>
                      {job.cyberPathwayNote && (
                        <p className="mt-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-slate-700">
                          {job.cyberPathwayNote}
                        </p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <p className="font-semibold text-slate-800">
                        Epävarmuudet ja tarkistettavat kohdat
                      </p>
                      {job.uncertainties.length > 0 ? (
                        <ul className="space-y-1 text-amber-950 list-disc pl-4">
                          {job.uncertainties.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-slate-500">
                          Ei havaittuja rakenteisia ristiriitoja. Tarkista
                          yksityiskohtaiset vaatimukset ja voimassaolo ennen
                          hakemista.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(job.id)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 cursor-pointer whitespace-nowrap"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="h-3.5 w-3.5" />
                          Piilota ilmoitusteksti
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3.5 w-3.5" />
                          Näytä ilmoitusteksti (
                          <span className="font-mono tabular-nums">
                            {job.descriptionFullLength.toLocaleString("fi-FI")}
                          </span>{" "}
                          merkkiä)
                        </>
                      )}
                    </button>

                    <div className="flex flex-wrap items-center gap-2.5">
                      {hasSafeUrl ? (
                        <a
                          href={job.jobUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                        >
                          Alkuperäinen ilmoitus
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">
                          Alkuperäinen HTTPS-linkki puuttuu
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => onSelectJobForAnalysis(job)}
                        className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Analysoi tarkemmin
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Safe Plain-Text Preview */}
                  {isExpanded && (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                      {job.description || "Ilmoitustekstiä ei saatu rajapinnasta."}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
