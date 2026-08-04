import test from "node:test";
import assert from "node:assert/strict";

import {
  groupRaceDaysByRace,
  splitResultBonusRow,
  buildBonusRows,
  computeResultsCapUsage,
  hasBonusClauses,
  buildSponsorIncomeBreakdown,
} from "./sponsorIncomeBreakdown.js";

const RATE = 500;

function raceDayTx({ id, raceId, raceName, amount, createdAt }) {
  return { id, type: "sponsor_race_day", raceId, raceName, amount, createdAt };
}

test("groupRaceDaysByRace — sums a single race with one row, computes days from rate", () => {
  const { total, count, rows } = groupRaceDaysByRace(
    [raceDayTx({ id: "t1", raceId: "r1", raceName: "Tour Test", amount: 1500, createdAt: "2026-06-01" })],
    RATE,
  );
  assert.equal(total, 1500);
  assert.equal(count, 1);
  assert.deepEqual(rows[0], { raceId: "r1", raceName: "Tour Test", amount: 1500, createdAt: "2026-06-01", rate: RATE, days: 3 });
});

test("groupRaceDaysByRace — sums multiple rows for the SAME race defensively and sorts newest-first", () => {
  const { total, count, rows } = groupRaceDaysByRace(
    [
      raceDayTx({ id: "t1", raceId: "r1", raceName: "Old Race", amount: 500, createdAt: "2026-05-01" }),
      raceDayTx({ id: "t2", raceId: "r2", raceName: "New Race", amount: 1000, createdAt: "2026-06-10" }),
      raceDayTx({ id: "t3", raceId: "r1", raceName: null, amount: 500, createdAt: "2026-05-02" }),
    ],
    RATE,
  );
  assert.equal(total, 2000);
  assert.equal(count, 2);
  // newest-first: r2 (06-10) before r1 (latest occurrence 05-02)
  assert.equal(rows[0].raceId, "r2");
  assert.equal(rows[1].raceId, "r1");
  assert.equal(rows[1].amount, 1000); // 500 + 500 summed defensively
  assert.equal(rows[1].raceName, "Old Race"); // keeps first non-null name
  assert.equal(rows[1].days, 2);
});

test("groupRaceDaysByRace — rate <= 0 yields days = null instead of Infinity/NaN", () => {
  const { rows } = groupRaceDaysByRace(
    [raceDayTx({ id: "t1", raceId: "r1", raceName: "Tour Test", amount: 500, createdAt: "2026-06-01" })],
    0,
  );
  assert.equal(rows[0].days, null);
});

test("groupRaceDaysByRace — ignores non-race-day transactions and empty input", () => {
  assert.deepEqual(groupRaceDaysByRace([{ id: "x", type: "sponsor", amount: 1000 }], RATE), { total: 0, count: 0, rows: [] });
  assert.deepEqual(groupRaceDaysByRace([], RATE), { total: 0, count: 0, rows: [] });
  assert.deepEqual(groupRaceDaysByRace(undefined, RATE), { total: 0, count: 0, rows: [] });
});

const contractWithClauses = {
  per_race_day_rate: RATE,
  bonus_clauses: [
    { type: "stage_win", amount: 100 },
    { type: "podium", amount: 40 },
    { type: "results_cap", amount: 1000 },
  ],
  results_bonus_paid: 250,
};

test("splitResultBonusRow — wins only, full amount attributed to stageWin", () => {
  const tx = { id: "b1", raceId: "r1", raceName: "Tour Test", amount: 200, createdAt: "2026-06-01", metadata: { params: { wins: 2, podiums: 0 } } };
  const rows = splitResultBonusRow(tx, contractWithClauses);
  assert.deepEqual(rows, [{ id: "b1:stageWin", kind: "stageWin", amount: 200, count: 2, raceId: "r1", raceName: "Tour Test", createdAt: "2026-06-01" }]);
});

