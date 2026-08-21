import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRaceResults,
  loadEntrantsForRace,
  simulateRace,
  deriveIsU25FromBirthdate,
  restDaysBeforeEachStage,
} from "./raceRunner.js";
import { isRaceEngineV2Enabled, isRaceEngineV3ScoringEnabled } from "./raceEngineFlag.js";
import { PRIZE_PER_POINT } from "./economyConstants.js";
import { ABILITY_KEYS, stableSeed } from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";

const ALLOWED_RESULT_TYPES = new Set([
  "stage", "gc", "points", "mountain", "young", "team",
  "leader", "mountain_day", "points_day", "young_day", "team_day",
]);

function abil(overrides = {}) {
  const a = {};
  for (const k of ABILITY_KEYS) a[k] = 50;
  return Object.assign(a, overrides);
}
function entrant(id, team_id, overrides = {}, is_u25 = false) {
  return { rider_id: id, team_id, rider_name: id, is_u25, abilities: abil(overrides) };
}

// 8 ryttere på 2 hold; én udtalt klatrer, én udtalt sprinter, 2 U25.
const ENTRANTS = [
  entrant("climber", "A", { climbing: 96, endurance: 92, recovery: 84, punch: 72 }, true),
  entrant("sprinter", "A", { sprint: 96, acceleration: 92, positioning: 88 }, false),
  entrant("a3", "A", { endurance: 60, climbing: 55 }, false),
  entrant("a4", "A", { sprint: 60, positioning: 58 }, false),
  entrant("b1", "B", { climbing: 70, endurance: 68 }, false),
  entrant("b2", "B", { sprint: 72, acceleration: 66 }, true),
  entrant("b3", "B", { punch: 64, climbing: 50 }, false),
  entrant("b4", "B", { endurance: 55, recovery: 52 }, false),
];

const STAGE_RACE = { id: "race-stage-1", race_type: "stage_race", race_class: "ProSeries", season_id: "s1" };
const STAGES_3 = [
  { stage_number: 1, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat },
  { stage_number: 2, profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain },
  { stage_number: 3, profile_type: "high_mountain", demand_vector: DEMAND_VECTORS.high_mountain },
];

// #3470: game_day-sekvens for et 21-etapers GT med 1 hviledag (game_day-hul) EFTER hver
// etape i `restPositions` (1-indekseret, samme form som grandTourRestDayPositions).
function gtGameDaysWithRest(restPositions) {
  const gds = [];
  let gd = 0;
  for (let stage = 1; stage <= 21; stage++) {
    gds.push(gd);
    gd += 1;
    if (restPositions.includes(stage)) gd += 1; // hviledag = spring ét game_day over
  }
  return gds;
}
// 21×flat (load 10/etape, #1021-hybrid) — bevidst den LETTESTE profil: high_mountain
// (load 20) mætter feltet til fatigue-loftet (100) inden for 5-6 etaper uanset hviledage,
// hvilket ville skjule effekten bag et fælles loft i begge scenarier. flat holder feltet
// under loftet længe nok til at hviledagenes restitution er MÅLBAR (samme valg som
// raceFatigue.test.js's tilsvarende harness-test). game_day attacheret KUN når `gds` er
// givet (mirrorer attachStageGameDays' .game_day-mutation); udeladt → restDaysBeforeEachStage
// giver alt-0 (bit-identisk fallback, samme kontrakt som #3469's fraction-frie fallback).
function stages21WithGameDays(gds) {
  return Array.from({ length: 21 }, (_, i) => ({
    stage_number: i + 1, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat,
    ...(gds ? { game_day: gds[i] } : {}),
  }));
}
// Realistisk-formet pointLookup (kun nogle ranks scorer, som race_points).
const POINTS = {
  "stage__1": 43, "stage__2": 30, "stage__3": 20,
  "gc__1": 160, "gc__2": 120, "gc__3": 100,
  "points__1": 40, "mountain__1": 40, "young__1": 40, "team__1": 50, "team__2": 30,
  "leader__1": 10, "points_day__1": 5, "mountain_day__1": 5, "young_day__1": 5,
};

function rowsBy(rows, type) {
  return rows.filter((r) => r.result_type === type);
}

// ── buildRaceResults (ren kerne) ──────────────────────────────────────────────
test("alle emitterede result_types er blandt de 10 tilladte", () => {
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  for (const r of resultRows) assert.ok(ALLOWED_RESULT_TYPES.has(r.result_type), `ugyldig type ${r.result_type}`);
});

test("etapeløb: emission — stage hver etape, FULDE dag-klassementer mellem (#2081), fulde trøjer til sidst", () => {
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const N = ENTRANTS.length; // 8
  // 'stage' for alle ryttere på hver af de 3 etaper.
  assert.equal(rowsBy(resultRows, "stage").length, N * 3);
  // #2081: FULDE løbende klassementer på de 2 mellem-etaper (rank 1..N pr. etape).
  for (const t of ["leader", "points_day", "mountain_day"]) {
    const rows = rowsBy(resultRows, t);
    assert.equal(rows.length, N * 2, `${t} forventet ${N * 2} (fuldt felt × 2 mellem-etaper)`);
    for (const stage of [1, 2]) {
      const ranks = rows.filter((r) => r.stage_number === stage).map((r) => r.rank).sort((a, b) => a - b);
      assert.deepEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8], `${t} etape ${stage}: rank 1..N`);
    }
  }
  assert.equal(rowsBy(resultRows, "young_day").length, 2 * 2); // 2 U25 × 2 mellem-etaper
  // Payout-neutralitet: kun rank 1 af dag-typerne har race_points-opslag → rank 2+ = 0 point.
  for (const t of ["leader", "points_day", "mountain_day", "young_day"]) {
    for (const r of rowsBy(resultRows, t).filter((row) => row.rank > 1)) {
      assert.equal(r.points_earned, 0, `${t} rank ${r.rank} skal have 0 point`);
      assert.equal(r.prize_money, 0, `${t} rank ${r.rank} skal have 0 præmie`);
    }
  }
  // INGEN 'team'-rækker på mellem-etaper (race_points har team__1 → ville udbetale
  // pr. etape under rederiveSeasonRacePoints). Hold-stilling undervejs deriveres på læsetidspunkt.
  assert.ok(rowsBy(resultRows, "team").every((r) => r.stage_number === 3), "team-rækker kun på slut-etapen");
  // Ingen gc på mellem-etaper — kun fuld gc på slut-etapen.
  assert.equal(rowsBy(resultRows, "gc").length, N);
  assert.equal(rowsBy(resultRows, "points").length, N);
  assert.equal(rowsBy(resultRows, "mountain").length, N);
  assert.equal(rowsBy(resultRows, "young").length, 2); // 2 U25
  assert.equal(rowsBy(resultRows, "team").length, 2);  // 2 hold
});

test("etapeløb: team_day emitteres på mellem-etaper (#2081), ikke på slut-etapen", () => {
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const teamDay = rowsBy(resultRows, "team_day");
  assert.equal(teamDay.length, 2 * 2, "2 hold × 2 mellem-etaper");
  for (const stage of [1, 2]) {
    const ranks = teamDay.filter((r) => r.stage_number === stage).map((r) => r.rank).sort();
    assert.deepEqual(ranks, [1, 2]);
  }
  // Payout-neutral: POINTS-lookup har intet team_day__N-opslag → altid 0.
  for (const r of teamDay) {
    assert.equal(r.points_earned, 0);
    assert.equal(r.prize_money, 0);
  }
  assert.ok(rowsBy(resultRows, "team_day").every((r) => r.stage_number !== 3), "ingen team_day på slut-etapen");
  // Slut-etapens 'team'-rækker er uændrede (2 hold).
  assert.equal(rowsBy(resultRows, "team").length, 2);
});

