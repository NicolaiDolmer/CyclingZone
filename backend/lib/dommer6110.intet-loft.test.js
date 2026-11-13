// DOMMER #6110, regler R9 og R10.
//   R9  Intet loft pr. evne pr. dato under XP. Kun prisen bremser. (ejer 7/11 og 12/11:
//       "Vi skal ikke have nogen regel om, at man ikke kan faa mere udvikling end 1 evne
//       om dagen, vi skal bare lave ordentligt design fra foerste omgang af.")
//   R10 Den gamle, gemte bjaelke-fremgang udbetales alt paa én nat ved taendingen.
//       Ingen dryp-regel. (ejer 12/11, kort 1)
// RIGELIG_XP_RAA giver med vilje alt for meget XP. Det er ikke et balancebud; det er
// den eneste maade at se, om motoren har et skjult loft.

import test from "node:test";
import assert from "node:assert/strict";

import { applyDailyTick } from "./dailyTraining.js";
import {
  kraev, findes, xpParams, koebMedPrisliste, falskDb, evner,
  RIGELIG_XP_RAA, DOMMER_XP_RAA, UNG_KLATRER, SPRINTER, HAARD_KLATRING, NORMAL_SPURT, HVILE,
} from "./dommer6110.fixtures.mjs";

const P = await xpParams();
const RIGELIG = await xpParams(RIGELIG_XP_RAA);
const { xpPriceForNextPoint } = await kraev("./developmentXp.ts", "xpPriceForNextPoint");
const pris = (params) => (niveau) => xpPriceForNextPoint(niveau, params);
const FAST_UR = () => 1_763_000_000_000;

const LAV_KLATRER = Object.freeze({ ...UNG_KLATRER, riderId: "dommer-lav-klatrer", abilities: evner(30, { climbing: 12, tempo: 14 }) });
const tick = (rytter, program, params, ekstra = {}) => applyDailyTick({
  ...rytter, dateStr: "2026-11-16", caps: {}, progress: {}, conditionMult: 1, program, developmentXp: params, ...ekstra,
});

test("R9 intet loft: naar XP raekker til flere point paa én dato, koebes de alle", () => {
  const ud = tick(LAV_KLATRER, HAARD_KLATRING, RIGELIG);
  const facit = koebMedPrisliste({ level: 12, xp: ud.xp.climbing }, pris(RIGELIG));
  assert.ok(facit.point >= 3, `scenariet skal give mindst 3 point (gav ${facit.point})`);
  assert.equal(ud.gains.climbing, facit.point);
  assert.equal(ud.abilities.climbing, 12 + facit.point);
  assert.ok(ud.progress.climbing < 1, "intet er holdt tilbage paa bjaelken");
});

test("R9 intet loft: den gamle regel om +1 pr. loebsdag (hardDailyCap) gaelder ikke under XP", () => {
  // Motoren sender i dag hardDailyCap = 1 paa loebsdags-aksen. Under XP maa det ikke bremse.
  for (const ekstra of [
    { hardDailyCap: 1, budgetDivisor: 140, tickSeedKey: "dommer#gd3" }, // loebsdags-aksen, som motoren sender
    { hardDailyCap: 1 },
    { hardDailyCap: 2 },
  ]) {
    const ud = tick(LAV_KLATRER, HAARD_KLATRING, RIGELIG, ekstra);
    const facit = koebMedPrisliste({ level: 12, xp: ud.xp.climbing }, pris(RIGELIG));
    assert.ok(facit.point > ekstra.hardDailyCap, `scenariet skal give flere point end ${ekstra.hardDailyCap} (gav ${facit.point})`);
    assert.equal(ud.gains.climbing, facit.point, `${JSON.stringify(ekstra)} maa ikke klippe XP-koebet`);
    assert.ok(ud.progress.climbing < 1);
  }
});

test("R9 intet loft: kontakten kraever ikke dato-loftet, og dato-loftet aendrer ikke svaret", async () => {
  const { loadDevelopmentXp, DEVELOPMENT_XP_FLAG_KEY, DEVELOPMENT_XP_FROM_DATE_KEY, DEVELOPMENT_XP_PARAMS_KEY } =
    await kraev("./developmentXpFlag.ts", "loadDevelopmentXp");
  const stille = { warn() {} };
  for (const loft of [undefined, "off", "on"]) {
    const app = { [DEVELOPMENT_XP_FLAG_KEY]: "on", [DEVELOPMENT_XP_FROM_DATE_KEY]: "2026-11-15" };
    if (loft !== undefined) app.ability_cap_per_date_enabled = loft;
    const db = falskDb({ app, privat: { [DEVELOPMENT_XP_PARAMS_KEY]: DOMMER_XP_RAA } });
    assert.ok(await loadDevelopmentXp({ supabase: db, tickDate: "2026-11-15", now: FAST_UR, log: stille }), `dato-loft=${loft}`);
  }
});

