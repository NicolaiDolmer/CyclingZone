// #6570 · Etapeprofilen farvet efter stigning (artifact v7): et farvebaand pr.
// 0,5 km, stigningsmaerker med kategori, spurt-maerke, maal, og et hover/tryk-
// kryds der viser km, hoejde, procent, km til maal og km til naeste top.
//
// Tegnes i pixel-koordinater ud fra beholderens maalte bredde (ResizeObserver),
// saa tekst aldrig straekkes. Efter etapen vises den som et smalt baand.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../../lib/intl.js";
import {
  colouredSegments, elevationAt, gradePct, gradeBand, profileScale,
  type Climb, type ElevationSeries, type GradeBand, type StageProfile,
} from "./stagePageV2Model.ts";

export function bandFill(band: GradeBand): { fill: string; opacity: number } {
  if (band === "flat") return { fill: "var(--text-3)", opacity: 0.3 };
  if (band === "down") return { fill: "var(--text-3)", opacity: 0.16 };
  return { fill: `rgb(var(--climb-grad-${band}))`, opacity: 1 };
}

export function categoryLabel(cat: string | null | undefined): string {
  const c = String(cat ?? "").toUpperCase();
  return c === "HC" ? "HC" : c || "?";
}

function useMeasuredWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export interface StageProfileV2Props {
  profile: StageProfile;
  series: ElevationSeries;
  climbs: Climb[];
  selectedClimb: number | null;
  onSelectClimb: (index: number) => void;
  band?: boolean;
}

