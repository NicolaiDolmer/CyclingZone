import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatGap,
  parseGapSeconds,
  accumulateStageRows,
  filterCompletedEntrants,
  classPointsForRank,
  teamClassification,
  teamClassificationTime,
  dailyTeamPlacesFromStageRows,
  jerseyLeadersFromComps,
} from "./raceClassifications.js";
import { buildStageRowsAccumulated } from "./raceRunner.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";
import { ENGINE_VERSION_V4 } from "./raceEngineV4Bridge.js";

// ── #5952: holdklassementet ved lige tid (UCI) ──────────────────────────────

// Spillerens eksempel (stijnlah98 29/9, Rund um Köln Neu): massespurt, alle +0:00.
// Hold A's ryttere blev nr. 9/19/24, hold B's nr. 29/45/49. Før: B foran A fordi
// "Breakaway Racing" < "Slipstream" alfabetisk. Nu: A foran B.
test("#5952: lige tid i endagsloeb brydes paa placeringssummen af de 3 taellende, aldrig alfabetisk", () => {
  const entrants = [
    { rider_id: "a1", team_id: "Slipstream" }, { rider_id: "a2", team_id: "Slipstream" }, { rider_id: "a3", team_id: "Slipstream" },
    { rider_id: "b1", team_id: "Breakaway" }, { rider_id: "b2", team_id: "Breakaway" }, { rider_id: "b3", team_id: "Breakaway" },
  ];
  const time = new Map(entrants.map((e) => [e.rider_id, 0]));
  const placeByRider = new Map([["a1", 9], ["a2", 19], ["a3", 24], ["b1", 29], ["b2", 45], ["b3", 49]]);
  const rows = teamClassification(entrants, time, { mode: "stage", placeByRider });
  assert.deepEqual(rows.map((r) => r.team_id), ["Slipstream", "Breakaway"]);
  // Uden tiebreak (gammel adfaerd) ville det vaere omvendt — beviset paa fejlen.
  assert.deepEqual(teamClassification(entrants, time).map((r) => r.team_id), ["Breakaway", "Slipstream"]);
});

test("#5952: tiden afgoer stadig foerst — placeringer bruges KUN ved lige tid", () => {
  const entrants = ["x1", "x2", "x3", "y1", "y2", "y3"].map((id) => ({ rider_id: id, team_id: id[0] }));
  const time = new Map([["x1", 0], ["x2", 0], ["x3", 5], ["y1", 0], ["y2", 0], ["y3", 0]]);
  const placeByRider = new Map([["x1", 1], ["x2", 2], ["x3", 3], ["y1", 50], ["y2", 51], ["y3", 52]]);
  assert.deepEqual(teamClassification(entrants, time, { placeByRider }).map((r) => r.team_id), ["y", "x"]);
});

test("#5952: de 3 taellende ved lige tid er de bedst placerede, ikke de foerste i listen", () => {
  const entrants = ["a1", "a2", "a3", "a4", "b1", "b2", "b3"].map((id) => ({ rider_id: id, team_id: id[0] }));
  const time = new Map(entrants.map((e) => [e.rider_id, 0]));
  // Hold a: 4 ryttere; de 3 bedste (1, 2, 3) taeller, ikke nr. 90.
  const placeByRider = new Map([["a1", 90], ["a2", 1], ["a3", 2], ["a4", 3], ["b1", 4], ["b2", 5], ["b3", 6]]);
  assert.deepEqual(teamClassification(entrants, time, { placeByRider }).map((r) => r.team_id), ["a", "b"]);
});

