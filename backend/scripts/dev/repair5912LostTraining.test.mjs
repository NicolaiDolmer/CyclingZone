import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyLostRiderDays, isLostRestCandidate, markerBlocks, repairKey, withMarkers,
  parseArgs, assertApplyAllowed, simulateRiderRepair, summarizePlan, MARKER_FIELD, sameProgress,
} from "./repair5912LostTraining.mjs";

const SEASON = "season-x";
const rest = (riderId, extra = {}) => ({
  rider_id: riderId, intensity: "rest", bound_race_day: true, race_day: false, injured: false,
  form: 60, fatigue: 20, fatigue_delta: -14, ...extra,
});
const run = (gameDay, riders, teamId = "team-a") => ({
  id: `run-${teamId}-${gameDay}`, team_id: teamId, season_id: SEASON, game_day: gameDay, report: { riders },
});

test("candidate: only forced rest from a binding, never injured/raced/trained", () => {
  assert.equal(isLostRestCandidate(rest("r")), true);
  assert.equal(isLostRestCandidate(rest("r", { injured: true })), false);
  assert.equal(isLostRestCandidate(rest("r", { race_day: true, intensity: "race" })), false);
  assert.equal(isLostRestCandidate(rest("r", { bound_race_day: false })), false);
  assert.equal(isLostRestCandidate({ ...rest("r"), intensity: "normal" }), false);
});

test("classify: free slot vs raced-missed vs legit stage-race rest day", () => {
  const runs = [0, 1, 2, 3, 4].map((gd) => run(gd, [rest("junior"), rest("senior"), rest("gt-rest")]));
  const stageGameDaysByRider = new Map([
    ["junior", new Map([[2, "hilly"]])], // youth rode a stage on game day 2 only
    ["senior", new Map([[0, "flat"]])],
  ]);
  const { lost, legitRest } = classifyLostRiderDays({ runs, stageGameDaysByRider });
  const junior = lost.filter((d) => d.riderId === "junior");
  assert.equal(junior.length, 5);
  assert.deepEqual(junior.filter((d) => d.kind === "raced_missed").map((d) => [d.gameDay, d.profileType]), [[2, "hilly"]]);
  assert.equal(junior.filter((d) => d.kind === "free_slot").length, 4);
  assert.equal(lost.filter((d) => d.riderId === "senior").length, 5);
  assert.equal(lost.some((d) => d.riderId === "gt-rest"), false);
  assert.equal(legitRest, 5);
  assert.deepEqual(junior[0].dateGameDays, [0, 1, 2, 3, 4]);
  assert.equal(junior[0].fatigueBefore, 34); // post 20 minus delta -14
});

test("classify: duplicate report line never yields double credit", () => {
  const runs = [run(1, [rest("r"), rest("r")]), { ...run(1, [rest("r")]), id: "dup" }];
  const { lost } = classifyLostRiderDays({ runs, stageGameDaysByRider: new Map([["r", new Map([[0, null]])]]) });
  assert.equal(lost.length, 1);
  assert.equal(lost[0].key, repairKey({ seasonId: SEASON, gameDay: 1, riderId: "r" }));
});

test("idempotency: claimed/applied markers block a rerun, released does not", () => {
  const stages = new Map([["r", new Map([[0, null]])]]);
  for (const [status, blocked] of [["claimed", true], ["applied", true], ["released", false]]) {
    const runs = [run(1, [rest("r", { [MARKER_FIELD]: { status } })])];
    const { lost, alreadyMarked } = classifyLostRiderDays({ runs, stageGameDaysByRider: stages });
    assert.equal(markerBlocks(runs[0].report.riders[0]), blocked);
    assert.equal(lost.length, blocked ? 0 : 1, status);
    assert.equal(alreadyMarked.length, blocked ? 1 : 0, status);
  }
});

test("withMarkers: claim is a no-op on applied lines; finalize only touches claimed lines", () => {
  const key = repairKey({ seasonId: SEASON, gameDay: 1, riderId: "r" });
  const keys = new Set([key]);
  const base = { riders: [rest("r"), { rider_id: "other", intensity: "normal" }] };
  const claimed = withMarkers(base, { gameDay: 1, seasonId: SEASON, keys, status: "claimed", at: "t1" });
  assert.equal(claimed.riders[0][MARKER_FIELD].status, "claimed");
  assert.equal(claimed.riders[0][MARKER_FIELD].key, key);
  assert.equal(claimed.riders[1][MARKER_FIELD], undefined);
  const applied = withMarkers(claimed, { gameDay: 1, seasonId: SEASON, keys, status: "applied", at: "t2" });
  assert.equal(applied.riders[0][MARKER_FIELD].status, "applied");
  const reclaim = withMarkers(applied, { gameDay: 1, seasonId: SEASON, keys, status: "claimed", at: "t3" });
  assert.equal(reclaim.riders[0][MARKER_FIELD].status, "applied");
  assert.equal(reclaim.riders[0][MARKER_FIELD].at, "t2");
  // A second classify after apply finds nothing left to do.
  const { lost } = classifyLostRiderDays({
    runs: [{ ...run(1, []), report: applied }], stageGameDaysByRider: new Map([["r", new Map([[0, null]])]]),
  });
  assert.equal(lost.length, 0);
  // Finalize without a prior claim never writes a marker.
  const stray = withMarkers(base, { gameDay: 1, seasonId: SEASON, keys, status: "applied", at: "t4" });
  assert.equal(stray.riders[0][MARKER_FIELD], undefined);
});

