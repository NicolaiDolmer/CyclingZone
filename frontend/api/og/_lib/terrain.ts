// #6574: etapens terræn som en ærlig, stykvis lineær profil — tegnet KUN ud fra rutens egne data.
//
// Ejer 13/10: "profilen skal vise etapens RIGTIGE terræn fra ruten, aldrig dekorative takker/bølger".
// race_stage_profiles har ingen punkt-for-punkt-højder; det rutens data siger, er segmentlisten
// (segments: flad / bølget / stigning / nedkørsel / brosten, med km) og stigningerne (længde og
// gennemsnitlig stigningsprocent). Profilen her er præcis det og intet mere:
//
//   stigning   ret rampe med stigningens egen gennemsnitsprocent over segmentets km
//   nedkørsel  fald med højst DESCENT_M_PER_KM (samme loft som etapesiden), aldrig under dalen
//   flad/bølget/brosten  vandret: ruten angiver ingen højdeforskel her, så kurven opfinder ingen.
//              Bølget terræn og brosten vises i km-båndet under profilen, ikke som falske takker.
//
// Etapens samlede højdemeter (elevation_gain_m) står som tal i hovedet; kurven påstår ikke at
// summere til det, fordi det ikke-kategoriserede bølgeterræn ikke har nogen placering i dataene.
//
// #6594: har etapen en rigtig højdeserie (elevation_profile, ét punkt pr. 0,5 km), tegnes den i stedet:
// ét stykke pr. skridt, farvet efter skridtets egen stigningsprocent (samme skala), nedkørsel dæmpet.
// Serien kommer fra generatoren og summerer til etapens højdemeter. Mangler den (S1-S4), er alt
// ovenstående uændret.
//
// Ældre rækker uden segments: stigningerne giver ramperne, og efter hver top lægges en nedkørsel
// efter samme loft (frem til næste stignings fod eller dalen). Resten er vandret.
import { DESCENT_M_PER_KM, elevationScaleFor, valleyBaseFor } from "../../../src/lib/stageRouteProfile.js";
import type { SegmentKind, StageRoute, Category } from "./stageRoute.ts";

export interface TerrainRun {
  kind: SegmentKind;
  from_km: number;
  to_km: number;
  startM: number;
  endM: number;
  /** -1 nedkørsel, 0 neutral, 1-4 = 3-6 / 6-8 / 8-10 / over 10 % (fælles road book-skala, #6570). */
  band: number;
  gradient?: number;
  category?: Category;
}
export interface Terrain {
  /** Det der tegnes: ét stykke pr. segment (uden serie) eller pr. skridt (med serie). */
  runs: TerrainRun[];
  /** Altid rutens segment-stykker; km-båndet (bølget/brosten) læser dem også når profilen er en serie. */
  segmentRuns: TerrainRun[];
  /** true når profilen er den rigtige højdeserie. */
  fromSeries: boolean;
  valley: number;
  peak: number;
  /** Fast højdeloft pr. etapetype (ejer-låst 23/8, #4107); udvides kun hvis toppen ligger over. */
  maxY: number;
  /** true når segmentlisten manglede og nedkørslerne er afledt af stigningerne. */
  derived: boolean;
  elevationAt: (km: number) => number;
}

/** Fælles road book-skala (#6570): -1 nedkørsel, 0 = under 3 %, 1-4 = 3-6, 6-8, 8-10, over 10 %. */
export function gradeBand(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  if (pct <= -3) return -1;
  if (pct < 3) return 0;
  if (pct < 6) return 1;
  if (pct < 8) return 2;
  if (pct < 10) return 3;
  return 4;
}

interface RawSeg { kind: SegmentKind; from_km: number; to_km: number; avg_gradient?: number; category?: Category }

/** Segmentlisten uden huller/overlap over [0, D]; huller fyldes som flad (ruten siger intet om dem). */
function coverSegments(segs: RawSeg[], D: number): RawSeg[] {
  const out: RawSeg[] = [];
  let cursor = 0;
  for (const s of segs) {
    const from = Math.max(s.from_km, cursor);
    const to = Math.min(s.to_km, D);
    if (to - from < 1e-6) continue;
    if (from - cursor > 1e-6) out.push({ kind: "flat", from_km: cursor, to_km: from });
    out.push({ ...s, from_km: from, to_km: to });
    cursor = to;
  }
  if (D - cursor > 1e-6) out.push({ kind: "flat", from_km: cursor, to_km: D });
  return out;
}