test("#5952: samlet (overall): flest dagssejre i holdklassementet, saa 2.-pladser, saa bedste GC-rytter", () => {
  const entrants = ["p1", "p2", "p3", "q1", "q2", "q3", "r1", "r2", "r3"].map((id) => ({ rider_id: id, team_id: id[0] }));
  const time = new Map(entrants.map((e) => [e.rider_id, 100]));
  const placeByRider = new Map([["p1", 1], ["q1", 2], ["r1", 3], ["p2", 4], ["q2", 5], ["r2", 6], ["p3", 7], ["q3", 8], ["r3", 9]]);
  // q: 2 dagssejre; r: 1 sejr + 1 andenplads; p: 1 sejr. -> q, r, p (p har bedste GC-rytter, men faerre sejre).
  const dailyPlacesByTeam = new Map([["q", [2]], ["r", [1, 1]], ["p", [1]]]);
  const rows = teamClassification(entrants, time, { mode: "overall", placeByRider, dailyPlacesByTeam });
  assert.deepEqual(rows.map((r) => r.team_id), ["q", "r", "p"]);
  // Lige dagsplaceringer -> bedste rytter i GC afgoer.
  const tied = teamClassification(entrants, time, { mode: "overall", placeByRider, dailyPlacesByTeam: new Map() });
  assert.deepEqual(tied.map((r) => r.team_id), ["p", "q", "r"]);
});

test("#5952: <3 finishers rangeres stadig ikke (#2694), og resultatformen er {team_id,time,rank}", () => {
  const entrants = [{ rider_id: "a1", team_id: "A" }, { rider_id: "a2", team_id: "A" }];
  assert.deepEqual(teamClassification(entrants, new Map(), { placeByRider: new Map() }), []);
  const three = ["b1", "b2", "b3"].map((id) => ({ rider_id: id, team_id: "B" }));
  assert.deepEqual(teamClassification(three, new Map([["b1", 1], ["b2", 2], ["b3", 3]])), [{ team_id: "B", time: 6, rank: 1 }]);
});

test("#5952: dailyTeamPlacesFromStageRows taeller etapernes holdplaceringer med UCI-tiebreak", () => {
  const row = (stage, rider, team, rank, gap = "+0:00") => ({ stage_number: stage, rider_id: rider, team_id: team, rank, finish_time: gap });
  const stageRows = [
    // Etape 1: alle samme tid; A har de bedste placeringer -> A vinder etapens holdklassement.
    row(1, "a1", "A", 1), row(1, "a2", "A", 2), row(1, "a3", "A", 3),
    row(1, "b1", "B", 4), row(1, "b2", "B", 5), row(1, "b3", "B", 6),
    // Etape 2: B hurtigst paa tid.
    row(2, "a1", "A", 4, "+0:10"), row(2, "a2", "A", 5, "+0:10"), row(2, "a3", "A", 6, "+0:10"),
    row(2, "b1", "B", 1), row(2, "b2", "B", 2), row(2, "b3", "B", 3),
  ];
  const counts = dailyTeamPlacesFromStageRows(stageRows);
  assert.deepEqual(counts.get("A"), [1, 1]);
  assert.deepEqual(counts.get("B"), [1, 1]);
});

// ── #5914: troejefoererne foer etapen ────────────────────────────────────────
test("jerseyLeadersFromComps: flest point foerer; nul point = ingen foerer", () => {
  const entrants = [{ rider_id: "a" }, { rider_id: "b" }, { rider_id: "c" }];
  const leaders = jerseyLeadersFromComps(
    entrants,
    new Map([["a", 20], ["b", 45], ["c", 45]]),
    new Map([["a", 0], ["b", 0]]),
  );
  // Lige point brydes paa rider_id — samme regel som troeje-klassementet.
  assert.deepEqual(leaders, { points: "b", kom: null });
});

test("jerseyLeadersFromComps: en foerer der er udgaaet (ikke i feltet) kan ikke foere", () => {
  const leaders = jerseyLeadersFromComps([{ rider_id: "a" }], new Map([["gone", 99], ["a", 5]]), new Map());
  assert.deepEqual(leaders, { points: "a", kom: null });
});

// ── parseGapSeconds / formatGap roundtrip ─────────────────────────────────────
test("parseGapSeconds er invers af formatGap (afrundede sekunder)", () => {
  for (const s of [0, 1, 59, 60, 61, 599, 600, 3599, 3600, 5025]) {
    assert.equal(parseGapSeconds(formatGap(s)), s, `roundtrip for ${s}s`);
  }
});

