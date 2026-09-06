// backend/scripts/v4TailSpread.test.js
// Tests for hale-spredningsmaalingen (#4885). Maaleredskabet skal selv vaere
// testet foer et tal fra det bruges som argument — samme praecedens som
// headToHeadV4.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DISTANCE_BANDS,
  DISTANCE_EXPERIMENT_KM,
  abilityRankCorrelation,
  buildProxyCalendar,
  enduranceCloneField,
  measureTailSpread,
  runEnduranceExperiment,
  runTailSpread,
  scaledMountainRoute,
  summarizeBy,
} from "./v4TailSpread.js";

// ── Proxy-kalenderen ─────────────────────────────────────────────────────────

test("proxy-kalenderen er deterministisk: samme input giver samme kalender", () => {
  assert.deepEqual(buildProxyCalendar({ raceCount: 6 }), buildProxyCalendar({ raceCount: 6 }));
});

test("proxy-kalenderen daekker de etapetyper hale-maalingen skal rapportere pr. type", () => {
  const rows = buildProxyCalendar({ raceCount: 16 });
  const types = new Set(rows.map((r) => r.profile_type));
  for (const required of ["flat", "mountain", "hilly", "itt"]) {
    assert.ok(types.has(required), `proxy-kalenderen mangler etapetypen "${required}" (fandt: ${[...types].join(", ")})`);
  }
});

test("proxy-kalenderens etape-noegle er unik — ellers deler to etaper seed og feltsample", () => {
  const rows = buildProxyCalendar({ raceCount: 16 });
  assert.equal(new Set(rows.map((r) => r.stage_number)).size, rows.length);
});

test("proxy-kalenderen leverer de felter v4's rute-adapter kraever", () => {
  for (const row of buildProxyCalendar({ raceCount: 4 })) {
    assert.ok(Array.isArray(row.segments) && row.segments.length > 0, `etape ${row.stage_number} mangler segmenter`);
    assert.ok(row.distance_km > 0, `etape ${row.stage_number} mangler distance_km`);
    assert.ok(row.demand_vector, `etape ${row.stage_number} mangler demand_vector`);
  }
});

// ── Selve maalet ─────────────────────────────────────────────────────────────

test("hale-spredning maales som (sidste - vinder) / vindertid, ikke i sekunder", () => {
  const output = {
    results: [
      { rider_id: "a", time_seconds: 1000 },
      { rider_id: "b", time_seconds: 1050 },
      { rider_id: "c", time_seconds: 1100 },
    ],
  };
  const m = measureTailSpread(output);
  assert.equal(m.winnerSeconds, 1000);
  assert.equal(m.spreadSeconds, 100);
  assert.equal(m.spreadPct, 10);
  assert.equal(m.medianGapPct, 5, "median-gappet maales mod samme vindertid");
});

test("hale-spredning er 0 naar hele feltet deler vindertiden (massefinale)", () => {
  const output = { results: [1, 2, 3, 4].map((i) => ({ rider_id: `r${i}`, time_seconds: 900 })) };
  assert.equal(measureTailSpread(output).spreadPct, 0);
});

test("distance-baandene daekker hele km-aksen uden huller eller overlap", () => {
  for (let i = 1; i < DISTANCE_BANDS.length; i++) {
    assert.equal(DISTANCE_BANDS[i].min, DISTANCE_BANDS[i - 1].max, "baandene skal støde op til hinanden");
  }
  assert.equal(DISTANCE_BANDS[0].min, 0);
  assert.equal(DISTANCE_BANDS[DISTANCE_BANDS.length - 1].max, Number.POSITIVE_INFINITY);
});

test("summarizeBy rapporterer median OG maks pr. gruppe", () => {
  const rows = [
    { k: "a", spreadPct: 1, spreadSeconds: 10, medianGapPct: 0.5 },
    { k: "a", spreadPct: 3, spreadSeconds: 30, medianGapPct: 1.5 },
    { k: "a", spreadPct: 5, spreadSeconds: 50, medianGapPct: 2.5 },
    { k: "b", spreadPct: 9, spreadSeconds: 90, medianGapPct: 4.5 },
  ];
  const out = summarizeBy(rows, (r) => r.k);
  const a = out.find((r) => r.key === "a");
  assert.equal(a.n, 3);
  assert.equal(a.medianPct, 3);
  assert.equal(a.maxPct, 5);
  assert.equal(a.medianSeconds, 30);
});

// ── Distance-eksperimentets rute ─────────────────────────────────────────────

