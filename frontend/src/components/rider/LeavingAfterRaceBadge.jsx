// #8153: maerket paa en rytter, hvis frigivelse er bestilt midt i et etapeloeb.
// Han koerer loebet faerdigt og forlader holdet efter sidste etape (ejer 14/11 + 17/11).
// Tekst ejer-godkendt 14/11: "Leaves after {race}" / "Forlader holdet efter {race}".
// Samme kompakte form og warning-tone som de oevrige status-maerker (RiderBadges).
import { useTranslation } from "react-i18next";
import { pendingRaceLabel } from "../../lib/pendingReleaseModel8153.js";
import { usePendingReleases8153 } from "../../lib/usePendingReleases8153.js";

/**
 * @param {{ pending?: { raceName?: string|null } | null, className?: string }} props
 */
export default function LeavingAfterRaceBadge({ pending, className = "" }) {
  const { t } = useTranslation("rider");
  if (!pending) return null;
  const text = t("badges.leavesAfter", { race: pendingRaceLabel(pending, t("manage.release.pendingRaceFallback")) });
  return (
    <span
      data-testid="leaving-after-race-badge"
      title={text}
      className={`inline-flex items-center text-3xs font-semibold leading-none px-1.5 py-0.5 rounded shrink-0 bg-cz-warning-bg text-cz-warning ${className}`}
    >
      {text}
    </span>
  );
}

/**
 * Rytterprofilen (egen rytter): henter holdets ventende frigivelser selv, saa
 * forælderen ikke faar en ny hook foran sine tidlige returns.
 * refreshKey skal vaere stabil mellem renders (fx rytter-objektet fra sidens state).
 * @param {{ riderId: string, refreshKey?: unknown, className?: string }} props
 */
export function OwnRiderLeavingBadge({ riderId, refreshKey = null, className = "" }) {
  const byRider = usePendingReleases8153(refreshKey ?? riderId);
  return <LeavingAfterRaceBadge pending={byRider[riderId]} className={className} />;
}

/**
 * Dialogens ekstra linje foer bestillingen (ejer-godkendt 14/11, ordret).
 * @param {{ race: { name?: string|null } | null, className?: string }} props
 */
export function ReleasePendingLine({ race, className = "" }) {
  const { t } = useTranslation("rider");
  if (!race) return null;
  return (
    <p data-testid="release-pending-line"
      className={`rounded-cz border border-cz-warning/30 bg-cz-warning-bg px-3 py-2 text-cz-warning text-xs ${className}`}>
      {t("manage.release.pendingLine", { race: pendingRaceLabel(race, t("manage.release.pendingRaceFallback")) })}
    </p>
  );
}