test("parseGapSeconds: defensiv på null/PCM-rækker uden finish_time", () => {
  assert.equal(parseGapSeconds(null), 0);
  assert.equal(parseGapSeconds(undefined), 0);
  assert.equal(parseGapSeconds(""), 0);
  assert.equal(parseGapSeconds("garbage"), 0);
  assert.equal(parseGapSeconds("+2:05"), 125);
  assert.equal(parseGapSeconds("2:05"), 125); // uden plus accepteres
});

// ── accumulateStageRows ───────────────────────────────────────────────────────
const PROFILES = new Map([[1, "flat"], [2, "mountain"], [3, "flat"]]);

function row(stage, rider, rank, gap) {
  return { stage_number: stage, result_type: "stage", rank, rider_id: rider, finish_time: gap };
}

test("akkumulering: cumTime = sum af parsede gaps, posSum = sum af ranks", () => {
  const acc = accumulateStageRows({
    stageRows: [row(1, "x", 1, "+0:00"), row(1, "y", 2, "+1:30"), row(2, "x", 3, "+2:00"), row(2, "y", 1, "+0:00")],
    profileTypeByStage: PROFILES,
  });
  assert.equal(acc.cumTime.get("x"), 120);
  assert.equal(acc.cumTime.get("y"), 90);
  assert.equal(acc.posSum.get("x"), 4);
  assert.equal(acc.posSum.get("y"), 3);
  assert.deepEqual([...acc.stageNumbers].sort(), [1, 2]);
});

test("KOM-point kun på klatre-etaper; point-konkurrence på alle", () => {
  const acc = accumulateStageRows({
    stageRows: [row(1, "x", 1, "+0:00"), row(2, "x", 1, "+0:00")], // flat + mountain
    profileTypeByStage: PROFILES,
  });
  assert.equal(acc.pointsComp.get("x"), 2 * classPointsForRank(1));
  assert.equal(acc.komComp.get("x"), classPointsForRank(1)); // kun mountain-etapen
});

test("rækker uden rider_id ignoreres (team-rækker o.l. kan aldrig forurene)", () => {
  const acc = accumulateStageRows({
    stageRows: [{ stage_number: 1, rank: 1, rider_id: null, finish_time: "+0:00" }],
    profileTypeByStage: PROFILES,
  });
  assert.equal(acc.stageNumbers.size, 0);
  assert.equal(acc.cumTime.size, 0);
});

// ── Sub-2 (#2770): passage-kolonner m. legacy-fallback ────────────────────────
test("accumulateStageRows: nye kolonner driver point/kom/bonus", () => {
  const rows = [
    { stage_number: 1, rider_id: "a", rank: 1, finish_time: "+0:00", sprint_points: 50, kom_points: 0, bonus_seconds: 13 },
    { stage_number: 1, rider_id: "b", rank: 2, finish_time: "+0:10", sprint_points: 30, kom_points: 5, bonus_seconds: 6 },
  ];
  const acc = accumulateStageRows({ stageRows: rows, profileTypeByStage: new Map([[1, "flat"]]) });
  assert.equal(acc.pointsComp.get("a"), 50);
  assert.equal(acc.komComp.get("b"), 5);
  assert.equal(acc.cumTime.get("a"), -13); // 0 gap − 13 bonus
  assert.equal(acc.cumTime.get("b"), 4);   // 10 − 6
});

test("accumulateStageRows: null-kolonner → legacy-adfærd (classPointsForRank + CLIMB_PROFILES)", () => {
  const rows = [
    { stage_number: 1, rider_id: "a", rank: 1, finish_time: "+0:00", sprint_points: null, kom_points: null, bonus_seconds: null },
  ];
  const acc = accumulateStageRows({ stageRows: rows, profileTypeByStage: new Map([[1, "mountain"]]) });
  assert.equal(acc.pointsComp.get("a"), 25); // legacy classPointsForRank(1)
  assert.equal(acc.komComp.get("a"), 25);    // legacy: mountain ∈ CLIMB_PROFILES
  assert.equal(acc.cumTime.get("a"), 0);
});

