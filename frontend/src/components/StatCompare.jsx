import { formatNumber } from "../lib/intl";

// To-sidet bar-sammenligning med vinder-fremhævning. Udtrukket fra
// HeadToHeadPage (#1609 Standings-hub-konsolidering) så compare-drawer'en på
// StandingsPage ikke importerer fra en side der udfases. Tager labels som props
// (ingen i18n-afhængighed) — kaldersiden oversætter. Tokens, ingen rå farver.
export default function StatCompare({ labelA, valueA, valueB, labelB, unit = "", higherIsBetter = true }) {
  const aWins = higherIsBetter ? valueA > valueB : valueA < valueB;
  const bWins = higherIsBetter ? valueB > valueA : valueB < valueA;
  const maxVal = Math.max(valueA, valueB, 1);
  return (
    <div className="py-3 border-b border-cz-border last:border-0">
      <div className="flex items-center justify-between mb-2">
        <span className={`font-mono font-bold text-sm ${aWins ? "text-cz-accent-t" : "text-cz-2"}`}>
          {formatNumber(valueA)}{unit}
        </span>
        <span className="text-cz-3 text-xs uppercase tracking-wider">{labelA || labelB}</span>
        <span className={`font-mono font-bold text-sm ${bWins ? "text-cz-accent-t" : "text-cz-2"}`}>
          {formatNumber(valueB)}{unit}
        </span>
      </div>
      <div className="flex gap-1 h-2">
        <div className="flex-1 bg-cz-subtle rounded-l-full overflow-hidden flex justify-end">
          <div className="h-2 rounded-l-full bg-cz-accent/60 transition-all"
            style={{ width: `${(valueA / maxVal) * 100}%` }} />
        </div>
        <div className="flex-1 bg-cz-subtle rounded-r-full overflow-hidden">
          <div className="h-2 rounded-r-full bg-cz-info transition-all"
            style={{ width: `${(valueB / maxVal) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
