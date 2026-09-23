// [epic #4592 del 2] parkingDryRun.simulateParkingSweep — den rene simulering
// bag dry-run-rapporten (pr. division, abonnement-skip, genindplaceringer,
// forventet puljestørrelse). Ingen DB.

import test from "node:test";
import assert from "node:assert/strict";

import { simulateParkingSweep } from "./parkingDryRun.js";
import { MANAGER_ENTRY_DIVISION, MAX_DIVISION, POOL_TARGET_SIZE } from "../lib/economyConstants.js";

const NOW = new Date("2026-09-28T09:00:00Z");
const DAY_MS = 86_400_000;
const daysAgo = (d) => new Date(NOW.getTime() - d * DAY_MS).toISOString();

const POOLS = [
  { id: "d3a", tier: MANAGER_ENTRY_DIVISION, pool_index: 0, label: "D3 A" },
  { id: "d3b", tier: MANAGER_ENTRY_DIVISION, pool_index: 1, label: "D3 B" },
  { id: "d4a", tier: MAX_DIVISION, pool_index: 0, label: "D4 A" },
];

function human(id, overrides = {}) {
  return {
    id,
    name: `Hold ${id}`,
    is_ai: false,
    is_bank: false,
    is_test_account: false,
    is_frozen: false,
    user_id: `u-${id}`,
    parked_at: null,
    next_season_signup_at: null,
    league_division_id: "d3a",
    division: MANAGER_ENTRY_DIVISION,
    ...overrides,
  };
}

function aiFill(poolId, count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `ai-${poolId}-${i}`, is_ai: true, is_bank: false, is_test_account: false, is_frozen: false,
    pending_removal_at: null, league_division_id: poolId,
  }));
}

function seatRow(team) {
  return {
    id: team.id,
    league_division_id: team.league_division_id,
    is_ai: team.is_ai,
    is_test_account: team.is_test_account,
    is_frozen: team.is_frozen,
    is_bank: team.is_bank,
    pending_removal_at: null,
  };
}

function scenario({ d3bFull = true } = {}) {
  const humans = [
    human("dormant", { league_division_id: "d3a" }),
    human("paying", { league_division_id: "d3b" }),
    human("back", { league_division_id: null, division: 2, parked_at: daysAgo(90), next_season_signup_at: daysAgo(2) }),
  ];
  const users = [
    { id: "u-dormant", last_seen: daysAgo(60) },
    { id: "u-paying", last_seen: daysAgo(60) },
    { id: "u-back", last_seen: daysAgo(1) },
  ];
  const subscriptions = [{ id: "s1", team_id: "paying", status: "active", current_period_end: null, last_event_at: daysAgo(3) }];
  const seatTeams = [
    ...humans.map(seatRow),
    ...aiFill("d3a", POOL_TARGET_SIZE - 1),
    ...aiFill("d3b", d3bFull ? POOL_TARGET_SIZE - 1 : POOL_TARGET_SIZE - 3),
  ];
  return { humanTeams: humans, users, subscriptions, pools: POOLS, seatTeams, now: NOW };
}

test("simulateParkingSweep: parkerer, springer abonnement over og genindplacerer på den frigjorte plads", () => {
  const sim = simulateParkingSweep(scenario());

  assert.deepEqual(sim.wouldPark.map((t) => t.id), ["dormant"]);
  assert.deepEqual(sim.subscriptionSkipped.map((t) => t.id), ["paying"]);
  assert.deepEqual(
    sim.placements.map((pl) => ({ id: pl.team.id, division: pl.division, pool: pl.leagueDivisionId })),
    [{ id: "back", division: MANAGER_ENTRY_DIVISION, pool: "d3a" }],
    "den eneste ledige entry-plads er den parkeringen frigjorde",
  );

  const d3a = sim.poolSizes.find((p) => p.pool_id === "d3a");
  assert.deepEqual(
    { before: d3a.before, parked_out: d3a.parked_out, placed_in: d3a.placed_in, after: d3a.after },
    { before: POOL_TARGET_SIZE, parked_out: 1, placed_in: 1, after: POOL_TARGET_SIZE },
  );

  const div3 = sim.byDivision.find((d) => d.division === MANAGER_ENTRY_DIVISION);
  assert.deepEqual(div3, {
    division: MANAGER_ENTRY_DIVISION, before: 2, parked: 1, subscription_skipped: 1, placed_in: 1, after: 2,
  });
});

test("simulateParkingSweep: simulerer placeringerne ét hold ad gangen (to tilbage-tilmeldte deler ikke én plads)", () => {
  const base = scenario({ d3bFull: false }); // d3b har to ledige pladser
  base.humanTeams.push(human("back2", { league_division_id: null, division: 2, parked_at: daysAgo(90), next_season_signup_at: daysAgo(1) }));
  base.users.push({ id: "u-back2", last_seen: daysAgo(1) });
  base.seatTeams.push(seatRow(base.humanTeams.at(-1)));

  const sim = simulateParkingSweep(base);
  const pools = sim.placements.map((pl) => pl.leagueDivisionId);
  assert.equal(pools.length, 2);
  const after = Object.fromEntries(sim.poolSizes.map((p) => [p.pool_id, p.after]));
  assert.ok(after.d3a <= POOL_TARGET_SIZE && after.d3b <= POOL_TARGET_SIZE, "ingen entry-pulje fyldes over målet af simuleringen");
});

test("simulateParkingSweep: fuld entry-division ⇒ genindplacering i overflow-divisionen", () => {
  const base = scenario();
  // Ingen parkering denne gang: den inaktive manager har logget ind igen.
  base.users.find((u) => u.id === "u-dormant").last_seen = daysAgo(1);

  const sim = simulateParkingSweep(base);
  assert.deepEqual(sim.wouldPark, []);
  assert.deepEqual(sim.placements.map((pl) => [pl.division, pl.leagueDivisionId]), [[MAX_DIVISION, "d4a"]]);
});
