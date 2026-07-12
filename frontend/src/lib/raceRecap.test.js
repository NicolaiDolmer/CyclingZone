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

test("S4 (#1176): abandon-momenter — scopet til valgt etape, cap på 2, kræver navn", () => {
  const results = [
    { id: "1", result_type: "stage", stage_number: 2, rank: 1, rider_id: "r1", rider: { firstname: "Stage", lastname: "Two" }, team_id: "tA", finish_time: "+0:00" },
  ];
  const incidents = [
    { stage_number: 2, rider_id: "r2", kind: "crash", outcome: "abandon", rider: { firstname: "Jens", lastname: "Berg" } },
    { stage_number: 2, rider_id: "r3", kind: "mechanical", outcome: "abandon", rider: { firstname: "Ole", lastname: "Holm" } },
    { stage_number: 2, rider_id: "r4", kind: "crash", outcome: "abandon", rider: { firstname: "Extra", lastname: "Rider" } },
    { stage_number: 1, rider_id: "r5", kind: "crash", outcome: "abandon", rider: { firstname: "Wrong", lastname: "Stage" } },
  ];
  const m = buildRaceRecap({ results, scope: { type: "stage", stageNumber: 2 }, incidents });
  const abandonMoments = m.filter((x) => x.key === "abandon");
  assert.equal(abandonMoments.length, 2, "cap på ABANDON_MOMENT_LIMIT=2");
  assert.equal(abandonMoments[0].params.rider, "Jens Berg");
  assert.equal(abandonMoments[0].params.kind, "crash");
  assert.equal(abandonMoments[1].params.rider, "Ole Holm");
  assert.equal(abandonMoments[1].params.kind, "mechanical");
  assert.ok(!abandonMoments.some((x) => x.params.rider === "Wrong Stage"), "etape-scope udelukker andre etapers uheld");
});

test("S4 (#1176): abandon-momenter i samlet-scope dækker alle etaper", () => {
  const results = [
    { id: "1", result_type: "gc", stage_number: 3, rank: 1, rider_id: "r1", rider: { firstname: "Gc", lastname: "Boss" }, team_id: "tA", finish_time: "+0:00" },
  ];
  const incidents = [
    { stage_number: 1, rider_id: "r2", kind: "crash", outcome: "abandon", rider: { firstname: "Early", lastname: "Out" } },
  ];
  const m = buildRaceRecap({ results, scope: { type: "overall" }, incidents });
  assert.ok(m.some((x) => x.key === "abandon" && x.params.rider === "Early Out"));
});

test("S4 (#1176): notable-crash kun ved topplacering + ≥30s tabt, ellers ingen moment", () => {
  const results = [
    { id: "1", result_type: "gc", stage_number: 3, rank: 1, rider_id: "r1", rider: { firstname: "Gc", lastname: "Boss" }, team_id: "tA", finish_time: "+0:00" },
    { id: "2", result_type: "gc", stage_number: 3, rank: 2, rider_id: "r2", rider: { firstname: "Podium", lastname: "Two" }, team_id: "tB", finish_time: "+0:42" },
  ];
  const incidentsHit = [
    { stage_number: 3, rider_id: "r2", kind: "crash", outcome: "time_loss", time_loss_seconds: 134, rider: { firstname: "Podium", lastname: "Two" } },
  ];
  const mHit = buildRaceRecap({ results, scope: { type: "overall" }, incidents: incidentsHit });
  const notable = mHit.find((x) => x.key === "notableCrash");
  assert.ok(notable, "topplaceret rytter + tilstrækkeligt tab → moment");
  assert.equal(notable.params.rider, "Podium Two");
  assert.equal(notable.params.marginText, "2:14");

  // Under tærsklen (< 30s) → ingen moment (ikke spam).
  const mSmall = buildRaceRecap({
    results, scope: { type: "overall" },
    incidents: [{ stage_number: 3, rider_id: "r2", kind: "crash", outcome: "time_loss", time_loss_seconds: 12, rider: { firstname: "Podium", lastname: "Two" } }],
  });
  assert.ok(!mSmall.some((x) => x.key === "notableCrash"));

  // Rammer en rytter uden for topplaceringen → heller ingen moment.
  const mOutsideTop = buildRaceRecap({
    results, scope: { type: "overall" },
    incidents: [{ stage_number: 3, rider_id: "r9", kind: "crash", outcome: "time_loss", time_loss_seconds: 90, rider: { firstname: "Back", lastname: "Pack" } }],
  });
  assert.ok(!mOutsideTop.some((x) => x.key === "notableCrash"));
});

test("S4 (#1176): degraderer ærligt — ingen incidents-param, tom liste, ukendt outcome", () => {
  const results = [
    { id: "1", result_type: "gc", stage_number: 1, rank: 1, rider_id: "r1", rider: { firstname: "Solo", lastname: "Rider" }, team_id: "tA", finish_time: "+0:00" },
  ];
  assert.deepEqual(buildRaceRecap({ results, scope: { type: "overall" } }), buildRaceRecap({ results, scope: { type: "overall" }, incidents: [] }));
  const m = buildRaceRecap({ results, scope: { type: "overall" }, incidents: [{ stage_number: 1, rider_id: "r1", kind: "crash", outcome: "abandon" }] });
  assert.ok(!m.some((x) => x.key === "abandon"), "uheld uden navn (rider ikke joinet) må ikke give en tom recap-linje");
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
