// backend/lib/engine/v4/adapters/routeProfileHills7289.ts
// #7290 (trin 2 af #7289): de ukategoriserede bakker fra hoejdeprofilen
// (race_stage_profiles.elevation_profile, #6594) bliver motor-terraen.
// SSOT: docs/superpowers/specs/2026-10-27-7289-motor-hoejdeprofil-design.md
//
// Rutegeneratoren fylder hullerne mellem stigningerne ud fra profiltypen, saa en
// flad etape kan vaere eet langt `flat`-segment, mens profilen spilleren ser har
// korte bakker ("vejens boelgen", #6366). Her skaeres de bakker ud af `flat`-
// segmenterne som `rolling` (motorens terraen for boelget vej). Stigninger,
// nedkoersler, brosten og eksisterende `rolling` har forrang og roeres ikke, og
// afslutningsrampen er finalens (den modelleres allerede af finale_type).
//
// REN + DETERMINISTISK: ingen rng, ingen IO. Samme raekke giver samme segmenter.
// Kaldes KUN naar kontakten er taendt (routeAdapter-optionen `profileHills`);
// uden den er ruten byte for byte som foer.

import type { Segment } from "../types.ts";

/**
 * Markoeren paa en etape-raekke der taender afledningen (sat af
 * backend/lib/routeProfileHillsFlag.js, kun under s5_profiles_v3 + flaget).
 * camelCase med vilje: ingen DB-kolonne (samme moenster som raceRunners `peakDay`).
 */
export const ROUTE_PROFILE_HILLS_ROW_KEY = "routeProfileHills";

/** En bakke kraever en gennemsnitsstigning paa mindst dette (procent) ... */
export const PROFILE_HILL_MIN_AVG_PCT = 3;
/** ... og mindst saa mange hoejdemeter i alt paa den stigende straekning. */
export const PROFILE_HILL_MIN_GAIN_M = 40;

// Profilens step_km er afrundet til 3 decimaler (routeElevationProfile.js).
const STEP_TOLERANCE_KM = 0.001;

type ElevationProfile = { v?: number; step_km?: number; h?: unknown };

type HillRowFields = {
  distance_km?: number | null;
  elevation_profile?: ElevationProfile | null;
  sprints?: Array<{ kind?: string; ramp_km?: number; ramp_in_climb?: boolean }> | null;
};

function roundKm(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Profilens hoejder, eller null hvis profilen ikke passer til etapens distance (fail-safe). */
function profileHeights(row: HillRowFields): { h: number[]; step: number; distanceKm: number } | null {
  const p = row.elevation_profile;
  const distanceKm = Number(row.distance_km);
  if (!p || typeof p !== "object" || !Array.isArray(p.h) || !(distanceKm > 0)) return null;
  const h = p.h as unknown[];
  if (h.length < 2 || !h.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const step = distanceKm / (h.length - 1);
  if (!(Math.abs(Number(p.step_km) - step) <= STEP_TOLERANCE_KM)) return null;
  return { h: h as number[], step, distanceKm };
}

/** Foerste skridt-indeks i afslutningsrampen (samme skridt som routeElevationProfile laegger den paa). */
function rampStartIndex(row: HillRowFields, steps: number, step: number): number {
  const fin = (Array.isArray(row.sprints) ? row.sprints : []).find(
    (s) => s?.kind === "finish" && Number(s.ramp_km) > 0 && !s.ramp_in_climb,
  );
  if (!fin) return steps;
  const k = Math.min(steps, Math.max(1, Math.round(Number(fin.ramp_km) / step)));
  return steps - k;
}

/** Bakkerne [from_km, to_km] inden for eet flat-segment. */
function hillsInFlatSegment(
  segment: Segment,
  h: number[],
  step: number,
  rampFrom: number,
  isLast: boolean,
): Array<[number, number]> {
  const hills: Array<[number, number]> = [];
  let start = -1;
  let gain = 0;
  let count = 0;
  const close = () => {
    if (start >= 0 && count > 0) {
      const avgPct = (gain / (count * step * 1000)) * 100;
      if (avgPct >= PROFILE_HILL_MIN_AVG_PCT && gain >= PROFILE_HILL_MIN_GAIN_M) {
        // Afrund foerst, klip bagefter: en bakke maa aldrig stikke ud over sit segment.
        const from = Math.max(segment.from_km, roundKm(start * step));
        const to = Math.min(segment.to_km, roundKm((start + count) * step));
        if (to > from) hills.push([from, to]);
      }
    }
    start = -1;
    gain = 0;
    count = 0;
  };
  const steps = h.length - 1;
  for (let i = 0; i < steps; i++) {
    const mid = (i + 0.5) * step;
    const inside = mid >= segment.from_km && (mid < segment.to_km || (isLast && mid <= segment.to_km));
    const rise = h[i + 1] - h[i];
    if (inside && i < rampFrom && rise > 0) {
      if (start < 0) start = i;
      gain += rise;
      count++;
    } else {
      close();
    }
  }
  close();
  return hills;
}

/**
 * #7290: skaer profilens ukategoriserede bakker ud af `flat`-segmenterne som
 * `rolling`. Returnerer SAMME array-reference naar intet aendres (ingen profil,
 * en profil der ikke passer, eller ingen bakker over taersklerne). Inputtet muteres ikke.
 */
export function withProfileHills(segments: Segment[], row: HillRowFields): Segment[] {
  const profile = profileHeights(row);
  if (!profile || segments.length === 0) return segments;
  const { h, step } = profile;
  const rampFrom = rampStartIndex(row, h.length - 1, step);
  let changed = false;
  const out: Segment[] = [];
  segments.forEach((segment, index) => {
    if (segment.kind !== "flat") {
      out.push(segment);
      return;
    }
    const hills = hillsInFlatSegment(segment, h, step, rampFrom, index === segments.length - 1);
    if (hills.length === 0) {
      out.push(segment);
      return;
    }
    changed = true;
    let cursor = segment.from_km;
    for (const [rawFrom, to] of hills) {
      const from = Math.max(rawFrom, cursor);
      if (!(to > from)) continue;
      if (from > cursor) out.push({ ...segment, from_km: cursor, to_km: from });
      out.push({ kind: "rolling", from_km: from, to_km: to });
      cursor = to;
    }
    if (segment.to_km > cursor) out.push({ ...segment, from_km: cursor, to_km: segment.to_km });
  });
  return changed ? out : segments;
}