// ── filterCompletedEntrants ───────────────────────────────────────────────────
test("kun ryttere med ALLE etaper er klassements-berettigede (solgt/slettet udgår)", () => {
  const entrants = [{ rider_id: "full" }, { rider_id: "leaver" }, { rider_id: "late" }];
  const acc = accumulateStageRows({
    stageRows: [
      row(1, "full", 1, "+0:00"), row(2, "full", 1, "+0:00"),
      row(1, "leaver", 2, "+0:10"), // mangler etape 2
      row(2, "late", 2, "+0:10"),   // mangler etape 1 (mid-race-intruder)
    ],
    profileTypeByStage: PROFILES,
  });
  const completed = filterCompletedEntrants(entrants, acc.stagesByRider, acc.stageNumbers);
  assert.deepEqual(completed.map((e) => e.rider_id), ["full"]);
});

test("tomt input → tomme maps, ingen throw", () => {
  const acc = accumulateStageRows({ stageRows: [], profileTypeByStage: new Map() });
  assert.equal(acc.stageNumbers.size, 0);
  assert.deepEqual(filterCompletedEntrants([{ rider_id: "a" }], acc.stagesByRider, acc.stageNumbers), [{ rider_id: "a" }]);
});

// ── teamClassification ────────────────────────────────────────────────────────
test("teamClassification: hold med <3 fuldførende ryttere rangeres IKKE (#2694)", () => {
  // Hold A har kun 1 rytter, hold B kun 2 — ingen af dem kan vinde/rangeres.
  // Hold C har 3 → eneste rangerede hold.
  const entrants = [
    { rider_id: "a1", team_id: "A" },
    { rider_id: "b1", team_id: "B" },
    { rider_id: "b2", team_id: "B" },
    { rider_id: "c1", team_id: "C" },
    { rider_id: "c2", team_id: "C" },
    { rider_id: "c3", team_id: "C" },
  ];
  const cumTime = new Map([
    ["a1", 10], // hurtigst, men soloryttet → udgår
    ["b1", 20], ["b2", 30],
    ["c1", 100], ["c2", 110], ["c3", 120],
  ]);
  const rows = teamClassification(entrants, cumTime);
  assert.deepEqual(rows.map((r) => r.team_id), ["C"]);
  assert.equal(rows[0].rank, 1);
});

test("teamClassification: bedste-3-sum + tie-break bevaret for hold med >=3", () => {
  const entrants = [
    { rider_id: "a1", team_id: "A" }, { rider_id: "a2", team_id: "A" },
    { rider_id: "a3", team_id: "A" }, { rider_id: "a4", team_id: "A" },
    { rider_id: "b1", team_id: "B" }, { rider_id: "b2", team_id: "B" },
    { rider_id: "b3", team_id: "B" },
  ];
  const cumTime = new Map([
    ["a1", 0], ["a2", 10], ["a3", 20], ["a4", 900], // 4. rytter tæller ikke: 0+10+20=30
    ["b1", 5], ["b2", 5], ["b3", 5], // 15 → B vinder
  ]);
  const rows = teamClassification(entrants, cumTime);
  assert.deepEqual(rows.map((r) => [r.rank, r.team_id, r.time]), [[1, "B", 15], [2, "A", 30]]);
});

test("teamClassification: lige tid brydes deterministisk på team_id", () => {
  const entrants = [
    { rider_id: "z1", team_id: "Z" }, { rider_id: "z2", team_id: "Z" }, { rider_id: "z3", team_id: "Z" },
    { rider_id: "a1", team_id: "A" }, { rider_id: "a2", team_id: "A" }, { rider_id: "a3", team_id: "A" },
  ];
  const cumTime = new Map([
    ["z1", 10], ["z2", 10], ["z3", 10],
    ["a1", 10], ["a2", 10], ["a3", 10],
  ]);
  const rows = teamClassification(entrants, cumTime);
  assert.deepEqual(rows.map((r) => r.team_id), ["A", "Z"]);
});

