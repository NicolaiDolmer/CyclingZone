import test from "node:test";
import assert from "node:assert/strict";
import { buildRaceRecap, parseGapSeconds } from "./raceRecap.js";

const keys = (moments) => moments.map((m) => m.key);

test("parseGapSeconds: '+M:SS' → sekunder, robust mod tom/ugyldig", () => {
  assert.equal(parseGapSeconds("+0:18"), 18);
  assert.equal(parseGapSeconds("+2:05"), 125);
  assert.equal(parseGapSeconds(""), null);
  assert.equal(parseGapSeconds(null), null);
});

test("endagsløb: solosejr + overlevet udbrud + holdsejr", () => {
  const results = [
    { id: "1", result_type: "gc", stage_number: 1, rank: 1, rider_id: "r1", rider: { id: "r1", firstname: "Mads", lastname: "Mortensen" }, team_id: "tA", finish_time: "+0:00", in_breakaway: true, breakaway_caught: false },
    { id: "2", result_type: "gc", stage_number: 1, rank: 2, rider_id: "r2", rider: { id: "r2", firstname: "Jonas", lastname: "Holm" }, team_id: "tB", finish_time: "+0:18", in_breakaway: false, breakaway_caught: false },
    { id: "3", result_type: "team", stage_number: 1, rank: 1, rider_id: null, team_id: "tA", team: { id: "tA", name: "Alpha" } },
    { id: "4", result_type: "team", stage_number: 1, rank: 2, rider_id: null, team_id: "tB", team: { id: "tB", name: "Beta" } },
  ];
  const m = buildRaceRecap({ results, race: { race_type: "single" }, scope: { type: "overall" } });
  assert.deepEqual(keys(m), ["soloWin", "breakawaySurvived", "teamWon"]);
  assert.equal(m[0].params.rider, "Mads Mortensen");
  assert.equal(m[0].params.marginText, "0:18");
  assert.equal(m[1].params.count, 1);
  assert.equal(m[2].params.team, "Alpha");
});

test("endagsløb: spurtsejr (lille margin) + indhentet udbrud", () => {
  const results = [
    { id: "1", result_type: "gc", stage_number: 1, rank: 1, rider_id: "r1", rider: { id: "r1", firstname: "Ada", lastname: "Pedersen" }, team_id: "tA", finish_time: "+0:00", in_breakaway: false, breakaway_caught: false },
    { id: "2", result_type: "gc", stage_number: 1, rank: 2, rider_id: "r2", rider: { id: "r2", firstname: "Lea", lastname: "Berg" }, team_id: "tB", finish_time: "+0:00", in_breakaway: false, breakaway_caught: false },
    { id: "3", result_type: "gc", stage_number: 1, rank: 8, rider_id: "r3", rider: { id: "r3", firstname: "Tom", lastname: "Eik" }, team_id: "tC", finish_time: "+0:31", in_breakaway: true, breakaway_caught: true },
  ];
  const m = buildRaceRecap({ results, race: { race_type: "single" }, scope: { type: "overall" } });
  assert.equal(m[0].key, "sprintWin");
  assert.equal(m[0].params.rider, "Ada Pedersen");
  assert.ok(keys(m).includes("breakawayCaught"));
  assert.equal(m.find((x) => x.key === "breakawayCaught").params.count, 1);
});

test("etape-scope bruger 'stage'-rækker for den valgte etape", () => {
  const results = [
    { id: "1", result_type: "stage", stage_number: 1, rank: 1, rider_id: "r9", rider: { firstname: "Stage", lastname: "One" }, team_id: "tA", finish_time: "+0:00", in_breakaway: false, breakaway_caught: false },
    { id: "2", result_type: "stage", stage_number: 2, rank: 1, rider_id: "r5", rider: { firstname: "Stage", lastname: "Two" }, team_id: "tB", finish_time: "+0:00", in_breakaway: false, breakaway_caught: false },
    { id: "3", result_type: "stage", stage_number: 2, rank: 2, rider_id: "r6", rider: { firstname: "Runner", lastname: "Up" }, team_id: "tC", finish_time: "+1:12", in_breakaway: false, breakaway_caught: false },
  ];
  const m = buildRaceRecap({ results, race: { race_type: "stage_race" }, scope: { type: "stage", stageNumber: 2 } });
  assert.equal(m[0].params.rider, "Stage Two");
  assert.equal(m[0].key, "soloWin");
  assert.equal(m[0].params.marginText, "1:12");
});

