import { useTranslation } from "react-i18next";
import { formatNumber } from "../../lib/intl.js";
import type { DayDemand, DecisiveClimb, DemandLevel, StageAxes } from "../../lib/stageAxes";

// #6364 (spec §6): "her afgoeres etapen" og "dagen kraever". Begge er afledt af etapens
// egne data (stigningerne og den gemte demand_vector), se lib/stageAxes.ts. Mangler data,
// skjules blokken i stedet for at vise noget opdigtet (TASTE P11).
const LABEL = "text-cz-3 text-3xs uppercase tracking-wider font-semibold mb-1.5";
const LEVEL_WIDTH: Record<DemandLevel, string> = { high: "100%", mid: "62%", low: "28%" };

interface Props {
  decisive: DecisiveClimb | null;
  demands: DayDemand[];
  finish: StageAxes["finish"];
}

export default function StageDecidedDemands({ decisive, demands, finish }: Props) {
  const { t } = useTranslation("races");
  if (!decisive && demands.length === 0) return null;

  let decidedText: string | null = null;
  if (decisive) {
    const name = decisive.name || t("detail.stageCard.unnamedClimb", { cat: decisive.category });
    const stats = t("detail.stageCard.climbStats", {
      cat: decisive.category,
      length: formatNumber(decisive.lengthKm, { maximumFractionDigits: 1 }),
      gradient: formatNumber(decisive.avgGradient, { maximumFractionDigits: 1 }),
    });
    // "Derefter nedkoersel" kun naar den afgoerende stigning ogsaa er den sidste paa ruten.
    const kind = decisive.summit ? "summit" : finish === "descent" && decisive.isLast ? "descent" : "before";
    decidedText = t(`detail.stageCard.decided.${kind}`, { name, stats, km: Math.round(decisive.kmToGo) });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mt-3 pt-3 border-t border-cz-border" data-testid="stage-decided-demands">
      {decidedText && (
        <div>
          <p className={LABEL}>{t("detail.stageCard.decided.label")}</p>
          <p className="text-cz-1 text-sm leading-relaxed">{decidedText}</p>
        </div>
      )}
      {demands.length > 0 && (
        <div>
          <p className={LABEL}>{t("detail.stageCard.demands.label")}</p>
          <ul className="space-y-1.5">
            {demands.map((d) => (
              <li key={d.ability} className="grid grid-cols-[minmax(0,7.5rem)_1fr_2.5rem] items-center gap-3 text-sm">
                <span className="text-cz-1 truncate">{t(`detail.ability.${d.ability}`)}</span>
                <span className="h-1.5 rounded-cz bg-cz-border/60 overflow-hidden" aria-hidden="true">
                  <span className="block h-full bg-cz-2" style={{ width: LEVEL_WIDTH[d.level] }} />
                </span>
                <span className="text-cz-2 text-2xs uppercase tracking-wider text-end">
                  {t(`detail.stageCard.demands.${d.level}`)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
