// backend/lib/engine/v4/adapters/routeAdapter.test.ts
// Race Engine v4 F2 (#4030), Fase B4: kontrakt-tests for routeAdapter.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { routeFromStageProfileRow, type StageProfileRow } from "./routeAdapter.ts";

// ── Moderne raekke (segments/weather allerede gemt, #3855 F1) ────────────────

test("routeFromStageProfileRow: bruger gemte segments/weather naar de findes (korte segmenter uaendret)", () => {
  const segments = [
    { kind: "flat" as const, from_km: 0, to_km: 20 },
    { kind: "climb" as const, from_km: 20, to_km: 26, category: "3" as const, avg_gradient: 5, top_elevation_m: 600 },
    { kind: "descent" as const, from_km: 26, to_km: 32, technicality: 2 as const },
    { kind: "rolling" as const, from_km: 32, to_km: 55 },
  ];
  const row: StageProfileRow = {
    id: "p1",
    race_id: "r1",
    stage_number: 1,
    profile_type: "flat",
    finale_type: "bunch_sprint",
    distance_km: 55,
    climbs: [],
    sprints: [{ name: "Sprint 1", km: 40, kind: "intermediate" }],
    sectors: [],
    segments,
    weather: { kind: "rain", wind_exposure: 0.3 },
  };
  const route = routeFromStageProfileRow(row);
  assert.equal(route.distance_km, 55);
  assert.equal(route.profile_type, "flat");
  assert.equal(route.finale_type, "bunch_sprint");
  assert.deepEqual(route.segments, segments);
  assert.deepEqual(route.weather, { kind: "rain", wind_exposure: 0.3 });
});

// ── #5812 (c): lange flade/rullende segmenter deles paa LAESESIDEN ───────────

function assertContiguous(segments: readonly { from_km: number; to_km: number }[], distanceKm: number): void {
  assert.equal(segments[0].from_km, 0);
  assert.equal(segments[segments.length - 1].to_km, distanceKm);
  for (let i = 1; i < segments.length; i++) {
    assert.equal(segments[i].from_km, segments[i - 1].to_km, `segment ${i} skal starte hvor segment ${i - 1} slutter`);
  }
}

test("#5812 en flad 190 km-etape uden stigninger bliver IKKE ét segment: stykker paa hoejst ca. 25 km", () => {
  const row: StageProfileRow = {
    id: "flat-190", race_id: "race-flat-190", stage_number: 1,
    profile_type: "flat", finale_type: "bunch_sprint",
    distance_km: 190,
    climbs: [], sprints: [], sectors: [],
    // Praecis det S4-kalenderen har skrevet: ét segment fra start til maal.
    segments: [{ kind: "flat", from_km: 0, to_km: 190 }],
    weather: { kind: "sun", wind_exposure: 0 },
  };
  const route = routeFromStageProfileRow(row);
  assert.ok(route.segments.length > 1, "en 190 km flad etape skal have flere segmenter");
  for (const seg of route.segments) {
    assert.equal(seg.kind, "flat");
    assert.ok(seg.to_km - seg.from_km <= 25, `segment ${seg.from_km}-${seg.to_km} er for langt`);
    assert.ok(seg.to_km - seg.from_km > 0);
  }
  assertContiguous(route.segments, 190);
});

