import test from "node:test";
import assert from "node:assert/strict";
import {
  findLastCompletedRaceDay,
  sumPointsByTeam,
  computeDivisionMovement,
} from "./dashboardMovementSignals.js";

test("findLastCompletedRaceDay: ignorerer scheduled-løb, vælger højeste game_day_start", () => {
  const races = [
    { id: "r1", status: "completed", game_day_start: 2 },
    { id: "r2", status: "completed", game_day_start: 9 },
    { id: "r3", status: "scheduled", game_day_start: 20 },
  ];
  const result = findLastCompletedRaceDay(races);
  assert.deepEqual(result, { day: 9, raceIds: ["r2"] });
});

test("findLastCompletedRaceDay: samler flere løb på samme (seneste) løbsdag", () => {
  const races = [
    { id: "r1", status: "completed", game_day_start: 5 },
    { id: "r2", status: "completed", game_day_start: 9 },
    { id: "r3", status: "completed", game_day_start: 9 },
  ];
  const result = findLastCompletedRaceDay(races);
  assert.equal(result.day, 9);
  assert.deepEqual(new Set(result.raceIds), new Set(["r2", "r3"]));
});

test("findLastCompletedRaceDay: ingen afsluttede løb → null", () => {
  assert.equal(findLastCompletedRaceDay([{ id: "r1", status: "scheduled", game_day_start: 1 }]), null);
  assert.equal(findLastCompletedRaceDay([]), null);
  assert.equal(findLastCompletedRaceDay(undefined), null);
});

test("findLastCompletedRaceDay: løb uden game_day_start ignoreres", () => {
  const races = [{ id: "r1", status: "completed", game_day_start: null }];
  assert.equal(findLastCompletedRaceDay(races), null);
});

test("sumPointsByTeam: summerer pr. team_id på tværs af rækker", () => {
  const rows = [
    { team_id: "a", race_points: 40 },
    { team_id: "a", race_points: 46 },
    { team_id: "b", race_points: 10 },
    { team_id: null, race_points: 99 }, // ugyldig række ignoreres
  ];
  assert.deepEqual(sumPointsByTeam(rows), { a: 86, b: 10 });
});

test("sumPointsByTeam: tomt/undefined input → tomt objekt", () => {
  assert.deepEqual(sumPointsByTeam([]), {});
  assert.deepEqual(sumPointsByTeam(undefined), {});
});

test("computeDivisionMovement: hold klatrer 1 plads + point-delta", () => {
  const divStandingsAll = [
    { team_id: "rival", total_points: 6120 },
    { team_id: "me", total_points: 5480 },
    { team_id: "ai", total_points: 5450 },
  ];
  const pointsByTeam = { rival: 10, me: 86, ai: 10 };
  const result = computeDivisionMovement({ divStandingsAll, myTeamId: "me", pointsByTeam });
  // Prior: rival=6110, me=5394, ai=5440 → sorteret: rival(0) ai(1) me(2) → priorRank=2
  // Current rank (index) = 1 → climbed 2-1 = 1
  assert.equal(result.rankMovement, 1);
  assert.equal(result.pointsDelta, 86);
});

test("computeDivisionMovement: uændret placering → rankMovement 0", () => {
  const divStandingsAll = [
    { team_id: "rival", total_points: 6120 },
    { team_id: "me", total_points: 5480 },
    { team_id: "ai", total_points: 4990 },
  ];
  const pointsByTeam = { rival: 10, me: 86, ai: 15 };
  const result = computeDivisionMovement({ divStandingsAll, myTeamId: "me", pointsByTeam });
  assert.equal(result.rankMovement, 0);
  assert.equal(result.pointsDelta, 86);
});

test("computeDivisionMovement: intet data for mit hold → begge null", () => {
  const divStandingsAll = [{ team_id: "rival", total_points: 6120 }, { team_id: "me", total_points: 5480 }];
  const result = computeDivisionMovement({ divStandingsAll, myTeamId: "me", pointsByTeam: { rival: 10 } });
  assert.equal(result.rankMovement, null);
  assert.equal(result.pointsDelta, null);
});

test("computeDivisionMovement: intet hold-id / tom standings-liste → begge null", () => {
  assert.deepEqual(
    computeDivisionMovement({ divStandingsAll: [], myTeamId: "me", pointsByTeam: {} }),
    { rankMovement: null, pointsDelta: null }
  );
  assert.deepEqual(
    computeDivisionMovement({ divStandingsAll: [{ team_id: "me", total_points: 10 }], myTeamId: null, pointsByTeam: {} }),
    { rankMovement: null, pointsDelta: null }
  );
});
