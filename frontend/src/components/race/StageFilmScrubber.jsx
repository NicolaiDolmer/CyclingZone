// #3859 (løbsfilm-afspiller): scrubberen tegnet OVEN PÅ etapens ÆGTE
// højdeprofil-silhuet (ejer-fix 17/8 — "det ligner ikke ruteprofilen, det
// læses som skema"). Genbruger PRÆCIS samme geometri-kilde som den
// eksisterende rute-graf (StageProfileGraph.jsx / stageRouteProfile.js) i
// stedet for at opfinde en flad linje: `buildProfileSeries(profile)` giver
// den samme silhuet spilleren allerede kender fra holdudtagelsen/etape-
// fanens rute-kort. Events forankres PÅ silhuet-linjen ved deres km
// (altitudeAtKm, stageTimelineFilm.js) i stedet for at svæve frit; forsprings-
// kurven deler km-aksen og trådes sammen med silhuetten via ét fælles
// gold "nu"-lodret + ét fælles clip-path (den afspillede strækning bliver
// gold, resten forbliver blæk/ink — samme sprog som ProgressMeter).
//
// Degraderer til FallbackFilmScrubber (simpel km-akse) for legacy-etaper
// uden rutedata (hasRouteData false) — fallback, ikke standard.
import { buildProfileSeries, hasRouteData } from "../../lib/stageRouteProfile.js";
import { kmToX, altitudeAtKm, climbMarkerHeight } from "../../lib/stageTimelineFilm.js";
import { formatNumber } from "../../lib/intl.js";

const WIDTH = 820;
const PAD = 10;
const PLOT_W = WIDTH - PAD * 2;
const SIL_TOP = 28;
const SIL_H = 56;
const SIL_BASE_Y = SIL_TOP + SIL_H;
const AXIS_Y = SIL_BASE_Y + 11;
// Rigeligt luft mellem km-akse-mærkaterne (AXIS_Y+9) og kurve-titlen
// (CURVE_TOP-5) — de to sad tidligere ~2px fra hinanden og læste som ét
// sammenflydt ord ("kmPRING TIL FELTET") i skærmbillede-reviewet 17/8.
const CURVE_TOP = AXIS_Y + 30;
const CURVE_H = 36;
const CURVE_BASE_Y = CURVE_TOP + CURVE_H;
const SVG_HEIGHT = CURVE_BASE_Y + 6;

// Kategori-mætning for stignings-rampen på silhuetten — SAMME skala som
// StageProfileGraph.jsx's CAT_ALPHA (#671 anti-drift: ét vokabular for
// "hvor hård er kategorien" i hele appen).
const CAT_ALPHA = { HC: 1, "1": 0.8, "2": 0.55, "3": 0.34, "4": 0.2 };
const catFill = (c) => `rgb(var(--jersey-mountain-bg) / ${CAT_ALPHA[c] ?? 0.2})`;
const catText = (c) => (c === "HC" || c === "1" ? "rgb(var(--jersey-mountain-fg))" : "var(--text-1)");

function X(km, distanceKm) { return PAD + kmToX(km, distanceKm, PLOT_W); }

function SilhouetteMarker({ x, y, played, size = 3.2 }) {
  return (
    <circle
      cx={x} cy={y} r={size}
      fill={played ? "rgb(var(--accent))" : "var(--bg-card)"}
      stroke={played ? "rgb(var(--accent-t))" : "var(--text-3)"}
      strokeWidth="1.2"
    />
  );
}

function ClimbChip({ climb, x, crestY, uid }) {
  const w = climb.category === "HC" ? 18 : 12;
  const EDGE = 60;
  const nearEnd = x > WIDTH - PAD - EDGE;
  const nearStart = x < PAD + EDGE;
  const anchor = nearEnd ? "end" : nearStart ? "start" : "middle";
  const textX = nearEnd ? WIDTH - PAD : nearStart ? PAD : x;
  const chipY = 2;
  return (
    <g key={`${uid}-climb-${climb.crest_km}`}>
      <line x1={x} y1={crestY} x2={x} y2={chipY + 22} stroke="var(--text-3)" strokeOpacity="0.55" strokeWidth="0.6" strokeDasharray="2 2" />
      <rect x={x - w / 2} y={chipY} width={w} height={11} rx="1" fill={catFill(climb.category)} />
      <text x={x} y={chipY + 8.2} textAnchor="middle" fontSize="7.5" fontWeight="700" fill={catText(climb.category)}>
        {climb.category}
      </text>
      <text x={textX} y={chipY + 20} textAnchor={anchor} fontSize="7.5" fontWeight="600" className="fill-cz-1 font-data" style={{ letterSpacing: "0.04em" }}>
        {(climb.name || "").toUpperCase()}
      </text>
    </g>
  );
}