test("countback: efter en flad etape leder etapevinderen GC (ikke alfabetisk)", () => {
  // Flad stage 1 → feltet deler tid (gap 0); GC-tie brydes på etapeplacering →
  // 'leader'-trøjen efter stage 1 skal være selve etapevinderen.
  const stages = [
    { stage_number: 1, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat },
    { stage_number: 2, profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain },
  ];
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages, entrants: ENTRANTS, pointsLookup: POINTS });
  const stage1Winner = resultRows.find((r) => r.result_type === "stage" && r.stage_number === 1 && r.rank === 1);
  const leader1 = resultRows.find((r) => r.result_type === "leader" && r.stage_number === 1);
  assert.equal(leader1.rider_id, stage1Winner.rider_id);
});

test("GC = kumulativ tid: klatreren vinder et bjerg-tungt løb", () => {
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const gc1 = rowsBy(resultRows, "gc").find((r) => r.rank === 1);
  assert.equal(gc1.rider_id, "climber");
});

test("young-rækker indeholder kun U25 og rangeres 1..M", () => {
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const young = rowsBy(resultRows, "young");
  const u25 = new Set(ENTRANTS.filter((e) => e.is_u25).map((e) => e.rider_id));
  assert.ok(young.every((r) => u25.has(r.rider_id)), "ikke-U25 i young");
  assert.deepEqual(young.map((r) => r.rank).sort((a, b) => a - b), [1, 2]);
});

test("hold-rækker: 2 hold, rank 1..2, rider_id null + team_id sat", () => {
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const team = rowsBy(resultRows, "team");
  assert.deepEqual(team.map((r) => r.rank).sort((a, b) => a - b), [1, 2]);
  assert.ok(team.every((r) => r.rider_id === null && r.team_id));
});

test("points_earned/prize_money udledes af (result_type, rank) via lookup", () => {
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const gc1 = rowsBy(resultRows, "gc").find((r) => r.rank === 1);
  assert.equal(gc1.points_earned, 160);
  assert.equal(gc1.prize_money, 160 * PRIZE_PER_POINT);
  const gcLast = rowsBy(resultRows, "gc").find((r) => r.rank === 8);
  assert.equal(gcLast.points_earned, 0); // rank 8 ikke seedet → 0
});

test("finish_time: sat på stage+gc+leader (display), null på øvrige trøjer/hold", () => {
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  for (const r of rowsBy(resultRows, "stage")) assert.match(r.finish_time, /^\+\d+:\d{2}$/);
  for (const r of rowsBy(resultRows, "gc")) assert.match(r.finish_time, /^\+\d+:\d{2}$/);
  // #2081: leader-rækker (løbende GC) bærer gap til display.
  for (const r of rowsBy(resultRows, "leader")) assert.match(r.finish_time, /^\+\d+:\d{2}$/);
  for (const t of ["points", "mountain", "young", "team", "points_day", "mountain_day", "young_day"]) {
    for (const r of rowsBy(resultRows, t)) assert.equal(r.finish_time, null);
  }
  // GC-leder har +0:00 — også undervejs.
  assert.equal(rowsBy(resultRows, "gc").find((r) => r.rank === 1).finish_time, "+0:00");
  assert.equal(rowsBy(resultRows, "leader").find((r) => r.rank === 1 && r.stage_number === 1).finish_time, "+0:00");
});

test("determinisme: samme input → identiske resultRows + runs", () => {
  const a = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const b = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  assert.deepEqual(a.resultRows, b.resultRows);
  assert.deepEqual(a.runs, b.runs);
});

test("træthed akkumulerer over etaper: finalFatigue afspejler entering sidste etape (#1021-hybrid)", () => {
  const { finalFatigue } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  // STAGES_3 = flat(10), mountain(18), high_mountain(20). Frisk rytter (ingen condition):
  // entering sidste etape (idx 2) = 0 + load(flat=10) + load(mountain=18) = 28.
  for (const e of ENTRANTS) assert.equal(finalFatigue[e.rider_id], 28);
});

test("akkumulering bevarer determinisme: finalFatigue identisk på tværs af kald", () => {
  const a = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const b = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  assert.deepEqual(a.finalFatigue, b.finalFatigue);
});

// ── #3470: GT-hviledage — fatigue-forløb over 21 etaper MED vs UDEN game_day-huller ──

test("restDaysBeforeEachStage: udleder GT_REST_DAY_PATTERN[3]-huller (efter etape 6/12/18) fra .game_day", () => {
  const stages = stages21WithGameDays(gtGameDaysWithRest([6, 12, 18]));
  const gaps = restDaysBeforeEachStage(stages);
  assert.equal(gaps.length, 21);
  assert.equal(gaps[0], 0, "ingen hviledag før første etape");
  // Hviledag ligger FØR etape 7/13/19 (0-indekseret 6/12/18).
  assert.equal(gaps[6], 1, "1 hviledag før etape 7 (efter etape 6)");
  assert.equal(gaps[12], 1, "1 hviledag før etape 13 (efter etape 12)");
  assert.equal(gaps[18], 1, "1 hviledag før etape 19 (efter etape 18)");
  for (let i = 0; i < gaps.length; i++) if (![6, 12, 18].includes(i)) assert.equal(gaps[i], 0, `etape ${i + 1}: uventet hviledag`);
});

test("restDaysBeforeEachStage: uden .game_day (ikke attacheret) → alt 0 (bit-identisk med før #3470)", () => {
  const gaps = restDaysBeforeEachStage(stages21WithGameDays(null));
  assert.deepEqual(gaps, new Array(21).fill(0));
});

test("#3470 buildRaceResults: GT med game_day-huller (3 hviledage efter etape 6/12/18) giver MARKANT lavere finalFatigue end uden huller — samme rytterfelt/seed", () => {
  const stagesWithRest = stages21WithGameDays(gtGameDaysWithRest([6, 12, 18]));
  const stagesWithoutRest = stages21WithGameDays(null); // ingen .game_day → 0 hviledage (fallback)
  const gtRace = { id: "gt-race", race_type: "stage_race", race_class: "GiroVuelta", season_id: "s1" };

  const withRest = buildRaceResults({ race: gtRace, stages: stagesWithRest, entrants: ENTRANTS, pointsLookup: POINTS });
  const withoutRest = buildRaceResults({ race: gtRace, stages: stagesWithoutRest, entrants: ENTRANTS, pointsLookup: POINTS });

  // Determinisme: SAMME entrants/pointsLookup — kun game_day-hullerne adskiller de to kald.
  // UDEN hviledage mætter hele feltet trætheds-loftet (100) inden sidste etape (21×flat-load
  // uden restitution overskrider 100 langt før etape 21). MED hviledage er feltet ALDRIG
  // mættet ved sidste etape — den kategoriske forskel (loft vs. luft tilbage) ER den
  // mærkbare effekt ejeren efterspurgte (#3470 punkt 5).
  for (const e of ENTRANTS) {
    const before = withoutRest.finalFatigue[e.rider_id];
    const after = withRest.finalFatigue[e.rider_id];
    assert.equal(before, 100, `${e.rider_id}: uden hviledage skal feltet være mættet ved sidste etape`);
    assert.ok(after < 100, `${e.rider_id}: med hviledage skal feltet IKKE være mættet ved sidste etape (${after})`);
    assert.ok(before - after >= 10, `${e.rider_id}: effekten skal være mærkbar (delta ${before - after} < 10)`);
  }
  // Rapportér den faktiske delta for det repræsentative feltmedlem (climber, recovery 84).
  const climberBefore = withoutRest.finalFatigue.climber;
  const climberAfter = withRest.finalFatigue.climber;
  assert.ok(Number.isFinite(climberBefore) && Number.isFinite(climberAfter));
});