/** Ældre rækker: ramper fra climbs[], nedkørsel efter hver top (samme loft), resten flad. */
function segmentsFromClimbs(route: StageRoute): RawSeg[] {
  const out: RawSeg[] = [];
  const climbs = route.climbs;
  let cursor = 0;
  climbs.forEach((c, i) => {
    const foot = Math.max(cursor, c.crest_km - c.length_km);
    if (c.crest_km - foot < 0.1) return;
    out.push({ kind: "climb", from_km: foot, to_km: c.crest_km, avg_gradient: c.avg_gradient, category: c.category });
    const gainM = (c.crest_km - foot) * 10 * c.avg_gradient;
    const nextFoot = i + 1 < climbs.length ? Math.max(c.crest_km, climbs[i + 1].crest_km - climbs[i + 1].length_km) : route.distance_km;
    const descentEnd = Math.min(nextFoot, c.crest_km + gainM / DESCENT_M_PER_KM);
    if (descentEnd - c.crest_km > 0.1) out.push({ kind: "descent", from_km: c.crest_km, to_km: descentEnd });
    cursor = Math.max(c.crest_km, descentEnd);
  });
  return out;
}

/** Ét stykke pr. skridt af højdeserien; punkterne ligger jævnt over [0, D]. */
function seriesRuns(h: number[], D: number): TerrainRun[] {
  const stepKm = D / (h.length - 1);
  const out: TerrainRun[] = [];
  for (let i = 0; i < h.length - 1; i++) {
    const pct = ((h[i + 1] - h[i]) / (stepKm * 1000)) * 100;
    const band = gradeBand(pct);
    out.push({
      kind: band > 0 ? "climb" : band < 0 ? "descent" : "flat",
      from_km: i * stepKm, to_km: (i + 1) * stepKm, startM: h[i], endM: h[i + 1], band, gradient: pct,
    });
  }
  return out;
}

export function buildTerrain(route: StageRoute): Terrain {
  const D = route.distance_km;
  const valley = valleyBaseFor(route.type);
  const derived = route.segments.length === 0;
  const segs = coverSegments(derived ? segmentsFromClimbs(route) : route.segments, D);

  const runs: TerrainRun[] = [];
  let alt = valley;
  for (const s of segs) {
    const len = s.to_km - s.from_km;
    let end = alt;
    let band = 0;
    if (s.kind === "climb") {
      const g = s.avg_gradient ?? 0;
      end = alt + len * 10 * g;
      band = gradeBand(g);
    } else if (s.kind === "descent") {
      end = Math.max(valley, alt - DESCENT_M_PER_KM * len);
      band = -1;
    }
    runs.push({ kind: s.kind, from_km: s.from_km, to_km: s.to_km, startM: alt, endM: end, band, gradient: s.avg_gradient, category: s.category });
    alt = end;
  }

  const segmentRuns = runs;
  const series = route.elevation;
  const drawn = series ? seriesRuns(series.h, D) : runs;
  const base = series ? Math.min(...series.h) : valley;

  const peak = drawn.reduce((m, r) => Math.max(m, r.startM, r.endM), base);
  const maxY = Math.max(elevationScaleFor(route.type), peak * 1.04);

  const elevationAt = (km: number): number => {
    if (!drawn.length) return valley;
    if (km <= drawn[0].from_km) return drawn[0].startM;
    for (const r of drawn) {
      if (km <= r.to_km) {
        const t = (km - r.from_km) / (r.to_km - r.from_km || 1);
        return r.startM + t * (r.endM - r.startM);
      }
    }
    return drawn[drawn.length - 1].endM;
  };

  return { runs: drawn, segmentRuns, fromSeries: Boolean(series), valley: base, peak, maxY, derived: series ? false : derived, elevationAt };
}
