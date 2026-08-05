import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSeasonMovement, resolveNextDivision, pickRecapHighlights } from "./seasonRecapData.js";

// ─── computeSeasonMovement ──────────────────────────────────────────────────

test("computeSeasonMovement: lower next division = promoted", () => {
  assert.equal(computeSeasonMovement(3, 2), "promoted");
});

test("computeSeasonMovement: higher next division = relegated", () => {
  assert.equal(computeSeasonMovement(2, 3), "relegated");
});

test("computeSeasonMovement: same division = maintained", () => {
  assert.equal(computeSeasonMovement(2, 2), "maintained");
});

test("computeSeasonMovement: missing finishedDivision = null", () => {
  assert.equal(computeSeasonMovement(null, 2), null);
});

test("computeSeasonMovement: missing nextDivision = null", () => {
  assert.equal(computeSeasonMovement(2, undefined), null);
});

// ─── resolveNextDivision ─────────────────────────────────────────────────────

test("resolveNextDivision: prefers a real next-season standings row", () => {
  assert.equal(
    resolveNextDivision({ nextSeasonStandingDivision: 2, nextSeasonStatus: "active", currentTeamDivision: 4 }),
    2
  );
});

test("resolveNextDivision: falls back to current team division when next season is active with no standings row yet", () => {
  assert.equal(
    resolveNextDivision({ nextSeasonStandingDivision: null, nextSeasonStatus: "active", currentTeamDivision: 2 }),
    2
  );
});

test("resolveNextDivision: does NOT use current team division when next season is not active (stale data risk)", () => {
  assert.equal(
    resolveNextDivision({ nextSeasonStandingDivision: null, nextSeasonStatus: "completed", currentTeamDivision: 2 }),
    null
  );
});

test("resolveNextDivision: next season does not exist at all -> null", () => {
  assert.equal(resolveNextDivision({}), null);
});

// ─── pickRecapHighlights ─────────────────────────────────────────────────────

test("pickRecapHighlights: empty inputs -> no highlights", () => {
  assert.deepEqual(pickRecapHighlights({ myTeamId: "t1" }), []);
});

test("pickRecapHighlights: division prize leader is included", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    divisionStandings: [{ team_id: "t1" }, { team_id: "t2" }],
    prizeByTeam: { t1: 500000, t2: 100000 },
  });
  assert.deepEqual(highlights, [{ kind: "prizeLeader", amount: 500000 }]);
});

test("pickRecapHighlights: not the division prize leader -> no prizeLeader highlight", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t2",
    divisionStandings: [{ team_id: "t1" }, { team_id: "t2" }],
    prizeByTeam: { t1: 500000, t2: 100000 },
  });
  assert.deepEqual(highlights, []);
});

test("pickRecapHighlights: zero-prize leader does not count as a highlight", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    divisionStandings: [{ team_id: "t1" }],
    prizeByTeam: { t1: 0 },
  });
  assert.deepEqual(highlights, []);
});

test("pickRecapHighlights: biggest sale included when present", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    myBiggestSale: { amount: 250000, description: "Solgt Test Rider via transfer" },
  });
  assert.deepEqual(highlights, [
    { kind: "biggestSale", amount: 250000, name: "Solgt Test Rider via transfer" },
  ]);
});

test("pickRecapHighlights: stage king included when present", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    myStageKing: { riderId: "r1", name: "Marco Bittner", wins: 6 },
  });
  assert.deepEqual(highlights, [{ kind: "stageKing", wins: 6, name: "Marco Bittner" }]);
});

test("pickRecapHighlights: combines all three, capped at 3, in prize/sale/stage order", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    divisionStandings: [{ team_id: "t1" }],
    prizeByTeam: { t1: 300000 },
    myBiggestSale: { amount: 100000, description: "Solgt X" },
    myStageKing: { riderId: "r1", name: "Y", wins: 3 },
  });
  assert.deepEqual(highlights.map((h) => h.kind), ["prizeLeader", "biggestSale", "stageKing"]);
});

test("pickRecapHighlights: myBiggestSale with amount 0 is ignored", () => {
  const highlights = pickRecapHighlights({
    myTeamId: "t1",
    myBiggestSale: { amount: 0, description: "Free transfer" },
  });
  assert.deepEqual(highlights, []);
});
