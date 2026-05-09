import assert from "node:assert/strict";
import test from "node:test";

import { groupCronRuns, DEFAULT_WINDOW_SECONDS } from "./cronRunCorrelation.js";

const ACTOR_A = "00000000-0000-0000-0000-000000000001";
const ACTOR_B = "00000000-0000-0000-0000-000000000002";
const TEAM_1 = "11111111-1111-1111-1111-111111111111";
const TEAM_2 = "22222222-2222-2222-2222-222222222222";

test("groupCronRuns — empty input returns empty array", () => {
  assert.deepEqual(groupCronRuns([]), []);
  assert.deepEqual(groupCronRuns(null), []);
  assert.deepEqual(groupCronRuns(undefined), []);
});

test("groupCronRuns — drops rows missing actor_id or source_path", () => {
  const rows = [
    { actor_id: null, source_path: "x", created_at: "2026-05-09T10:00:00Z", amount: 100, team_id: TEAM_1 },
    { actor_id: ACTOR_A, source_path: null, created_at: "2026-05-09T10:00:00Z", amount: 100, team_id: TEAM_1 },
    { actor_id: ACTOR_A, source_path: "x", created_at: null, amount: 100, team_id: TEAM_1 },
  ];
  assert.deepEqual(groupCronRuns(rows), []);
});

test("groupCronRuns — single row becomes a single-tx run", () => {
  const rows = [
    { actor_id: ACTOR_A, source_path: "sponsorPayout", created_at: "2026-05-09T10:00:00Z",
      amount: 240000, reason_code: "season_start_sponsor", team_id: TEAM_1 },
  ];
  const runs = groupCronRuns(rows);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].tx_count, 1);
  assert.equal(runs[0].total_amount, 240000);
  assert.deepEqual(runs[0].reason_codes, ["season_start_sponsor"]);
  assert.deepEqual(runs[0].affected_teams, [TEAM_1]);
  assert.equal(runs[0].started_at, runs[0].ended_at);
});

test("groupCronRuns — burst within 5s window groups into one run", () => {
  const rows = [];
  for (let i = 0; i < 22; i++) {
    rows.push({
      actor_id: ACTOR_A, source_path: "sponsorPayout",
      created_at: new Date(Date.parse("2026-05-09T10:00:00Z") + i * 100).toISOString(),
      amount: 240000,
      reason_code: "season_start_sponsor",
      team_id: i % 2 === 0 ? TEAM_1 : TEAM_2,
    });
  }
  const runs = groupCronRuns(rows);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].tx_count, 22);
  assert.equal(runs[0].total_amount, 22 * 240000);
  assert.deepEqual(runs[0].affected_teams.sort(), [TEAM_1, TEAM_2].sort());
});

test("groupCronRuns — gap > 5s splits into two runs", () => {
  const t0 = Date.parse("2026-05-09T10:00:00Z");
  const rows = [
    { actor_id: ACTOR_A, source_path: "sponsorPayout", created_at: new Date(t0).toISOString(),
      amount: 100, team_id: TEAM_1 },
    { actor_id: ACTOR_A, source_path: "sponsorPayout", created_at: new Date(t0 + 3000).toISOString(),
      amount: 100, team_id: TEAM_1 },
    { actor_id: ACTOR_A, source_path: "sponsorPayout", created_at: new Date(t0 + 9000).toISOString(),
      amount: 100, team_id: TEAM_2 },
  ];
  const runs = groupCronRuns(rows);
  assert.equal(runs.length, 2);
  // newest first
  assert.equal(runs[0].tx_count, 1);
  assert.equal(runs[1].tx_count, 2);
});

test("groupCronRuns — different source_paths never merge even if timestamps overlap", () => {
  const t0 = Date.parse("2026-05-09T10:00:00Z");
  const rows = [
    { actor_id: ACTOR_A, source_path: "sponsorPayout", created_at: new Date(t0).toISOString(),
      amount: 100, team_id: TEAM_1 },
    { actor_id: ACTOR_A, source_path: "salaryDeduction", created_at: new Date(t0 + 100).toISOString(),
      amount: -50, team_id: TEAM_1 },
  ];
  const runs = groupCronRuns(rows);
  assert.equal(runs.length, 2);
  const paths = runs.map((r) => r.source_path).sort();
  assert.deepEqual(paths, ["salaryDeduction", "sponsorPayout"]);
});