test("#5812 opdelingen roerer kun flad/rullende: stigninger, nedkoersler og brosten beholdes 1:1", () => {
  const climb = { kind: "climb" as const, from_km: 140, to_km: 170, category: "1" as const, avg_gradient: 7, top_elevation_m: 1800 };
  const descent = { kind: "descent" as const, from_km: 170, to_km: 200, technicality: 3 as const };
  const cobbles = { kind: "cobbles" as const, from_km: 60, to_km: 90, sector_name: "Lang sektor", stars: 5 as const };
  const row: StageProfileRow = {
    id: "mixed", race_id: "race-mixed", stage_number: 4,
    profile_type: "mountain", finale_type: "long_climb",
    distance_km: 230,
    climbs: [], sprints: [], sectors: [],
    segments: [
      { kind: "flat", from_km: 0, to_km: 60 },
      cobbles,
      { kind: "rolling", from_km: 90, to_km: 140 },
      climb,
      descent,
      { kind: "flat", from_km: 200, to_km: 230 },
    ],
    weather: { kind: "sun", wind_exposure: 0 },
  };
  const route = routeFromStageProfileRow(row);
  assert.deepEqual(route.segments.filter((s) => s.kind === "climb"), [climb]);
  assert.deepEqual(route.segments.filter((s) => s.kind === "descent"), [descent]);
  assert.deepEqual(route.segments.filter((s) => s.kind === "cobbles"), [cobbles]);
  for (const seg of route.segments.filter((s) => s.kind === "flat" || s.kind === "rolling")) {
    assert.ok(seg.to_km - seg.from_km <= 25, `${seg.kind} ${seg.from_km}-${seg.to_km} er for langt`);
  }
  // Rullende forbliver rullende, flad forbliver flad.
  assert.ok(route.segments.some((s) => s.kind === "rolling" && s.from_km === 90));
  assert.ok(route.segments.every((s) => !(s.kind === "rolling" && s.from_km < 90)));
  assertContiguous(route.segments, 230);
});

test("#5812 opdelingen er deterministisk og muterer ikke raekken", () => {
  const stored = [{ kind: "flat" as const, from_km: 0, to_km: 173.4 }];
  const row: StageProfileRow = {
    id: "det", race_id: "race-det", stage_number: 2,
    profile_type: "flat", finale_type: "bunch_sprint",
    distance_km: 173.4,
    climbs: [], sprints: [], sectors: [],
    segments: stored,
    weather: { kind: "sun", wind_exposure: 0 },
  };
  const a = routeFromStageProfileRow(row);
  const b = routeFromStageProfileRow(row);
  assert.deepEqual(a, b);
  assert.deepEqual(stored, [{ kind: "flat", from_km: 0, to_km: 173.4 }], "raekkens gemte segmenter maa ikke muteres");
  assertContiguous(a.segments, 173.4);
});

test("#5812 legacy-syntesen (ingen gemte segmenter) faar ogsaa korte flade segmenter", () => {
  const row: StageProfileRow = {
    id: "legacy-flat", race_id: "race-legacy-flat", stage_number: 1,
    profile_type: "flat", finale_type: "bunch_sprint",
    distance_km: 200,
    climbs: [], sprints: [], sectors: [],
    segments: null, weather: null,
  };
  const route = routeFromStageProfileRow(row);
  for (const seg of route.segments.filter((s) => s.kind === "flat" || s.kind === "rolling")) {
    assert.ok(seg.to_km - seg.from_km <= 25, `${seg.kind} ${seg.from_km}-${seg.to_km} er for langt`);
  }
  assertContiguous(route.segments, 200);
});

test("routeFromStageProfileRow: waypoints = kom (climbs) + sprint (intermediate) + finish, sorteret paa km", () => {
  const row: StageProfileRow = {
    id: "p2",
    race_id: "r2",
    stage_number: 1,
    profile_type: "hilly",
    finale_type: "punch",
    distance_km: 150,
    climbs: [{ name: "Col A", crest_km: 100, category: "2" }],
    sprints: [
      { name: "Sprint 1", km: 40, kind: "intermediate" },
      { name: "Finish-sprint-noise", km: 150, kind: "finish" }, // ikke intermediate -> udelades
    ],
    segments: [{ kind: "flat", from_km: 0, to_km: 150 }],
    weather: { kind: "sun", wind_exposure: 0.1 },
  };
  const route = routeFromStageProfileRow(row);
  assert.deepEqual(
    route.waypoints.map((w) => [w.kind, w.km, w.name]),
    [
      ["sprint", 40, "Sprint 1"],
      ["kom", 100, "Col A"],
      ["finish", 150, "Finish"],
    ],
  );
});

