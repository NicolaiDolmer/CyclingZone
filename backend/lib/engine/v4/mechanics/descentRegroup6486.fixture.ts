// backend/lib/engine/v4/mechanics/descentRegroup6486.fixture.ts
// #6486 D3-fixturen: bjergetape uden topankomst, to lange stigninger, toppen af
// den sidste ca. 15 km fra maal. Tre varianter af vejen fra toppen til maal:
//   - shortRunIn:    nedkoersel + et kort fladt stykke (nedkoerselsfinalen, #6200)
//   - descentToLine: nedkoersel helt til stregen
//   - longRunIn:     kortere nedkoersel + et laengere fladt stykke (en dal, #6199 B)
// Rene data (en stage_profiles-raekke pr. variant), ingen motor-logik.
// Ruten er syntetisk; feltet er testportens Giro-fixture (scripts/baselines).

type Seg = Record<string, unknown> & { kind: string; from_km: number; to_km: number };

const climb = (from: number, to: number, category: string, avg_gradient: number, top_elevation_m: number): Seg =>
  ({ kind: "climb", from_km: from, to_km: to, category, avg_gradient, top_elevation_m });
const descent = (from: number, to: number, technicality = 2): Seg => ({ kind: "descent", from_km: from, to_km: to, technicality });
const rolling = (from: number, to: number): Seg => ({ kind: "rolling", from_km: from, to_km: to });
const flat = (from: number, to: number): Seg => ({ kind: "flat", from_km: from, to_km: to });

function profileOf(id: string, segments: Seg[]) {
  const climbs = segments.filter((s) => s.kind === "climb").map((s) => ({
    category: s.category, crest_km: s.to_km, length_km: Math.round((s.to_km - s.from_km) * 10) / 10, avg_gradient: s.avg_gradient, summit_finish: false,
  }));
  const distance = segments[segments.length - 1].to_km;
  return Object.freeze({
    id, race_id: "d3-6486", stage_number: 1, profile_type: "mountain", finale_type: "descent",
    demand_vector: { punch: 0.04, tempo: 0.12, tactics: 0.02, climbing: 0.5, recovery: 0.06, endurance: 0.14, randomness: 0.1, positioning: 0.02 },
    generator_version: 5, is_manual: false, generated_at: null, distance_km: distance, elevation_gain_m: 3200,
    climbs, sprints: [{ km: distance, kind: "finish" }], sectors: [], segments, weather: { kind: "overcast", wind_exposure: 0.2 },
  });
}

const head = (): Seg[] => [rolling(0, 95), climb(95, 110, "1", 7.0, 1900), descent(110, 122), rolling(122, 140), climb(140, 155, "1", 7.4, 2100)];

export const D3_NON_SUMMIT_ROUTES_6486 = Object.freeze({
  shortRunIn: profileOf("d3-6486-short-run-in", [...head(), descent(155, 166), flat(166, 170)]),
  descentToLine: profileOf("d3-6486-descent-to-line", [...head(), descent(155, 170)]),
  longRunIn: profileOf("d3-6486-long-run-in", [...head(), descent(155, 162), flat(162, 170)]),
});
