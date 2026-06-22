import test from "node:test";
import assert from "node:assert/strict";

import { DIVISION_SQUAD_LIMITS } from "./boardConstants.js";
import { getDivisionSquadLimits } from "./boardIdentity.js";
import { MAX_DIVISION } from "./economyConstants.js";

// #1688 (forever-relaunch AI-fill + race-scale): tier 4 = bunden i 4-tier-pyramiden.
// getDivisionSquadLimits(4) faldt tidligere STILLE tilbage til div-3-entry'en
// (normalizeDivision returnerede null fordi DIVISION_SQUAD_LIMITS[4] ikke fandtes),
// så et tier-4-hold blev bestyrelses-evalueret med div-3-grænser uden at det var
// eksplicit. Vi tilføjer en EKSPLICIT [4]-entry der bevarer den nuværende adfærd
// ({min:8,max:10} = div-3-fallbacken), så grænsen er bevidst og forward-guarded.

test("DIVISION_SQUAD_LIMITS har en eksplicit tier-4-entry (ikke længere stille div-3-fallback)", () => {
  assert.ok(DIVISION_SQUAD_LIMITS[MAX_DIVISION], "tier 4 skal have en egen entry");
  assert.deepEqual(
    DIVISION_SQUAD_LIMITS[MAX_DIVISION],
    { min: 8, max: 10 },
    "tier-4-grænsen bevarer den hidtidige div-3-fallback-adfærd ({min:8,max:10})",
  );
});

test("getDivisionSquadLimits(4) returnerer tier-4-entry direkte — ikke div-3-fallback via ?? 3", () => {
  const limits = getDivisionSquadLimits(MAX_DIVISION);
  assert.deepEqual(limits, DIVISION_SQUAD_LIMITS[MAX_DIVISION]);
  // Forward-guard: den eksplicitte [4]-entry og div-3-entry'en er værdimæssigt ens
  // i dag, men [4] skal være sin EGEN entry, så en fremtidig tier-4-rebalance ikke
  // utilsigtet ændrer div-3.
  assert.notStrictEqual(
    DIVISION_SQUAD_LIMITS[MAX_DIVISION],
    DIVISION_SQUAD_LIMITS[3],
    "tier-4 skal være sin egen objekt-reference, ikke en alias af div-3",
  );
});

test("getDivisionSquadLimits bevarer div 1-3 uændret", () => {
  assert.deepEqual(getDivisionSquadLimits(1), { min: 10, max: 16 });
  assert.deepEqual(getDivisionSquadLimits(2), { min: 9, max: 13 });
  assert.deepEqual(getDivisionSquadLimits(3), { min: 8, max: 10 });
});