test("splitResultBonusRow — podiums only, full amount attributed to podium", () => {
  const tx = { id: "b2", raceId: "r1", raceName: "Tour Test", amount: 80, createdAt: "2026-06-01", metadata: { params: { wins: 0, podiums: 2 } } };
  const rows = splitResultBonusRow(tx, contractWithClauses);
  assert.deepEqual(rows, [{ id: "b2:podium", kind: "podium", amount: 80, count: 2, raceId: "r1", raceName: "Tour Test", createdAt: "2026-06-01" }]);
});

test("splitResultBonusRow — wins + podiums split proportionally and sum EXACTLY to tx.amount (uncapped)", () => {
  // raw: 1 win * 100 + 1 podium * 40 = 140, uncapped tx.amount = 140
  const tx = { id: "b3", raceId: "r1", raceName: "Tour Test", amount: 140, createdAt: "2026-06-01", metadata: { params: { wins: 1, podiums: 1 } } };
  const rows = splitResultBonusRow(tx, contractWithClauses);
  assert.equal(rows.length, 2);
  const stageWin = rows.find((r) => r.kind === "stageWin");
  const podium = rows.find((r) => r.kind === "podium");
  assert.equal(stageWin.amount, 100);
  assert.equal(podium.amount, 40);
  assert.equal(stageWin.amount + podium.amount, tx.amount);
});

test("splitResultBonusRow — CAPPED amount scales both shares proportionally and still sums exactly", () => {
  // raw total would be 140, but the results_cap only left 70 remaining → tx.amount = 70.
  const tx = { id: "b4", raceId: "r1", raceName: "Tour Test", amount: 70, createdAt: "2026-06-01", metadata: { params: { wins: 1, podiums: 1 } } };
  const rows = splitResultBonusRow(tx, contractWithClauses);
  const stageWin = rows.find((r) => r.kind === "stageWin");
  const podium = rows.find((r) => r.kind === "podium");
  assert.equal(stageWin.amount + podium.amount, 70);
  // proportional: win share ~= round(70 * 100/140) = 50, podium = 20
  assert.equal(stageWin.amount, 50);
  assert.equal(podium.amount, 20);
});

test("splitResultBonusRow — missing metadata falls back to a single generic row for the full amount", () => {
  const tx = { id: "b5", raceId: "r1", raceName: "Tour Test", amount: 90, createdAt: "2026-06-01" };
  const rows = splitResultBonusRow(tx, contractWithClauses);
  assert.deepEqual(rows, [{ id: "b5:generic", kind: "resultBonus", amount: 90, wins: 0, podiums: 0, raceId: "r1", raceName: "Tour Test", createdAt: "2026-06-01" }]);
});

test("splitResultBonusRow — both counts present but clause amounts unknown (0) falls back to generic instead of guessing", () => {
  const contractNoClauseAmounts = { bonus_clauses: [{ type: "stage_win", amount: 0 }, { type: "podium", amount: 0 }] };
  const tx = { id: "b6", raceId: "r1", raceName: "Tour Test", amount: 60, createdAt: "2026-06-01", metadata: { params: { wins: 1, podiums: 1 } } };
  const rows = splitResultBonusRow(tx, contractNoClauseAmounts);
  assert.deepEqual(rows, [{ id: "b6:generic", kind: "resultBonus", amount: 60, wins: 1, podiums: 1, raceId: "r1", raceName: "Tour Test", createdAt: "2026-06-01" }]);
});

test("buildBonusRows — combines signing/objective/result-bonus rows, sorted newest-first", () => {
  const rows = buildBonusRows(
    [
      { id: "s1", type: "sponsor_signing_bonus", amount: 5000, createdAt: "2026-05-01" },
      { id: "o1", type: "sponsor_objective_bonus", amount: 8000, createdAt: "2026-07-01" },
      { id: "b1", type: "sponsor_result_bonus", raceId: "r1", raceName: "Tour Test", amount: 100, createdAt: "2026-06-01", metadata: { params: { wins: 1, podiums: 0 } } },
    ],
    contractWithClauses,
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.kind), ["objective", "stageWin", "signing"]);
});

test("computeResultsCapUsage — returns null when no results_cap clause", () => {
  assert.equal(computeResultsCapUsage({ bonus_clauses: [{ type: "stage_win", amount: 100 }] }), null);
  assert.equal(computeResultsCapUsage(null), null);
});