test("args + apply gate: owner go, matching count, outside evening window", () => {
  assert.equal(parseArgs([]).apply, false);
  assert.throws(() => parseArgs(["--apply"]), /owner-go/);
  assert.throws(() => parseArgs(["--apply", "--owner-go"]), /expect-rider-days/);
  assert.throws(() => parseArgs(["--write"]), /Unsupported/);
  const opts = parseArgs(["--apply", "--owner-go", "--expect-rider-days=7"]);
  const morning = new Date("2026-10-02T08:00:00Z"); // 10:00 Copenhagen
  assert.doesNotThrow(() => assertApplyAllowed({ opts, plannedRiderDays: 7, now: morning }));
  assert.throws(() => assertApplyAllowed({ opts, plannedRiderDays: 8, now: morning }), /plan changed/);
  assert.throws(() => assertApplyAllowed({ opts, plannedRiderDays: 7, now: new Date("2026-10-02T17:00:00Z") }), /refused/);
  assert.throws(() => assertApplyAllowed({ opts: parseArgs([]), plannedRiderDays: 7, now: morning }), /not authorised/);
});

test("simulate: deterministic, same engine, gains chain over the rider's lost days", () => {
  const abilityRow = {
    climbing: 50, time_trial: 50, sprint: 50, punch: 50, endurance: 50, cobblestone: 50, acceleration: 50,
    recovery: 50, tactics: 50, positioning: 50, prolog: 50, flat: 50, tempo: 50, durability: 50,
    descending: 50, aggression: 50, ability_progress: {},
  };
  const rider = {
    id: "r", birthdate: "2009-03-01", potentiale: 5, primary_type: "climber", secondary_type: null, is_academy: true,
  };
  const days = [1, 3, 0].map((gameDay) => ({
    key: repairKey({ seasonId: SEASON, gameDay, riderId: "r" }), kind: gameDay === 0 ? "raced_missed" : "free_slot",
    profileType: gameDay === 0 ? "hilly" : null, seasonId: SEASON, gameDay, dateGameDays: [0, 1, 2, 3, 4],
    formBefore: 60, fatigueBefore: 20,
  }));
  const a = simulateRiderRepair({ rider, abilityRow, days, seasonNumber: 4 });
  const b = simulateRiderRepair({ rider, abilityRow, days, seasonNumber: 4 });
  assert.deepEqual(a, b);
  assert.deepEqual(a.perDay.map((d) => d.gameDay), [0, 1, 3]);
  assert.equal(a.perDay[0].kind, "raced_missed");
  assert.ok(a.patch.ability_progress);
  for (const [k, v] of Object.entries(a.patch)) {
    if (k === "ability_progress") continue;
    assert.equal(v, abilityRow[k] + (a.gains[k] ?? 0));
  }
  assert.equal(a.totalPoints, Object.values(a.gains).reduce((s, n) => s + n, 0));
  assert.ok(a.totalProgress > 0, "a training day always moves the progress bar");
  // Input rows are never mutated.
  assert.deepEqual(abilityRow.ability_progress, {});
  assert.deepEqual(a.beforeProgress, {});
});

test("summary: counts by team type and squad", () => {
  const lost = [
    { riderId: "r1", teamId: "t1", kind: "free_slot" },
    { riderId: "r1", teamId: "t1", kind: "raced_missed" },
    { riderId: "r2", teamId: "t2", kind: "free_slot" },
  ];
  const plans = new Map([["r1", { totalPoints: 2 }], ["r2", { totalPoints: 0 }]]);
  const s = summarizePlan({
    lost, plans,
    teamById: new Map([["t1", { is_ai: false }], ["t2", { is_ai: true }]]),
    riderById: new Map([["r1", { squad: "junior" }], ["r2", { squad: "senior" }]]),
  });
  assert.equal(s.riderDays, 3);
  assert.equal(s.riders, 2);
  assert.equal(s.teams, 2);
  assert.deepEqual(s.byKind, { free_slot: 2, raced_missed: 1 });
  assert.deepEqual(s.byCategory.map((c) => c.category), ["AI / senior", "menneske / junior"]);
  assert.deepEqual(s.gainPointsPerRider, { min: 0, median: 1, max: 2, ridersWithZero: 1 });
  assert.deepEqual(s.progressPerRider, { min: 0, median: 0, max: 0 });
});

test("sameProgress: key order independent, detects changed progress", () => {
  assert.equal(sameProgress({ a: 0.5, b: 0.2 }, { b: 0.2, a: 0.5 }), true);
  assert.equal(sameProgress({ a: 0.5 }, { a: 0.6 }), false);
  assert.equal(sameProgress(null, {}), true);
});

test("--human-only keeps only human-team rider-days and plans (owner 1/10)", async () => {
  const { onlyHumanTeams, parseArgs } = await import("./repair5912LostTraining.mjs");
  const teamById = new Map([["ai", { is_ai: true }], ["human", { is_ai: false }]]);
  const r = onlyHumanTeams({
    lost: [{ teamId: "ai" }, { teamId: "human" }],
    plans: new Map([["r-ai", { teamId: "ai" }], ["r-human", { teamId: "human" }]]),
    teamById,
  });
  assert.equal(r.lost.length, 1);
  assert.deepEqual([...r.plans.keys()], ["r-human"]);
  assert.equal(parseArgs(["--human-only"]).humanOnly, true);
});

test("apply after 17:00 is allowed only when today's date close is complete (owner 1/10)", async () => {
  const { assertApplyAllowed } = await import("./repair5912LostTraining.mjs");
  const opts = { apply: true, ownerGo: true, expectRiderDays: 5 };
  const evening = new Date("2026-10-01T19:00:00Z"); // 21:00 Copenhagen
  assert.throws(() => assertApplyAllowed({ opts, plannedRiderDays: 5, now: evening }), /until today's training date close is complete/);
  assert.doesNotThrow(() => assertApplyAllowed({ opts, plannedRiderDays: 5, now: evening, todayCloseComplete: true }));
});