export default function StageProfileV2({ profile, series, climbs, selectedClimb, onSelectClimb, band = false }: StageProfileV2Props) {
  const { t } = useTranslation("races");
  const [wrapRef, width] = useMeasuredWidth<HTMLDivElement>();
  const [hoverKm, setHoverKm] = useState<number | null>(null);

  const D = Number(profile.distance_km) || series.kms[series.kms.length - 1];
  const narrow = width > 0 && width < 640;
  const H = band ? (narrow ? 130 : 170) : (narrow ? 220 : 320);
  const TOP = band ? 34 : (narrow ? 48 : 78);
  const BOT = 30;
  const W = Math.max(1, width);

  const runs = useMemo(() => {
    const out: ReturnType<typeof colouredSegments>[] = [];
    for (const s of colouredSegments(series)) {
      const last = out[out.length - 1];
      if (last && last[0].band === s.band) last.push(s);
      else out.push([s]);
    }
    return out;
  }, [series]);
  // Fast terraenskala pr. profile_type (#4107), aldrig etapens egen top/bund.
  const { floor, ceil } = useMemo(() => profileScale(profile, series), [profile, series]);
  const X = (km: number) => (km / D) * W;
  const Y = (h: number) => H - BOT - ((h - floor) / (ceil - floor)) * (H - BOT - TOP);

  const grid = useMemo(() => {
    const span = ceil - floor;
    const step = span > 1600 ? 500 : span > 700 ? 250 : 100;
    const out: number[] = [];
    for (let v = Math.ceil(floor / step) * step; v < ceil; v += step) if (v > floor) out.push(v);
    return out;
  }, [floor, ceil]);

  const sprints = (Array.isArray(profile.sprints) ? profile.sprints : []).filter((s) => s.kind === "intermediate");
  const finishH = Math.round(series.hs[series.hs.length - 1]);
  // Maal paa toppen: stigningens eget maerke bærer hoejden, saa maal-teksten udelades.
  const summitFinish = climbs.length > 0 && D - Number(climbs[climbs.length - 1].crest_km) < 1;

  function onPointer(e: ReactPointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const km = Math.max(0, Math.min(D, ((e.clientX - rect.left) / rect.width) * D));
    setHoverKm(km);
  }

  let tip: { left: number; km: number; h: number; grade: number; toGo: number; next: Climb | null } | null = null;
  if (hoverKm !== null && width > 0) {
    const a = Math.max(0, hoverKm - 0.25), b = Math.min(D, hoverKm + 0.25);
    const grade = gradePct(a, elevationAt(series, a), b, elevationAt(series, b));
    tip = {
      left: Math.max(90, Math.min(W - 90, X(hoverKm))),
      km: hoverKm,
      h: elevationAt(series, hoverKm),
      grade,
      toGo: D - hoverKm,
      next: climbs.find((c) => Number(c.crest_km) >= hoverKm) ?? null,
    };
  }

  const kmFmt = (v: number) => formatNumber(Math.round(v * 10) / 10, { maximumFractionDigits: 1 });

  return (
    <div ref={wrapRef} className="relative select-none">
      {width > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={t("stagePageV2.profile.aria", { km: formatNumber(Math.round(D)) })}
          className="block overflow-visible touch-none"
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setHoverKm(null)}
        >
          {grid.map((v) => (
            <g key={v}>
              <line x1={0} x2={W} y1={Y(v)} y2={Y(v)} stroke="var(--border)" strokeWidth={1} />
              <text x={4} y={Y(v) - 4} fontSize={10} fill="var(--text-3)" className="font-data tabular-nums">{`${formatNumber(v)} m`}</text>
            </g>
          ))}
          {selectedClimb !== null && climbs[selectedClimb] && !band && (
            <rect
              x={X(Math.max(0, Number(climbs[selectedClimb].crest_km) - Number(climbs[selectedClimb].length_km)))}
              y={TOP - 30}
              width={Math.max(2, X(Number(climbs[selectedClimb].crest_km)) - X(Math.max(0, Number(climbs[selectedClimb].crest_km) - Number(climbs[selectedClimb].length_km))))}
              height={H - BOT - TOP + 30}
              fill="var(--text-1)"
              opacity={0.05}
            />
          )}
          {runs.map((run, i) => {
            // Sammenhaengende skridt i samme baand tegnes som EEN flade, saa
            // der ingen soemme er mellem dem.
            const f = bandFill(run[0].band);
            const top = run.map((s, j) => `${j === 0 ? `L${X(s.km0)},${Y(s.h0)} ` : ""}L${X(s.km1)},${Y(s.h1)}`).join(" ");
            return (
              <path
                key={i}
                d={`M${X(run[0].km0)},${H - BOT} ${top} L${X(run[run.length - 1].km1)},${H - BOT} Z`}
                fill={f.fill}
                fillOpacity={f.opacity}
              />
            );
          })}
          <path
            d={`M${series.kms.map((k, i) => `${X(k)},${Y(series.hs[i])}`).join(" L")}`}
            fill="none"
            stroke="var(--text-1)"
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
          <rect x={0} y={H - BOT + 6} width={W} height={3} fill="var(--bg-subtle)" />
          {climbs.map((c, i) => {
            const top = Number(c.crest_km);
            const start = Math.max(0, top - Number(c.length_km));
            const tx = X(top), ty = Y(elevationAt(series, top));
            const rightSide = tx > W * 0.6;
            const cat = categoryLabel(c.category);
            return (
              <g key={`${c.name}-${i}`}>
                <rect x={X(start)} y={H - BOT + 4} width={Math.max(2, tx - X(start))} height={7} rx={1} fill="rgb(var(--climb-grad-4))" />
                {!band && (
                  <g
                    role="button"
                    tabIndex={0}
                    aria-label={`${c.name ?? ""}, ${cat}`}
                    className="cursor-pointer"
                    onClick={() => onSelectClimb(i)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectClimb(i); } }}
                  >
                    <line x1={tx} x2={tx} y1={ty} y2={ty - 26} stroke="var(--text-3)" strokeWidth={1} />
                    <rect x={tx - 11} y={ty - 48} width={22} height={20} rx={3} fill={cat === "HC" || cat === "1" ? "rgb(var(--climb-grad-4))" : "rgb(var(--climb-grad-3))"} />
                    <text x={tx} y={ty - 34} textAnchor="middle" fontSize={cat === "HC" ? 10 : 12} fontWeight={700} fill="white" className="font-data">{cat}</text>
                    {!narrow && (
                      <>
                        <text x={tx + (rightSide ? -16 : 16)} y={ty - 40} textAnchor={rightSide ? "end" : "start"} fontSize={12} fontWeight={700} fill="var(--text-1)" className="font-data">{c.name}</text>
                        <text x={tx + (rightSide ? -16 : 16)} y={ty - 26} textAnchor={rightSide ? "end" : "start"} fontSize={11} fill="var(--text-2)" className="font-data tabular-nums">
                          {`${kmFmt(Number(c.length_km))} km · ${kmFmt(Number(c.avg_gradient))} % · ${formatNumber(Math.round(elevationAt(series, top)))} m`}
                        </text>
                      </>
                    )}
                  </g>
                )}
                {D - top >= 4 && <text x={tx} y={H - BOT + 24} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--text-2)" className="font-data tabular-nums">{i === climbs.length - 1 && D - top >= 3 && !narrow ? `${Math.round(top)} · ${t("stagePageV2.profile.toGoAxis", { km: formatNumber(Math.round(D - top)) })}` : Math.round(top)}</text>}
              </g>
            );
          })}
          {!band && sprints.map((s, i) => {
            const sx = X(Number(s.km)), sy = Y(elevationAt(series, Number(s.km)));
            return (
              <g key={`sp-${i}`}>
                <line x1={sx} x2={sx} y1={sy} y2={sy - 20} stroke="var(--text-3)" strokeWidth={1} />
                <circle cx={sx} cy={sy - 28} r={8} fill="var(--color-cz-success)" />
                <text x={sx} y={sy - 24} textAnchor="middle" fontSize={10} fontWeight={700} fill="white" className="font-data">S</text>
                <rect x={sx - 2} y={H - BOT + 4} width={4} height={7} fill="var(--color-cz-success)" />
              </g>
            );
          })}
          <line x1={W - 1} x2={W - 1} y1={Y(finishH)} y2={TOP - 30} stroke="var(--text-2)" strokeWidth={1} />
          {!summitFinish && (
            <text x={W - 6} y={TOP - 34} textAnchor="end" fontSize={11} fontWeight={700} fill="var(--text-1)" className="font-data tabular-nums">
              {t("stagePageV2.profile.finish", { m: formatNumber(finishH) })}
            </text>
          )}
          <text x={0} y={H - 2} fontSize={10} fill="var(--text-3)" className="font-data tabular-nums">0 km</text>
          <text x={W} y={H - 2} textAnchor="end" fontSize={10} fill="var(--text-3)" className="font-data tabular-nums">{`${formatNumber(Math.round(D))} km`}</text>
          {tip && <line x1={X(tip.km)} x2={X(tip.km)} y1={TOP - 30} y2={H - BOT} stroke="var(--text-1)" strokeOpacity={0.5} strokeWidth={1} />}
        </svg>
      )}
      {tip && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-cz border border-cz-border bg-cz-elevated px-2.5 py-2 font-data text-xs tabular-nums text-cz-1"
          style={{ left: tip.left }}
        >
          <div className="font-semibold">{`km ${kmFmt(tip.km)} · ${formatNumber(Math.round(tip.h))} m`}</div>
          <div className="flex items-center gap-1.5 text-cz-2">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: bandFill(gradeBand(tip.grade)).fill, opacity: Math.max(0.4, bandFill(gradeBand(tip.grade)).opacity) }} aria-hidden="true" />
            {`${kmFmt(tip.grade)} % · ${t("stagePageV2.profile.tipToGo", { km: kmFmt(tip.toGo) })}`}
          </div>
          {tip.next && (
            <div className="text-cz-3">{t("stagePageV2.profile.tipToTop", { km: kmFmt(Number(tip.next.crest_km) - tip.km), name: tip.next.name ?? "" })}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function GradientLegend() {
  const { t } = useTranslation("races");
  const items: Array<[GradeBand, string]> = [
    ["flat", "flat"], [2, "band2"], [3, "band3"], [4, "band4"], [5, "band5"], ["down", "down"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
      {items.map(([b, key]) => {
        const f = bandFill(b);
        return (
          <span key={key} className="inline-flex items-center gap-1.5 font-data text-2xs text-cz-2">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: f.fill, opacity: f.opacity }} aria-hidden="true" />
            {t(`stagePageV2.profile.legend.${key}`)}
          </span>
        );
      })}
    </div>
  );
}
