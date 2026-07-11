/**
 * Unit-tests for route-helpers der er eksporteret fra api.js til testbarhed.
 * Kører med: node --test backend/routes/api.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import router, { assertTeamNotTransferFrozen } from "./api.js";

// Minimal fake res der opfanger status + json
function fakeRes() {
  const r = {
    code: null,
    body: null,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return r;
}

// ── assertTeamNotTransferFrozen ──────────────────────────────────────────────

test("assertTeamNotTransferFrozen — returnerer false og sender 403 når transfer_frozen=true", () => {
  const req = { team: { transfer_frozen: true } };
  const res = fakeRes();

  const result = assertTeamNotTransferFrozen(req, res);

  assert.equal(result, false, "skal returnere false");
  assert.equal(res.code, 403, "skal sætte status 403");
  assert.equal(res.body?.errorCode, "team_transfer_frozen", "skal sætte errorCode");
  assert.ok(typeof res.body?.error === "string" && res.body.error.length > 0, "skal have en fejlbesked");
});

test("assertTeamNotTransferFrozen — returnerer true og svarer IKKE når transfer_frozen=false", () => {
  const req = { team: { transfer_frozen: false } };
  const res = fakeRes();

  const result = assertTeamNotTransferFrozen(req, res);

  assert.equal(result, true, "skal returnere true");
  assert.equal(res.code, null, "må ikke kalde status()");
  assert.equal(res.body, null, "må ikke kalde json()");
});

test("assertTeamNotTransferFrozen — returnerer true og svarer IKKE når transfer_frozen mangler (undefined)", () => {
  const req = { team: { transfer_frozen: undefined } };
  const res = fakeRes();

  const result = assertTeamNotTransferFrozen(req, res);

  assert.equal(result, true, "udefineret transfer_frozen = ikke frosset");
  assert.equal(res.code, null);
  assert.equal(res.body, null);
});

test("assertTeamNotTransferFrozen — returnerer true og svarer IKKE når req.team er null", () => {
  const req = { team: null };
  const res = fakeRes();

  const result = assertTeamNotTransferFrozen(req, res);

  assert.equal(result, true, "null team = ikke frosset (eksisterende guard håndterer det)");
  assert.equal(res.code, null);
  assert.equal(res.body, null);
});

// ── Route-rækkefølge: statiske stier før parametriserede (#1479) ──────────────
// Express matcher routes i registrerings-rækkefølge. Hvis POST /training/:riderId
// står FØR POST /training/run-today, fanger :riderId-routen "run-today" som et
// rytter-id, kalder isValidFocus(undefined) → "invalid_focus" og blokerer "Træn
// i dag"-knappen helt. Denne test låser rækkefølgen fast.
function postRouteIndex(path) {
  return router.stack.findIndex(
    (layer) => layer.route?.path === path && layer.route?.methods?.post,
  );
}

test("POST /training/run-today registreres FØR POST /training/:riderId (#1479)", () => {
  const runTodayIdx = postRouteIndex("/training/run-today");
  const riderIdIdx = postRouteIndex("/training/:riderId");

  assert.notEqual(runTodayIdx, -1, "run-today POST-route skal være registreret");
  assert.notEqual(riderIdIdx, -1, ":riderId POST-route skal være registreret");
  assert.ok(
    runTodayIdx < riderIdIdx,
    `run-today (idx ${runTodayIdx}) skal stå før :riderId (idx ${riderIdIdx}) — ellers blokeres træning af invalid_focus`,
  );
});

test("POST /training/bulk registreres FØR POST /training/:riderId (#1885)", () => {
  const bulkIdx = postRouteIndex("/training/bulk");
  const riderIdIdx = postRouteIndex("/training/:riderId");

  assert.notEqual(bulkIdx, -1, "bulk POST-route skal være registreret");
  assert.notEqual(riderIdIdx, -1, ":riderId POST-route skal være registreret");
  assert.ok(
    bulkIdx < riderIdIdx,
    `bulk (idx ${bulkIdx}) skal stå før :riderId (idx ${riderIdIdx}) — ellers matcher :riderId "bulk" som et rytter-id`,
  );
});

// ── #1895 PR 2: pr-rytter ugerytme-override-routes ────────────────────────────
function putRouteIndex(path) {
  return router.stack.findIndex(
    (layer) => layer.route?.path === path && layer.route?.methods?.put,
  );
}
function deleteRouteIndex(path) {
  return router.stack.findIndex(
    (layer) => layer.route?.path === path && layer.route?.methods?.delete,
  );
}

test("PUT/DELETE /training/week-plan/:riderId registreres FØR POST/DELETE /training/:riderId (#1895 PR 2)", () => {
  const putWeekPlanRiderIdx = putRouteIndex("/training/week-plan/:riderId");
  const deleteWeekPlanRiderIdx = deleteRouteIndex("/training/week-plan/:riderId");
  const postRiderIdIdx = postRouteIndex("/training/:riderId");
  const deleteRiderIdIdx = deleteRouteIndex("/training/:riderId");

  assert.notEqual(putWeekPlanRiderIdx, -1, "PUT week-plan/:riderId skal være registreret");
  assert.notEqual(deleteWeekPlanRiderIdx, -1, "DELETE week-plan/:riderId skal være registreret");
  assert.ok(putWeekPlanRiderIdx < postRiderIdIdx, "PUT week-plan/:riderId skal stå før POST :riderId");
  assert.ok(deleteWeekPlanRiderIdx < deleteRiderIdIdx, "DELETE week-plan/:riderId skal stå før DELETE :riderId");
});
