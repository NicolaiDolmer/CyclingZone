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
  percentile,
  TAIL_BANDS,
  flatWeatherRoute,
  runEnduranceExperiment,
  runTailSpread,
  runWeatherExperiment,
  scaledMountainRoute,
  summarizeBy,
  WEATHER_EXPERIMENT_CASES,
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

// ── #4885: fysiologisk hale vs. uheldsdrevet hale ───────────────────────────

test("percentilen interpolerer og degenererer sikkert paa tomme/enkelt-vaerdier", () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([7], 0.9), 7);
  assert.equal(percentile([0, 10], 0.5), 5);
  assert.equal(percentile([0, 1, 2, 3, 4], 0.5), 2, "p50 skal vaere medianen");
  assert.equal(percentile([0, 1, 2, 3, 4], 1), 4);
});

test("maalingen skiller den uheldsdrevne hale fra den fysiologiske", () => {
  // Ét styrt paa 60 % af vindertiden maa ikke laese som at feltet har en hale.
  const output = {
    results: [
      { rider_id: "a", time_seconds: 1000, status: "finished" },
      { rider_id: "b", time_seconds: 1005, status: "finished" },
      { rider_id: "c", time_seconds: 1010, status: "finished" },
      { rider_id: "crash", time_seconds: 1600, status: "finished" },
    ],
    incidents: [{ rider_id: "crash", km: 50 }],
  };
  const m = measureTailSpread(output);
  assert.equal(m.spreadPct, 60, "det raa maks-tal ser stadig styrtet");
  assert.equal(m.cleanMaxGapPct, 1, "uden den uheldsramte er halen 1 %");
  assert.equal(m.within2Pct, 75, "3 af 4 ryttere ligger inden for 2 % af vinderen");
  assert.equal(m.finishGroups, 4);
});

test("maalingen taeller M15's OTL og grupetto-redninger fra tidslinjen", () => {
  const output = {
    results: [{ rider_id: "a", time_seconds: 1000, status: "finished" }],
    timeline: {
      events: [
        { type: "outside_time_limit", params: { rider_count: 3 } },
        { type: "grupetto_saved", params: { rider_count: 40 } },
        { type: "finish", params: {} },
      ],
    },
  };
  const m = measureTailSpread(output);
  assert.equal(m.otlCount, 3);
  assert.equal(m.rescuedCount, 40);
});

test("maalingen degenererer sikkert naar incidents/timeline mangler", () => {
  const output = { results: [{ rider_id: "a", time_seconds: 1000 }, { rider_id: "b", time_seconds: 1100 }] };
  const m = measureTailSpread(output);
  assert.equal(m.otlCount, 0);
  assert.equal(m.incidentRiders, 0);
  assert.equal(m.cleanMaxGapPct, 10, "uden uheldsprotokol er hele feltet 'rent'");
});

test("hale-baandene er velformede og ordnet efter hvor haardt terraenet er", () => {
  for (const [key, [lo, hi]] of Object.entries(TAIL_BANDS)) {
    assert.ok(lo >= 0, `${key}: nedre graense kan ikke vaere negativ`);
    assert.ok(hi > lo, `${key}: oevre graense skal ligge over den nedre`);
  }
  // Baandene er et STARTGAET fra virkeligheden, men rangordenen er ikke til
  // forhandling: et bjerg spreder feltet mere end en flad etape.
  assert.ok(TAIL_BANDS.mountain[0] > TAIL_BANDS.hilly[0]);
  assert.ok(TAIL_BANDS.hilly[0] >= TAIL_BANDS.rolling[0]);
  assert.ok(TAIL_BANDS.rolling[1] > TAIL_BANDS.flat[1]);
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

// ── Vejr-eksperimentet (#3855, M11-wiring 6/9) ───────────────────────────────

function syntheticPopulation(count = 40) {
  return {
    riders: Array.from({ length: count }, (_, i) => ({
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
}

test("vejr-eksperimentets rute holder FORMEN konstant naar vejret skifter", () => {
  const sunny = flatWeatherRoute({ kind: "sun", wind_exposure: 0.1 });
  const wet = flatWeatherRoute({ kind: "rain", wind_exposure: 0.1 });
  assert.deepEqual(sunny.segments, wet.segments, "kun vejret maa variere mellem raekkerne");
  assert.equal(sunny.distance_km, wet.distance_km);
  assert.notDeepEqual(sunny.weather, wet.weather);
});

test("runWeatherExperiment er deterministisk og daekker alle vejr-tilfaelde", () => {
  const args = { population: syntheticPopulation(), seeds: ["w1", "w2"], fieldSize: 20 };
  const first = runWeatherExperiment(args);

  assert.equal(first.length, WEATHER_EXPERIMENT_CASES.length);
  assert.deepEqual(first, runWeatherExperiment(args), "samme seeds skal give samme maaling");
  for (const row of first) {
    assert.equal(row.spreadPct.length, 2, "én maaling pr. seed");
    assert.ok(row.meanWinnerSeconds > 0, "vindertiden skal vaere maalt");
  }
});

test("vejr-eksperimentet viser M11's retning: sol og overskyet er identiske, daarligt vejr er langsommere", () => {
  const rows = runWeatherExperiment({ population: syntheticPopulation(), seeds: ["w1", "w2"], fieldSize: 20 });
  const by = (kind) => rows.filter((r) => r.kind === kind);
  const sun = by("sun")[0];
  const overcast = by("overcast")[0];
  const rain = by("rain")[0];

  assert.equal(sun.meanWinnerSeconds, overcast.meanWinnerSeconds, "sol og overskyet er begge baseline");
  assert.equal(sun.weatherEvents, 0, "godt vejr melder sig ikke i tidslinjen");
  assert.ok(overcast.weatherEvents === 0);
  assert.ok(rain.meanWinnerSeconds > sun.meanWinnerSeconds, "regn skal goere etapen langsommere");
  assert.ok(rain.weatherEvents > 0, "regn skal melde sig i tidslinjen");

  // Vind: mere eksponering skal koste mere tid (to vind-raekker i tabellen).
  const windRows = by("wind");
  assert.equal(windRows.length, 2, "eksperimentet skal daekke to vind-eksponeringer");
  assert.ok(
    windRows[1].meanWinnerSeconds > windRows[0].meanWinnerSeconds,
    "hoej vind-eksponering skal koste mere tid end lav",
  );
});
