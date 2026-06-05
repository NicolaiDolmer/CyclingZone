// #915 · Tests for getBoardRenegotiationLock — guard mod gen-forhandling af en
// allerede-signeret bestyrelsesplan midt i en igangværende sæson.
//
// Dækker eksplicit bypass-vektorerne fra undersøgelsen:
//   (1) første signering (intet board / pending) må altid passere
//   (2) sæsonstart (race_days_completed = 0) må passere
//   (3) flerårig plan mid-plan i sæson 2+ skal låses — uafhængigt af season_id
//   (4) fornyelse af udløbet (pending) plan må passere
//   + tærskel-grænser (49% vs 50%) og slutfase-vinduet (sidste 5 race-days).

import test from "node:test";
import assert from "node:assert/strict";

import {
  getBoardRenegotiationLock,
  REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT,
  RENEGOTIATION_SEASON_PROGRESS_LOCK_PCT,
} from "./boardRequests.js";

const season = (completed, total = 100) => ({
  race_days_completed: completed,
  race_days_total: total,
});
const completedPlan = (extra = {}) => ({
  plan_type: "1yr",
  negotiation_status: "completed",
  ...extra,
});

test("ingen plan → ikke låst (første signering)", () => {
  assert.equal(getBoardRenegotiationLock({ board: null, activeSeason: season(90) }).locked, false);
});

test("pending plan → ikke låst (fornyelse af udløbet plan, selv sent på sæsonen)", () => {
  const board = completedPlan({ negotiation_status: "pending" });
  assert.equal(getBoardRenegotiationLock({ board, activeSeason: season(95) }).locked, false);
});

test("sæsonstart (0 race-days kørt) → ikke låst", () => {
  assert.equal(getBoardRenegotiationLock({ board: completedPlan(), activeSeason: season(0) }).locked, false);
});

test("tidligt på sæsonen (under 50%) → ikke låst", () => {
  const r = getBoardRenegotiationLock({ board: completedPlan(), activeSeason: season(49) });
  assert.equal(r.locked, false);
});

test("præcis ved 50% sæson-progress → låst (PROGRESS)", () => {
  const r = getBoardRenegotiationLock({ board: completedPlan(), activeSeason: season(50) });
  assert.equal(r.locked, true);
  assert.equal(r.code, "BOARD_RENEGOTIATION_LOCKED_PROGRESS");
  // #678 Track 3: { code, params }-kontrakt til frontend resolveApiError.
  assert.equal(r.errorCode, "board_renegotiation_locked_progress");
  assert.deepEqual(r.errorParams, { percent: RENEGOTIATION_SEASON_PROGRESS_LOCK_PCT });
});

test("slutfase (≤5 race-days tilbage) → låst (WINDOW)", () => {
  const completed = 100 - REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT; // raceDaysLeft = 5
  const r = getBoardRenegotiationLock({ board: completedPlan(), activeSeason: season(completed) });
  assert.equal(r.locked, true);
  assert.equal(r.code, "BOARD_RENEGOTIATION_LOCKED_WINDOW");
  // #678 Track 3: { code, params }-kontrakt til frontend resolveApiError.
  assert.equal(r.errorCode, "board_renegotiation_locked_window");
  assert.deepEqual(r.errorParams, { raceDays: REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT });
});

test("flerårig plan mid-plan (sæson 2+) låses uafhængigt af season_id", () => {
  // Vector 3: en 5yr-plan signeret i en tidligere sæson (season_id ≠ aktiv) må
  // IKKE kunne gen-forhandles midt i en senere sæson. Guarden ser kun på
  // negotiation_status + sæson-progress, så season_id-mismatch redder ikke exploiten.
  const board = completedPlan({
    plan_type: "5yr",
    season_id: "00000000-0000-0000-0000-000000000001",
    plan_start_season_number: 1,
    plan_end_season_number: 5,
  });
  const r = getBoardRenegotiationLock({ board, activeSeason: { ...season(60), id: "different-season-id", number: 2 } });
  assert.equal(r.locked, true);
});

test("manglende/0 race_days_total → ikke låst (fail-open, ingen falsk blokering)", () => {
  assert.equal(getBoardRenegotiationLock({ board: completedPlan(), activeSeason: { race_days_total: 0, race_days_completed: 0 } }).locked, false);
  assert.equal(getBoardRenegotiationLock({ board: completedPlan(), activeSeason: null }).locked, false);
});

test("tærskel-konstant matcher forventet 50%", () => {
  assert.equal(RENEGOTIATION_SEASON_PROGRESS_LOCK_PCT, 50);
});