test("#5952 stage: equal time and placing sum use the best individual placing", () => {
  const entrants = [
    { rider_id: "a1", team_id: "alpha" }, { rider_id: "a2", team_id: "alpha" }, { rider_id: "a3", team_id: "alpha" },
    { rider_id: "z1", team_id: "zeta" }, { rider_id: "z2", team_id: "zeta" }, { rider_id: "z3", team_id: "zeta" },
  ];
  const time = new Map(entrants.map((r) => [r.rider_id, 0]));
  const placeByRider = new Map([["a1", 2], ["a2", 3], ["a3", 7], ["z1", 1], ["z2", 5], ["z3", 6]]);
  assert.deepEqual(teamClassification(entrants, time, { mode: "stage", placeByRider }).map((r) => r.team_id), ["zeta", "alpha"]);
});

// ── #6338 (ren revision, official_times_v3): holdklassementet uden bonussekunder ──
// UCI: holdklassementet i et etapeloeb summerer rytternes FAKTISKE tider, uden
// bonussekunder. Foer trak den samlede tidssum bonussen fra (samme tal som GC),
// saa et hold hvis rytter tog maalbonus fik en fordel det ikke skal have.

// Hold A's rytter vandt etapen med 10 s bonus; Hold B var 5 s hurtigere i sum.
const BONUS_ROWS_6338 = [
  { stage_number: 1, rider_id: "a1", team_id: "team-a", rank: 1, finish_time: "+0:00", sprint_points: 0, kom_points: 0, bonus_seconds: 10 },
  { stage_number: 1, rider_id: "a2", team_id: "team-a", rank: 4, finish_time: "+0:05", sprint_points: 0, kom_points: 0, bonus_seconds: 0 },
  { stage_number: 1, rider_id: "a3", team_id: "team-a", rank: 5, finish_time: "+0:05", sprint_points: 0, kom_points: 0, bonus_seconds: 0 },
  { stage_number: 1, rider_id: "b1", team_id: "team-b", rank: 2, finish_time: "+0:00", sprint_points: 0, kom_points: 0, bonus_seconds: 0 },
  { stage_number: 1, rider_id: "b2", team_id: "team-b", rank: 3, finish_time: "+0:00", sprint_points: 0, kom_points: 0, bonus_seconds: 0 },
  { stage_number: 1, rider_id: "b3", team_id: "team-b", rank: 6, finish_time: "+0:05", sprint_points: 0, kom_points: 0, bonus_seconds: 0 },
];
const BONUS_ENTRANTS_6338 = BONUS_ROWS_6338.map((r) => ({ rider_id: r.rider_id, team_id: r.team_id }));

test("#6338: accumulateStageRows baerer ogsaa tiden uden bonussekunder (cumTimeRaw); GC-tiden er uaendret", () => {
  const acc = accumulateStageRows({ stageRows: [...BONUS_ROWS_6338, { ...BONUS_ROWS_6338[0], stage_number: 2, finish_time: "+0:07", bonus_seconds: 4 }] });
  assert.equal(acc.cumTime.get("a1"), 0 - 10 + 7 - 4, "GC: bonussekunder trukket fra som foer");
  assert.equal(acc.cumTimeRaw.get("a1"), 0 + 7, "holdtid: kun de faktiske tider");
  assert.equal(acc.cumTimeRaw.get("b3"), 5);
});

test("#6338 v3: holdklassementet i et etapeloeb bruger tiden uden bonussekunder", () => {
  const acc = accumulateStageRows({ stageRows: BONUS_ROWS_6338 });
  const time = teamClassificationTime(acc, "official_times_v3");
  assert.equal(time, acc.cumTimeRaw);
  const rows = teamClassification(BONUS_ENTRANTS_6338, time, { mode: "overall" });
  assert.deepEqual(rows.map((r) => [r.team_id, r.time]), [["team-b", 5], ["team-a", 10]], "bonussen maa ikke vinde holdklassementet");
});

