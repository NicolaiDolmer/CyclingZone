import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { buildProfileSeries, waypointsFor } from "../../lib/stageRouteProfile.js";

// Sub-4 (#2448): etapeprofil som SVG. Geometrien kommer fra stageRouteProfile.js;
// her bor KUN tegningen. Alle farver fra cz-tokens (#671 anti-drift): KOM-rød =
// --jersey-mountain, sprint-grøn = --jersey-points, mål/aktiv = --text-1.

// Stejlhed → intensitet på rampen. Ét hue, tre trin — ikke en regnbue.
function gradientAlpha(g) { return g >= 8 ? 1 : g >= 6 ? 0.62 : 0.38; }
// Kategori-mætning: HC massiv, cat 4 svag.
const CAT_ALPHA = { HC: 1, "1": 0.8, "2": 0.55, "3": 0.34, "4": 0.2 };
const catFill = (c) => `rgb(var(--jersey-mountain-bg) / ${CAT_ALPHA[c] ?? 0.2})`;
const catText = (c) => (c === "HC" || c === "1" ? "rgb(var(--jersey-mountain-fg))" : "var(--text-1)");

const PAD = {
  full:    { l: 40, r: 16, t: 74, b: 66 },
  compact: { l: 12, r: 16, t: 26, b: 34 },
  mini:    { l: 0,  r: 0,  t: 2,  b: 2 },
};

