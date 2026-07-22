// Sub-2 (#2770), Task 5: raceRunner-integration af passage-laget (mellemsprint/
// KOM-konkurrencer + bonussekunder) i buildRaceResults (whole-race-stien).
// Rene builds — ingen DB (mønster fra raceRunner.test.js). Fixture-hjælpere er
// kopieret lokalt (ikke importeret fra raceRunner.test.js's interne scope).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRaceResults } from "./raceRunner.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";

const ABILITY_KEYS = [
  "climbing", "endurance", "recovery", "punch", "sprint",
  "acceleration", "positioning", "cornering", "descending", "timeTrial",
];
function abil(overrides = {}) {
  const a = {};
  for (const k of ABILITY_KEYS) a[k] = 50;
  return Object.assign(a, overrides);
}
function entrant(id, team_id, overrides = {}, is_u25 = false) {
  return { rider_id: id, team_id, rider_name: id, is_u25, abilities: abil(overrides) };
}

// 6 ryttere på 2 hold; udtalt sprinter + udtalt klatrer + fyld.
const ENTRANTS = [
  entrant("climber", "A", { climbing: 96, endurance: 92, recovery: 84, punch: 72 }),
  entrant("sprinter", "A", { sprint: 96, acceleration: 92, positioning: 88 }),
  entrant("a3", "A", { endurance: 60, climbing: 55 }),
  entrant("b1", "B", { climbing: 70, endurance: 68 }),
  entrant("b2", "B", { sprint: 72, acceleration: 66 }),
  entrant("b3", "B", { punch: 64, climbing: 50 }),
];

const RACE = { id: "passage-race-1", race_type: "stage_race", race_class: "ProSeries", season_id: "s1" };

// Stage 1: flad m. mellemsprint + mål. Stage 2: bjerg m. kategoriseret stigning + mål.
const STAGES_WITH_ROUTES = [
  {
    stage_number: 1, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat,
    distance_km: 180,
    climbs: [],
    sprints: [{ name: "Inter", km: 100, kind: "intermediate" }, { name: "Finish", km: 180, kind: "finish" }],
    sectors: [],
  },
  {
    stage_number: 2, profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain,
    distance_km: 160,
    climbs: [{ name: "Col X", category: "1", crest_km: 140, length_km: 10, avg_gradient: 7, summit_finish: false }],
    sprints: [{ name: "Finish", km: 160, kind: "finish" }],
    sectors: [],
  },
];
// Klon UDEN rutefelter (kun de felter motoren selv bruger) — samme profile_type/
// demand_vector/stage_number, så simulateStage's input er identisk.
const STAGES_BARE = STAGES_WITH_ROUTES.map(({ stage_number, profile_type, demand_vector }) => ({
  stage_number, profile_type, demand_vector,
}));

const POINTS = {}; // ikke relevant for disse tests (points_earned/prize_money urørt af passage-laget)

function rowsBy(rows, type, stage) {
  return rows.filter((r) => r.result_type === type && (stage == null || r.stage_number === stage));
}

test("stage-rækker bærer sprint_points/kom_points/bonus_seconds når rutedata findes", () => {
  const { resultRows } = buildRaceResults({ race: RACE, stages: STAGES_WITH_ROUTES, entrants: ENTRANTS, pointsLookup: POINTS, v3: false });
  const stageRows = rowsBy(resultRows, "stage", 1);
  assert.ok(stageRows.length > 0);
  assert.ok(stageRows.every((r) => r.sprint_points != null && r.kom_points != null && r.bonus_seconds != null),
    "ALLE stage-rækker skal bære numeriske værdier (0 for ikke-scorere), ALDRIG null, når passage-laget er aktivt for etapen");
  const winner = stageRows.find((r) => r.rank === 1);
  assert.ok(winner.bonus_seconds >= 10, "etapevinderen skal mindst have mål-bonussen (10s)");

  // Bjerg-etapen (stage 2): kom_points > 0 for mindst én rytter (den kategoriserede stigning).
  const stage2Rows = rowsBy(resultRows, "stage", 2);
  assert.ok(stage2Rows.some((r) => r.kom_points > 0), "stage 2 (bjerg) skal uddele kom_points via den kategoriserede stigning");
});