test("groupCronRuns — different actor_ids never merge", () => {
  const t0 = Date.parse("2026-05-09T10:00:00Z");
  const rows = [
    { actor_id: ACTOR_A, source_path: "x", created_at: new Date(t0).toISOString(),
      amount: 100, team_id: TEAM_1 },
    { actor_id: ACTOR_B, source_path: "x", created_at: new Date(t0 + 100).toISOString(),
      amount: 100, team_id: TEAM_1 },
  ];
  const runs = groupCronRuns(rows);
  assert.equal(runs.length, 2);
});

test("groupCronRuns — collects unique reason_codes per run", () => {
  const t0 = Date.parse("2026-05-09T10:00:00Z");
  const rows = [
    { actor_id: ACTOR_A, source_path: "auctionFinalization", created_at: new Date(t0).toISOString(),
      amount: -100000, reason_code: "auction_winner_payment", team_id: TEAM_1 },
    { actor_id: ACTOR_A, source_path: "auctionFinalization", created_at: new Date(t0 + 200).toISOString(),
      amount: 100000, reason_code: "auction_seller_payout", team_id: TEAM_2 },
    { actor_id: ACTOR_A, source_path: "auctionFinalization", created_at: new Date(t0 + 300).toISOString(),
      amount: 100000, reason_code: "auction_seller_payout", team_id: TEAM_2 },
  ];
  const runs = groupCronRuns(rows);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].reason_codes, ["auction_seller_payout", "auction_winner_payment"]);
  assert.equal(runs[0].tx_count, 3);
  assert.equal(runs[0].total_amount, 100000); // -100k + 100k + 100k
});

test("groupCronRuns — newest run sorted first", () => {
  const t0 = Date.parse("2026-05-09T10:00:00Z");
  const rows = [
    { actor_id: ACTOR_A, source_path: "x", created_at: new Date(t0).toISOString(),
      amount: 100, team_id: TEAM_1 },
    { actor_id: ACTOR_A, source_path: "x", created_at: new Date(t0 + 60_000).toISOString(),
      amount: 200, team_id: TEAM_1 },
  ];
  const runs = groupCronRuns(rows);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].total_amount, 200); // newer first
  assert.equal(runs[1].total_amount, 100);
});

test("groupCronRuns — custom window expands grouping", () => {
  const t0 = Date.parse("2026-05-09T10:00:00Z");
  const rows = [
    { actor_id: ACTOR_A, source_path: "x", created_at: new Date(t0).toISOString(),
      amount: 100, team_id: TEAM_1 },
    { actor_id: ACTOR_A, source_path: "x", created_at: new Date(t0 + 8000).toISOString(),
      amount: 100, team_id: TEAM_1 },
  ];
  assert.equal(groupCronRuns(rows).length, 2); // default 5s → split
  assert.equal(groupCronRuns(rows, { windowSeconds: 10 }).length, 1);
});

test("groupCronRuns — chained timestamps within window stay in one run even if span > window", () => {
  // Each row is within 5s of the previous, but total span is 20s — should still be one run.
  const t0 = Date.parse("2026-05-09T10:00:00Z");
  const rows = [];
  for (let i = 0; i < 6; i++) {
    rows.push({
      actor_id: ACTOR_A, source_path: "x",
      created_at: new Date(t0 + i * 4000).toISOString(),
      amount: 100, team_id: TEAM_1,
    });
  }
  const runs = groupCronRuns(rows);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].tx_count, 6);
  assert.equal(
    new Date(runs[0].ended_at).getTime() - new Date(runs[0].started_at).getTime(),
    20_000,
  );
});

test("DEFAULT_WINDOW_SECONDS is 5", () => {
  assert.equal(DEFAULT_WINDOW_SECONDS, 5);
});
