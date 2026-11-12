import { useEffect, useRef, useState } from "react";
import {
  linearScale, linePath, nearestIndex, niceTicks, xTickIndices,
} from "../../../lib/svgChartGeometry";

// Delt linjediagram til vækst-dashboardets trend-visninger (DAU/WAU/MAU,
// D1/D7/D30, NPS over tid). #6165: egen lille SVG i stedet for recharts, så det
// tunge chart-bibliotek ikke ligger i bundlen. Samme props som før (data, lines,
// xKey, height, yFormatter). Geometrien ligger i lib/svgChartGeometry.ts.
// Farver kommer fra chartPalette.js (rgb(var(--cz-chart-N))), så de themer i
// både lys og mørk visning uden separat gren. Hairline-gitter, ingen skygger.
function formatDateTick(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(dateStr ?? "");
  return d.toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit" });
}

function formatDateFull(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(dateStr ?? "");
  return d.toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const MARGIN = { top: 8, right: 12, bottom: 24, left: 44 };
const LEGEND_HEIGHT = 28;
const DEFAULT_WIDTH = 600;

function toNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function useContainerWidth(ref) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

export default function TrendLineChart({ data, lines, xKey = "snapshot_date", height = 260, yFormatter }) {
  const wrapRef = useRef(null);
  const width = useContainerWidth(wrapRef);
  const [active, setActive] = useState(/** @type {number | null} */ (null));

  const rows = Array.isArray(data) ? data : [];
  const series = Array.isArray(lines) ? lines : [];
  const svgHeight = Math.max(80, height - (series.length ? LEGEND_HEIGHT : 0));
  const plotW = Math.max(40, width - MARGIN.left - MARGIN.right);
  const plotH = Math.max(40, svgHeight - MARGIN.top - MARGIN.bottom);

  const values = [];
  for (const row of rows) {
    for (const line of series) {
      const n = toNumber(row[line.key]);
      if (n != null) values.push(n);
    }
  }
  const dataMin = values.length ? Math.min(0, ...values) : 0;
  const dataMax = values.length ? Math.max(...values) : 1;
  const yTicks = niceTicks(dataMin, dataMax, Math.max(2, Math.floor(plotH / 56)));
  const yLo = yTicks[0];
  const yHi = yTicks[yTicks.length - 1];
  const yScale = linearScale(yLo, yHi, MARGIN.top + plotH, MARGIN.top);
  const n = rows.length;
  const xAt = (i) => (n <= 1 ? MARGIN.left + plotW / 2 : MARGIN.left + (i / (n - 1)) * plotW);
  const xs = rows.map((_, i) => xAt(i));
  const xTicks = xTickIndices(n, plotW, 56);
  const yOf = (row, key) => {
    const v = toNumber(row[key]);
    return v === null ? null : yScale(v);
  };
  const fmtY = (v) => (yFormatter ? yFormatter(v) : String(v));

  const activeRow = active !== null && rows[active] ? rows[active] : null;
  const activeX = active !== null ? xs[active] : 0;

  const onPointerMove = (e) => {
    if (!n) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = rect.width > 0 ? width / rect.width : 1;
    setActive(nearestIndex(xs, (e.clientX - rect.left) * scale));
  };

  const onKeyDown = (e) => {
    if (!n) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActive((a) => (a == null ? n - 1 : Math.max(0, a - 1)));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setActive((a) => (a == null ? 0 : Math.min(n - 1, a + 1)));
    } else if (e.key === "Escape") {
      setActive(null);
    }
  };

  const tooltipLeft = activeX;
  const flip = activeRow && tooltipLeft > width / 2;

  const summary = activeRow
    ? `${formatDateFull(activeRow[xKey])}: ${series
        .map((l) => `${l.label} ${toNumber(activeRow[l.key]) == null ? "–" : fmtY(toNumber(activeRow[l.key]))}`)
        .join(", ")}`
    : "";

  return (
    <div ref={wrapRef} style={{ width: "100%", height }}>
      <div className="relative" style={{ height: svgHeight }}>
        <svg
          viewBox={`0 0 ${width} ${svgHeight}`}
          width="100%"
          height={svgHeight}
          role="group"
          aria-label={series.map((l) => l.label).join(", ")}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          style={{ display: "block", touchAction: "pan-y", overflow: "visible" }}
        >
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left} x2={MARGIN.left + plotW}
                y1={yScale(tick)} y2={yScale(tick)}
                stroke="var(--border)" strokeDasharray="3 3" strokeWidth={1}
              />
              <text
                x={MARGIN.left - 6} y={yScale(tick)} textAnchor="end" dominantBaseline="middle"
                fill="var(--text-3)" fontSize={11} style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {fmtY(tick)}
              </text>
            </g>
          ))}
          <line
            x1={MARGIN.left} x2={MARGIN.left + plotW}
            y1={MARGIN.top + plotH} y2={MARGIN.top + plotH}
            stroke="var(--border)" strokeWidth={1}
          />
          {xTicks.map((i) => (
            <g key={i}>
              <line
                x1={xs[i]} x2={xs[i]} y1={MARGIN.top + plotH} y2={MARGIN.top + plotH + 4}
                stroke="var(--border)" strokeWidth={1}
              />
              <text
                x={xs[i]} y={MARGIN.top + plotH + 16} textAnchor="middle"
                fill="var(--text-3)" fontSize={11} style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatDateTick(rows[i][xKey])}
              </text>
            </g>
          ))}
          {series.map((line) => (
            <path
              key={line.key}
              d={linePath(rows.map((row, i) => ({ x: xs[i], y: yOf(row, line.key) })), true)}
              fill="none" stroke={line.color} strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round"
            />
          ))}
          {activeRow && (
            <g pointerEvents="none">
              <line
                x1={activeX} x2={activeX} y1={MARGIN.top} y2={MARGIN.top + plotH}
                stroke="var(--text-3)" strokeWidth={1}
              />
              {series.map((line) => {
                const v = toNumber(activeRow[line.key]);
                if (v == null) return null;
                return (
                  <circle
                    key={line.key} cx={activeX} cy={yScale(v)} r={4}
                    fill={line.color} stroke="var(--bg-card)" strokeWidth={2}
                  />
                );
              })}
            </g>
          )}
          <rect
            x={MARGIN.left} y={MARGIN.top} width={plotW} height={plotH}
            fill="transparent"
            onPointerMove={onPointerMove}
            onPointerDown={onPointerMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
        {activeRow && (
          <div
            className="absolute pointer-events-none bg-cz-card border border-cz-border rounded-cz px-3 py-2 text-xs tabular-nums"
            style={{
              top: MARGIN.top,
              left: tooltipLeft,
              transform: `translateX(${flip ? "calc(-100% - 10px)" : "10px"})`,
              maxWidth: Math.max(120, width / 2 - 16),
            }}
          >
            <p className="text-cz-1 font-semibold mb-1">{formatDateFull(activeRow[xKey])}</p>
            {series.map((line) => {
              const v = toNumber(activeRow[line.key]);
              return (
                <p key={line.key} className="flex items-center justify-between gap-3 text-cz-2">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-cz shrink-0" style={{ background: line.color }} />
                    <span className="truncate">{line.label}</span>
                  </span>
                  <span className="font-mono text-cz-1 shrink-0">{v == null ? "–" : fmtY(v)}</span>
                </p>
              );
            })}
          </div>
        )}
        <span className="sr-only" aria-live="polite">{summary}</span>
      </div>
      {series.length > 0 && (
        <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-cz-3" style={{ height: LEGEND_HEIGHT }}>
          {series.map((line) => (
            <li key={line.key} className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 shrink-0" style={{ background: line.color }} />
              {line.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