test("runs: én pr. etape med seed + entrant-snapshot", () => {
  const { runs } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  assert.equal(runs.length, 3);
  for (const r of runs) {
    assert.ok(Number.isInteger(r.seed));
    assert.equal(r.entrant_snapshot.length, ENTRANTS.length);
    assert.equal(r.engine_version, 1);
  }
});

// ── Race v3 S3 (#2034): input_checksum + stageRoleOverrides ──────────────────

test("checksum: v3=true, stageRoleOverrides udeladt vs. tom Map → SAMME checksum (bagudkompatibel)", () => {
  const a = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS, v3: true });
  const b = buildRaceResults({
    race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS, v3: true,
    stageRoleOverrides: new Map(),
  });
  assert.deepEqual(a.runs.map((r) => r.input_checksum), b.runs.map((r) => r.input_checksum));
});

test("checksum: v3=true + IKKE-tomme overrides → ANDEN checksum end uden overrides", () => {
  const overrides = new Map([[1, new Map([["climber", { race_role: "helper", effort: "protect" }]])]]);
  const without = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS, v3: true });
  const withOv = buildRaceResults({
    race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS, v3: true, stageRoleOverrides: overrides,
  });
  assert.notEqual(without.runs[0].input_checksum, withOv.runs[0].input_checksum);
});

test("checksum: v3=false + IKKE-tomme overrides → checksum UÆNDRET (overrides ignoreres helt)", () => {
  const overrides = new Map([[1, new Map([["climber", { race_role: "helper", effort: "protect" }]])]]);
  const without = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS, v3: false });
  const withOv = buildRaceResults({
    race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS, v3: false, stageRoleOverrides: overrides,
  });
  assert.equal(without.runs[0].input_checksum, withOv.runs[0].input_checksum);
});

test("checksum: samme overrides → deterministisk (samme checksum på tværs af kald)", () => {
  const overrides = new Map([[2, new Map([["b1", { race_role: "hunter", effort: "save" }]])]]);
  const a = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS, v3: true, stageRoleOverrides: overrides });
  const b = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS, v3: true, stageRoleOverrides: overrides });
  assert.deepEqual(a.runs.map((r) => r.input_checksum), b.runs.map((r) => r.input_checksum));
});

test("endagsløb: kun gc(all) + team — ingen stage/dag-ledere", () => {
  const single = { id: "race-single-1", race_type: "single", race_class: "ProSeries", season_id: "s1" };
  const stages = [{ stage_number: 1, profile_type: "hilly", demand_vector: DEMAND_VECTORS.hilly }];
  const { resultRows } = buildRaceResults({ race: single, stages, entrants: ENTRANTS, pointsLookup: POINTS });
  const types = new Set(resultRows.map((r) => r.result_type));
  assert.deepEqual([...types].sort(), ["gc", "team"]);
  assert.equal(rowsBy(resultRows, "gc").length, ENTRANTS.length);
  assert.equal(rowsBy(resultRows, "team").length, 2);
});

test("guards: kaster ved manglende stages/entrants/race.id", () => {
  assert.throws(() => buildRaceResults({ race: STAGE_RACE, stages: [], entrants: ENTRANTS }), /stage profiles/);
  assert.throws(() => buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: [] }), /entrants/);
  assert.throws(() => buildRaceResults({ race: {}, stages: STAGES_3, entrants: ENTRANTS }), /race\.id/);
});

// #1993: team_name-snapshot på løbstidspunktet. Entrants beriges med team_name i
// loadEntrantsForRace; buildRaceResults skal kopiere det ud på hver resultatrække
// (både indiv- og hold-rækker), og falde til null når entranten mangler navnet.
test("#1993 buildRaceResults snapshots team_name from entrant onto every result row", () => {
  const teamNameByTeam = { A: "Team Alpha", B: "Team Bravo" };
  const namedEntrants = ENTRANTS.map((e) => ({ ...e, team_name: teamNameByTeam[e.team_id] }));
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: namedEntrants, pointsLookup: POINTS });

  // Individual rows carry the snapshot of their rider's team name.
  for (const r of resultRows.filter((row) => row.rider_id)) {
    assert.equal(r.team_name, teamNameByTeam[r.team_id], `indiv-række for ${r.rider_id} mangler korrekt team_name`);
  }
  // Team rows (rider_id null) also carry the snapshot for their team.
  for (const r of resultRows.filter((row) => row.result_type === "team")) {
    assert.equal(r.team_name, teamNameByTeam[r.team_id], `hold-række for ${r.team_id} mangler korrekt team_name`);
  }
});

test("#1993 buildRaceResults sets team_name null when entrant lacks it", () => {
  // Entrants WITHOUT team_name (as legacy/un-enriched entrants would be).
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  for (const r of resultRows) {
    assert.equal(r.team_name, null, `række ${r.result_type}/${r.rider_id ?? r.team_id} burde have team_name null`);
  }
});

// ── Mock-supabase ─────────────────────────────────────────────────────────────
function makeSupabase(canned = {}) {
  const writes = [];
  const rpcCalls = [];
  function from(table) {
    const b = {
      select() { return b; },
      eq() { return b; },
      in() { return b; },
      or() { return b; },
      is() { return b; },
      order() { return b; },
      gte() { return b; },
      // #2962 · fillMissingTeamEntries' teams-select pagineres nu via fetchAllRows
      // (.order("id").range()) — mocken slicer den cannede tabel som en enkelt side.
      range(from, to) { return Promise.resolve({ data: (canned[table] || []).slice(from, to + 1), error: null }); },
      maybeSingle() { return Promise.resolve({ data: (canned[table] || [])[0] ?? null, error: null }); },
      insert(rows) { writes.push({ table, op: "insert", rows }); return Promise.resolve({ error: null }); },
      // #3193-test: matview_refresh_heartbeat-upsert (refreshRankingMatviewsSafe).
      upsert(obj) { writes.push({ table, op: "upsert", obj }); return Promise.resolve({ error: null }); },
      update(obj) {
        const rec = { table, op: "update", obj, eqs: [] };
        writes.push(rec);
        const u = { eq(c, v) { rec.eqs.push([c, v]); return u; }, in() { return u; }, then(r) { return Promise.resolve({ error: null }).then(r); } };
        return u;
      },
      delete() {
        const rec = { table, op: "delete", eqs: [], ins: [] };
        writes.push(rec);
        const d = { eq(c, v) { rec.eqs.push([c, v]); return d; }, in(c, v) { rec.ins.push([c, v]); return d; }, then(r) { return Promise.resolve({ error: null }).then(r); } };
        return d;
      },
      then(resolve, reject) { return Promise.resolve({ data: canned[table] || [], error: null }).then(resolve, reject); },
    };
    return b;
  }
  // #3193-test: refreshRankingMatviewsSafe kalder supabase.rpc("refresh_*_mv") —
  // tracket her så ordre kan verificeres mod DI-callbacks (notifyDiscord m.fl.).
  function rpc(name, args) {
    rpcCalls.push({ name, args });
    return Promise.resolve({ error: null });
  }
  return { from, rpc, __writes: writes, __rpcCalls: rpcCalls };
}

// ── Flag ──────────────────────────────────────────────────────────────────────
test("flag: true KUN når app_config.value === true; ellers false", async () => {
  assert.equal(await isRaceEngineV2Enabled(makeSupabase({ app_config: [{ value: true }] })), true);
  assert.equal(await isRaceEngineV2Enabled(makeSupabase({ app_config: [{ value: false }] })), false);
  assert.equal(await isRaceEngineV2Enabled(makeSupabase({ app_config: [] })), false);
  assert.equal(await isRaceEngineV2Enabled(null), false);
});