test("#6338: aeldre revisioner er uaendrede (holdtiden er stadig GC-tiden med bonus)", () => {
  const acc = accumulateStageRows({ stageRows: BONUS_ROWS_6338 });
  for (const rev of [undefined, null, "legacy", "orders_gc_v1", "orders_gc_v3", "official_times_v1", "official_times_v2", "ukendt"]) {
    assert.equal(teamClassificationTime(acc, rev), acc.cumTime, String(rev));
  }
  const rows = teamClassification(BONUS_ENTRANTS_6338, acc.cumTime, { mode: "overall" });
  assert.deepEqual(rows.map((r) => r.team_id), ["team-a", "team-b"], "den gamle regel (bonus med) - laast som den var");
});

// Kaldstedet: raceRunner's etape-for-etape-sti (buildStageRowsAccumulated) paa
// loebets sidste etape, med en spion-motor der giver hele feltet samme tid.
// Etape 1 (persisteret): Hold A's rytter tog bonussen; Hold B var hurtigst i sum.
test("#6338 v3: raceRunner's samlede holdklassement paa sidste etape ignorerer bonussen; aeldre revisioner uaendret", () => {
  const abil = (seed) => Object.fromEntries(ABILITY_KEYS.map((k, i) => [k, 35 + ((seed * 13 + i * 7) % 55)]));
  const entrants = Array.from({ length: 16 }, (_, i) => ({
    rider_id: `r${String(i).padStart(2, "0")}`, team_id: i < 8 ? "A" : "B", team_name: i < 8 ? "Team A" : "Team B",
    rider_name: `Rider ${i}`, is_u25: false, abilities: abil(i), fatigue: 0,
  }));
  const race = { id: "race-6338", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 2 };
  const stages = [
    { stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint", demand_vector: DEMAND_VECTORS.flat, distance_km: 180, climbs: [], sprints: [], race_id: race.id, id: "sp-1" },
    { stage_number: 2, profile_type: "flat", finale_type: "bunch_sprint", demand_vector: DEMAND_VECTORS.flat, distance_km: 180, climbs: [], sprints: [], race_id: race.id, id: "sp-2" },
  ];
  // A: r00 +0:00 med 30 s bonus, r01/r02 +0:10 (raa sum 20, med bonus -10).
  // B: r08/r09/r10 +0:05 (sum 15). Resten +1:00.
  const gapOf = { r00: "+0:00", r01: "+0:10", r02: "+0:10", r08: "+0:05", r09: "+0:05", r10: "+0:05" };
  const priorStageRows = entrants.map((e, i) => ({
    stage_number: 1, result_type: "stage", rank: i + 1, rider_id: e.rider_id, team_id: e.team_id,
    finish_time: gapOf[e.rider_id] ?? "+1:00", sprint_points: 0, kom_points: 0, bonus_seconds: e.rider_id === "r00" ? 30 : 0,
  }));
  const spyEngine = {
    version: ENGINE_VERSION_V4,
    simulateStage: (args) => ({
      ranked: args.entrants.map((e, i) => ({ rider_id: e.rider_id, team_id: e.team_id, rank: i + 1, stageGap: 0, components: {} })),
      incidents: [], passages: null, timeline: null,
    }),
  };
  const finalTeamWinner = (rulesRevision) => {
    const { resultRows } = buildStageRowsAccumulated({
      race, stagesSorted: stages, stageIndex: 1, entrants, pointsLookup: {}, priorStageRows, v3: true, v4Engine: spyEngine, rulesRevision,
    });
    return resultRows.filter((r) => r.result_type === "team").sort((a, b) => a.rank - b.rank)[0]?.team_id;
  };
  assert.equal(finalTeamWinner("official_times_v3"), "B", "v3: holdklassementet paa de faktiske tider");
  for (const rev of ["legacy", "orders_gc_v2", "official_times_v2"]) {
    assert.equal(finalTeamWinner(rev), "A", `${rev}: den gamle regel (bonus med) er uaendret`);
  }
});

test("#6338 v3: uden en raa tid (aeldre kaldsted) falder holdtiden tilbage paa GC-tiden", () => {
  const cumTime = new Map([["a1", 1]]);
  assert.equal(teamClassificationTime({ cumTime }, "official_times_v3"), cumTime);
});
