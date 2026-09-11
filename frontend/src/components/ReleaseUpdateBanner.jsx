import { useTranslation } from "react-i18next";
import Button from "./ui/Button.jsx";
import { RefreshIcon } from "./ui/icons";

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
// Skabelon: hairline + 5 px radius (rounded-cz) + kort-baggrund, ingen skygge,
// én gold primary-knap. Se docs/design/TASTE.md §P3.
export default function ReleaseUpdateBanner({ show, onUpdate }) {
  const { t } = useTranslation("banners");
  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t("releaseUpdate.regionAriaLabel")}
      data-testid="release-update-banner"
      className="fixed inset-x-0 bottom-0 z-toast px-3 pb-3 sm:px-6 sm:pb-6 pointer-events-none"
    >
      <div className="mx-auto flex max-w-lg items-center gap-3 rounded-cz border border-cz-border bg-cz-card px-4 py-3 pointer-events-auto">
        <RefreshIcon size={16} className="shrink-0 text-cz-3" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm leading-snug text-cz-1">
          {t("releaseUpdate.title")}
        </p>
        <Button
          size="sm"
          variant="primary"
          onClick={onUpdate}
          data-testid="release-update-apply"
        >
          {t("releaseUpdate.action")}
        </Button>
      </div>
    </div>
  );
}