test("flag: DB-fejl → false (fail-safe)", async () => {
  const errMock = { from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle() { return Promise.resolve({ data: null, error: { message: "boom" } }); } }) };
  assert.equal(await isRaceEngineV2Enabled(errMock), false);
});

test("flag: beta-stage kun for beta-testere", async () => {
  assert.equal(await isRaceEngineV2Enabled(makeSupabase({ app_config: [{ value: "beta" }] }), { isBetaTester: true }), true);
  assert.equal(await isRaceEngineV2Enabled(makeSupabase({ app_config: [{ value: "beta" }] })), false);
});

// ── #2352 (Race v3 S1): race_engine_v3_scoring kill-switch ────────────────────
test("v3-flag: true KUN når app_config.value === true|'on'; ellers false (default off)", async () => {
  assert.equal(await isRaceEngineV3ScoringEnabled(makeSupabase({ app_config: [{ value: true }] })), true);
  assert.equal(await isRaceEngineV3ScoringEnabled(makeSupabase({ app_config: [{ value: "on" }] })), true);
  assert.equal(await isRaceEngineV3ScoringEnabled(makeSupabase({ app_config: [{ value: "off" }] })), false);
  assert.equal(await isRaceEngineV3ScoringEnabled(makeSupabase({ app_config: [] })), false, "manglende række → off (fail-safe)");
  assert.equal(await isRaceEngineV3ScoringEnabled(null), false);
});

// ── loadEntrantsForRace ───────────────────────────────────────────────────────
test("loadEntrantsForRace: beriger entries med navn, is_u25 + abilities", async () => {
  const supabase = makeSupabase({
    race_entries: [{ rider_id: "r1", team_id: "T1" }, { rider_id: "r2", team_id: "T1" }],
    riders: [
      { id: "r1", team_id: "T1", firstname: "Anna", lastname: "Berg", is_u25: true },
      { id: "r2", team_id: "T1", firstname: "Bo", lastname: "Dahl", is_u25: false },
    ],
    rider_derived_abilities: [
      { rider_id: "r1", ...abil({ climbing: 80 }) },
      { rider_id: "r2", ...abil({ sprint: 80 }) },
    ],
  });
  const entrants = await loadEntrantsForRace({ supabase, race: { id: "race-x" } });
  assert.equal(entrants.length, 2);
  const r1 = entrants.find((e) => e.rider_id === "r1");
  assert.equal(r1.rider_name, "Anna Berg");
  assert.equal(r1.is_u25, true);
  assert.equal(r1.team_id, "T1");
  assert.equal(r1.abilities.climbing, 80);
});

// ── U25 sæson-derivering (#109/#2073) ─────────────────────────────────────────
// Den lagrede riders.is_u25 er statisk (DEFAULT FALSE) og re-deriveres aldrig →
// 16-18-årige oprettet uden flag manglede i ungdomsklassementet. U25 udledes nu
// sæson-korrekt fra birthdate: fødselsår > sæsonens år - 25.
test("deriveIsU25FromBirthdate: fødselsår > referenceår-25 ⇔ U25", () => {
  assert.equal(deriveIsU25FromBirthdate("2010-06-15", 2026), true);  // 16
  assert.equal(deriveIsU25FromBirthdate("2002-01-01", 2026), true);  // 24
  assert.equal(deriveIsU25FromBirthdate("2001-01-01", 2026), false); // 25 (boundary)
  assert.equal(deriveIsU25FromBirthdate("1990-01-01", 2026), false); // 36
});

test("deriveIsU25FromBirthdate: sæson-drevet — samme rytter skifter ved sæsonskift", () => {
  assert.equal(deriveIsU25FromBirthdate("2002-06-15", 2026), true);  // 24
  assert.equal(deriveIsU25FromBirthdate("2002-06-15", 2027), false); // 25
});

test("deriveIsU25FromBirthdate: robust ved manglende birthdate/referenceår", () => {
  assert.equal(deriveIsU25FromBirthdate(null, 2026), false);
  assert.equal(deriveIsU25FromBirthdate(undefined, 2026), false);
  assert.equal(deriveIsU25FromBirthdate("2010-06-15", null), false);
  assert.equal(deriveIsU25FromBirthdate("2010-06-15", NaN), false);
});

// Kernefix #2073: en 16-årig med det STALE is_u25=false skal alligevel være U25 i
// startfeltet, fordi motoren udleder fra birthdate + sæsonens referenceår.
test("loadEntrantsForRace: is_u25 sæson-afledt fra birthdate (overstyrer stale flag)", async () => {
  const supabase = makeSupabase({
    seasons: [{ start_date: "2026-06-22" }],
    race_entries: [{ rider_id: "young", team_id: "T1" }, { rider_id: "old", team_id: "T1" }],
    riders: [
      // Stale flag=false men 16 år (født 2010) → skal blive U25 via birthdate.
      { id: "young", team_id: "T1", firstname: "Jiho", lastname: "Cho", is_u25: false, birthdate: "2010-06-15" },
      // Stale flag=true men 36 år (født 1990) → skal blive IKKE-U25 via birthdate.
      { id: "old", team_id: "T1", firstname: "Old", lastname: "Guard", is_u25: true, birthdate: "1990-06-15" },
    ],
    rider_derived_abilities: [
      { rider_id: "young", ...abil() },
      { rider_id: "old", ...abil() },
    ],
  });
  const entrants = await loadEntrantsForRace({ supabase, race: { id: "race-x", season_id: "s1" } });
  assert.equal(entrants.find((e) => e.rider_id === "young").is_u25, true, "16-årig med stale flag=false skal være U25");
  assert.equal(entrants.find((e) => e.rider_id === "old").is_u25, false, "36-årig med stale flag=true må ikke være U25");
});

// Degraderende: kan sæson-referenceåret ikke læses (intet seasons-row), falder vi
// tilbage til det lagrede is_u25-flag frem for at blokere finalization.
test("loadEntrantsForRace: falder tilbage til lagret is_u25 når sæson-år mangler", async () => {
  const supabase = makeSupabase({
    // Ingen seasons-canned → maybeSingle giver null → fallback til lagret flag.
    race_entries: [{ rider_id: "r1", team_id: "T1" }],
    riders: [{ id: "r1", team_id: "T1", firstname: "Anna", lastname: "Berg", is_u25: true, birthdate: "1990-06-15" }],
    rider_derived_abilities: [{ rider_id: "r1", ...abil() }],
  });
  const entrants = await loadEntrantsForRace({ supabase, race: { id: "race-x", season_id: "s1" } });
  // Trods 36 år bevares det lagrede flag=true, fordi sæson-året ikke kunne læses.
  assert.equal(entrants.find((e) => e.rider_id === "r1").is_u25, true);
});

// #1993: entrants beriges med team_name (holdets navn på løbstidspunktet) så
// buildRaceResults kan snapshotte det. Navnet hentes fra teams, ikke fra rytteren.
test("#1993 loadEntrantsForRace: beriger entrants med team_name fra teams", async () => {
  const supabase = makeSupabase({
    race_entries: [{ rider_id: "r1", team_id: "T1" }, { rider_id: "r2", team_id: "T2" }],
    riders: [
      { id: "r1", team_id: "T1", firstname: "Anna", lastname: "Berg", is_u25: false },
      { id: "r2", team_id: "T2", firstname: "Bo", lastname: "Dahl", is_u25: false },
    ],
    rider_derived_abilities: [
      { rider_id: "r1", ...abil() },
      { rider_id: "r2", ...abil() },
    ],
    teams: [
      { id: "T1", name: "Team Alpha" },
      { id: "T2", name: "Team Bravo" },
    ],
  });
  const entrants = await loadEntrantsForRace({ supabase, race: { id: "race-x" } });
  const r1 = entrants.find((e) => e.rider_id === "r1");
  const r2 = entrants.find((e) => e.rider_id === "r2");
  assert.equal(r1.team_name, "Team Alpha");
  assert.equal(r2.team_name, "Team Bravo");
});

