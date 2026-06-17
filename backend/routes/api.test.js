/**
 * Unit-tests for route-helpers der er eksporteret fra api.js til testbarhed.
 * Kører med: node --test backend/routes/api.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import { assertTeamNotTransferFrozen } from "./api.js";

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