test("R9 intet loft: standardkarrieren bag skoen og prognose har heller intet loft pr. dato", async () => {
  const { expectedCareer, standardCareerShares } = await kraev("./developmentXpExpectedTop.ts", "expectedCareer", "standardCareerShares");
  const { xpPerDate } = await kraev("./developmentXp.ts", "xpPerDate");
  const rytter = { id: "dommer-karriere", abilities: evner(10), age: 20, potentiale: 6, primaryType: "climber", secondaryType: null };
  const datoer = 3;
  const karriere = expectedCareer(rytter, RIGELIG, { endAge: 20, datesPerSeason: datoer, declineLoad: { raceDays: datoer, hardDays: 0 } });
  assert.ok(karriere, "standardkarrieren skal kunne regnes");
  const andele = standardCareerShares("climber", null, RIGELIG);
  const [evne, andel] = Object.entries(andele).sort((a, b) => b[1] - a[1])[0];
  let facit = { level: 10, rest: 0 };
  for (let d = 0; d < datoer; d++) {
    const bar = facit.rest / pris(RIGELIG)(facit.level);
    facit = koebMedPrisliste({ level: facit.level, bar, xp: xpPerDate({ potentiale: 6, age: 20 }, RIGELIG) * andel }, pris(RIGELIG));
  }
  assert.ok(facit.level - 10 > datoer, `scenariet skal give mere end ét point pr. dato (gav ${facit.level - 10} paa ${datoer} datoer)`);
  assert.equal(karriere.abilities[evne], facit.level, `${evne}: standardkarrieren maa ikke stoppe ved +1 pr. dato, naar motoren ikke goer det`);
});

test("R10 gemt fremgang: en bjaelke over 1 udbetales helt paa én nat, ogsaa uden ny XP (hviledag)", () => {
  const gemt = { climbing: 3.4, sprint: 2.2, tactics: 1.05, flat: 0.4 };
  const ud = tick(UNG_KLATRER, HVILE, P, { progress: gemt });
  for (const evne of ["climbing", "sprint", "tactics"]) {
    const facit = koebMedPrisliste({ level: UNG_KLATRER.abilities[evne], bar: gemt[evne] }, pris(P));
    assert.ok(facit.point >= 1, `${evne}: scenariet skal have gemt mindst ét point`);
    assert.equal(ud.gains[evne], facit.point, `${evne}: alle gemte point udbetales`);
    assert.ok(ud.progress[evne] < 1, `${evne}: intet gemt tilbage`);
  }
  assert.equal(ud.gains.flat, undefined, "en bjaelke under 1 udbetaler intet");
  assert.equal(ud.progress.flat, 0.4);
});

test("R10 gemt fremgang: ingen dryp, heller ikke naar motoren sender den gamle loebsdagsregel (+1 pr. tick)", () => {
  const gemt = { sprint: 3.7, acceleration: 2.5 };
  for (const program of [NORMAL_SPURT, HVILE]) {
    const ud = tick(SPRINTER, program, P, { progress: gemt, hardDailyCap: 1, budgetDivisor: 140, tickSeedKey: "dommer#gd1" });
    for (const evne of ["sprint", "acceleration"]) {
      const facit = koebMedPrisliste({ level: SPRINTER.abilities[evne], bar: gemt[evne], xp: ud.xp?.[evne] ?? 0 }, pris(P));
      assert.ok(facit.point >= 2, `${evne}: scenariet skal have gemt mindst to point`);
      assert.equal(ud.gains[evne], facit.point, `${evne} (${program.intensity}): alt udbetales i samme tick`);
      assert.ok(ud.progress[evne] < 1, `${evne}: intet gemt tilbage`);
    }
  }
});

test("R10 gemt fremgang: der findes ingen dryp-regel, man kan slaa til (overgangsvindue med +1 pr. dato)", async () => {
  if (!findes("./developmentXpFlag.ts")) throw new Error("IKKE BYGGET: modulet ./developmentXpFlag.ts findes ikke");
  const flag = await import("./developmentXpFlag.ts");
  // Er krogen fjernet helt, er reglen opfyldt.
  if (typeof flag.loadDevelopmentXpDateCap === "function") {
    for (const dage of ["7", 7, "30", 1]) {
      const db = falskDb({ app: {
        [flag.DEVELOPMENT_XP_FLAG_KEY]: "on", [flag.DEVELOPMENT_XP_FROM_DATE_KEY]: "2026-11-15",
        development_xp_transition_cap_dates: dage,
      } });
      const loft = await flag.loadDevelopmentXpDateCap({ supabase: db, tickDate: "2026-11-15", log: { warn() {} } });
      assert.equal(loft, null, `development_xp_transition_cap_dates=${JSON.stringify(dage)} maa ikke give et loft`);
    }
  }
  if (typeof flag.developmentXpDateCap === "function") {
    assert.equal(flag.developmentXpDateCap({ tickDate: "2026-11-16", fromDate: "2026-11-15", transitionDates: 7 }), null);
  }
});
