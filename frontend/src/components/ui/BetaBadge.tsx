// #5404 · "Beta"-chip: markerer at det menupunkt eller den side den staar
// ved, ligger bag et flag i stadiet beta for denne viewer.
//
// Ren og statslos: kaldstedet afgoer selv stadiet (lib/featureStage.ts) og
// sender kun det ind — komponenten fetcher intet og kender ingen flag-noegler.
//
// TASTE.md P8: siden har allerede fire maader at sige "vigtigt" (guld-knap,
// StatusBadge, taelle-pille, guld-keyline) — Beta er ikke en femte. Den deler
// anatomi med CategoryTag (badgeStyles.js): neutral hairline-pille, ikke den
// gyldne accent-farve (guld er rationeret til primaer-knap + ledermarkoerer).
import { useTranslation } from "react-i18next";
import type { FlagStage } from "../../lib/featureStage";

export interface BetaBadgeProps {
  /** off|beta|on for viewer — badgen renderer kun noget ved praecis "beta". */
  stage?: FlagStage | null;
  className?: string;
}

export default function BetaBadge({ stage, className = "" }: BetaBadgeProps) {
  const { t } = useTranslation("common");
  if (stage !== "beta") return null;
  return (
    <span
      className={`inline-flex items-center rounded-cz border border-cz-border bg-cz-subtle px-1.5 py-0.5 font-data text-3xs font-semibold uppercase tracking-[.08em] text-cz-2 ${className}`}
    >
      {t("betaBadge")}
    </span>
  );
}