/** Silhuet-tilstand: den ægte rute-profil, events forankret på linjen. */
function SilhouetteScrubber({ profile, feedEvents, catchKm, gapCurve, scrubKm, distanceKm, t, uid }) {
  const series = buildProfileSeries(profile);
  if (!series) return null; // burde ikke ske (hasRouteData allerede tjekket af caller) — degraderer stille
  const topY = series.maxY * 1.12 || 1;
  const Yalt = (m) => SIL_TOP + SIL_H - (m / topY) * SIL_H;

  const silhouettePoints = series.xs.map((x, i) => `${X(x, distanceKm).toFixed(1)},${Yalt(series.ys[i]).toFixed(1)}`).join(" ");
  const closedPolygon = `${silhouettePoints} ${X(distanceKm, distanceKm).toFixed(1)},${SIL_BASE_Y} ${X(0, distanceKm).toFixed(1)},${SIL_BASE_Y}`;

  const progressX = X(scrubKm, distanceKm);
  const scrubAlt = altitudeAtKm(series, scrubKm);
  const scrubY = scrubAlt != null ? Yalt(scrubAlt) : SIL_BASE_Y;

  const climbEvents = feedEvents.filter((e) => e.type === "kom_passage");
  const otherEvents = feedEvents.filter((e) => e.type !== "kom_passage");

  return (
    <svg viewBox={`0 0 ${WIDTH} ${SVG_HEIGHT}`} className="block w-full h-auto" aria-hidden="true">
      <defs>
        <clipPath id={`${uid}-progress-clip`}>
          <rect x="0" y="0" width={progressX} height={SVG_HEIGHT} />
        </clipPath>
      </defs>

      {/* Fuld silhuet, altid synlig (hele parcoursen) — dæmpet ink-tone. */}
      <polygon points={closedPolygon} fill="var(--text-1)" fillOpacity="0.08" />
      <polyline points={silhouettePoints} fill="none" stroke="var(--text-1)" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />

      {/* Den afspillede strækning: "jorden der allerede er redet" bliver gold —
          KUN fladen (ikke ryg-linjen), tegnet FØR stignings-ramperne, så en
          kategori-ramp altid forbliver vivid rød ovenpå den gyldne baggrund
          i stedet for at blive vasket ud til en utydelig tan-farve. */}
      <g clipPath={`url(#${uid}-progress-clip)`}>
        <polygon points={closedPolygon} fill="rgb(var(--accent) / 0.18)" />
      </g>

      {/* Stignings-ramperne, kategori-farvet — samme sprog som rute-kortet. Tegnet
          OVEN PÅ den gyldne flade, så kategorien altid er læsbar. */}
      {series.climbs.map((c, i) => {
        const [a, b] = series.spans[i];
        const seg = series.xs.reduce((acc, x, k) => (
          x >= a - 0.4 && x <= b + 0.4 ? `${acc}${X(x, distanceKm).toFixed(1)},${Yalt(series.ys[k]).toFixed(1)} ` : acc
        ), "");
        return (
          <polyline key={`ramp-${i}`} points={seg.trim()} fill="none"
            stroke={`rgb(var(--jersey-mountain-bg) / ${CAT_ALPHA[c.category] ?? 0.5})`}
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        );
      })}

      {/* Klima-navne/kategori-chips ANKRET på silhuetten (ingen fritsvævende trekanter). */}
      {series.climbs.map((c, i) => (
        <ClimbChip key={`chip-${i}`} climb={c} x={X(c.crest_km, distanceKm)} crestY={Yalt(series.ys[Math.round((c.crest_km / distanceKm) * (series.ys.length - 1))])} uid={uid} />
      ))}

      {/* Generiske narrative events (ikke KOM) forankret PÅ silhuet-linjen, tonet gold når afspillet. */}
      {otherEvents.map((e, i) => {
        const alt = altitudeAtKm(series, e.km);
        if (alt == null) return null;
        return <SilhouetteMarker key={`ev-${e.type}-${e.km}-${i}`} x={X(e.km, distanceKm)} y={Yalt(alt)} played={e.km <= scrubKm} />;
      })}
      {climbEvents.map((e, i) => {
        const alt = altitudeAtKm(series, e.km);
        if (alt == null) return null;
        return <SilhouetteMarker key={`kom-${e.km}-${i}`} x={X(e.km, distanceKm)} y={Yalt(alt)} played={e.km <= scrubKm} size={3.6} />;
      })}

      {/* Catch-punkt: ring-markør på linjen, ikke en løsrevet cirkel i bunden. */}
      {catchKm != null && (() => {
        const alt = altitudeAtKm(series, catchKm);
        if (alt == null) return null;
        return <circle cx={X(catchKm, distanceKm)} cy={Yalt(alt)} r="5" fill="var(--bg-card)" stroke="var(--text-1)" strokeWidth="1.6" />;
      })()}

      {/* Scrub-head: gold prik PÅ ridge-linjen, med en lodret gold "nu"-guide der binder silhuet + akse + kurve sammen. */}
      <line x1={progressX} y1={scrubY} x2={progressX} y2={CURVE_BASE_Y} stroke="rgb(var(--accent) / 0.55)" strokeWidth="1" strokeDasharray="2 2" />
      <circle cx={progressX} cy={scrubY} r="4.5" fill="rgb(var(--accent))" stroke="var(--bg-card)" strokeWidth="1.2" />

      {/* Delt km-akse (hairline) mellem silhuet og forsprings-kurve. */}
      <line x1={PAD} y1={AXIS_Y} x2={WIDTH - PAD} y2={AXIS_Y} stroke="var(--border)" strokeWidth="1" />
      <text x={PAD} y={AXIS_Y + 9} className="fill-cz-3 font-data" fontSize="8">{t("detail.film.km", { value: 0 })}</text>
      <text x={WIDTH - PAD} y={AXIS_Y + 9} textAnchor="end" className="fill-cz-3 font-data" fontSize="8">
        {t("detail.film.km", { value: formatNumber(distanceKm) })}
      </text>

      <GapCurveLayer gapCurve={gapCurve || []} distanceKm={distanceKm} progressX={progressX} uid={uid} t={t} />
    </svg>
  );
}

