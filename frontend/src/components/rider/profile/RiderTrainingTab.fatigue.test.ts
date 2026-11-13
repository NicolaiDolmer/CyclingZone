// #7801 (dom 2 paa #8054): rytterprofilens "Form & restitution" viser en streg ved ukendt
// traethed lige nu (kontakten taendt), aldrig 0. Slukket er uaendret.
// Samme kilde-scan-moenster som RiderScoutingTab.confidence.test.js (ingen render-harness).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { profileFatigueValue } from "../../../lib/training.js";

test("taendt og ukendt traethed: null (vises som streg), ikke 0", () => {
  assert.equal(profileFatigueValue({ form: 60, fatigue: null, fatigue_at_start: null }), null);
  assert.equal(profileFatigueValue({ form: 60, fatigue: undefined, fatigue_at_start: 70 }), null);
});

test("taendt og kendt traethed: tallet", () => {
  assert.equal(profileFatigueValue({ form: 60, fatigue: 62, fatigue_at_start: 70 }), 62);
  assert.equal(profileFatigueValue({ form: 60, fatigue: 0, fatigue_at_start: null }), 0);
});

test("slukket (intet fatigue_at_start i svaret): som foer", () => {
  assert.equal(profileFatigueValue({ form: 60, fatigue: 44 }), 44);
  assert.equal(profileFatigueValue({ form: 60, fatigue: null }), 0);
  assert.equal(profileFatigueValue({ form: 60 }), 0);
});

test("FormCard bruger profileFatigueValue og viser streg og tom bjaelke ved null", () => {
  const src = readFileSync(fileURLToPath(new URL("./RiderTrainingTab.jsx", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /condition\.fatigue \?\? 0/, "ukendt traethed maa ikke blive 0");
  assert.match(src, /const fatigue = profileFatigueValue\(condition\)/);
  assert.match(src, /\{fatigue \?\? "—"\}/);
  assert.match(src, /width: `\$\{fatigue === null \? 0 : clamp\(fatigue\)\}%`/);
});