export default function StageProfileGraph({
  profile, tier = "full", width = 900, height = 340, yMax,
  activeWaypoint = null, onWaypointSelect = null, uid = "sp",
}) {
  const { t } = useTranslation("races");
  const series = useMemo(() => buildProfileSeries(profile, yMax ? { yMax } : {}), [profile, yMax]);
  const waypoints = useMemo(() => waypointsFor(profile), [profile]);
  if (!series) return null;

  const mini = tier === "mini";
  const full = tier === "full";
  const p = PAD[tier] ?? PAD.compact;
  const plotW = width - p.l - p.r;
  const plotH = height - p.t - p.b;
  const D = Number(profile.distance_km);
  const top = series.maxY * 1.12;
  const X = (km) => p.l + (km / D) * plotW;
  const Y = (m) => p.t + plotH - (m / top) * plotH;
  const baseY = p.t + plotH;

  const points = series.xs.map((x, i) => `${X(x).toFixed(1)},${Y(series.ys[i]).toFixed(1)}`).join(" ");
  const sectors = Array.isArray(profile.sectors) ? profile.sectors : [];
  const kmStep = D > 200 ? 40 : D > 60 ? 20 : D > 20 ? 5 : 1;
  const gridStep = top > 3000 ? 1000 : top > 1200 ? 500 : top > 400 ? 200 : 100;
  const gridLines = [];
  for (let m = gridStep; m <= top; m += gridStep) gridLines.push(m);
  const kmTicks = [];
  for (let k = 0; k <= D; k += kmStep) kmTicks.push(k);

  const lastClimb = series.climbs.length ? series.climbs[series.climbs.length - 1] : null;
  const finishY = lastClimb?.summit_finish ? Y(series.ys[series.ys.length - 1]) - 6 : baseY - 28;
  const axisY = baseY + (full ? 16 : 12);
  const isActive = (w) => activeWaypoint && activeWaypoint.kind === w.kind && activeWaypoint.index === w.index;
  const pick = (w) => (onWaypointSelect ? () => onWaypointSelect(w) : undefined);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block w-full h-auto overflow-visible"
      preserveAspectRatio={mini ? "none" : undefined}
      role={mini ? undefined : "img"}
      aria-hidden={mini ? "true" : undefined}
      aria-label={mini ? undefined : t("detail.route.a11y.graph", {
        number: profile.stage_number ?? 1, distance: D,
        elevation: profile.elevation_gain_m ?? 0, climbs: series.climbs.length,
      })}
    >
      <defs>
        <pattern id={`${uid}-pave`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="var(--text-2)" strokeOpacity="0.5" strokeWidth="1.8" />
        </pattern>
        <pattern id={`${uid}-chk`} width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill="var(--text-1)" />
          <rect width="3" height="3" fill="var(--bg-card)" />
          <rect x="3" y="3" width="3" height="3" fill="var(--bg-card)" />
        </pattern>
      </defs>

      {full && gridLines.map((m) => (
        <g key={`g${m}`}>
          <line x1={p.l} y1={Y(m)} x2={width - p.r} y2={Y(m)} stroke="var(--text-3)" strokeOpacity="0.2" strokeWidth="0.5" />
          <text x={p.l - 6} y={Y(m) + 3} textAnchor="end" className="fill-cz-3 font-mono" fontSize="9">{m}</text>
        </g>
      ))}

      {sectors.map((s, i) => (
        <rect key={`sec${i}`} x={X(s.start_km)} y={p.t} width={Math.max(1.4, (s.length_km / D) * plotW)}
          height={plotH} fill={`url(#${uid}-pave)`} opacity="0.5" />
      ))}

      {!mini && series.spans.map(([a, b], i) => (
        <rect key={`band${i}`} x={X(a)} y={p.t} width={X(b) - X(a)} height={plotH}
          fill="rgb(var(--jersey-mountain-bg))"
          fillOpacity={activeWaypoint?.kind === "kom" && activeWaypoint.index === i ? 0.15 : 0.045}
          stroke="rgb(var(--jersey-mountain-bg))" strokeOpacity="0.15" strokeWidth="0.5" />
      ))}

      <polygon points={`${points} ${X(D)},${baseY} ${X(0)},${baseY}`} fill="var(--text-1)" fillOpacity="0.09" />
      <polyline points={points} fill="none" stroke="var(--text-1)" strokeWidth={mini ? 1 : 1.2}
        strokeLinejoin="round" strokeLinecap="round" />

      {series.climbs.map((c, i) => {
        const [a, b] = series.spans[i];
        const seg = series.xs.reduce((acc, x, k) => (x >= a - 0.4 && x <= b + 0.4
          ? acc + `${X(x).toFixed(1)},${Y(series.ys[k]).toFixed(1)} ` : acc), "");
        return (
          <polyline key={`ramp${i}`} points={seg.trim()} fill="none"
            stroke={`rgb(var(--jersey-mountain-bg) / ${gradientAlpha(c.avg_gradient)})`}
            strokeWidth={mini ? 1.6 : 2.4} strokeLinecap="round" strokeLinejoin="round" />
        );
      })}

      {!mini && series.climbs.map((c, i) => {
        const cx = X(c.crest_km);
        const crestIdx = Math.round((c.crest_km / D) * (series.xs.length - 1));
        const cy = Y(series.ys[crestIdx]);
        const labelY = (full ? 10 : 4) + (full ? i % 2 : 0) * 30;
        const w = c.category === "HC" ? 20 : 13;
        // Label-ankeret trækkes ind ved kanterne. En summit-finish har
        // crest_km === distance_km, så dens navn ville ellers centreres PÅ
        // grafens højre kant og løbe ~40 px udenfor — og det er præcis de
        // etaper hvor stigningen er dagens historie.
        const EDGE = 64;
        const nearEnd = cx > width - p.r - EDGE;
        const nearStart = cx < p.l + EDGE;
        const textAnchor = nearEnd ? "end" : nearStart ? "start" : "middle";
        const textX = nearEnd ? width - p.r : nearStart ? p.l : cx;
        // Point-mærkatet sidder normalt til højre for chippen; ved højre kant
        // flyttes det til venstre for den, så det ikke skydes ud over stregen.
        const ptsX = nearEnd ? cx - w / 2 - 4 : cx + w / 2 + 4;
        const ptsAnchor = nearEnd ? "end" : "start";
        return (
          <g key={`lbl${i}`}>
            <line x1={cx} y1={cy} x2={cx} y2={labelY + (full ? 30 : 14)}
              stroke="var(--text-3)" strokeOpacity="0.55" strokeWidth="0.6" strokeDasharray="2 2" />
            <rect x={cx - w / 2} y={labelY} width={w} height={12} rx="1" fill={catFill(c.category)} />
            <text x={cx} y={labelY + 8.8} textAnchor="middle" fontSize="8" fontWeight="700" fill={catText(c.category)}>
              {c.category}
            </text>
            {full && (
              <>
                <text x={ptsX} y={labelY + 9} textAnchor={ptsAnchor} fontSize="7.5" className="font-mono"
                  fill="rgb(var(--jersey-mountain-bg))">
                  {waypoints.find((wp) => wp.kind === "kom" && wp.index === i)?.points}p
                </text>
                <text x={textX} y={labelY + 22} textAnchor={textAnchor} fontSize="8.5" fontWeight="600"
                  className="fill-cz-1" style={{ letterSpacing: "0.05em" }}>
                  {(c.name || "").toUpperCase()}
                </text>
                <text x={textX} y={labelY + 31} textAnchor={textAnchor} fontSize="8" className="fill-cz-2 font-mono">
                  {t("detail.route.waypoint.gradient", {
                    length: c.length_km.toFixed(1), gradient: c.avg_gradient.toFixed(1),
                  })}
                </text>
              </>
            )}
          </g>
        );
      })}

      {!mini && (
        <>
          <line x1={p.l} y1={axisY} x2={width - p.r} y2={axisY} stroke="var(--text-3)" strokeOpacity="0.5" strokeWidth="0.7" />
          {kmTicks.map((k) => (
            <g key={`km${k}`}>
              <line x1={X(k)} y1={axisY} x2={X(k)} y2={axisY + 4} stroke="var(--text-3)" strokeOpacity="0.5" strokeWidth="0.7" />
              <text x={X(k)} y={axisY + 15} textAnchor="middle" fontSize="9" className="fill-cz-3 font-mono">{k}</text>
            </g>
          ))}
          {waypoints.map((w) => {
            if (w.kind === "kom") {
              const x = X(w.km);
              return (
                <path key={`mk-kom-${w.index}`} d={`M${x - 5} ${axisY - 1} L${x} ${axisY - 10} L${x + 5} ${axisY - 1} Z`}
                  fill={catFill(w.category)} stroke={isActive(w) ? "var(--text-1)" : "none"} strokeWidth="1.2"
                  className={onWaypointSelect ? "cursor-pointer" : undefined}
                  onClick={pick(w)} onMouseEnter={pick(w)} />
              );
            }
            if (w.kind === "sprint") {
              return (
                <g key={`mk-spr-${w.index}`}>
                  <line x1={X(w.km)} y1={p.t} x2={X(w.km)} y2={axisY}
                    stroke="rgb(var(--jersey-points-bg))" strokeOpacity="0.4" strokeWidth="0.7" strokeDasharray="3 3" />
                  <circle cx={X(w.km)} cy={axisY - 5} r="4.5" fill="rgb(var(--jersey-points-bg))"
                    stroke={isActive(w) ? "var(--text-1)" : "none"} strokeWidth="1.2"
                    className={onWaypointSelect ? "cursor-pointer" : undefined}
                    onClick={pick(w)} onMouseEnter={pick(w)} />
                  {full && (
                    <text x={X(w.km) + 8} y={axisY - 8} fontSize="8" className="font-mono"
                      fill="rgb(var(--jersey-points-bg))">
                      {t("detail.route.sprintMarker", { points: w.points, bonus: w.bonus })}
                    </text>
                  )}
                </g>
              );
            }
            return null;
          })}
          <line x1={X(D)} y1={finishY} x2={X(D)} y2={baseY} stroke="var(--text-1)" strokeWidth="1" />
          <rect x={X(D) - 13} y={finishY - 10} width="13" height="9" fill={`url(#${uid}-chk)`}
            stroke={activeWaypoint?.kind === "finish" ? "var(--text-1)" : "none"} strokeWidth="1.2"
            className={onWaypointSelect ? "cursor-pointer" : undefined}
            onClick={pick(waypoints[waypoints.length - 1])} onMouseEnter={pick(waypoints[waypoints.length - 1])} />
        </>
      )}
    </svg>
  );
}
