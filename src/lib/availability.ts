import type {
  ApplicationAvailabilityStatus,
  RecommendationCategory,
} from "../types/career.ts";

export interface ActionabilityGuidance {
  status: ApplicationAvailabilityStatus;
  statusLabel: string;
  isActionable: boolean;
  requiresVerificationCheck: boolean;
  tone: "open" | "closed" | "unverified" | "caution";
  headline: string;
  detail: string;
}

export function formatAvailabilityLabel(
  status?: ApplicationAvailabilityStatus
): string {
  switch (status) {
    case "Avoinna":
      return "Avoinna (vahvistettu)";
    case "Päättynyt":
      return "Päättynyt (vahvistettu)";
    case "Ei tarkistettu":
    default:
      return "Ei tarkistettu";
  }
}

export function getActionabilityGuidance(
  fitCategory: RecommendationCategory,
  availabilityStatus: ApplicationAvailabilityStatus = "Ei tarkistettu",
  availabilityVerifiedAt = "",
  availabilitySourceUrl = ""
): ActionabilityGuidance {
  const verifiedSuffix = availabilityVerifiedAt
    ? ` (tarkistettu ${availabilityVerifiedAt})`
    : "";
  const sourceNote = availabilitySourceUrl.trim()
    ? ` Lähde: ${availabilitySourceUrl.trim()}.`
    : "";

  if (availabilityStatus === "Päättynyt") {
    return {
      status: "Päättynyt",
      statusLabel: `Päättynyt${verifiedSuffix}`,
      isActionable: false,
      requiresVerificationCheck: false,
      tone: "closed",
      headline: "Ei tällä hetkellä haettavissa — haku on vahvistetusti päättynyt.",
      detail: `Tehtävän soveltuvuusarvio (${fitCategory}) säilyy muuttumattomana myöhempää vertailua varten, mutta kohde ei ole nyt ajankohtainen. Merkintä perustuu käyttäjän omaan tarkistukseen.${sourceNote}`,
    };
  }

  if (availabilityStatus === "Ei tarkistettu") {
    return {
      status: "Ei tarkistettu",
      statusLabel: "Ei tarkistettu",
      isActionable: false,
      requiresVerificationCheck: true,
      tone: "unverified",
      headline:
        "Hakutilannetta ei ole varmistettu — tarkista voimassaolo ennen hakemista.",
      detail:
        "Liitetty ilmoitusteksti, julkaisupäivä tai URL-osoite ei yksinään todista, että haku on avoinna tai päättynyt. Sovellus ei ole avannut työnantajan sivua; tarkista haku manuaalisesti ennen kuin käytät aikaa hakemuksen tekemiseen.",
    };
  }

  const weakFit =
    fitCategory === "Matala prioriteetti" || fitCategory === "Jätä väliin";

  if (weakFit) {
    return {
      status: "Avoinna",
      statusLabel: `Avoinna${verifiedSuffix}`,
      isActionable: true,
      requiresVerificationCheck: false,
      tone: "caution",
      headline:
        "Haku on vahvistetusti avoinna, mutta osaamisvastaavuus tai soveltuvuus on heikko.",
      detail: `Vaikka haku on merkitty avoimeksi käyttäjän tarkistuksen perusteella, tehtävän soveltuvuussuositus on "${fitCategory}". Arvioi kriittisesti ennen hakemista, onko ajankäyttö perusteltua.${sourceNote}`,
    };
  }

  return {
    status: "Avoinna",
    statusLabel: `Avoinna${verifiedSuffix}`,
    isActionable: true,
    requiresVerificationCheck: false,
    tone: "open",
    headline: "Haku on vahvistetusti avoinna ja kohde on ajankohtainen.",
    detail: `Tila perustuu käyttäjän omaan tarkistukseen (sovellus ei ole tarkistanut verkkosivua automaattisesti).${sourceNote}`,
  };
}
