// #6818: dommen i read-only-tjekket foer taend af s5_profiles_v2.
import test from "node:test";
import assert from "node:assert/strict";
import { verdict } from "./verifyS5v2Taend.mjs";

test("#6818 verifyS5v2Taend: klar kun naar migration er applied, formtoppe slukket og intet loeb bundet til v2", () => {
  assert.equal(verdict({ migrationApplied: true, formPeaksEnabled: false, boundToV2: 0 }).ready, true);
  assert.equal(verdict({ migrationApplied: false, formPeaksEnabled: false, boundToV2: 0 }).ready, false);
  assert.equal(verdict({ migrationApplied: true, formPeaksEnabled: true, boundToV2: 0 }).ready, false);
  assert.equal(verdict({ migrationApplied: true, formPeaksEnabled: false, boundToV2: 3 }).ready, false);
  // Ukendt (fx null fra en fejlet laesning) er aldrig "klar".
  assert.equal(verdict({ migrationApplied: true, formPeaksEnabled: null, boundToV2: null }).ready, false);
});
