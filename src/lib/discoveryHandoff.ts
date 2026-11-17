import type { DiscoveredJob, JobDiscoverySourceType } from "../types/career.ts";

export const MAX_ANALYZE_TEXT_CHARS = 30_000;

export interface FormattedDiscoveryTransfer {
  transferId: string;
  jobId: string;
  title: string;
  company: string;
  text: string;
  url: string;
  wasTruncated: boolean;
  originalCharCount: number;
  omittedCharCount: number;
  warnings: string[];
}

function sourceDisplayName(source: JobDiscoverySourceType): string {
  switch (source) {
    case "ashby":
      return "Ashby";
    case "greenhouse":
      return "Greenhouse";
    case "lever":
      return "Lever";
  }
}

function workModelDisplayName(job: DiscoveredJob): string {
  switch (job.remoteType) {
    case "remote":
      return `Etätyö (${job.remoteEligibilityNote})`;
    case "hybrid":
      return "Hybridi";
    case "onsite":
      return "Lähityö";
    default:
      return "Ei ilmoitettu";
  }
}

export function formatDiscoveredJobForAnalysis(
  job: DiscoveredJob,
  transferId = `discovery-${job.id}-${Date.now()}`
): FormattedDiscoveryTransfer {
  const headerLines = [
    `Tehtävänimike: ${job.title}`,
    `Työnantaja: ${job.company}`,
    `Sijainti: ${job.location}`,
    `Työskentelymalli: ${workModelDisplayName(job)}`,
    `Työsuhteen tyyppi: ${job.employmentType}`,
    `Osasto / tiimi: ${job.department}`,
    `Hakuaika: ${job.deadline ?? "Ei ilmoitettu"}`,
    `Lähdejärjestelmä: ${sourceDisplayName(job.source)}`,
    `Alkuperäinen ilmoitus-URL: ${job.jobUrl || "Ei ilmoitettu"}`,
  ];

  if (job.publishedAt) {
    headerLines.push(`Julkaistu lähteessä: ${job.publishedAt}`);
  }
  if (job.updatedAt) {
    headerLines.push(`Päivitetty lähteessä: ${job.updatedAt}`);
  }

  const header = `${headerLines.join("\n")}\n\n`;
  const cleanDescription = job.description.trim();
  const fullCombined = `${header}${cleanDescription}`;
  const originalCharCount = fullCombined.length;

  const warnings: string[] = [];
  if (job.deadlineStatus === "expired") {
    warnings.push(
      `Huomio: Ilmoituksen tunnistettu hakuaika (${job.deadline ?? "tuntematon"}) vaikuttaa päättyneen. Tarkista alkuperäinen ilmoitus ennen hakemista.`
    );
  } else if (job.deadlineStatus === "conflicting") {
    warnings.push(
      "Huomio: Ilmoituksessa havaittiin ristiriitaisia hakuaikatietoja. Tarkista määräaika alkuperäisestä ilmoituksesta."
    );
  }

  if (fullCombined.length <= MAX_ANALYZE_TEXT_CHARS) {
    return {
      transferId,
      jobId: job.id,
      title: job.title,
      company: job.company,
      text: fullCombined,
      url: job.jobUrl,
      wasTruncated: false,
      originalCharCount,
      omittedCharCount: 0,
      warnings,
    };
  }

  // Reserve room for explicit truncation disclosure so nothing is ever cut silently
  const noteTemplate = (omitted: number) =>
    `\n\n[Huomio: Ilmoitusteksti ylitti ${MAX_ANALYZE_TEXT_CHARS.toLocaleString("fi-FI")} merkin analyysirajan (alkuperäinen pituus ${originalCharCount.toLocaleString("fi-FI")} merkkiä). Lopusta jätettiin pois noin ${omitted.toLocaleString("fi-FI")} merkkiä. Tarkista mahdolliset loppuosan lisäehdot alkuperäisestä ilmoituksesta: ${job.jobUrl}]`;

  const maxNoteLen = noteTemplate(originalCharCount).length + 12;
  const maxBodySlice = Math.max(200, MAX_ANALYZE_TEXT_CHARS - header.length - maxNoteLen);
  let cutSlice = cleanDescription.slice(0, maxBodySlice);
  const lastBreak = Math.max(
    cutSlice.lastIndexOf("\n\n"),
    cutSlice.lastIndexOf("\n"),
    cutSlice.lastIndexOf(". ")
  );
  if (lastBreak > Math.floor(maxBodySlice * 0.6)) {
    cutSlice = cutSlice.slice(0, lastBreak + 1);
  }

  const omittedCharCount = Math.max(1, cleanDescription.length - cutSlice.length);
  const truncationNote = noteTemplate(omittedCharCount);
  const finalText = `${header}${cutSlice.trimEnd()}${truncationNote}`.slice(
    0,
    MAX_ANALYZE_TEXT_CHARS
  );

  warnings.push(
    `Ilmoituksen teksti ylitti 30 000 merkin rajan (${originalCharCount.toLocaleString("fi-FI")} merkkiä). Lopusta jätettiin pois ${omittedCharCount.toLocaleString("fi-FI")} merkkiä; voit muokata tekstiä ennen analyysiä tai tarkistaa alkuperäisen ilmoituksen.`
  );

  return {
    transferId,
    jobId: job.id,
    title: job.title,
    company: job.company,
    text: finalText,
    url: job.jobUrl,
    wasTruncated: true,
    originalCharCount,
    omittedCharCount,
    warnings,
  };
}

export function isSafeExternalHttpUrl(rawUrl: string): boolean {
  if (!rawUrl || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

export type DiscoverySortOption =
  | "suitability"
  | "company"
  | "location"
  | "published_desc";

export function sortDiscoveredJobs(
  jobs: DiscoveredJob[],
  sortBy: DiscoverySortOption
): DiscoveredJob[] {
  const copy = [...jobs];
  switch (sortBy) {
    case "company":
      return copy.sort((a, b) => {
        const cmp = a.company.localeCompare(b.company, "fi");
        if (cmp !== 0) return cmp;
        return b.discoveryScore - a.discoveryScore;
      });
    case "location":
      return copy.sort((a, b) => {
        const cmp = a.location.localeCompare(b.location, "fi");
        if (cmp !== 0) return cmp;
        return b.discoveryScore - a.discoveryScore;
      });
    case "published_desc":
      return copy.sort((a, b) => {
        const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        const safeA = Number.isFinite(aTime) ? aTime : 0;
        const safeB = Number.isFinite(bTime) ? bTime : 0;
        if (safeB !== safeA) return safeB - safeA;
        return b.discoveryScore - a.discoveryScore;
      });
    case "suitability":
    default:
      return copy.sort((a, b) => {
        if (b.discoveryScore !== a.discoveryScore) {
          return b.discoveryScore - a.discoveryScore;
        }
        return a.title.localeCompare(b.title, "fi");
      });
  }
}

export function shouldConfirmDiscoveryTransfer(state: {
  isLoading: boolean;
  isFetchingJob: boolean;
  jobText: string;
  jobUrl?: string;
  hasResult: boolean;
}): boolean {
  return (
    state.isLoading ||
    state.isFetchingJob ||
    state.jobText.trim().length > 0 ||
    (state.jobUrl ?? "").trim().length > 0 ||
    state.hasResult
  );
}