test("passageRows returneres og matcher perRider-aggregaterne", () => {
  const { resultRows, passageRows } = buildRaceResults({ race: RACE, stages: STAGES_WITH_ROUTES, entrants: ENTRANTS, pointsLookup: POINTS, v3: false });
  assert.ok(passageRows.length > 0);
  // Alle passageRows for stage 1 skal have race_id/stage_number + waypoint-metadata sat.
  for (const p of passageRows.filter((x) => x.stage_number === 1)) {
    assert.equal(p.race_id, RACE.id);
    assert.ok(["kom", "sprint", "finish"].includes(p.waypoint_kind));
    assert.ok(Number.isInteger(p.passage_rank) && p.passage_rank >= 1);
  }
  const agg = new Map();
  for (const p of passageRows.filter((x) => x.stage_number === 1)) {
    const cur = agg.get(p.rider_id) || 0;
    agg.set(p.rider_id, cur + p.bonus_seconds);
  }
  const stageRows = rowsBy(resultRows, "stage", 1);
  for (const r of stageRows) {
    assert.equal(r.bonus_seconds, agg.get(r.rider_id) || 0, `${r.rider_id}: stage-rækkens bonus_seconds skal matche summen af passageRows`);
  }
});

test("motorens rangorden er BIT-IDENTISK med/uden passage-lag (deep-equal på rank-rækkefølgen, IKKE finish_time)", () => {
  // Sub-3 (#2771) gør rutedata (stageGapModel: summit/dal/kategori/distance)
  // BEVIDST med til at ændre gab-størrelsen (finish_time) — det er selve
  // formålet med den rute-bevidste motor. Invarianten fra Sub-2 der stadig
  // ufravigeligt skal holde er derfor rank-ORDENEN: passage-laget (sprint-
  // point/KOM-point/bonussekunder) er et lag OVEN PÅ motorens rangering og må
  // ALDRIG selv omrokere den. finish_time-lighed er ikke længere en gyldig
  // proxy for det siden Sub-3 (jf. golden-gate i raceRunnerRouteAware.test.js,
  // der stadig håndhæver bit-identiske SCORES for etaper uden rutedata).
  const withRoutes = buildRaceResults({ race: RACE, stages: STAGES_WITH_ROUTES, entrants: ENTRANTS, pointsLookup: POINTS, v3: false });
  const bare = buildRaceResults({ race: RACE, stages: STAGES_BARE, entrants: ENTRANTS, pointsLookup: POINTS, v3: false });
  const key = (rows) => rows.filter((r) => r.result_type === "stage").map((r) => `${r.stage_number}:${r.rank}:${r.rider_id}`);
  assert.deepEqual(key(withRoutes.resultRows), key(bare.resultRows));
});

test("uden rutedata: kolonner er null (legacy) og passageRows tom", () => {
  const { resultRows, passageRows } = buildRaceResults({ race: RACE, stages: STAGES_BARE, entrants: ENTRANTS, pointsLookup: POINTS, v3: false });
  assert.deepEqual(passageRows, []);
  const stageRows = rowsBy(resultRows, "stage", 1);
  assert.ok(stageRows.length > 0);
  for (const r of stageRows) {
    assert.equal(r.sprint_points, null);
    assert.equal(r.kom_points, null);
    assert.equal(r.bonus_seconds, null);
  }
});

