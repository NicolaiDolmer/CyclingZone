// #2806 · Raekker og saesonakse til Pro-saesonhistorikken. Flyttet ud af
// RiderAbilityHistoryPro.jsx, saa /pro-siden tegner sit maerkede eksempel med
// praecis de samme komponenter som den rigtige fane (ingen kopi der kan drive).
//
// Sparkline-opskrift (ejer-retning 2/9, TASTE.md P2 fork 5 valg A "monokrom
// streg"): 2px streg i --text-1, flad --bg-subtle-fyld under kurven,
// slutpunkt markeret, akse-labels text-3xs. Kurven skifter ALDRIG farve efter
// retning; deltaet ved siden af vaerdien baerer groen/roed.
//
// Den stiplede linje er den FASTE spilbrede skala-graense (99, samme for alle),
// ikke et rytter-specifikt loft (se proRiderHistory.js for hvorfor).
//
// #6286: en evne der mangler i en saeson er et HUL i kurven (aldrig 0), og
// deltaet regnes kun mellem rigtige vaerdier (lib/proAbilityHistory.js).

import { ABILITY_SHORT } from "../../lib/abilities.js";
import {
  abilityDelta, latestValue, seriesSegments, seasonAxisLabels, axisFraction,
} from "../../lib/proAbilityHistory.js";

export interface HistoryPoint {
  season: number | null;
  live: boolean;
  v: number | null;
}

export interface HistorySeason {
  season_number: number | null;
  live?: boolean;
}

interface Segment { i: number; v: number }

const VB = { w: 120, h: 32, x0: 2, x1: 118, y0: 3, y1: 27 };
const SHORT = ABILITY_SHORT as Readonly<Record<string, string>>;

const xAtIndex = (i: number, n: number): number => VB.x0 + axisFraction(i, n) * (VB.x1 - VB.x0);

function Sparkline({ points, ceiling }: { points: HistoryPoint[]; ceiling: number }) {
  const segments = seriesSegments(points) as Segment[][];
  if (segments.length === 0) return <div className="h-8" aria-hidden="true" />;
  const n = points.length;
  const vals = segments.flat().map((p) => p.v);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(ceiling, ...vals);
  const span = Math.max(1, hi - lo);
  const yAt = (v: number): number => VB.y1 - ((v - lo) / span) * (VB.y1 - VB.y0);
  const ceilY = yAt(ceiling);
  const lastSeg = segments[segments.length - 1];
  const last = lastSeg[lastSeg.length - 1];
  return (
    <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="block w-full h-8" aria-hidden="true">
      <line x1={VB.x0} y1={ceilY.toFixed(1)} x2={VB.x1} y2={ceilY.toFixed(1)}
        stroke="var(--border)" strokeWidth="1" strokeDasharray="2 2" opacity="0.8" />
      {segments.map((seg) => {
        const line = seg.map((p) => `${xAtIndex(p.i, n).toFixed(1)},${yAt(p.v).toFixed(1)}`).join(" ");
        const xFirst = xAtIndex(seg[0].i, n).toFixed(1);
        const xLast = xAtIndex(seg[seg.length - 1].i, n).toFixed(1);
        return seg.length > 1 ? (
          <g key={seg[0].i}>
            <polygon points={`${xFirst},${VB.y1} ${line} ${xLast},${VB.y1}`} fill="var(--bg-subtle)" />
            <polyline points={line} fill="none" stroke="var(--text-1)" strokeWidth="2" />
          </g>
        ) : (
          seg[0] !== last && (
            <circle key={seg[0].i} cx={xFirst} cy={yAt(seg[0].v).toFixed(1)} r="1.6" fill="var(--text-1)" />
          )
        );
      })}
      <circle cx={xAtIndex(last.i, n).toFixed(1)} cy={yAt(last.v).toFixed(1)} r="2.3" fill="var(--text-1)" />
    </svg>
  );
}

export function AbilityRow({ abilityKey, points, ceiling }: {
  abilityKey: string;
  points: HistoryPoint[];
  ceiling: number;
}) {
  const last = latestValue(points) as number | null;
  const delta = abilityDelta(points) as number | null;
  return (
    <div className="flex items-center gap-3 py-2 border-t border-cz-border first:border-t-0">
      <div className="w-10 shrink-0 font-data text-2xs font-semibold uppercase text-cz-2">
        {SHORT[abilityKey]}
      </div>
      <div className="flex-1 min-w-0">
        <Sparkline points={points} ceiling={ceiling} />
      </div>
      <div className="w-9 shrink-0 text-right font-data text-xs font-bold tabular-nums text-cz-1">
        {last ?? "—"}
      </div>
      <div className={`w-11 shrink-0 text-right font-data text-3xs font-semibold tabular-nums ${
        delta != null && delta > 0 ? "text-cz-success" : delta != null && delta < 0 ? "text-cz-danger" : "text-cz-3"
      }`}>
        {delta == null ? "—" : delta > 0 ? `+${delta}` : delta}
      </div>
    </div>
  );
}

// Saesonakse under en kategori: samme kolonner som AbilityRow. Tegnes som SVG med
// samme viewBox-bredde og skala som Sparkline (begge centreres af
// preserveAspectRatio), saa hvert label staar praecis under sit punkt.
const AXIS_H = 12;
export function SeasonAxis({ seasons, nowLabel }: { seasons: readonly HistorySeason[]; nowLabel: string }) {
  const n = seasons.length;
  const labels = seasonAxisLabels(seasons, { nowLabel }) as { i: number; label: string }[];
  return (
    <div className="flex items-center gap-3 pt-1" aria-hidden="true">
      <div className="w-10 shrink-0" />
      <div className="flex-1 min-w-0">
        <svg viewBox={`0 0 ${VB.w} ${AXIS_H}`} className="block w-full h-3 overflow-visible">
          {labels.map(({ i, label }) => (
            <text
              key={i}
              x={xAtIndex(i, n).toFixed(1)}
              y={AXIS_H - 2}
              textAnchor={n <= 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              className="font-data text-3xs tabular-nums"
              fill="var(--text-3)"
            >
              {label}
            </text>
          ))}
        </svg>
      </div>
      <div className="w-9 shrink-0" />
      <div className="w-11 shrink-0" />
    </div>
  );
}
