// #5902 · evaluateAndApplyConsequences giver aldrig et parkeret hold (#4592)
// en bestyrelseskonsekvens, en tvangssalgsliste eller en besked.
// =============================================================================
// Funktionen er den eneste, der opretter rækker i board_consequences og
// tvangssalgslister. Begge kaldere (sæsonafslutningen og den ugentlige kørsel)
// sorterer allerede parkerede hold fra; dette er det sidste værn, testet direkte.
// Tærskler læses fra CONSEQUENCE_CONSTANTS, aldrig som tal i testen.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CONSEQUENCE_CONSTANTS,
  CONSEQUENCE_LAYERS,
  evaluateAndApplyConsequences,
} from "./boardConsequences.js";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";

const T = CONSEQUENCE_CONSTANTS.SATISFACTION_THRESHOLDS;
const CRISIS = T.SPONSOR_PULLOUT - 1;

/** @param {Record<string, any>} [extra] */
function makeTeam(extra = {}) {
  return {
    id: "team-1",
    name: "Hold A",
    division: 3,
    created_at: "2026-01-01T00:00:00.000Z",
    parked_at: null,
    riders: [
      { id: "r-1", firstname: "Billig", lastname: "Rytter", popularity: 1, market_value: 10_000, salary: 5_000 },
      { id: "r-2", firstname: "Anden", lastname: "Rytter", popularity: 1, market_value: 20_000, salary: 5_000 },
    ],
    ...extra,
  };
}

const BOARD = { id: "board-1", focus: "balanced", plan_type: "1yr" };

function run({ team, supabase, notify, satisfaction = CRISIS, goalsMet = 0, goalsTotal = 3, planIsComplete = false, consecutiveLowExpirations = 0 }) {
  return evaluateAndApplyConsequences({
    supabase,
    team,
    board: BOARD,
    newSatisfaction: satisfaction,
    previousSatisfaction: satisfaction,
    goalsMet,
    goalsTotal,
    planIsComplete,
    seasonId: "season-5",
    consecutiveLowExpirations,
    notify,
  });
}

function makeNotify() {
  const calls = [];
  const fn = async (msg) => { calls.push(msg); };
  fn.calls = calls;
  return fn;
}

test("#5902 · parkeret hold i dyb krise: 0 konsekvenser, 0 salgslister, 0 beskeder", async () => {
  const state = { board_consequences: [], transfer_listings: [], app_config: [] };
  const supabase = createFakeSupabase(state);
  const notify = makeNotify();

  const result = await run({
    team: makeTeam({ parked_at: "2026-09-27T12:00:00.000Z" }),
    supabase,
    notify,
    // Også sponsor-exit-vejen via to udløbne planer i træk.
    planIsComplete: true,
    consecutiveLowExpirations: CONSEQUENCE_CONSTANTS.PULLOUT_PLAN_LAPSE_TRIGGER,
  });

  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.skipped, [{ layer: null, reason: "parked_team" }]);
  assert.equal(state.board_consequences.length, 0);
  assert.equal(state.transfer_listings.length, 0);
  assert.equal(notify.calls.length, 0);
});

test("#5902 · parkeret hold med høj tilfredshed: intet bonustilbud", async () => {
  const state = { board_consequences: [], transfer_listings: [], app_config: [] };
  const notify = makeNotify();

  await run({
    team: makeTeam({ parked_at: "2026-09-27T12:00:00.000Z" }),
    supabase: createFakeSupabase(state),
    notify,
    satisfaction: T.BONUS_OFFER + 1,
    goalsMet: 3,
    goalsTotal: 3,
  });

  assert.equal(state.board_consequences.length, 0);
  assert.equal(notify.calls.length, 0);
});

test("#5902 · parkeret hold: eksisterende aktive rækker røres ikke (hverken udløbes eller skærpes)", async () => {
  const existing = [
    { id: "c-2", team_id: "team-1", layer: CONSEQUENCE_LAYERS.SALARY_CAP, severity: 1, status: "active", resolved_at: null },
    { id: "c-3", team_id: "team-1", layer: CONSEQUENCE_LAYERS.SIGNING_RESTRICTION, severity: 1, status: "active", resolved_at: null },
  ];
  const state = { board_consequences: JSON.parse(JSON.stringify(existing)), transfer_listings: [], app_config: [] };

  // Høj tilfredshed ville for et aktivt hold udløbe begge rækker.
  await run({
    team: makeTeam({ parked_at: "2026-09-27T12:00:00.000Z" }),
    supabase: createFakeSupabase(state),
    notify: makeNotify(),
    satisfaction: T.SALARY_CAP + 1,
  });

  assert.deepEqual(state.board_consequences, existing);
});

test("#5902 · aktivt hold med samme tal: uændret adfærd (lønloft, købsstop, tvangssalg, sponsor-exit)", async () => {
  const state = { board_consequences: [], transfer_listings: [], app_config: [] };
  const notify = makeNotify();

  const result = await run({ team: makeTeam(), supabase: createFakeSupabase(state), notify });

  assert.deepEqual(
    result.applied.map((a) => a.layer).sort(),
    [
      CONSEQUENCE_LAYERS.SALARY_CAP,
      CONSEQUENCE_LAYERS.SIGNING_RESTRICTION,
      CONSEQUENCE_LAYERS.FORCED_LISTING,
      CONSEQUENCE_LAYERS.SPONSOR_PULLOUT,
    ].sort(),
  );
  assert.equal(state.transfer_listings.length, 1);
  assert.equal(state.transfer_listings[0].rider_id, "r-1");
  assert.equal(notify.calls.length, 2);
});

test("#5902 · team uden parked_at-felt tæller som ikke parkeret (samme regel som managerParking.isParkedTeam)", async () => {
  const state = { board_consequences: [], transfer_listings: [], app_config: [] };
  const team = makeTeam();
  delete team.parked_at;

  const result = await run({ team, supabase: createFakeSupabase(state), notify: makeNotify() });

  assert.ok(result.applied.length > 0);
});