test("routeFromStageProfileRow: summit_finish og category baeres videre paa kom-waypoints", () => {
  const row: StageProfileRow = {
    id: "p3", race_id: "r3", stage_number: 1, profile_type: "mountain", finale_type: "long_climb",
    distance_km: 170,
    climbs: [{ name: "HC Summit", crest_km: 170, category: "HC", summit_finish: true }],
    sprints: [],
    segments: [{ kind: "climb", from_km: 150, to_km: 170, category: "HC", avg_gradient: 7, top_elevation_m: 2000 }],
    weather: { kind: "overcast", wind_exposure: 0.2 },
  };
  const route = routeFromStageProfileRow(row);
  const komWp = route.waypoints.find((w) => w.kind === "kom");
  assert.ok(komWp);
  assert.equal(komWp?.category, "HC");
  assert.equal(komWp?.summit_finish, true);
});

// ── Legacy-raekker (segments/weather null — #3855 F1 punkt 3-fallback) ───────

test("routeFromStageProfileRow: legacy uden segments/weather -> deterministisk synthesizeSegments/buildWeather-fallback", () => {
  const row: StageProfileRow = {
    id: "legacy-1", race_id: "race-legacy-1", stage_number: 2,
    profile_type: "mountain", finale_type: "long_climb",
    distance_km: 170,
    climbs: [], sprints: [], sectors: [],
    segments: null, weather: null,
  };
  const route = routeFromStageProfileRow(row);
  assert.ok(route.segments.length > 0);
  assert.ok(["sun", "overcast", "rain", "wind"].includes(route.weather.kind));
  assert.equal(route.segments[route.segments.length - 1].to_km, 170);
});

test("routeFromStageProfileRow: legacy-fallback er deterministisk (samme raekke -> byte-identisk route, to kald)", () => {
  const row: StageProfileRow = {
    id: "legacy-2", race_id: "race-legacy-2", stage_number: 5,
    profile_type: "hilly", finale_type: "punch",
    climbs: [], sprints: [], sectors: [],
    segments: undefined, weather: undefined,
  };
  const a = routeFromStageProfileRow(row);
  const b = routeFromStageProfileRow(row);
  assert.deepEqual(a, b);
});

test("routeFromStageProfileRow: legacy uden distance_km afleder distance af segmentlistens sidste graense", () => {
  const row: StageProfileRow = {
    id: "legacy-3", race_id: "race-legacy-3", stage_number: 1,
    profile_type: "flat", finale_type: "bunch_sprint",
    climbs: [], sprints: [], sectors: [],
    segments: null, weather: null,
  };
  const route = routeFromStageProfileRow(row);
  assert.ok(route.distance_km > 0);
  assert.equal(route.segments[route.segments.length - 1].to_km, route.distance_km);
});

test("routeFromStageProfileRow: ukendt/manglende profile_type falder tilbage til 'flat'", () => {
  const row: StageProfileRow = {
    id: "legacy-4", race_id: "race-legacy-4", stage_number: 1,
    profile_type: "not-a-real-profile", finale_type: null,
    climbs: [], sprints: [], sectors: [],
    segments: null, weather: null,
  };
  const route = routeFromStageProfileRow(row);
  assert.equal(route.profile_type, "flat");
});

test("routeFromStageProfileRow: to forskellige legacy-raekker (forskellig race_id/stage_number) giver forskellige segmentlister", () => {
  const rowA: StageProfileRow = {
    id: "a", race_id: "race-a", stage_number: 1, profile_type: "cobbles", finale_type: "breakaway",
    climbs: [], sprints: [], sectors: [], segments: null, weather: null,
  };
  const rowB: StageProfileRow = {
    id: "b", race_id: "race-b", stage_number: 1, profile_type: "cobbles", finale_type: "breakaway",
    climbs: [], sprints: [], sectors: [], segments: null, weather: null,
  };
  const routeA = routeFromStageProfileRow(rowA);
  const routeB = routeFromStageProfileRow(rowB);
  assert.notDeepEqual(routeA.segments, routeB.segments);
});

