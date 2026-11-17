// #8153: maerket paa en rytter, hvis frigivelse er bestilt midt i et etapeloeb.
// Han koerer loebet faerdigt og forlader holdet efter sidste etape (ejer 14/11 + 17/11).
// Tekst ejer-godkendt 14/11: "Leaves after {race}" / "Forlader holdet efter {race}".
// Samme kompakte form og warning-tone som de oevrige status-maerker (RiderBadges).
import { useTranslation } from "react-i18next";
import { pendingRaceLabel } from "../../lib/pendingReleaseModel8153.ts";
import { usePendingReleases8153 } from "../../lib/usePendingReleases8153.ts";

type RaceLike = { name?: string | null; raceName?: string | null } | null | undefined;

export default function LeavingAfterRaceBadge({ pending, className = "" }: { pending?: RaceLike; className?: string }) {
  const { t } = useTranslation("rider");
  if (!pending) return null;
  const text = t("badges.leavesAfter", { race: pendingRaceLabel(pending, t("manage.release.pendingRaceFallback")) });
  return (
    <span
      data-testid="leaving-after-race-badge"
      title={text}
      className={`inline-flex items-center text-3xs font-semibold leading-tight px-1.5 py-0.5 rounded-cz min-w-0 max-w-full break-words bg-cz-warning-bg text-cz-warning ${className}`}
    >
      {text}
    </span>
  );
}

/**
 * Rytterprofilen (egen rytter): henter holdets ventende frigivelser selv, saa
 * foraelderen ikke faar en ny hook foran sine tidlige returns.
 * refreshKey skal vaere stabil mellem renders (fx rytter-objektet fra sidens state).
 */
export function OwnRiderLeavingBadge({ riderId, refreshKey = null, className = "" }: { riderId: string; refreshKey?: unknown; className?: string }) {
  const byRider = usePendingReleases8153(refreshKey ?? riderId);
  return <LeavingAfterRaceBadge pending={byRider[riderId]} className={className} />;
}

/** Dialogens ekstra linje foer bestillingen (ejer-godkendt 14/11, ordret). */
export function ReleasePendingLine({ race, className = "" }: { race: RaceLike; className?: string }) {
  const { t } = useTranslation("rider");
  if (!race) return null;
  return (
    <p data-testid="release-pending-line"
      className={`rounded-cz border border-cz-warning/30 bg-cz-warning-bg px-3 py-2 text-cz-warning text-xs ${className}`}>
      {t("manage.release.pendingLine", { race: pendingRaceLabel(race, t("manage.release.pendingRaceFallback")) })}
    </p>
  );
}