test("distance-eksperimentets rute holder FORMEN konstant naar laengden skalerer", () => {
  const shapeOf = (km) =>
    scaledMountainRoute(km).segments.map((s) => [s.kind, Math.round((s.from_km / km) * 1000), Math.round((s.to_km / km) * 1000)]);
  assert.deepEqual(shapeOf(120), shapeOf(280), "kun distance_km maa skille to rute-laengder ad");
  for (const km of DISTANCE_EXPERIMENT_KM) {
    const route = scaledMountainRoute(km);
    assert.equal(route.segments[0].from_km, 0);
    assert.equal(route.segments[route.segments.length - 1].to_km, km, "segmenterne skal daekke hele etapen (invariant 4)");
  }
});

// ── Ende-til-ende (lille felt, faa etaper — holder testen hurtig) ────────────

test("runTailSpread er deterministisk og maaler én raekke pr. (etape, seed)", () => {
  const population = {
    riders: Array.from({ length: 40 }, (_, i) => ({
      id: `r${String(i).padStart(3, "0")}`,
      team_id: `t${i % 8}`,
      abilities: {
        climbing: 10 + (i % 40), time_trial: 10 + (i % 30), flat: 15 + (i % 25), tempo: 12 + (i % 35),
        sprint: 10 + (i % 45), acceleration: 10 + (i % 30), punch: 10 + (i % 28), endurance: 8 + (i % 50),
        recovery: 10 + (i % 20), durability: 10 + (i % 22), descending: 10 + (i % 26), cobblestone: 10 + (i % 24),
        positioning: 0, aggression: 10 + (i % 18), tactics: 0,
      },
    })),
  };
  const stages = buildProxyCalendar({ raceCount: 2 }).slice(0, 3);
  const args = { population, stages, seeds: ["t1", "t2"], fieldSize: 20 };

  const first = runTailSpread(args);
  assert.equal(first.length, stages.length * 2);
  assert.deepEqual(first, runTailSpread(args), "samme seeds skal give samme maaling");
  for (const row of first) {
    assert.ok(row.spreadPct >= 0, "hale-spredning kan aldrig vaere negativ (sidsteplads >= vinder)");
    assert.equal(row.fieldSize, 20);
  }
});

// ── Endurance-eksperimentet ──────────────────────────────────────────────────

test("endurance-klonfeltet adskiller sig KUN paa udholdenhed", () => {
  const riders = enduranceCloneField(3);
  const keysToCompare = Object.keys(riders[0].abilities).filter((k) => k !== "endurance");
  for (const rider of riders) {
    for (const key of keysToCompare) {
      assert.equal(
        rider.abilities[key],
        riders[0].abilities[key],
        `${rider.id} afviger paa "${key}" — saa ville eksperimentet maale mere end udholdenhed`,
      );
    }
  }
  assert.ok(new Set(riders.map((r) => r.abilities.endurance)).size > 1, "udholdenheden SKAL variere");
});

test("rangkorrelationen er +1 naar hoejere evne altid giver bedre placering, og -1 omvendt", () => {
  const results = [
    { rider_id: "a", rank: 1 },
    { rider_id: "b", rank: 2 },
    { rider_id: "c", rank: 3 },
    { rider_id: "d", rank: 4 },
  ];
  const perfect = new Map([["a", 90], ["b", 70], ["c", 50], ["d", 30]]);
  const inverted = new Map([["a", 30], ["b", 50], ["c", 70], ["d", 90]]);
  assert.equal(abilityRankCorrelation(results, perfect), 1);
  assert.equal(abilityRankCorrelation(results, inverted), -1);
  assert.equal(abilityRankCorrelation(results.slice(0, 2), perfect), null, "for faa ryttere => n/a, ikke 0");
});

test("runEnduranceExperiment er deterministisk og daekker alle eksperimentets distancer", () => {
  const args = { seeds: ["e1"], distances: [120, 280] };
  const rows = runEnduranceExperiment(args);
  assert.deepEqual(rows.map((r) => r.distanceKm), [120, 280]);
  assert.deepEqual(rows, runEnduranceExperiment(args));
  for (const row of rows) {
    assert.ok(
      Number.isFinite(row.meanGapPct),
      "gappet mellem laveste og hoejeste udholdenhed skal vaere et tal, ogsaa naar feltet er kloner",
    );
  }
  assert.equal(DISTANCE_EXPERIMENT_KM[0], 120, "eksperimentets korteste distance er ankeret rapporten laeses mod");
});
