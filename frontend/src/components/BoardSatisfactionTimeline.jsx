import { useTranslation } from "react-i18next";

// #1451 · Løb-for-løb historik for bestyrelsens tilfredshed. Visnings-only:
// renderer board_satisfaction_events fra /board/status. Tom → render intet
// (så panelet ikke står med en gabende boks før første weekend).
export default function BoardSatisfactionTimeline({ events = [] }) {
  const { t } = useTranslation("board");
  if (!events.length) return null;
  const rows = [...events].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  // Sparkline: den løbende tilfredshed (satisfaction_after) ældst → nyest, så
  // bevægelsen ses som en sammenhængende kurve (#1451 "glat bevægelse").
  const sparkValues = [...rows].reverse().map((e) => e.satisfaction_after ?? 50);
  let sparkPoints = null;
  if (sparkValues.length >= 2) {
    const min = Math.min(...sparkValues);
    const max = Math.max(...sparkValues);
    const span = Math.max(1, max - min);
    sparkPoints = sparkValues
      .map((v, i) => {
        const x = (i / (sparkValues.length - 1)) * 100;
        const y = 20 - ((v - min) / span) * 16;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  return (
    <div className="mt-4">
      <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("satisfactionTimeline.heading")}</p>
      {sparkPoints && (
        <svg viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true"
          data-testid="board-satisfaction-sparkline" className="w-full h-6 text-cz-2 mb-3">
          <polyline points={sparkPoints} fill="none" stroke="currentColor"
            strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <div className="divide-y divide-cz-border">
        {rows.map((e) => {
          const delta = e.satisfaction_delta ?? 0;
          const up = delta > 0;
          const flat = delta === 0;
          const deltaColor = flat ? "text-cz-3" : up ? "text-cz-success" : "text-cz-danger";
          const sign = up ? "+" : "";
          return (
            <div key={e.id} className="flex items-center justify-between py-2">
              <div className="min-w-0">
                <p className="text-cz-1 text-sm font-medium truncate">{e.race_name || t("satisfactionTimeline.unknownRace")}</p>
                <p className="text-cz-3 text-xs">
                  {t("satisfactionTimeline.goals", { met: e.goals_met, total: e.goals_total })}
                  {e.reason_category ? ` · ${t(`category.${e.reason_category}`, { defaultValue: e.reason_category })}` : ""}
                </p>
              </div>
              <span className={`text-sm font-medium tabular-nums ${deltaColor}`}>
                {flat ? t("satisfactionTimeline.flat") : `${sign}${delta}%`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
