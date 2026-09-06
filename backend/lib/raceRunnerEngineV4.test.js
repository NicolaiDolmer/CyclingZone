// Løbsmotor v4 — flip-infrastruktur, kaldsstedet i raceRunner (#3855, #4707).
//
// Dækker:
//   (a) flag off ⇒ v4 hverken indlæses, kaldes eller koster et DB-kald,
//       og v3-stien er uændret;
//   (b) flag on  ⇒ v4 kaldes, og race_results-rækkerne har PRÆCIS samme
//       kolonnesæt og resultattyper som en v3-kørsel på samme fixture;
//   (c) determinisme: samme etape to gange giver de samme rækker;
//   (d) kill-switch: etape 1 på v4, etape 2 på v3 → GC beregnes uden fejl
//       og bruger BEGGE etaper.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRaceResults,
  buildStageRowsAccumulated,
  resolveRaceEngineV4,
} from "./raceRunner.js";
import { ABILITY_KEYS, ENGINE_VERSION_V3 } from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";
import { ENGINE_VERSION_V4, loadRaceEngineV4, __resetRaceEngineV4Cache } from "./raceEngineV4Bridge.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function abil(seed) {
  const a = {};
  ABILITY_KEYS.forEach((k, i) => { a[k] = 35 + ((seed * 13 + i * 7) % 55); });
  return a;
}

// To hold à 8 = 16 ryttere (over #4295's gulv på 6 pr. hold).
const ENTRANTS = Array.from({ length: 16 }, (_, i) => ({
  rider_id: `r${String(i).padStart(2, "0")}`,
  team_id: i < 8 ? "A" : "B",
  team_name: i < 8 ? "Team A" : "Team B",
  rider_name: `Rider ${i}`,
  is_u25: i % 4 === 0,
  abilities: abil(i),
  fatigue: (i * 3) % 30,
}));

const RACE = { id: "race-v4-runner", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 2 };

const STAGES = [
  {
    stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint",
    demand_vector: DEMAND_VECTORS.flat, distance_km: 180,
    climbs: [], sprints: [{ name: "Sprint", km: 90, kind: "intermediate" }],
    race_id: RACE.id, id: "sp-1",
  },
  {
    stage_number: 2, profile_type: "mountain", finale_type: "long_climb",
    demand_vector: DEMAND_VECTORS.mountain, distance_km: 165,
    climbs: [{ name: "Col", crest_km: 158, category: "1", summit_finish: true }],
    sprints: [{ name: "Sprint", km: 70, kind: "intermediate" }],
    race_id: RACE.id, id: "sp-2",
  },
];

const POINTS = { "stage__1": 100, "stage__2": 60, "gc__1": 200, "gc__2": 120, "leader__1": 50, "team__1": 40, "team_day__1": 20 };

function baseArgs(extra = {}) {
  return { race: RACE, stages: STAGES, entrants: ENTRANTS, pointsLookup: POINTS, v3: true, ...extra };
}

/** Kolonnesættet på en resultatrække — kontrakten mod race_results. */
function columnSignature(rows) {
  return [...new Set(rows.map((r) => Object.keys(r).sort().join("|")))].sort();
}

// ── (a) Flag OFF ───────────────────────────────────────────────────────────

test("#3855 (a) flag off: resolveRaceEngineV4 indlæser INTET og laver ingen DB-kald", async () => {
  let loadEngineCalls = 0;
  let loadOrderCalls = 0;
  const result = await resolveRaceEngineV4({
    supabase: { from: () => { throw new Error("må ikke kaldes ved flag-off"); } },
    race: RACE,
    checkV4Enabled: async () => false,
    loadEngine: async () => { loadEngineCalls += 1; return {}; },
    loadOrders: async () => { loadOrderCalls += 1; return []; },
  });
  assert.deepEqual(result, { v4Engine: null, teamOrderRows: [] });
  assert.equal(loadEngineCalls, 0);
  assert.equal(loadOrderCalls, 0);
});

test("#3855 (a) flag on: motoren indlæses og ordre-rækkerne hentes ÉN gang", async () => {
  let loadEngineCalls = 0;
  const rows = [{ team_id: "A", stage_number: 1, breakaway_stance: "chase", riders: [] }];
  const result = await resolveRaceEngineV4({
    supabase: {},
    race: RACE,
    checkV4Enabled: async () => true,
    loadEngine: async () => { loadEngineCalls += 1; return { version: ENGINE_VERSION_V4 }; },
    loadOrders: async () => rows,
  });
  assert.equal(loadEngineCalls, 1);
  assert.equal(result.v4Engine.version, ENGINE_VERSION_V4);
  assert.deepEqual(result.teamOrderRows, rows);
});