test("etapeløb samlet: GC-vinder + holdets dag (≥2 i top 10) + trøjer", () => {
  const results = [
    { id: "g1", result_type: "gc", stage_number: 3, rank: 1, rider_id: "r1", rider: { firstname: "Gc", lastname: "Boss" }, team_id: "tA", finish_time: "+0:00" },
    { id: "g2", result_type: "gc", stage_number: 3, rank: 2, rider_id: "r2", rider: { firstname: "Sec", lastname: "Ond" }, team_id: "tA", finish_time: "+0:42" },
    { id: "g3", result_type: "gc", stage_number: 3, rank: 3, rider_id: "r3", rider: { firstname: "Thi", lastname: "Rd" }, team_id: "tB", finish_time: "+1:05" },
    { id: "p1", result_type: "points", stage_number: 3, rank: 1, rider_id: "r4", rider: { firstname: "Point", lastname: "King" }, team_id: "tC" },
    { id: "m1", result_type: "mountain", stage_number: 3, rank: 1, rider_id: "r5", rider: { firstname: "Climb", lastname: "Ace" }, team_id: "tD" },
    { id: "t1", result_type: "team", stage_number: 3, rank: 1, rider_id: null, team_id: "tA", team: { id: "tA", name: "Alpha" } },
  ];
  const m = buildRaceRecap({ results, race: { race_type: "stage_race" }, scope: { type: "overall" } });
  const ks = keys(m);
  assert.equal(m[0].key, "soloWin");
  assert.equal(m[0].params.rider, "Gc Boss");
  assert.ok(ks.includes("teamDay"), "holdets dag med count");
  assert.equal(m.find((x) => x.key === "teamDay").params.count, 2);
  assert.ok(ks.includes("jerseys"));
  assert.equal(m.find((x) => x.key === "jerseys").params.points, "Point King");
  assert.equal(m.find((x) => x.key === "jerseys").params.mountain, "Climb Ace");
});

test("endagsløb gemt som 'stage'-rækker (ingen gc) → recap udledes alligevel", () => {
  const results = [
    { id: "1", result_type: "stage", stage_number: 1, rank: 1, rider_id: "r1", rider: { firstname: "Ada", lastname: "Pedersen" }, team_id: "tA", finish_time: "+0:00", in_breakaway: true, breakaway_caught: false },
    { id: "2", result_type: "stage", stage_number: 1, rank: 2, rider_id: "r2", rider: { firstname: "Mik", lastname: "Hansen" }, team_id: "tB", finish_time: "+0:14", in_breakaway: false, breakaway_caught: false },
    { id: "3", result_type: "team", stage_number: 1, rank: 1, rider_id: null, team_id: "tA", team: { id: "tA", name: "Alpha" } },
  ];
  const m = buildRaceRecap({ results, scope: { type: "overall" } });
  assert.equal(m[0].key, "soloWin");
  assert.equal(m[0].params.rider, "Ada Pedersen");
  assert.equal(keys(m).includes("breakawaySurvived"), true);
  assert.equal(keys(m).includes("teamWon"), true);
});

test("tynde data: manglende finish_time → generisk 'win'; tom → []", () => {
  const thin = [
    { id: "1", result_type: "gc", stage_number: 1, rank: 1, rider_id: "r1", rider: { firstname: "Solo", lastname: "Rider" }, team_id: "tA", finish_time: null },
  ];
  const m = buildRaceRecap({ results: thin, race: { race_type: "single" }, scope: { type: "overall" } });
  assert.equal(m[0].key, "win");
  assert.equal(m[0].params.rider, "Solo Rider");

  assert.deepEqual(buildRaceRecap({ results: [], race: {}, scope: { type: "overall" } }), []);
  assert.deepEqual(buildRaceRecap({}), []);
});