// #1993 / #1844 regression: motoren binder hver entrants team_id til
// race_entries-SNAPSHOT'et (teamByRider bygges fra `entries`, raceRunner.js), så
// en re-run efter et rytter-salg bevarer det oprindelige team_id og historikken
// ikke flytter stille. Beviset her: race_entries siger T_SNAPSHOT, og entranten
// bærer netop T_SNAPSHOT — og team_name slås op ud fra DET (frosne) team_id, ikke
// rytterens nuværende hold. (Ghost-eligibility-filteret kræver at rytter-rækken
// matcher entry'ens team_id for at overleve, så de holdes konsistente her; selve
// snapshot-bindingen vises ved at output-team_id === race_entries-værdien.)
test("#1993/#1844 loadEntrantsForRace: entrant.team_id + team_name kommer fra race_entries-snapshot", async () => {
  const supabase = makeSupabase({
    race_entries: [{ rider_id: "r1", team_id: "T_SNAPSHOT" }],
    riders: [{ id: "r1", team_id: "T_SNAPSHOT", firstname: "Frozen", lastname: "Rider", is_u25: false }],
    rider_derived_abilities: [{ rider_id: "r1", ...abil() }],
    teams: [{ id: "T_SNAPSHOT", name: "Snapshot Squad" }],
  });
  const entrants = await loadEntrantsForRace({ supabase, race: { id: "race-x" } });
  const r1 = entrants.find((e) => e.rider_id === "r1");
  // Snapshot vinder: team_id frosset til race_entries-værdien.
  assert.equal(r1.team_id, "T_SNAPSHOT");
  // team_name slås op ud fra det frosne team_id (teams.name), ikke nogen rider-felt.
  assert.equal(r1.team_name, "Snapshot Squad");
});

test("loadEntrantsForRace: tomt felt → auto-fill skriver race_entries", async () => {
  const supabase = makeSupabase({
    race_entries: [], // tomt → auto-fill
    teams: [{ id: "T1", is_test_account: false, is_frozen: false }, { id: "T2", is_test_account: false, is_frozen: true }],
    riders: [{ id: "r1", team_id: "T1", firstname: "A", lastname: "A", is_u25: false }],
    rider_derived_abilities: [{ rider_id: "r1", ...abil() }],
  });
  const entrants = await loadEntrantsForRace({ supabase, race: { id: "race-x" } });
  const inserted = supabase.__writes.find((w) => w.table === "race_entries" && w.op === "insert");
  assert.ok(inserted, "auto-fill skrev ikke race_entries");
  assert.ok(entrants.length >= 1);
});

// ── loadEntrantsForRace: condition-merge (B2 #1306) ──────────────────────────
test("loadEntrantsForRace: form/fatigue merges fra rider_condition når rækker findes", async () => {
  const supabase = makeSupabase({
    race_entries: [{ rider_id: "r1", team_id: "T1" }, { rider_id: "r2", team_id: "T1" }],
    riders: [
      { id: "r1", team_id: "T1", firstname: "Anna", lastname: "Berg", is_u25: false },
      { id: "r2", team_id: "T1", firstname: "Bo", lastname: "Dahl", is_u25: false },
    ],
    rider_derived_abilities: [
      { rider_id: "r1", ...abil() },
      { rider_id: "r2", ...abil() },
    ],
    rider_condition: [
      { rider_id: "r1", form: 8, fatigue: 30 },
      // r2 har ingen condition-række
    ],
  });
  const entrants = await loadEntrantsForRace({ supabase, race: { id: "race-x" } });
  const r1 = entrants.find((e) => e.rider_id === "r1");
  const r2 = entrants.find((e) => e.rider_id === "r2");
  // r1 får form/fatigue merged.
  assert.equal(r1.form, 8);
  assert.equal(r1.fatigue, 30);
  // r2 mangler condition-række → form/fatigue sættes IKKE (undefined → neutral i simulatoren).
  assert.equal(r2.form, undefined);
  assert.equal(r2.fatigue, undefined);
});

// ── loadEntrantsForRace: skadede MANAGER-udtagne entries (#3896) ────────────────────
// Root-cause-bug: fillMissingTeamEntries (auto-fyld) og raceEntryGenerator (auto-pick-
// sweep) udelukkede allerede skadede kandidater (#2637/#1306) — men committede
// race_entries fra en MANAGER-udtagelse blev aldrig krydset mod skadesstatus i selve
// motoren. En rytter udtaget rask og siden skadet FØR løbsstart kunne derfor stadig stå
// i startfeltet og score (Cooper Bennett, Discord 17/8). Denne test dækker gapet: en
// manager-udtaget, aktivt skadet rytter skal IKKE med i entrants, mens en rytter med
// udløbet skade (eller ingen condition-række) stadig skal med.
test("loadEntrantsForRace: skadet MANAGER-udtaget entry ekskluderes fra startfeltet; udløbet skade/ingen condition består", async () => {
  const supabase = makeSupabase({
    race_entries: [
      { rider_id: "r-hurt", team_id: "T1" },
      { rider_id: "r-expired", team_id: "T1" },
      { rider_id: "r-none", team_id: "T1" },
    ],
    riders: [
      { id: "r-hurt", team_id: "T1", firstname: "Cooper", lastname: "Bennett", is_u25: false },
      { id: "r-expired", team_id: "T1", firstname: "B", lastname: "B", is_u25: false },
      { id: "r-none", team_id: "T1", firstname: "C", lastname: "C", is_u25: false },
    ],
    rider_derived_abilities: [
      // r-hurt mangler abilities bevidst (mocken filtrerer ikke .in() server-side —
      // spejler konventionen i fillMissingTeamEntries-testen nedenfor): er
      // ekskluderet af skade-filteret FØR entrants bygges, så testen ikke skal
      // afhænge af den senere abilities-guard for at bevise eksklusionen.
      { rider_id: "r-expired", ...abil() },
      { rider_id: "r-none", ...abil() },
    ],
    rider_condition: [
      { rider_id: "r-hurt", injured_until: "2099-01-01" }, // langt i fremtiden → altid skadet
      { rider_id: "r-expired", injured_until: "2020-01-01" }, // langt i fortiden → udløbet
      // r-none har bevidst ingen condition-række
    ],
  });
  const entrants = await loadEntrantsForRace({ supabase, race: { id: "race-injured" } });
  const ids = entrants.map((e) => e.rider_id);
  assert.ok(!ids.includes("r-hurt"), "skadet manager-udtaget rytter må ikke stå i startfeltet");
  assert.ok(ids.includes("r-expired"), "udløbet skade skal stadig med");
  assert.ok(ids.includes("r-none"), "rytter uden condition-række skal stadig med");
});

