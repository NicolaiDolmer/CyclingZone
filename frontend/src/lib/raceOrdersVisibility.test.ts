// #5059 · Ordre-kolonnen paa Taktik-fanen var styret af build-variablen
// TACTICS_V4_PREVIEW alene - en almindelig spiller med race_engine_v4 taendt
// saa den ALDRIG, fordi build-variablen er false i prod. Tester den rene
// gate-logik direkte, og pinner en kildekontrakt om at RaceDetailPage ikke
// laengere sender den raa build-variabel som showOrders (samme moenster som
// RaceTacticsTab.contract.test.js og HelpPage.flagGates.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { computeShowOrders } from "./raceOrdersVisibility.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const raceDetailSource = readFileSync(join(__dirname, "..", "pages", "RaceDetailPage.jsx"), "utf8");

test("preview-flaget (dev/preview-mock) taender altid, uanset spillerflaget", () => {
  assert.equal(computeShowOrders(true, { race_engine_v4: false }), true);
  assert.equal(computeShowOrders(true, null), true);
  assert.equal(computeShowOrders(true, {}), true);
});

test("uden preview-flaget: kun et strengt true for race_engine_v4 taender", () => {
  assert.equal(computeShowOrders(false, { race_engine_v4: true }), true); // on
  assert.equal(computeShowOrders(false, { race_engine_v4: false }), false); // off
  assert.equal(computeShowOrders(false, { race_engine_v4: "beta" }), false); // stage-vaerdi, ikke strengt true
  assert.equal(computeShowOrders(false, {}), false); // manglende noegle
  assert.equal(computeShowOrders(false, null), false); // svaret hentes stadig / fejlede
  assert.equal(computeShowOrders(false, undefined), false);
});

test("fail-safe: et ikke-objekt flag-svar er skjult, aldrig en kastet fejl", () => {
  // @ts-expect-error - bevidst forkert input for at bekraefte fail-safen
  assert.equal(computeShowOrders(false, "on"), false);
  // @ts-expect-error
  assert.equal(computeShowOrders(false, 1), false);
});

test("kildekontrakt: RaceDetailPage sender ikke laengere den raa build-variabel som showOrders", () => {
  assert.doesNotMatch(
    raceDetailSource,
    /showOrders=\{TACTICS_V4_PREVIEW\}/,
    "RaceDetailPage skal afgoere showOrders via computeShowOrders, ikke sende build-variablen direkte",
  );
  assert.match(
    raceDetailSource,
    /computeShowOrders\(/,
    "RaceDetailPage bruger ikke den delte gate-funktion raceOrdersVisibility.computeShowOrders",
  );
  assert.match(
    raceDetailSource,
    /fetchPlayerFeatureFlags\(\)/,
    "RaceDetailPage henter ikke spillerens flag-svar",
  );
});
