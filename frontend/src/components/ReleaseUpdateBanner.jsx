import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import Button from "./ui/Button.jsx";
// Eksplicit fil, ikke mappe-import: extensionless specifiers bestaar Vite men
// fejler i Node's ESM-loader (projektreglen i .coderabbit.yaml).
import { RefreshIcon } from "./ui/icons/index.jsx";
import { isReloadAllowed } from "../lib/reloadGate.js";
import { useConsent } from "../lib/consent.jsx";

// #5159 — den manuelle udvej. Banneret er selve grunden til at appen tør LADE
// VÆRE med at genindlæse af sig selv: opdager watcheren en ny frontend mens
// spilleren har ugemt arbejde, en åben dialog eller en kørende afspilning, sker
// der ingenting automatisk — men spilleren kan se at der er en opdatering og
// tage den præcis når det passer.
//
// Ikke-blokerende med vilje: ingen overlay, ingen fokus-fælde, ingen luk-knap
// der skal rammes for at komme videre. Det er en stribe i bunden af skærmen som
// forsvinder af sig selv i det sekund opdateringen faktisk sker.
//
// Review-fund 2 (11/9): klikket springer porten over — det er spillerens egen
// beslutning, og den skal det blive ved med at være. Men det gjorde det UDEN at
// sige hvad det koster: er der ugemt arbejde, genindlæser klikket dokumentet og
// kladden er væk. Derfor spørger banneret én gang, i sig selv, med det samme
// valg spilleren faktisk har. Ingen browser-`confirm()`: den er modal, kan ikke
// styles, og er præcis den fokus-fælde banneret findes for at undgå.
//
// Skabelon: hairline + 5 px radius (rounded-cz) + kort-baggrund, ingen skygge.
// Knappen er SECONDARY (review-fund 6, TASTE §P3): banneret er en stribe oven på
// en vilkårlig side, og viewets egen gold primary — Gem, Log ind — skal blive ved
// med at være den ene guld-flade i billedet.
// Review-fund 5: banneret deler `fixed inset-x-0 bottom-0 z-toast` med
// cookie-banneret og NPS-prompten og tegner OVENPÅ dem. De to gates herunder bor
// HER og ikke i App, med vilje: App er rodkomponenten, og et abonnement dér
// (samtykke-contexten, `useLocation`) gen-renderer HELE træet — inklusive den
// prerendrede landing — hver gang samtykket eller ruten ændrer sig. Banneret er
// et blad der rendrer null i de tilfælde gaten lukker, så et gen-render koster
// ingenting.
//
// (Første udkast lagde dem i App. Det blev flyttet mens jeg jagtede en React
// #418-hydrationsfejl i WebKit. Flytningen fjernede IKKE fejlen: den er målt på
// bee33ecf4 — altså helt uden dette spors ændringer — med 3/1/0 røde ud af 24
// på tre kørsler, så den er et eksisterende, belastningsafhængigt flake i
// landing-hydrationen og ikke noget denne PR indfører. Placeringen her er
// beholdt fordi den er den rigtige uanset.)
export default function ReleaseUpdateBanner({ show, hasSession = false, onUpdate, onDismiss }) {
  const { t } = useTranslation("banners");
  // Cookie-banneret er en samtykke-beslutning der ejer bundkanten alene — samme
  // løsning useNpsPrompt allerede bruger for NPS-baren.
  const { bannerOpen: consentBannerOpen } = useConsent();
  const { pathname } = useLocation();
  // Sat når spilleren klikkede Update mens porten var lukket. Nulstilles hvis
  // banneret forsvinder, så det aldrig kommer tilbage midt i en bekræftelse.
  const [confirming, setConfirming] = useState(false);

  // Forsiden for en anonym besøgende: ingen session, intet ugemt arbejde og
  // ingen app-tilstand at redde. En opdaterings-stribe dér er ren støj.
  const anonymousOnLanding = !hasSession && pathname === "/";
  const visible = Boolean(show) && !consentBannerOpen && !anonymousOnLanding;

  useEffect(() => {
    if (!visible) setConfirming(false);
  }, [visible]);

  if (!visible) return null;

  function handleUpdate() {
    // Porten læses på KLIK-tidspunktet, ikke ved render: en kladde kan være gemt
    // (eller skrevet) i sekunderne mellem at banneret dukkede op og klikket.
    if (!confirming && !isReloadAllowed()) {
      setConfirming(true);
      return;
    }
    onUpdate?.();
  }

  function handleSaveFirst() {
    setConfirming(false);
    // Banneret lukkes uden reload. Markøren bliver liggende i watcheren, så i det
    // sekund spilleren HAR gemt, tages opdateringen automatisk på det sikre punkt.
    onDismiss?.();
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t("releaseUpdate.regionAriaLabel")}
      data-testid="release-update-banner"
      className="fixed inset-x-0 bottom-0 z-toast px-3 pb-3 sm:px-6 sm:pb-6 pointer-events-none"
    >
      {/* flex-wrap: ikon + spoergsmaal bliver paa samme linje, og det er
          KNAPPERNE der bryder om til linje to paa 390 px. To knapper og en hel
          saetning kan ikke staa paa én linje dér uden at klemme teksten ned i en
          smal soejle — og et ikon alene paa foerste linje laeser som en fejl. */}
      <div className="mx-auto flex max-w-lg flex-wrap items-center gap-x-3 gap-y-2 rounded-cz border border-cz-border bg-cz-card px-4 py-3 pointer-events-auto">
        <RefreshIcon size={16} className="shrink-0 text-cz-3" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm leading-snug text-cz-1">
          {confirming ? t("releaseUpdate.unsavedTitle") : t("releaseUpdate.title")}
        </p>
        <div
          className={`flex shrink-0 items-center justify-end gap-2 ${
            confirming ? "w-full sm:w-auto" : ""
          }`}
        >
          {confirming && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSaveFirst}
              data-testid="release-update-save-first"
            >
              {t("releaseUpdate.saveFirst")}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={handleUpdate}
            data-testid="release-update-apply"
          >
            {confirming ? t("releaseUpdate.updateAnyway") : t("releaseUpdate.action")}
          </Button>
        </div>
      </div>
    </div>
  );
}