// ── fillMissingTeamEntries: skadefilter (B2 #1306) ───────────────────────────────────
test("fillMissingTeamEntries: skadede ryttere (injured_until >= i dag) udelukkes fra auto-entry; udløbet skade + ingen condition inkluderes", async () => {
  // Mocken returnerer rider_condition ufiltreret (gte simuleres ikke) — vi lægger
  // kun den aktive skade i canned for at simulere DB's gte-filter. r-injured udelades
  // fra rider_derived_abilities så auto-fill-eksklusionen er den eneste guard der
  // testes (ingen abilities-fallback der ville skjule eventuel fejl i eksklusionen).
  const supabase = makeSupabase({
    race_entries: [], // tomt → auto-fill
    teams: [{ id: "T1", is_test_account: false, is_frozen: false }],
    riders: [
      { id: "r-injured", team_id: "T1" },
      { id: "r-expired", team_id: "T1" },
      { id: "r-none",    team_id: "T1" },
    ],
    rider_derived_abilities: [
      // r-injured mangler abilities bevidst: er ekskluderet af injury-filter
      // → bør aldrig nå enrichment-loop. Test ville stadig grønne via ab-guard,
      // men det ville skjule en regressi i injury-eksklusionen.
      { rider_id: "r-expired", ...abil() },
      { rider_id: "r-none",    ...abil() },
    ],
    // Kun r-injured returneres fra gte-query (simulerer DB-filter med >= i dag).
    rider_condition: [{ rider_id: "r-injured" }],
  });
  const entrants = await loadEntrantsForRace({ supabase, race: { id: "race-y" } });
  const ids = entrants.map((e) => e.rider_id);
  // Skadet rytter (returneret af gte-query) udelukkes fra auto-fill → ikke i startfeltet.
  assert.ok(!ids.includes("r-injured"), "skadet rytter må ikke auto-fyldes");
  // Rytter med udløbet skade (ikke i gte-resultatet) inkluderes.
  assert.ok(ids.includes("r-expired"), "rytter med udløbet skade skal med");
  // Rytter uden condition-række (ikke i gte-resultatet) inkluderes.
  assert.ok(ids.includes("r-none"), "rytter uden condition skal med");
});

// ── simulateRace (I/O-orchestrator, smoke) ────────────────────────────────────
test("simulateRace: bygger rækker, sender stageNumbers til applyRaceResults (atomisk delete+insert, #3022), sætter completed", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
  });
  let appliedRows = null;
  let appliedStageNumbers = null;
  const report = await simulateRace({
    supabase,
    race: STAGE_RACE,
    applyRaceResults: async ({ resultRows, stageNumbers }) => {
      appliedRows = resultRows;
      appliedStageNumbers = stageNumbers;
      return { rowsImported: resultRows.length };
    },
    recomputeRaceDays: async () => {},
  });
  assert.ok(appliedRows && appliedRows.length > 0, "applyRaceResults fik ingen rækker");
  assert.equal(report.stages, 3);
  // #3022: delete+insert sker nu ATOMISK inde i applyRaceResults (via
  // apply_race_results_batch-RPC'en når stageNumbers er sat) — ikke længere et
  // separat .from("race_results").delete()-kald her i orchestratoren. Beviset
  // for at rigtige etaper sendes med er stageNumbers-argumentet.
  assert.deepEqual(
    [...new Set(appliedStageNumbers)].sort(),
    [1, 2, 3],
    "stageNumbers skal dække alle 3 etaper løbet faktisk producerede rækker for",
  );
  // status=completed sat.
  const upd = supabase.__writes.find((w) => w.table === "races" && w.op === "update");
  assert.equal(upd.obj.status, "completed");
  // run-snapshot persisteret.
  assert.ok(supabase.__writes.find((w) => w.table === "race_simulation_runs" && w.op === "insert"));
});

// ── #2898/#3022: fejlhåndtering på race_results-skrivning + races.status=completed
// Injicerer en Supabase-fejl på ÉT specifikt (table, op)-par oven på makeSupabase's
// normale happy-path (uden at røre den delte mock — andre tests skal forblive
// upåvirkede). #3022 flyttede race_results' delete-then-insert IND i
// applyRaceResults (atomisk via apply_race_results_batch-RPC'en, sat i
// raceRunner.js gennem stageNumbers) — der er derfor ikke længere et separat
// .from("race_results").delete()-kald HER i orchestratoren at injicere en fejl
// på; den regressionsbeskyttelse dækkes nu af de dedikerede RPC-tests
// (stageResultRpc.test.js + raceResultsEngine.test.js + PGlite-integrationstesten
// backend/lib/testdb/raceResultsEntrantUnique.integration.test.js). Testene
// nedenfor beviser i stedet at simulateRace propagerer en applyRaceResults-fejl
// synligt og IKKE sætter status=completed på en afbrudt afvikling.
function withInjectedError(canned, table, op, message) {
  const base = makeSupabase(canned);
  const originalFrom = base.from;
  base.from = (t) => {
    const b = originalFrom(t);
    if (t !== table) return b;
    if (op === "delete") {
      const originalDelete = b.delete.bind(b);
      b.delete = (...args) => {
        const d = originalDelete(...args);
        d.then = (r) => Promise.resolve({ error: { message } }).then(r);
        return d;
      };
    } else if (op === "update") {
      const originalUpdate = b.update.bind(b);
      b.update = (...args) => {
        const u = originalUpdate(...args);
        u.then = (r) => Promise.resolve({ error: { message } }).then(r);
        return u;
      };
    }
    return b;
  };
  return base;
}

function simulateRaceCanned() {
  return {
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
  };
}

test("#3022 simulateRace: applyRaceResults (atomisk delete+insert) fejler → afbrydes synligt, status IKKE sat til completed", async () => {
  // Modellerer at apply_race_results_batch-RPC'en fejler (fx en rullet-tilbage
  // transaktion pga. race_results_entrant_unique) — den ægte ROLLBACK-garanti er
  // bevist mod en rigtig Postgres-motor i
  // backend/lib/testdb/raceResultsEntrantUnique.integration.test.js; her testes
  // KUN at simulateRace propagerer fejlen og ikke fortsætter til status-flippet.
  const supabase = makeSupabase(simulateRaceCanned());
  await assert.rejects(
    () => simulateRace({
      supabase,
      race: STAGE_RACE,
      applyRaceResults: async () => {
        throw new Error("apply_race_results_batch failed: statement timeout");
      },
      recomputeRaceDays: async () => {},
    }),
    /apply_race_results_batch failed/,
  );
  const statusUpd = supabase.__writes.find((w) => w.table === "races" && w.op === "update");
  assert.equal(statusUpd, undefined, "status må ikke sættes til completed når afviklingen er afbrudt af en fejlet resultat-skrivning");
});

test("#2898 simulateRace: races.status=completed update-fejl → synlig fejl (ingen tavs succes)", async () => {
  const supabase = withInjectedError(simulateRaceCanned(), "races", "update", "connection reset by peer");
  let applyRaceResultsCalled = false;
  await assert.rejects(
    () => simulateRace({
      supabase,
      race: STAGE_RACE,
      applyRaceResults: async ({ resultRows }) => {
        applyRaceResultsCalled = true;
        return { rowsImported: resultRows.length };
      },
      recomputeRaceDays: async () => {},
    }),
    /Failed to mark race .* as completed/,
  );
  // Resultaterne ER allerede skrevet (applyRaceResults' atomiske delete+insert
  // kørte færdigt FØR update-kaldet der fejler) — kun status-flippet fejler, men
  // det skal stadig kastes synligt, ikke sluges tavst, for at recovery-logikken
  // (der læner sig på status='completed') ikke ser en falsk "ikke afviklet"-tilstand.
  assert.equal(applyRaceResultsCalled, true, "applyRaceResults skulle være kørt færdig før status-update-fejlen opstod");
});