test("endagsløb (isStageRace=false): computePassages-kontrakten holder — ingen passage-rækker/aggregater", () => {
  const single = { id: "passage-single-1", race_type: "single", race_class: "ProSeries", season_id: "s1" };
  const stage = [{ ...STAGES_WITH_ROUTES[0], stage_number: 1 }];
  const { resultRows, passageRows } = buildRaceResults({ race: single, stages: stage, entrants: ENTRANTS, pointsLookup: POINTS, v3: false });
  assert.deepEqual(passageRows, []);
  // Endagsløb emitterer 'gc' (ikke 'stage') — bekræft ingen passage-felter smittede af.
  const gcRows = rowsBy(resultRows, "gc");
  assert.ok(gcRows.length > 0);
  for (const r of gcRows) {
    assert.equal(r.sprint_points, null);
    assert.equal(r.kom_points, null);
    assert.equal(r.bonus_seconds, null);
  }
});

// ── GC afspejler bonussekunder ────────────────────────────────────────────────
// Fixture: 6 ryttere med IDENTISKE abilities på 2 flade etaper (fuldt felt-bunch,
// gap=0 begge dage for alle → GC afgøres UDEN bonus af countback (posSum) og til
// sidst rider_id-alfabetisk). r1 og r5 ender EMPIRISK helt tids-lige (samme
// kumulative gap=0 OG samme posSum=7 — verificeret nedenfor via stage-rækkerne),
// men r5 optjener flere bonussekunder (mellemsprint + mål-bonus på tværs af de 2
// etaper) end r1 → r5 SKAL stå øverst i GC, selvom en ren tid/countback-afgørelse
// (uden bonus) ville give r1 forrang (alfabetisk tie-break).
function gcBonusFixture() {
  const gcEntrants = ["r1", "r2", "r3", "r4", "r5", "r6"].map((id, i) => entrant(id, i < 3 ? "A" : "B"));
  const race = { id: "gc-bonus-race", race_type: "stage_race", race_class: "ProSeries", season_id: "s1" };
  const flatWithRoute = (stageNumber) => ({
    stage_number: stageNumber, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat,
    distance_km: 180,
    climbs: [],
    sprints: [{ name: "Inter", km: 100, kind: "intermediate" }, { name: "Finish", km: 180, kind: "finish" }],
    sectors: [],
  });
  const stages = [flatWithRoute(1), flatWithRoute(2)];
  return { race, stages, entrants: gcEntrants };
}

test("GC afspejler bonussekunder (rytter med flere bonussekunder leder foran en rå tids-tie)", () => {
  const { race, stages, entrants } = gcBonusFixture();
  const { resultRows } = buildRaceResults({ race, stages, entrants, pointsLookup: {}, v3: false });
  const stageRows = rowsBy(resultRows, "stage");

  // Verificér selve tie-forudsætningen empirisk (ikke antaget): r1 og r5 har
  // samme kumulative rå-gap (0 begge dage) OG samme posSum (sum af etape-rank).
  const rawGap = (id) => stageRows.filter((r) => r.rider_id === id)
    .reduce((sum, r) => sum + /^\+(\d+):(\d{2})$/.exec(r.finish_time).slice(1).reduce((s, v, i2) => s + Number(v) * (i2 === 0 ? 60 : 1), 0), 0);
  const posSum = (id) => stageRows.filter((r) => r.rider_id === id).reduce((sum, r) => sum + r.rank, 0);
  const totalBonus = (id) => stageRows.filter((r) => r.rider_id === id).reduce((sum, r) => sum + (r.bonus_seconds || 0), 0);

  assert.equal(rawGap("r1"), rawGap("r5"), "forudsætning: r1/r5 tids-lige på rå gap");
  assert.equal(posSum("r1"), posSum("r5"), "forudsætning: r1/r5 tids-lige på countback (posSum)");
  assert.ok(totalBonus("r5") > totalBonus("r1"), "forudsætning: r5 har flere bonussekunder end r1");

  const gc = rowsBy(resultRows, "gc");
  const rankOf = (id) => gc.find((r) => r.rider_id === id).rank;
  assert.ok(rankOf("r5") < rankOf("r1"), "r5 skal lede r1 i GC pga. flere bonussekunder, trods identisk rå tid/countback");
});