test("#3855 kill-switch-robusthed: kan v4 ikke indlæses, falder afviklingen tilbage til v3", async () => {
  const errors = [];
  const originalError = console.error;
  console.error = (msg) => errors.push(String(msg));
  try {
    const result = await resolveRaceEngineV4({
      supabase: {},
      race: RACE,
      checkV4Enabled: async () => true,
      loadEngine: async () => { throw new Error("modulet er væk"); },
      loadOrders: async () => [],
    });
    assert.deepEqual(result, { v4Engine: null, teamOrderRows: [] });
  } finally {
    console.error = originalError;
  }
  assert.ok(errors.some((e) => e.includes("v4 kunne ikke indlæses")), "fejlen skal larme i loggen");
});

test("#3855 (a) flag off: motoren kaldes ALDRIG, og v3-stien er uændret (engine_version 2)", () => {
  let calls = 0;
  const spyEngine = { version: ENGINE_VERSION_V4, simulateStage: () => { calls += 1; throw new Error("v4 må ikke kaldes ved flag-off"); } };

  const off = buildRaceResults(baseArgs({ v4Engine: null }));
  assert.equal(calls, 0);
  assert.ok(off.runs.every((r) => r.engine_version === ENGINE_VERSION_V3));
  assert.ok(off.runs.every((r) => Array.isArray(r.riderScores) && r.riderScores.length === ENTRANTS.length));

  // Kontrol: samme spion ER non-null → grenen tages, altså er den kun styret af v4Engine.
  assert.throws(() => buildRaceResults(baseArgs({ v4Engine: spyEngine })));
  assert.equal(calls, 1);
});

// ── (b) Flag ON: samme kolonner som v3 ─────────────────────────────────────

test("#3855 (b) flag on: race_results-rækkerne har PRÆCIS samme kolonner og typer som v3", async () => {
  __resetRaceEngineV4Cache();
  const v4Engine = await loadRaceEngineV4();

  const v3Run = buildRaceResults(baseArgs({ v4Engine: null }));
  const v4Run = buildRaceResults(baseArgs({ v4Engine }));

  assert.deepEqual(columnSignature(v4Run.resultRows), columnSignature(v3Run.resultRows),
    "kolonnesættet på race_results-rækkerne må ikke afhænge af hvilken motor der kørte");
  assert.deepEqual(
    [...new Set(v4Run.resultRows.map((r) => r.result_type))].sort(),
    [...new Set(v3Run.resultRows.map((r) => r.result_type))].sort(),
    "samme resultattyper (stage/leader/points_day/mountain_day/young_day/team_day/gc/...)",
  );
  assert.equal(v4Run.resultRows.length, v3Run.resultRows.length, "samme antal rækker");

  // Ranglisten er komplet og uden huller på hver etape.
  for (const stage of [1, 2]) {
    const stageRows = v4Run.resultRows.filter((r) => r.result_type === "stage" && r.stage_number === stage);
    assert.equal(stageRows.length, ENTRANTS.length);
    assert.deepEqual(stageRows.map((r) => r.rank).sort((a, b) => a - b), ENTRANTS.map((_, i) => i + 1));
    assert.ok(stageRows.every((r) => typeof r.finish_time === "string" && r.finish_time.startsWith("+")));
  }

  // Point/præmie udledes af (result_type, rank) — motoren opfinder dem aldrig.
  const v4Winner = v4Run.resultRows.find((r) => r.result_type === "stage" && r.stage_number === 1 && r.rank === 1);
  assert.equal(v4Winner.points_earned, POINTS["stage__1"]);

  // Motorstemplet + de dokumenterede v4-udeladelser.
  assert.ok(v4Run.runs.every((r) => r.engine_version === ENGINE_VERSION_V4));
  assert.ok(v4Run.runs.every((r) => !("riderScores" in r)), "v4 producerer ingen score-komponenter");
  assert.deepEqual(v4Run.incidents, [], "v4 har ingen uheldsmekanik endnu");
  assert.deepEqual(v4Run.moments, [], "neutral fortælling under v4");
});

test("#3855 (b) flag on: passage-laget (spurt-/bjergpoint + bonussekunder) fyldes stadig ud", async () => {
  const v4Engine = await loadRaceEngineV4();
  const v4Run = buildRaceResults(baseArgs({ v4Engine }));
  const stageRows = v4Run.resultRows.filter((r) => r.result_type === "stage");
  // Passage-laget ligger UDEN for motoren (racePassages.js, data-gated på ruten),
  // så det virker uændret under v4 — kolonnerne er numeriske, ikke null.
  assert.ok(stageRows.every((r) => Number.isFinite(r.sprint_points)));
  assert.ok(stageRows.every((r) => Number.isFinite(r.kom_points)));
  assert.ok(stageRows.every((r) => Number.isFinite(r.bonus_seconds)));
  assert.ok(v4Run.passageRows.length > 0, "ruten har en mellemspurt + en bjergpassage");
});

