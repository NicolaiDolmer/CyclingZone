// backend/lib/engine/v4/adapters/routeProfileHills7289.test.ts
// #7290: hoejdeprofilens ukategoriserede bakker bliver rolling paa de flade segmenter.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Segment } from "../types.ts";
import { PROFILE_HILL_MIN_AVG_PCT, PROFILE_HILL_MIN_GAIN_M, withProfileHills } from "./routeProfileHills7289.ts";

const STEP = 0.5;

/** Hoejdeserie med `rises[i]` meter stigning paa skridt i (0,5 km pr. skridt). */
function profileFrom(rises: number[], start = 100) {
  const h = [start];
  for (const r of rises) h.push(h[h.length - 1] + r);
  return { v: 1, step_km: STEP, h };
}

/** Flad serie paa `steps` skridt med en stigning paa `pct` % over skridt [from, from+len). */
function risesWithHill(steps: number, from: number, len: number, pct: number): number[] {
  const perStep = Math.round(pct * STEP * 10);
  return Array.from({ length: steps }, (_, i) => (i >= from && i < from + len ? perStep : 0));
}

function assertContiguous(segments: readonly Segment[], distanceKm: number): void {
  assert.equal(segments[0].from_km, 0);
  for (let i = 1; i < segments.length; i++) assert.equal(segments[i].from_km, segments[i - 1].to_km, `hul/overlap ved segment ${i}`);
  assert.equal(segments[segments.length - 1].to_km, distanceKm);
  for (const s of segments) assert.ok(s.to_km > s.from_km, `tomt segment ${JSON.stringify(s)}`);
}

test("taersklerne er meningsfulde (en bakke er stejlere end vejens svage boelger)", () => {
  assert.ok(PROFILE_HILL_MIN_AVG_PCT > 0 && PROFILE_HILL_MIN_GAIN_M > 0);
});

test("en bakke paa et fladt segment bliver rolling paa sine egne km; resten forbliver flat", () => {
  // 20 km = 40 skridt; bakke paa skridt 10-17 (km 5-9) paa 5 %.
  const segments: Segment[] = [{ kind: "flat", from_km: 0, to_km: 20 }];
  const row = { distance_km: 20, elevation_profile: profileFrom(risesWithHill(40, 10, 8, 5)) };
  const out = withProfileHills(segments, row);
  assert.deepEqual(out, [
    { kind: "flat", from_km: 0, to_km: 5 },
    { kind: "rolling", from_km: 5, to_km: 9 },
    { kind: "flat", from_km: 9, to_km: 20 },
  ]);
  assertContiguous(out, 20);
});

test("svage boelger under taersklerne roeres ikke (samme array-reference)", () => {
  const segments: Segment[] = [{ kind: "flat", from_km: 0, to_km: 20 }];
  // 1 % over 4 km: for svag.
  const weak = { distance_km: 20, elevation_profile: profileFrom(risesWithHill(40, 10, 8, 1)) };
  assert.equal(withProfileHills(segments, weak), segments);
  // 6 % men kun 0,5 km: for faa hoejdemeter.
  const short = { distance_km: 20, elevation_profile: profileFrom(risesWithHill(40, 10, 1, 6)) };
  assert.equal(withProfileHills(segments, short), segments);
});

test("stigninger, nedkoersler, brosten og eksisterende rolling har forrang", () => {
  const segments: Segment[] = [
    { kind: "rolling", from_km: 0, to_km: 5 },
    { kind: "climb", from_km: 5, to_km: 10, category: "3", avg_gradient: 5, top_elevation_m: 600 },
    { kind: "descent", from_km: 10, to_km: 12, technicality: 2 },
    { kind: "cobbles", from_km: 12, to_km: 16, sector_name: "S", stars: 3 },
    { kind: "flat", from_km: 16, to_km: 20 },
  ];
  // Stigning over hele etapen paa 5 %: kun det flade stykke kan blive rolling.
  const row = { distance_km: 20, elevation_profile: profileFrom(risesWithHill(40, 0, 40, 5)) };
  const out = withProfileHills(segments, row);
  assert.deepEqual(out.slice(0, 4), segments.slice(0, 4));
  assert.deepEqual(out.slice(4), [{ kind: "rolling", from_km: 16, to_km: 20 }]);
  assertContiguous(out, 20);
});