// ── #2974: samme utjekkede delete-mønster i persist-laget ────────────────────
// persistRuns/persistIncidents/persistPassages brugte alle det samme
// delete-then-insert uden fejltjek som #2898 fixede for race_results. Fejler
// deletet tavst, kører insertet ALLIGEVEL og lægger de nye rækker oven på de
// gamle → dublerede snapshots/hændelser/passager for samme (race_id, stage).
test("#2974 simulateRace: race_simulation_runs delete-fejl → abort FØR insert (ingen dublerede run-snapshots)", async () => {
  const supabase = withInjectedError(simulateRaceCanned(), "race_simulation_runs", "delete", "statement timeout");
  await assert.rejects(
    () => simulateRace({
      supabase,
      race: STAGE_RACE,
      applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
      recomputeRaceDays: async () => {},
    }),
    /race_simulation_runs delete failed/,
    "et fejlet delete skal kastes synligt, så retry-laget (#2878) kan gribe det — ikke sluges tavst",
  );
  const insert = supabase.__writes.find((w) => w.table === "race_simulation_runs" && w.op === "insert");
  assert.equal(
    insert,
    undefined,
    "insert MÅ IKKE køre efter en fejlet delete — ville lægge et dublet run-snapshot oven på det gamle",
  );
});

test("#2974 simulateRace: happy path skriver stadig run-snapshot (fejltjekket ændrer ikke normal-adfærd)", async () => {
  const supabase = makeSupabase(simulateRaceCanned());
  await simulateRace({
    supabase,
    race: STAGE_RACE,
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    recomputeRaceDays: async () => {},
  });
  const del = supabase.__writes.find((w) => w.table === "race_simulation_runs" && w.op === "delete");
  const insert = supabase.__writes.find((w) => w.table === "race_simulation_runs" && w.op === "insert");
  assert.ok(del, "delete skal stadig køre (idempotens-mønsteret er uændret)");
  assert.ok(insert, "insert skal stadig køre når deletet lykkedes");
});

// #2352 (Race v3 S1): checkV3Enabled=false (default-mock) → INGEN
// race_simulation_rider_scores-skrivning, race_simulation_runs uden client-side id.
test("simulateRace: v3=false (kill-switch off) — ingen race_simulation_rider_scores skrives", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
  });
  await simulateRace({
    supabase,
    race: STAGE_RACE,
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    recomputeRaceDays: async () => {},
    checkV3Enabled: async () => false,
  });
  assert.ok(!supabase.__writes.find((w) => w.table === "race_simulation_rider_scores"), "v3=false må ikke skrive rider_scores");
  const runsInsert = supabase.__writes.find((w) => w.table === "race_simulation_runs" && w.op === "insert");
  for (const row of runsInsert.rows) {
    assert.equal(row.engine_version, 1);
    assert.equal(row.id, undefined, "v3=false: intet client-side id — DB-default bevares");
  }
});

// #2352: checkV3Enabled=true → race_simulation_rider_scores skrives med run_id
// der matcher det EKSPLICITTE client-side id på race_simulation_runs-rækkerne
// (§11.3 — ingen select-roundtrip nødvendig).
test("simulateRace: v3=true — race_simulation_rider_scores persisteres, run_id matcher runs-insert, engine_version=2", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
  });
  await simulateRace({
    supabase,
    race: STAGE_RACE,
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    recomputeRaceDays: async () => {},
    checkV3Enabled: async () => true,
  });
  const runsInsert = supabase.__writes.find((w) => w.table === "race_simulation_runs" && w.op === "insert");
  assert.ok(runsInsert, "race_simulation_runs blev ikke skrevet");
  const runIds = new Set();
  for (const row of runsInsert.rows) {
    assert.equal(row.engine_version, 2, "v3=true → ENGINE_VERSION_V3");
    assert.ok(typeof row.id === "string" && row.id.length > 0, "v3=true: client-side UUID forventet");
    runIds.add(row.id);
  }
  assert.equal(runIds.size, runsInsert.rows.length, "hvert run skal have sit EGET unikke id");

  const scoresInsert = supabase.__writes.find((w) => w.table === "race_simulation_rider_scores" && w.op === "insert");
  assert.ok(scoresInsert, "race_simulation_rider_scores blev ikke skrevet");
  assert.ok(scoresInsert.rows.length > 0);
  for (const row of scoresInsert.rows) {
    assert.ok(runIds.has(row.run_id), `rider_score.run_id ${row.run_id} matcher ikke noget runs-insert-id`);
    assert.ok(typeof row.rider_id === "string");
    assert.ok(Number.isInteger(row.rank) && row.rank >= 1);
    assert.ok(row.components && typeof row.components === "object");
  }
});

// #2351: Race v3 salt — provably-fair seed-salt på resultat-seeds. Uden env sat
// forbliver adfærden identisk til før (ingen salt_version-nøgle på insert-rows,
// legacy-kompatibelt med prod FØR migrationen er applied). Med salt-env sat
// stempler runs deres salt_version og seedet afviger fra det usaltede seed.
const SALT_ENV_KEYS = ["RACE_ENGINE_SEED_SALT", "RACE_ENGINE_SEED_SALT_VERSION"];
function clearSaltEnv() {
  for (const k of SALT_ENV_KEYS) delete process.env[k];
}

test("#2351 simulateRace: uden salt-env har race_simulation_runs-insert IKKE salt_version-nøglen", async () => {
  clearSaltEnv();
  try {
    const supabase = makeSupabase({
      race_stage_profiles: STAGES_3,
      race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
      riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
      rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
      race_points: [],
    });
    await simulateRace({
      supabase,
      race: STAGE_RACE,
      applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
      recomputeRaceDays: async () => {},
    });
    const insert = supabase.__writes.find((w) => w.table === "race_simulation_runs" && w.op === "insert");
    assert.ok(insert, "race_simulation_runs blev ikke skrevet");
    for (const row of insert.rows) {
      assert.ok(!("salt_version" in row), "salt_version-nøgle må IKKE være til stede uden salt-env (prod-kompatibilitet før migration)");
    }
  } finally {
    clearSaltEnv();
  }
});

test("#2351 simulateRace: med salt-env sat har rows salt_version=1 og seedet afviger fra usaltet seed", async () => {
  clearSaltEnv();
  try {
    process.env.RACE_ENGINE_SEED_SALT = "test-salt-for-raceRunner";
    const supabase = makeSupabase({
      race_stage_profiles: STAGES_3,
      race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
      riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
      rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
      race_points: [],
    });
    await simulateRace({
      supabase,
      race: STAGE_RACE,
      applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
      recomputeRaceDays: async () => {},
    });
    const insert = supabase.__writes.find((w) => w.table === "race_simulation_runs" && w.op === "insert");
    assert.ok(insert, "race_simulation_runs blev ikke skrevet");
    assert.ok(insert.rows.length > 0);
    for (const row of insert.rows) {
      assert.equal(row.salt_version, 1);
      const unsaltedSeed = stableSeed(`${STAGE_RACE.id}:${row.stage_number}`);
      assert.notEqual(row.seed, unsaltedSeed, `etape ${row.stage_number}: saltet seed skal afvige fra usaltet seed`);
    }
  } finally {
    clearSaltEnv();
  }
});

// #1187 · Board-weekend-wiring: simulateRace kalder processBoardWeekend med
// race-days FØR (checkpoint-udgangspunkt) og EFTER (ny værdi fra recompute).
test("simulateRace: kalder processBoardWeekend med prev/ny race-days (#1187)", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    seasons: [{ id: STAGE_RACE.season_id, number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
  });
  const boardCalls = [];
  await simulateRace({
    supabase,
    race: STAGE_RACE,
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    recomputeRaceDays: async () => 12,
    processBoardWeekend: async (args) => { boardCalls.push(args); return { boards_updated: 1 }; },
  });
  assert.equal(boardCalls.length, 1, "processBoardWeekend skal kaldes når sæsonen findes");
  assert.equal(boardCalls[0].previousRaceDaysCompleted, 9);
  assert.equal(boardCalls[0].season.race_days_completed, 12, "ny værdi fra recompute");
  assert.equal(boardCalls[0].season.id, STAGE_RACE.season_id);
  // #1451 · race-kontekst til event-loggen.
  assert.equal(boardCalls[0].race.id, STAGE_RACE.id);
});

