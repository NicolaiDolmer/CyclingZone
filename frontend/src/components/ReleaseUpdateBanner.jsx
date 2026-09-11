import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "./ui/Button.jsx";
// Eksplicit fil, ikke mappe-import: extensionless specifiers bestaar Vite men
// fejler i Node's ESM-loader (projektreglen i .coderabbit.yaml).
import { RefreshIcon } from "./ui/icons/index.jsx";
import { isReloadAllowed } from "../lib/reloadGate.js";

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
export default function ReleaseUpdateBanner({ show, onUpdate, onDismiss }) {
  const { t } = useTranslation("banners");
  // Sat når spilleren klikkede Update mens porten var lukket. Nulstilles hvis
  // banneret forsvinder, så det aldrig kommer tilbage midt i en bekræftelse.
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!show) setConfirming(false);
  }, [show]);

  if (!show) return null;

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
      {/* flex-wrap + `basis-full` paa spoergsmaalet: to knapper og en hel
          saetning kan ikke staa paa én linje paa 390 px uden at klemme teksten
          ned i en smal soejle. I bekraeftelses-tilstanden faar teksten derfor sin
          egen linje paa mobil og deler linje med knapperne fra sm og op. */}
      <div className="mx-auto flex max-w-lg flex-wrap items-center gap-x-3 gap-y-2 rounded-cz border border-cz-border bg-cz-card px-4 py-3 pointer-events-auto">
        <RefreshIcon size={16} className="shrink-0 text-cz-3" aria-hidden="true" />
        <p
          className={`min-w-0 text-sm leading-snug text-cz-1 ${
            confirming ? "basis-full sm:basis-0 sm:flex-1" : "flex-1"
          }`}
        >
          {confirming ? t("releaseUpdate.unsavedTitle") : t("releaseUpdate.title")}
        </p>
        {confirming && (
          <Button
            size="sm"
            variant="ghost"
            className="ms-auto sm:ms-0"
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
  );
}