test("en bakke der krydser et segmentskift klippes til det flade segment", () => {
  const segments: Segment[] = [
    { kind: "flat", from_km: 0, to_km: 8 },
    { kind: "climb", from_km: 8, to_km: 10, category: "4", avg_gradient: 5, top_elevation_m: 300 },
    { kind: "flat", from_km: 10, to_km: 20 },
  ];
  // Stigning paa skridt 10-19 (km 5-10) paa 5 %: km 5-8 er flat, km 8-10 er stigningen.
  const row = { distance_km: 20, elevation_profile: profileFrom(risesWithHill(40, 10, 10, 5)) };
  const out = withProfileHills(segments, row);
  assert.deepEqual(out, [
    { kind: "flat", from_km: 0, to_km: 5 },
    { kind: "rolling", from_km: 5, to_km: 8 },
    segments[1],
    segments[2],
  ]);
});

test("afslutningsrampen er finalens: den bliver ikke rolling", () => {
  const segments: Segment[] = [{ kind: "flat", from_km: 0, to_km: 20 }];
  // Rampe paa de sidste 2 km (skridt 36-39) paa 6 %.
  const rises = risesWithHill(40, 36, 4, 6);
  const withRamp = { distance_km: 20, elevation_profile: profileFrom(rises), sprints: [{ kind: "finish", ramp_km: 2, ramp_gradient: 6 }] };
  assert.equal(withProfileHills(segments, withRamp), segments);
  // Uden rampe paa raekken er det en almindelig bakke.
  const noRamp = { distance_km: 20, elevation_profile: profileFrom(rises) };
  assert.deepEqual(withProfileHills(segments, noRamp).at(-1), { kind: "rolling", from_km: 18, to_km: 20 });
  // En rampe der ligger i en stigning (ramp_in_climb) udelukker intet ekstra.
  const inClimb = { ...withRamp, sprints: [{ kind: "finish", ramp_km: 2, ramp_in_climb: true }] };
  assert.deepEqual(withProfileHills(segments, inClimb).at(-1), { kind: "rolling", from_km: 18, to_km: 20 });
});

test("fail-safe: ingen profil, forkert gitter eller ugyldige hoejder giver uaendrede segmenter", () => {
  const segments: Segment[] = [{ kind: "flat", from_km: 0, to_km: 20 }];
  const hill = risesWithHill(40, 10, 8, 5);
  assert.equal(withProfileHills(segments, { distance_km: 20 }), segments);
  assert.equal(withProfileHills(segments, { distance_km: 20, elevation_profile: null }), segments);
  // 40 skridt men distancen siger 30 km (step 0,75 != 0,5).
  assert.equal(withProfileHills(segments, { distance_km: 30, elevation_profile: profileFrom(hill) }), segments);
  const bad = profileFrom(hill);
  bad.h[3] = Number.NaN;
  assert.equal(withProfileHills(segments, { distance_km: 20, elevation_profile: bad }), segments);
  assert.equal(withProfileHills(segments, { distance_km: 0, elevation_profile: profileFrom(hill) }), segments);
});

test("deterministisk og muterer hverken segmenter eller raekke", () => {
  const segments: Segment[] = [{ kind: "flat", from_km: 0, to_km: 20 }];
  const row = { distance_km: 20, elevation_profile: profileFrom(risesWithHill(40, 4, 6, 5).map((r, i) => (i > 25 && i < 33 ? 30 : r))) };
  const before = JSON.stringify({ segments, row });
  const a = withProfileHills(segments, row);
  const b = withProfileHills(segments, row);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify({ segments, row }), before);
  assert.equal(a.filter((s) => s.kind === "rolling").length, 2);
  assertContiguous(a, 20);
});
