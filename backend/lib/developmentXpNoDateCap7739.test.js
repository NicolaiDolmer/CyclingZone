// #7739 (ejer 7/11 paa #6110): under XP-modellen er der intet +1-loft pr. evne pr. dato;
// kun prisen bremser. Tallene er syntetiske (hard rule 17). Testene laaser:
//   · XP on: en evne kan koebe flere point paa samme dato, naar XP'en raekker, og dato-
//     loftets kvittering (gains_deferred_by_date_cap) skrives ikke
//   · XP off: dagens model og kurve B holder stadig maks +1 pr. dato (bit-identiteten
//     mod merge-basen laases af den frosne golden i developmentXpWiring.test.js)
//   · #6110 R10 (ejer 12/11): der findes ingen dryp-regel. Det tidligere overgangsvindue
//     (development_xp_transition_cap_dates) er fjernet; sat i app_config giver det intet loft
import test from "node:test";
import assert from "node:assert/strict";

import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { validateDevelopmentXpParams, xpPriceForNextPoint } from "./developmentXp.ts";
import { DEVELOPMENT_XP_FLAG_KEY, DEVELOPMENT_XP_FROM_DATE_KEY } from "./developmentXpFlag.ts";
import { XP_TEST_PARAMS, ENGINE_SCENARIOS, engineSeed, runEngine } from "./__fixtures__/developmentXpOffScenarios.js";

const XP = validateDevelopmentXpParams(XP_TEST_PARAMS);
const TICK_DATE = "2026-06-12"; // motor-fixturens dato (NOW i developmentXpOffScenarios.js)
const xpOn = (fromDate = TICK_DATE, extra = []) => ({
  app: [[DEVELOPMENT_XP_FLAG_KEY, "on"], [DEVELOPMENT_XP_FROM_DATE_KEY, fromDate], ...extra],
  params: XP_TEST_PARAMS,
});
const NONE = { app: [], params: undefined };
const TRANSITION_KEY = "development_xp_transition_cap_dates";

// Rytter r1 faar en stor gemt bjaelke paa en evne, saa XP'en i sig selv raekker til
// flere point paa én dato (gammel fremgang plus dagens XP).
const ABILITY = "climbing";
function seed({ flags = ENGINE_SCENARIOS.cap.flags, overlay, raced = false }) {
  const state = engineSeed({ flags, raced, overlay, plan: "vo2max" });
  state.rider_derived_abilities[0].ability_progress = { ...state.rider_derived_abilities[0].ability_progress, [ABILITY]: 4 };
  return state;
}
const r1Report = (result) => result.report.riders.find((r) => r.rider_id === "r1");
const r1Level = (state) => state.rider_derived_abilities.find((r) => r.rider_id === "r1")[ABILITY];

test("#7739 forudsaetning: scenariets bjaelke raekker til flere point til prisen", () => {
  const level = engineSeed({ flags: {}, raced: false, overlay: NONE, plan: "vo2max" }).rider_derived_abilities[0][ABILITY];
  const wallet = 4 * xpPriceForNextPoint(level, XP);
  assert.ok(wallet >= xpPriceForNextPoint(level, XP) + xpPriceForNextPoint(level + 1, XP), "mindst to point uden ny XP");
});

test("#7739 motor: XP on koeber flere point paa samme dato, og dato-loftets kvittering skrives ikke", async () => {
  for (const flags of [ENGINE_SCENARIOS.cap.flags, ENGINE_SCENARIOS.noCap.flags]) {
    const state = seed({ flags, overlay: xpOn() });
    const before = r1Level(state);
    const result = await runEngine(state);
    const report = r1Report(result);
    assert.ok(report.gains[ABILITY] >= 2, "flere point paa én dato");
    assert.equal(r1Level(state) - before, report.gains[ABILITY], "gemt evne = rapportens gevinst");
    for (const r of result.report.riders) {
      assert.equal(r.gains_deferred_by_date_cap, undefined, "ingen dato-loft-kvittering under XP");
    }
  }
});

test("#7739 motor: paa en loebsdag skriver XP heller ingen dato-loft-kvittering", async () => {
  // Loebsdagens eget loft pr. tick (#4750, spec §4.3) er uaendret og ligger i tick'et selv.
  const state = seed({ overlay: xpOn(), raced: true });
  const result = await runEngine(state);
  assert.ok(r1Report(result).gains[ABILITY] >= 1);
  for (const r of result.report.riders) assert.equal(r.gains_deferred_by_date_cap, undefined);
});

test("#7739 motor: XP off holder stadig maks +1 pr. dato (dagens model og kurve B uaendret)", async () => {
  const state = seed({ overlay: NONE });
  const before = structuredClone(state.rider_derived_abilities);
  const result = await runEngine(state);
  for (const [i, row] of state.rider_derived_abilities.entries()) {
    for (const k of VISIBLE_ABILITIES) assert.ok(row[k] - before[i][k] <= 1, `${k}: hoejst +1`);
  }
  assert.ok(r1Report(result).gains_deferred_by_date_cap?.[ABILITY] > 0, "klippet point kvitteres som i dag");
});

test("#6110 R10: ingen dryp-regel; et overgangsvindue i app_config giver intet loft", async () => {
  // Ejer 12/11: gemt fremgang udbetales helt paa én nat. Krogen fra #7739 er fjernet.
  for (const flags of [ENGINE_SCENARIOS.cap.flags, ENGINE_SCENARIOS.noCap.flags]) {
    for (const dates of [7, "30", 1]) {
      const result = await runEngine(seed({ flags, overlay: xpOn(TICK_DATE, [[TRANSITION_KEY, dates]]) }));
      assert.ok(r1Report(result).gains[ABILITY] >= 2, `${JSON.stringify(dates)}: alt gemt udbetales`);
      assert.equal(r1Report(result).gains_deferred_by_date_cap, undefined);
    }
  }
});