// #3193: matview-refresh (global_rank_mv m.fl.) skal ske LIGE EFTER
// season_standings er opdateret (applyRaceResults), IKKE efter board-weekend/
// Discord/in-app-notifikationerne. Diagnose (execute_sql mod prod 3/8, se PR):
// /standings læser season_standings LIVE, Global Rank læser global_rank_mv
// (periodisk snapshot) — refresh'en lå tidligere efter en ekstern Discord-
// webhook-latens, hvilket forlængede vinduet hvor de to sider viste
// forskellige tal for samme hold. Denne test beviser rækkefølgen er rettet:
// alle fire refresh-RPC'er er kaldt FØR notifyDiscord/notifyInApp fyrer.
test("simulateRace: refresher rangliste-matviews FØR notifyDiscord/notifyInApp (#3193)", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
  });
  const order = [];
  const originalRpc = supabase.rpc;
  supabase.rpc = (name, args) => { order.push(`rpc:${name}`); return originalRpc(name, args); };

  await simulateRace({
    supabase,
    race: STAGE_RACE,
    applyRaceResults: async ({ resultRows }) => { order.push("applyRaceResults"); return { rowsImported: resultRows.length }; },
    recomputeRaceDays: async () => { order.push("recomputeRaceDays"); return 1; },
    notifyDiscord: async () => { order.push("notifyDiscord"); },
    notifyInApp: async () => { order.push("notifyInApp"); },
  });

  assert.deepEqual(
    order,
    [
      "applyRaceResults",
      "rpc:refresh_rider_rankings_mv",
      "rpc:refresh_team_standings_ext_mv",
      "rpc:refresh_team_race_points_mv",
      "rpc:refresh_global_rank_mv",
      "recomputeRaceDays",
      "notifyDiscord",
      "notifyInApp",
    ],
    "alle fire matview-refresh skal ske LIGE EFTER applyRaceResults, FØR board-weekend/notify (#3193 rod-årsagsfix)"
  );
});

test("simulateRace: processBoardWeekend-fejl vælter ikke afviklingen (#1187)", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    seasons: [{ id: STAGE_RACE.season_id, number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
  });
  const report = await simulateRace({
    supabase,
    race: STAGE_RACE,
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    recomputeRaceDays: async () => 12,
    processBoardWeekend: async () => { throw new Error("board boom"); },
  });
  assert.ok(report.rowsImported > 0, "afviklingen skal fuldføre selv om board-wiring fejler");
});

// ── simulateRace dryRun (#1102) ───────────────────────────────────────────────
test("simulateRace dryRun: returnerer preview uden DB-writes", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    seasons: [{ id: STAGE_RACE.season_id, number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
  });
  const result = await simulateRace({
    supabase,
    race: STAGE_RACE,
    dryRun: true,
    applyRaceResults: async () => { throw new Error("må ikke kaldes i dryRun"); },
    recomputeRaceDays: async () => { throw new Error("må ikke kaldes i dryRun"); },
    processBoardWeekend: async () => { throw new Error("må ikke kaldes i dryRun"); },
  });
  // Korrekt preview-form.
  assert.equal(result.dryRun, true);
  assert.ok(result.rows > 0, "rows skal være > 0");
  assert.ok(Array.isArray(result.stageWinners) && result.stageWinners.length === 3, "3 etapevindere");
  assert.ok(Array.isArray(result.gcPodium) && result.gcPodium.length === 3, "3 gc-podium");
  assert.equal(result.gcPodium[0].rank, 1);
  // NULPUNKT: ingen muterende DB-operationer (delete/insert/update).
  const mutating = supabase.__writes.filter((w) => ["insert", "update", "delete"].includes(w.op));
  assert.equal(mutating.length, 0, `dryRun må ikke skrive til DB — fandt: ${JSON.stringify(mutating)}`);
});

test("simulateRace dryRun: tomt startfelt auto-fills i hukommelse uden insert (#1102)", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: [], // tomt → auto-fill-sti
    teams: [
      { id: "T1", is_test_account: false, is_frozen: false },
      { id: "T2", is_test_account: false, is_frozen: false },
    ],
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.rider_id.startsWith("b") ? "T2" : "T1", firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
  });
  const result = await simulateRace({
    supabase,
    race: STAGE_RACE,
    dryRun: true,
    applyRaceResults: async () => { throw new Error("må ikke kaldes i dryRun"); },
    recomputeRaceDays: async () => { throw new Error("må ikke kaldes i dryRun"); },
  });
  assert.equal(result.dryRun, true);
  assert.ok(result.rows > 0, "rows skal være > 0 selv med auto-fill");
  // NULPUNKT: ingen race_entries insert — hverken auto-fill eller andet.
  const inserts = supabase.__writes.filter((w) => w.table === "race_entries" && w.op === "insert");
  assert.equal(inserts.length, 0, "dryRun må ikke indsætte i race_entries");
  // Ingen muterende operationer overhovedet.
  const mutating = supabase.__writes.filter((w) => ["insert", "update", "delete"].includes(w.op));
  assert.equal(mutating.length, 0, `dryRun-auto-fill må ikke skrive til DB — fandt: ${JSON.stringify(mutating)}`);
});

// ── simulateRace race fatigue (#1306 B3) ─────────────────────────────────────

test("simulateRace: dryRun=true → applyFatigue kaldes IKKE", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
  });
  let fatigueCalls = 0;
  const result = await simulateRace({
    supabase,
    race: STAGE_RACE,
    dryRun: true,
    applyRaceResults: async () => { throw new Error("må ikke kaldes i dryRun"); },
    recomputeRaceDays: async () => { throw new Error("må ikke kaldes i dryRun"); },
    applyFatigue: async () => { fatigueCalls++; return { updated: 0 }; },
  });
  assert.equal(result.dryRun, true);
  assert.equal(fatigueCalls, 0, "applyFatigue må ikke kaldes ved dryRun=true");
});

test("simulateRace: persisted run → applyFatigue kaldt én gang pr. etape med korrekt profileType", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    seasons: [{ id: STAGE_RACE.season_id, number: 2, status: "active", race_days_completed: 5, race_days_total: 60 }],
  });
  const fatigueCalls = [];
  await simulateRace({
    supabase,
    race: STAGE_RACE,
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    recomputeRaceDays: async () => 8,
    applyFatigue: async ({ riderIds, profileType }) => {
      fatigueCalls.push({ riderIds: riderIds.slice().sort(), profileType });
      return { updated: riderIds.length };
    },
  });
  // Ét kald pr. etape (3 etaper i STAGES_3).
  assert.equal(fatigueCalls.length, STAGES_3.length, `forventet ${STAGES_3.length} fatigue-kald, fik ${fatigueCalls.length}`);
  // Profile-typer matcher STAGES_3 i rækkefølge.
  const expectedProfiles = STAGES_3.map((s) => s.profile_type);
  assert.deepEqual(fatigueCalls.map((c) => c.profileType), expectedProfiles);
  // Alle entrant-ryttere er med i hvert kald.
  const expectedIds = ENTRANTS.map((e) => e.rider_id).sort();
  for (const call of fatigueCalls) {
    assert.deepEqual(call.riderIds, expectedIds, "riderIds matcher ikke entrants");
  }
});

test("simulateRace: applyFatigue-fejl vælter ikke afviklingen (#1306)", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
  });
  const report = await simulateRace({
    supabase,
    race: STAGE_RACE,
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    recomputeRaceDays: async () => 8,
    applyFatigue: async () => { throw new Error("fatigue boom"); },
  });
  assert.ok(report.rowsImported > 0, "finalization skal fuldføre selv om applyFatigue kaster");
});