// ── #2789 fund 5: raekkens EGNE sectors[] skal laeses, ikke genopfindes ──────

test("routeFromStageProfileRow: legacy uden segments MEN med egne sectors -> sektorerne bliver cobbles-segmenter paa deres egne km", () => {
  const row: StageProfileRow = {
    id: "sect-1", race_id: "race-sect-1", stage_number: 3,
    profile_type: "cobbles", finale_type: "reduced_sprint",
    distance_km: 160,
    climbs: [], sprints: [],
    sectors: [
      { kind: "cobbles", name: "Sektor Alfa", start_km: 72, length_km: 2 },
      { kind: "cobbles", name: "Sektor Omega", start_km: 152, length_km: 2.5 },
    ],
    segments: null, weather: null,
  };
  const route = routeFromStageProfileRow(row);
  const cobbles = route.segments.filter((s) => s.kind === "cobbles");
  assert.equal(cobbles.length, 2, "begge sektorer skal blive til cobbles-segmenter");
  assert.deepEqual(
    cobbles.map((s) => [s.from_km, s.to_km]),
    [[72, 74], [152, 154.5]],
    "sektorernes egne km skal baeres videre, ikke genopfindes af synthesizeSegments",
  );
  // Ejer-beslutning 6/9: en sektor der slutter taet paa maal skal overleve hele vejen
  // ind i motorens segmentliste — ellers kan en brostens-finale ikke opstaa.
  assert.ok(route.distance_km - cobbles[1].to_km <= 10);
  assert.equal(route.segments[route.segments.length - 1].to_km, 160);
});

test("routeFromStageProfileRow: grus-sektorer bliver ogsaa cobbles-SEGMENTER (RACE_ENGINE_RULES §2b: fysikken er den samme)", () => {
  const row: StageProfileRow = {
    id: "sect-2", race_id: "race-sect-2", stage_number: 1,
    profile_type: "gravel", finale_type: "punch",
    distance_km: 200,
    climbs: [], sprints: [],
    sectors: [{ kind: "gravel", name: "Strada Bianca 1", start_km: 100, length_km: 5 }],
    segments: null, weather: null,
  };
  const route = routeFromStageProfileRow(row);
  const cobbles = route.segments.filter((s) => s.kind === "cobbles");
  assert.equal(cobbles.length, 1);
  assert.deepEqual([cobbles[0].from_km, cobbles[0].to_km], [100, 105]);
});

test("routeFromStageProfileRow: sektor-stien er deterministisk (samme raekke -> byte-identisk route)", () => {
  const row: StageProfileRow = {
    id: "sect-3", race_id: "race-sect-3", stage_number: 2,
    profile_type: "cobbles", finale_type: "breakaway",
    distance_km: 165,
    climbs: [], sprints: [],
    sectors: [{ kind: "cobbles", name: "Sektor A", start_km: 80, length_km: 2 }],
    segments: null, weather: null,
  };
  assert.deepEqual(routeFromStageProfileRow(row), routeFromStageProfileRow(row));
});

test("routeFromStageProfileRow: raekke UDEN egne climbs/sectors bruger stadig den blinde syntese", () => {
  const row: StageProfileRow = {
    id: "sect-4", race_id: "race-sect-4", stage_number: 1,
    profile_type: "cobbles", finale_type: "breakaway",
    distance_km: 160,
    climbs: [], sprints: [], sectors: [],
    segments: null, weather: null,
  };
  const route = routeFromStageProfileRow(row);
  assert.ok(route.segments.length > 0);
  assert.equal(route.segments[route.segments.length - 1].to_km, 160);
});