test("#3855 (b) flag on: tidslinjen persisteres som under v3 (samme version, degraderet indhold)", async () => {
  const v4Engine = await loadRaceEngineV4();
  const v3Run = buildRaceResults(baseArgs({ v4Engine: null, timeline: true }));
  const v4Run = buildRaceResults(baseArgs({ v4Engine, timeline: true }));
  assert.equal(v4Run.timelines.length, v3Run.timelines.length);
  assert.deepEqual(
    v4Run.timelines.map((t) => t.timeline_version),
    v3Run.timelines.map((t) => t.timeline_version),
    "samme artefakt-version — aftagerne må ikke skulle kende motoren",
  );
  assert.ok(v4Run.timelines.every((t) => Array.isArray(t.events) && t.events.length > 0));
});

// ── (c) Determinisme ───────────────────────────────────────────────────────

test("#3855 (c) determinisme: samme etape kørt to gange giver identiske race_results-rækker", async () => {
  const v4Engine = await loadRaceEngineV4();
  const a = buildRaceResults(baseArgs({ v4Engine }));
  const b = buildRaceResults(baseArgs({ v4Engine }));
  assert.equal(JSON.stringify(a.resultRows), JSON.stringify(b.resultRows));
  assert.equal(JSON.stringify(a.runs), JSON.stringify(b.runs));
  assert.equal(JSON.stringify(a.passageRows), JSON.stringify(b.passageRows));
});

// ── (d) Kill-switch midt i et etapeløb ─────────────────────────────────────

test("#3855 (d) kill-switch: etape 1 på v4 + etape 2 på v3 → GC bygges på BEGGE etaper", async () => {
  const v4Engine = await loadRaceEngineV4();
  const stagesSorted = STAGES;

  // Etape 1: flaget er ON.
  const stage1 = buildStageRowsAccumulated({
    race: RACE, stagesSorted, stageIndex: 0, entrants: ENTRANTS, pointsLookup: POINTS,
    priorStageRows: [], v3: true, v4Engine,
  });
  assert.equal(stage1.runs[0].engine_version, ENGINE_VERSION_V4);

  // Persisterede etaperækker, som loadPriorStageRows ville levere dem.
  const priorStageRows = stage1.resultRows
    .filter((r) => r.result_type === "stage")
    .map((r) => ({
      stage_number: r.stage_number, result_type: r.result_type, rank: r.rank,
      rider_id: r.rider_id, team_id: r.team_id, finish_time: r.finish_time,
      sprint_points: r.sprint_points, kom_points: r.kom_points, bonus_seconds: r.bonus_seconds,
    }));
  assert.equal(priorStageRows.length, ENTRANTS.length);

  // Etape 2: flaget er slukket midt i løbet → v4Engine er null.
  const stage2 = buildStageRowsAccumulated({
    race: RACE, stagesSorted, stageIndex: 1, entrants: ENTRANTS, pointsLookup: POINTS,
    priorStageRows, v3: true, v4Engine: null,
  });
  assert.equal(stage2.runs[0].engine_version, ENGINE_VERSION_V3, "etape 2 kører v3 uden fejl");

  // GC på slut-etapen: alle ryttere klassificeret, ingen huller, lederen på +0:00.
  const gc = stage2.resultRows.filter((r) => r.result_type === "gc").sort((a, b) => a.rank - b.rank);
  assert.equal(gc.length, ENTRANTS.length, "GC-beregningen fejler ikke og udelader ingen");
  assert.deepEqual(gc.map((r) => r.rank), ENTRANTS.map((_, i) => i + 1));
  assert.equal(gc[0].finish_time, "+0:00");

  // ... og den bruger FAKTISK begge etaper: GC-tiden for hver rytter er summen
  // af etape 1's (v4-skrevne) og etape 2's (v3-skrevne) gaps minus bonussekunder.
  const gapOf = (rows, riderId) => {
    const row = rows.find((r) => r.rider_id === riderId);
    const [m, s] = row.finish_time.replace("+", "").split(":").map(Number);
    return m * 60 + s;
  };
  const bonusOf = (rows, riderId) => rows.find((r) => r.rider_id === riderId)?.bonus_seconds ?? 0;
  const stage2Rows = stage2.resultRows.filter((r) => r.result_type === "stage");
  const cum = new Map(ENTRANTS.map((e) => [
    e.rider_id,
    (gapOf(priorStageRows, e.rider_id) - bonusOf(priorStageRows, e.rider_id))
    + (gapOf(stage2Rows, e.rider_id) - bonusOf(stage2Rows, e.rider_id)),
  ]));
  const leaderTime = Math.min(...cum.values());
  for (const row of gc) {
    const [m, s] = row.finish_time.replace("+", "").split(":").map(Number);
    assert.equal(m * 60 + s, cum.get(row.rider_id) - leaderTime,
      `GC-tiden for ${row.rider_id} skal være summen af begge etaper, uanset motor`);
  }
  // Sanity: mindst én rytter har et gap fra etape 1 med i sin GC-tid.
  assert.ok([...cum.values()].some((v) => v > leaderTime), "etape 1 skal bidrage til GC");
});