function GapCurveLayer({ gapCurve, distanceKm, progressX, uid, t }) {
  if (!gapCurve.length) return null;
  const maxGap = Math.max(...gapCurve.map((p) => p.gapSeconds), 30) * 1.15;
  const y = (gap) => CURVE_BASE_Y - (gap / maxGap) * CURVE_H;
  const points = gapCurve.map((p) => `${X(p.km, distanceKm).toFixed(1)},${y(p.gapSeconds).toFixed(1)}`).join(" ");
  const curveScrubY = (() => {
    // Trin-funktion: seneste kendte gap-punkt op til scrub-positionen (samme
    // "afspillet"-logik som event-feedet — kurven springer ikke i fremtiden).
    let last = gapCurve[0].gapSeconds;
    for (const p of gapCurve) { if (X(p.km, distanceKm) <= progressX) last = p.gapSeconds; else break; }
    return y(last);
  })();
  return (
    <g>
      <text x={PAD} y={CURVE_TOP - 4} className="fill-cz-3 font-data" fontSize="7.5" style={{ letterSpacing: "0.08em" }}>
        {t("detail.film.gapCurveTitle").toUpperCase()}
      </text>
      <line x1={PAD} y1={CURVE_BASE_Y} x2={WIDTH - PAD} y2={CURVE_BASE_Y} stroke="var(--border)" strokeWidth="1" />
      <polyline points={points} fill="none" stroke="var(--text-2)" strokeWidth="1.5" />
      <g clipPath={`url(#${uid}-progress-clip)`}>
        <polyline points={points} fill="none" stroke="rgb(var(--accent))" strokeWidth="2" />
      </g>
      <circle cx={progressX} cy={curveScrubY} r="3.2" fill="rgb(var(--accent))" stroke="var(--bg-card)" strokeWidth="1" />
    </g>
  );
}