test("computeResultsCapUsage — reads limit from clause + used from results_bonus_paid", () => {
  assert.deepEqual(computeResultsCapUsage(contractWithClauses), { used: 250, limit: 1000 });
});

test("computeResultsCapUsage — missing results_bonus_paid defaults used to 0", () => {
  assert.deepEqual(
    computeResultsCapUsage({ bonus_clauses: [{ type: "results_cap", amount: 1000 }] }),
    { used: 0, limit: 1000 },
  );
});

test("hasBonusClauses — true when a non-cap clause exists, false when only results_cap or empty", () => {
  assert.equal(hasBonusClauses(contractWithClauses), true);
  assert.equal(hasBonusClauses({ bonus_clauses: [{ type: "results_cap", amount: 1000 }] }), false);
  assert.equal(hasBonusClauses({ bonus_clauses: [] }), false);
  assert.equal(hasBonusClauses(null), false);
});

test("buildSponsorIncomeBreakdown — full season: guaranteed/earned-on-top split, total, group totals", () => {
  const contract = { sponsor_name: "Alta Cycles", per_race_day_rate: RATE, bonus_clauses: contractWithClauses.bonus_clauses, results_bonus_paid: 100 };
  const transactions = [
    { id: "base1", type: "sponsor", amount: 60000, createdAt: "2026-05-01" },
    raceDayTx({ id: "rd1", raceId: "r1", raceName: "Tour Test", amount: 1500, createdAt: "2026-06-01" }),
    raceDayTx({ id: "rd2", raceId: "r2", raceName: "Grand Prix", amount: 1000, createdAt: "2026-06-10" }),
    { id: "sign1", type: "sponsor_signing_bonus", amount: 5000, createdAt: "2026-05-01" },
    { id: "res1", type: "sponsor_result_bonus", raceId: "r1", raceName: "Tour Test", amount: 100, createdAt: "2026-06-01", metadata: { params: { wins: 1, podiums: 0 } } },
  ];
  const result = buildSponsorIncomeBreakdown({ contract, seasonNumber: 4, transactions });

  assert.equal(result.seasonNumber, 4);
  assert.equal(result.sponsorName, "Alta Cycles");
  assert.equal(result.guaranteed, 60000);
  assert.equal(result.earnedOnTop, 1500 + 1000 + 5000 + 100);
  assert.equal(result.total, result.guaranteed + result.earnedOnTop);
  assert.equal(result.hasBonusClauses, true);

  assert.equal(result.fixed.total, 60000);
  assert.equal(result.fixed.rows.length, 1);

  assert.equal(result.raceDays.total, 2500);
  assert.equal(result.raceDays.count, 2);
  assert.equal(result.raceDays.rows[0].raceId, "r2"); // newest first

  assert.equal(result.bonuses.total, 5100);
  assert.equal(result.bonuses.rows.length, 2);
  assert.deepEqual(result.bonuses.cap, { used: 100, limit: 1000 });
});

test("buildSponsorIncomeBreakdown — empty season transactions returns zeroed totals + empty groups (no contract error)", () => {
  const result = buildSponsorIncomeBreakdown({ contract: null, seasonNumber: null, transactions: [] });
  assert.equal(result.guaranteed, 0);
  assert.equal(result.earnedOnTop, 0);
  assert.equal(result.total, 0);
  assert.equal(result.sponsorName, null);
  assert.equal(result.hasBonusClauses, false);
  assert.deepEqual(result.fixed.rows, []);
  assert.deepEqual(result.raceDays.rows, []);
  assert.deepEqual(result.bonuses.rows, []);
  assert.equal(result.bonuses.cap, null);
});

test("buildSponsorIncomeBreakdown — contract without bonus clauses reports hasBonusClauses=false", () => {
  const contract = { sponsor_name: "Meridian Bank", per_race_day_rate: RATE, bonus_clauses: [], results_bonus_paid: 0 };
  const result = buildSponsorIncomeBreakdown({ contract, seasonNumber: 1, transactions: [] });
  assert.equal(result.hasBonusClauses, false);
  assert.equal(result.bonuses.cap, null);
});
