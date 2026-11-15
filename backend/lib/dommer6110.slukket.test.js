// DOMMER #6110, regel R1: SLUKKET KONTAKT = PRAECIS SAMME RESULTAT SOM FOER.
// Kilde: ejer 12/11 ("byg-go for specens resterende trin bag den slukkede kontakt")
// og 7/11 ("XP-modellen taendes ... efter taend-kortet"). Intet i spillet maa aendre
// sig, foer ejeren taender.
//
// Fingeraftrykket er taget af dommeren paa commit c8fe1c2a8 (6/11, lige FOER den
// foerste XP-linje kom ind, #7819) og er det samme paa origin/main 5401140f2 (13/11).
// Proeven maa ikke rettes til: aendrer tallet sig, har byggeriet aendret den gamle model.

import test from "node:test";
import assert from "node:assert/strict";

import { applyDailyTick } from "./dailyTraining.js";
import {
  gammelModelFingeraftryk, gammelModelScenarier, falskDb, kraev, DOMMER_XP_RAA,
} from "./dommer6110.fixtures.mjs";

const FOER_XP = "ae8a512262165de57653a932c6095bee71f4cf0afca1cb4177255da01a5cc1df";
const ANTAL = 85;
const FAST_UR = () => 1_763_000_000_000;

test("R1 slukket: den gamle model giver praecis samme tick som foer XP (85 faste scenarier)", () => {
  const nu = gammelModelFingeraftryk(applyDailyTick);
  assert.equal(nu.antal, ANTAL);
  assert.equal(nu.hash, FOER_XP, "den gamle model har flyttet sig: slukket kontakt er ikke laengere som foer");
});

test("R1 slukket: scenarierne maaler noget (der koebes point og fyldes bjaelker)", () => {
  const medPoint = gammelModelScenarier().filter((s) => Object.keys(applyDailyTick(s).gains).length > 0).length;
  assert.ok(medPoint >= 10, `kun ${medPoint} scenarier gav point; fingeraftrykket ville vaere tomt`);
});

test("R1 slukket: XP-felterne sat til 'ingenting' aendrer intet (null, undefined, false)", () => {
  for (const ekstra of [
    { developmentXp: null },
    { developmentXp: undefined, abilityYieldMult: null, trainNowBonus: false },
    { developmentXp: null, xpYieldMult: 3, developmentScore: null },
  ]) {
    assert.equal(gammelModelFingeraftryk(applyDailyTick, ekstra).hash, FOER_XP, JSON.stringify(Object.keys(ekstra)));
  }
});

test("R1 slukket: kontakten giver kun XP ved 'on'; slukket, beta og alt andet er den gamle model", async () => {
  const { loadDevelopmentXp, DEVELOPMENT_XP_FLAG_KEY, DEVELOPMENT_XP_FROM_DATE_KEY, DEVELOPMENT_XP_PARAMS_KEY } =
    await kraev("./developmentXpFlag.ts", "loadDevelopmentXp", "DEVELOPMENT_XP_FLAG_KEY", "DEVELOPMENT_XP_FROM_DATE_KEY", "DEVELOPMENT_XP_PARAMS_KEY");
  const privat = { [DEVELOPMENT_XP_PARAMS_KEY]: DOMMER_XP_RAA };
  const stille = { warn() {} };
  for (const vaerdi of [undefined, "off", "beta", false, null, "ON ", "1", 1]) {
    for (const strict of [false, true]) {
      const app = { [DEVELOPMENT_XP_FROM_DATE_KEY]: "2026-11-15" };
      if (vaerdi !== undefined) app[DEVELOPMENT_XP_FLAG_KEY] = vaerdi;
      const db = falskDb({ app, privat });
      const svar = await loadDevelopmentXp({ supabase: db, tickDate: "2026-11-20", strict, now: FAST_UR, log: stille });
      assert.equal(svar, null, `kontakt=${JSON.stringify(vaerdi)} strict=${strict} maa ikke give XP`);
    }
  }
  // Modproeve: samme opsaetning med "on" giver XP, saa proeven ovenfor ikke er tom.
  const db = falskDb({ app: { [DEVELOPMENT_XP_FLAG_KEY]: "on", [DEVELOPMENT_XP_FROM_DATE_KEY]: "2026-11-15" }, privat });
  assert.ok(await loadDevelopmentXp({ supabase: db, tickDate: "2026-11-20", now: FAST_UR, log: stille }), "on + startdato + params skal give XP");
});

test("R1 slukket: en dato foer startdatoen afregnes med den gamle model, ogsaa naar kontakten er on", async () => {
  const { loadDevelopmentXp, DEVELOPMENT_XP_FLAG_KEY, DEVELOPMENT_XP_FROM_DATE_KEY, DEVELOPMENT_XP_PARAMS_KEY } =
    await kraev("./developmentXpFlag.ts", "loadDevelopmentXp");
  const lav = () => falskDb({
    app: { [DEVELOPMENT_XP_FLAG_KEY]: "on", [DEVELOPMENT_XP_FROM_DATE_KEY]: "2026-11-15" },
    privat: { [DEVELOPMENT_XP_PARAMS_KEY]: DOMMER_XP_RAA },
  });
  const stille = { warn() {} };
  assert.equal(await loadDevelopmentXp({ supabase: lav(), tickDate: "2026-11-14", now: FAST_UR, log: stille }), null);
  assert.ok(await loadDevelopmentXp({ supabase: lav(), tickDate: "2026-11-15", now: FAST_UR, log: stille }));
});