/** Fallback: simpel km-akse uden ægte terræn (legacy/PCM-etaper uden rutedata). */
function FallbackScrubber({ climbMarkers, catchKm, scrubKm, distanceKm, t }) {
  const axisY = 30;
  const height = 60;
  const progressX = X(scrubKm, distanceKm);
  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} className="block w-full h-auto" aria-hidden="true">
      <line x1={PAD} y1={axisY} x2={WIDTH - PAD} y2={axisY} stroke="var(--border)" strokeWidth="1" />
      <line x1={PAD} y1={axisY} x2={progressX} y2={axisY} stroke="rgb(var(--accent))" strokeWidth="3" strokeLinecap="round" />
      {climbMarkers.map((c, i) => {
        const x = X(c.km, distanceKm);
        const h = climbMarkerHeight(c.category);
        return (
          <path key={`climb-${i}`}
            d={`M${(x - 4).toFixed(1)},${axisY} L${x.toFixed(1)},${(axisY - h).toFixed(1)} L${(x + 4).toFixed(1)},${axisY} Z`}
            fill="rgb(var(--jersey-mountain-bg) / 0.75)" />
        );
      })}
      {catchKm != null && (
        <circle cx={X(catchKm, distanceKm)} cy={axisY} r="3.5" fill="var(--bg-card)" stroke="var(--text-2)" strokeWidth="1.5" />
      )}
      <circle cx={progressX} cy={axisY} r="4.5" fill="rgb(var(--accent))" />
      <text x={PAD} y={height - 2} className="fill-cz-3 font-data" fontSize="9">{t("detail.film.km", { value: 0 })}</text>
      <text x={WIDTH - PAD} y={height - 2} textAnchor="end" className="fill-cz-3 font-data" fontSize="9">
        {t("detail.film.km", { value: formatNumber(distanceKm) })}
      </text>
    </svg>
  );
}

export default function StageFilmScrubber({ profile, feedEvents, climbMarkers, catchKm, gapCurve, scrubKm, distanceKm, t }) {
  const uid = "film-scrub";
  if (hasRouteData(profile)) {
    return (
      <SilhouetteScrubber
        profile={profile}
        feedEvents={feedEvents}
        catchKm={catchKm}
        gapCurve={gapCurve}
        scrubKm={scrubKm}
        distanceKm={distanceKm || Number(profile.distance_km)}
        t={t}
        uid={uid}
      />
    );
  }
  return (
    <>
      <FallbackScrubber climbMarkers={climbMarkers} catchKm={catchKm} scrubKm={scrubKm} distanceKm={distanceKm} t={t} />
      <GapCurveFallback gapCurve={gapCurve} distanceKm={distanceKm} scrubKm={scrubKm} t={t} />
    </>
  );
}

// Fallback-kurven er en selvstændig lille SVG (ingen delt akse-geometri at
// hægte på, uden en silhuet at binde sig til) — bevidst enklere end
// GapCurveLayer, samme princip som resten af fallback-stien.
function GapCurveFallback({ gapCurve, distanceKm, scrubKm, t }) {
  if (!gapCurve.length) return null;
  const H = 44, padT = 6, padB = 12;
  const plotH = H - padT - padB;
  const maxGap = Math.max(...gapCurve.map((p) => p.gapSeconds), 30) * 1.15;
  const x = (km) => X(km, distanceKm);
  const y = (gap) => padT + plotH - (gap / maxGap) * plotH;
  const points = gapCurve.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.km).toFixed(1)},${y(p.gapSeconds).toFixed(1)}`).join(" ");
  return (
    <div className="mt-2">
      <p className="text-cz-3 text-3xs uppercase tracking-wider font-semibold mb-1">{t("detail.film.gapCurveTitle")}</p>
      <svg viewBox={`0 0 ${WIDTH} ${H}`} className="block w-full h-auto" role="img" aria-label={t("detail.film.gapCurveTitle")}>
        <line x1={PAD} y1={padT + plotH} x2={WIDTH - PAD} y2={padT + plotH} stroke="var(--border)" strokeWidth="1" />
        <path d={points} fill="none" stroke="var(--text-2)" strokeWidth="1.5" />
        <line x1={x(scrubKm)} y1={padT} x2={x(scrubKm)} y2={padT + plotH} stroke="rgb(var(--accent))" strokeWidth="1.5" strokeDasharray="2,2" />
      </svg>
    </div>
  );
}
