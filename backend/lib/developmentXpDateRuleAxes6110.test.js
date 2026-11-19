// #6110 Fable-fund 2 (16/11): datoreglen under XP prøvet på de stier, der kører live.
//
// Reglen (R16, ejervalg A 16/11): en evne stiger højst +1 pr. dato, +2 kun for et ungt
// toptalent på en meget lav evne, og det gælder på tværs af datoens ticks. Før denne fil
// var reglen kun prøvet på reserve-stien (uden training_condition_per_date). Her køres:
//   1. Aftenkørslen på løbsdags-aksen med XP OG training_condition_per_date tændt: hver af
//      datoens fem løbsdage er sit eget tick og læser de andre løbsdages kvitteringer
//      (training_rider_ticks) fra databasen.
//   2. Træn nu-presset (runTrainNow -> settleWholeDayPress -> runPressDayFromMemory): de
//      senere dag-felter læser de tidligere kvitteringer fra pressets hukommelse.
// Beviset er det samme begge steder: en stor gemt bjælke rækker til mange point, men datoen
// giver tilsammen højst reglens tal; datoens første løbsdag tager det hele, de andre intet,
// og resten venter på bjælken. Tallene er opdigtede (hard rule 17).
import test from "node:test";
import assert from "node:assert/strict";

import { seedState, createFake, press, sweep, rider, DATE1, DAYS1 } from "./trainNowSameResult7982.harness.js";
import { XP_TEST_PARAMS } from "./__fixtures__/developmentXpOffScenarios.js";

const RIDER = rider(0);
const ABILITY = "climbing";
const STORED = 6; // seks point gemt på bjælken: rækker langt over datoens tal
// XP tændt fra før datoen, så datoen ikke er tændingsnatten (der udbetales gemt fremgang helt).
const XP_ON = { development_xp_model: "on", development_xp_from_date: "2026-11-01" };

/** Én ung toptalent-rytter på en lav evne; `datePlus2` afgør, om han får +2. */
function xpState(datePlus2) {
  const state = seedState({ count: 1, flags: XP_ON });
  Object.assign(state.riders[0], { potentiale: 5, birthdate: "2010-03-15" }); // 20 aar i saeson 5 (saeson-alder)
  state.rider_derived_abilities[0].ability_progress = { [ABILITY]: STORED };
  state.private_config = [{ key: "development_xp_params", value: { ...XP_TEST_PARAMS, datePlus2 } }];
  return state;
}

// Opdigtede grænser: rytteren er ung, toptalent og på en meget lav evne ...
const ELIGIBLE = { maxAge: 23, minPotential: 5, belowLevel: 60 };
// ... eller ikke ung nok efter talfilen: det lave tal.
const TOO_OLD = { maxAge: 18, minPotential: 5, belowLevel: 60 };

const receipts = (state) => state.training_rider_ticks
  .filter((row) => row.rider_id === RIDER && row.tick_date === DATE1)
  .sort((a, b) => a.game_day - b.game_day);

function assertDateRule(state, { cap, label }) {
  const rows = receipts(state);
  assert.deepEqual(rows.map((row) => row.game_day), DAYS1, `${label}: alle fem løbsdage er afregnet`);
  // XP kørte: dagens model med dato-loftet (#6210) ville kvittere det klippede point her.
  for (const row of rows) assert.equal(row.report?.gains_deferred_by_date_cap, undefined, `${label}: XP-grenen kørte`);
  const perAbility = {};
  for (const row of rows) {
    for (const [ability, n] of Object.entries(row.report?.gains ?? {})) perAbility[ability] = (perAbility[ability] ?? 0) + n;
  }
  for (const [ability, n] of Object.entries(perAbility)) assert.ok(n <= cap, `${label}: ${ability} +${n} på én dato`);
  assert.equal(perAbility[ABILITY], cap, `${label}: bjælken rækker til mere, men datoen giver ${cap}`);
  assert.equal(rows[0].report.gains[ABILITY], cap, `${label}: datoens første løbsdag tager datoens tal`);
  for (const row of rows.slice(1)) {
    assert.equal(row.report.gains?.[ABILITY], undefined, `${label}: løbsdag ${row.game_day} læser de tidligere kvitteringer og køber intet`);
  }
  const ab = state.rider_derived_abilities.find((row) => row.rider_id === RIDER);
  assert.ok(ab.ability_progress[ABILITY] >= 1, `${label}: resten venter på bjælken (intet tabt)`);
}

for (const [rule, cap] of [[ELIGIBLE, 2], [TOO_OLD, 1]]) {
  test(`#6110 R16 løbsdags-aksen (XP + training_condition_per_date): højst +${cap} på tværs af datoens ticks`, async () => {
    const state = xpState(rule);
    const levelBefore = state.rider_derived_abilities[0][ABILITY];
    const fake = createFake(state);
    const out = await sweep(state, fake, { deadlineReached: true });
    assert.ok(out.every((day) => !day.error), JSON.stringify(out));
    assertDateRule(state, { cap, label: "aftenkørslen" });
    assert.equal(state.rider_derived_abilities[0][ABILITY] - levelBefore, cap, "gemt evne = kvitteringernes sum");
    assert.ok(receipts(state).every((row) => row.report?.condition_per_date !== false));
  });

  test(`#6110 R16 Træn nu-presset (runPressDayFromMemory): højst +${cap} på tværs af datoens ticks`, async () => {
    const state = xpState(rule);
    const levelBefore = state.rider_derived_abilities[0][ABILITY];
    const fake = createFake(state);
    const res = await press(state, fake);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.settledGameDays, DAYS1, "presset afregner hele datoen");
    assertDateRule(state, { cap, label: "presset" });
    assert.equal(state.rider_derived_abilities[0][ABILITY] - levelBefore, cap, "gemt evne = kvitteringernes sum");
  });
}

test("#6110 R16 forudsætning: uden XP giver samme opsætning dagens model (prøven måler XP, ikke noget andet)", async () => {
  const state = xpState(ELIGIBLE);
  state.app_config = state.app_config.filter((row) => row.key !== "development_xp_model");
  const fake = createFake(state);
  await press(state, fake);
  // Dagens model med dato-loftet (#6210) tændt: højst +1 pr. evne pr. dato, uanset bjælken.
  const total = receipts(state).reduce((sum, row) => sum + (row.report?.gains?.[ABILITY] ?? 0), 0);
  assert.ok(total <= 1, `dagens model: +${total}`);
  assert.ok(receipts(state).some((row) => row.report?.gains_deferred_by_date_cap?.[ABILITY] > 0), "dagens model kvitterer det klippede point");
});
