// #7739 (ejer 7/11 paa #6110): under XP-modellen er der intet +1-loft pr. evne pr. dato.
// Ejervalg 16/11 (#6110 R16) gav en graense paa +2 pr. dato; G3a (spec 2026-11-20 §3, #8520)
// fjerner den igen: prisen og afstanden til P bremser. Tallene er syntetiske (hard rule 17). Testene laaser:
//   · XP on: ingen graense pr. evne pr. dato gennem motoren; dato-loftets kvittering
//     (gains_deferred_by_date_cap) skrives ikke, for intet klippes; en talfil med datePlus2 afvises
//   · taendingsnatten (ejervalg 2 = A): gemt fremgang udbetales helt paa én nat
//   · XP off: dagens model og kurve B holder stadig maks +1 pr. dato (bit-identiteten
//     mod merge-basen laases af den frosne golden i developmentXpWiring.test.js)
//   · #6110 R10 (ejer 12/11): der findes ingen dryp-regel. Det tidligere overgangsvindue
//     (development_xp_transition_cap_dates) er fjernet; sat i app_config giver det intet loft
import test from "node:test";
import assert from "node:assert/strict";

import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { buyPoints, validateDevelopmentXpParams, xpPriceForNextPoint } from "./developmentXp.ts";
import { DEVELOPMENT_XP_FLAG_KEY, DEVELOPMENT_XP_FROM_DATE_KEY } from "./developmentXpFlag.ts";
import { XP_TEST_PARAMS, ENGINE_SCENARIOS, engineSeed, runEngine } from "./__fixtures__/developmentXpOffScenarios.js";

const XP = validateDevelopmentXpParams(XP_TEST_PARAMS);
const TICK_DATE = "2026-06-12"; // motor-fixturens dato (NOW i developmentXpOffScenarios.js)
const EARLIER = "2026-06-01"; // XP taendt tidligere: datoen er ikke taendingsnatten
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

test("G3a motor (#8520): efter taendingsnatten koeber XP alt, bjaelken raekker til; ingen graense pr. dato, ingen kvittering", async () => {
  for (const flags of [ENGINE_SCENARIOS.cap.flags, ENGINE_SCENARIOS.noCap.flags]) {
    const state = seed({ flags, overlay: xpOn(EARLIER) });
    const before = r1Level(state);
    const stored = buyPoints({ level: before, bar: 4 }, XP).points;
    assert.ok(stored > 2, "scenariet har gemt mere end +2");
    const result = await runEngine(state);
    const report = r1Report(result);
    assert.ok(report.gains[ABILITY] >= stored, "hele bjaelken koebes paa én dato (tidligere hoejst +2)");
    assert.equal(r1Level(state) - before, report.gains[ABILITY], "gemt evne = rapportens gevinst");
    for (const r of result.report.riders) assert.equal(r.gains_deferred_by_date_cap, undefined, "ingen dato-loft-kvittering under XP");
  }
});

test("G3a motor (#8520): datoens tidligere gevinster begraenser intet, med og uden dato-loftet (#6210)", async () => {
  for (const flags of [ENGINE_SCENARIOS.cap.flags, ENGINE_SCENARIOS.noCap.flags]) {
    const plain = r1Report(await runEngine(seed({ flags, overlay: xpOn(EARLIER) })));
    const state = seed({ flags, overlay: xpOn(EARLIER) });
    // En tidligere koersel samme dato (loebsdags-aksen) har allerede givet +1 i evnen.
    state.training_day_runs.push({
      team_id: state.teams[0].id, season_id: state.training_plans[0].season_id, tick_date: TICK_DATE, game_day: 3, squad: "senior",
      report: { riders: [{ rider_id: "r1", gains: { [ABILITY]: 1 } }] },
    });
    const before = r1Level(state);
    const report = r1Report(await runEngine(state));
    assert.equal(report.gains[ABILITY], plain.gains[ABILITY], `${JSON.stringify(flags)}: samme koeb som uden den tidligere gevinst`);
    assert.equal(r1Level(state) - before, report.gains[ABILITY]);
  }
});

test("G3a motor (#8520): en talfil med datoreglens graenser (datePlus2) afvises; motoren koerer dagens model", async () => {
  const state = seed({ flags: ENGINE_SCENARIOS.noCap.flags, overlay: { ...xpOn(EARLIER), params: { ...XP_TEST_PARAMS, datePlus2: { minPotential: 4, belowLevel: 45 } } } });
  const xpState = seed({ flags: ENGINE_SCENARIOS.noCap.flags, overlay: xpOn(EARLIER) });
  const old = seed({ flags: ENGINE_SCENARIOS.noCap.flags, overlay: NONE });
  const [rejected, withXp, today] = [r1Report(await runEngine(state)), r1Report(await runEngine(xpState)), r1Report(await runEngine(old))];
  assert.equal(validateDevelopmentXpParams({ ...XP_TEST_PARAMS, datePlus2: { minPotential: 4, belowLevel: 45 } }), null);
  assert.ok(withXp.xp, "forudsaetning: med en gyldig talfil har rapporten XP-felter");
  assert.equal(rejected.xp, undefined, "ingen XP-felter: XP koerte ikke");
  assert.deepEqual(rejected.gains, today.gains, "samme udfald som dagens model");
});

test("#6110 R10 motor: paa taendingsnatten udbetales gemt fremgang helt", async () => {
  const state = seed({ overlay: xpOn() });
  const before = r1Level(state);
  const payout = buyPoints({ level: before, bar: 4 }, XP).points;
  assert.ok(payout > 2, "scenariet har gemt mere end +2");
  const report = r1Report(await runEngine(state));
  assert.ok(report.gains[ABILITY] >= payout, "alt gemt udbetales paa én nat");
  assert.equal(r1Level(state) - before, report.gains[ABILITY]);
});

test("#7739 motor: paa en loebsdag skriver XP heller ingen dato-loft-kvittering", async () => {
  // G3a (#8520): ingen graense pr. dato, heller ikke paa en loebsdag; bjaelken koebes ud.
  const state = seed({ overlay: xpOn(EARLIER), raced: true });
  const result = await runEngine(state);
  assert.ok(r1Report(result).gains[ABILITY] > 2, "hele bjaelken ogsaa paa en loebsdag (tidligere hoejst +2)");
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

