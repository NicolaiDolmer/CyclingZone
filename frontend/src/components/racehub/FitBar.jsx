// Delt suitability-fit-bar (#1823 world-class). Editorial navy/guld-skala + ord-anker
// (Strong/Average/Poor i tooltip). Ét sted så kolonne, pulje og popover viser samme
// signal. Score = 0-100 (rytterens egnethed mod løbets terræn). Tærskler: raceHubLogic.fitTier.
import { useTranslation } from "react-i18next";
import { fitTier } from "../../lib/raceHubLogic.js";

const TIER_FILL = {
  strong: "bg-cz-accent",
  average: "bg-cz-2",
  poor: "bg-cz-3",
};

export default function FitBar({ score, className = "" }) {
  const { t } = useTranslation("races");
  const tier = fitTier(score);
  if (tier == null) return <span className="text-cz-3 text-[10px] font-mono">—</span>;
  const pct = Math.max(0, Math.min(100, score));
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      title={`${t("racehub.fit.label")} ${score} · ${t(`racehub.fit.${tier}`)}`}
    >
      <span className="relative inline-block w-9 h-1 rounded-full bg-cz-border/60 overflow-hidden align-middle">
        <span className={`absolute inset-y-0 left-0 rounded-full ${TIER_FILL[tier]}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-[10px] font-mono tabular-nums text-cz-2 w-5 text-right">{score}</span>
    </span>
  );
}
