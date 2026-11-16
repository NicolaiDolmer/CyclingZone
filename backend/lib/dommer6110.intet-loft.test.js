// DOMMER #6110, regler R16 (datoreglen) og R10 (taendingsnatten). Filen hed "intet loft",
// fordi R9 (ejer 7/11 og 12/11) var "kun prisen bremser". Ejervalg 16/11 vendte den:
//   R16 En evne stiger hoejst 2 point pr. dato under XP, paa tvaers af datoens ticks og stier
//       (Traen nu, aftenkoerslen, loebsdags-aksen). Resten bliver staaende paa bjaelken,
//       omregnet til den nye pris, saa intet XP gaar tabt eller opstaar. Ingen prisbund.
//       Erstatter "kun prisen bremser" (12/11) og prisbunden (valg A 14/11).
//   R10 Den gamle, gemte bjaelke-fremgang udbetales alt paa én nat ved taendingen
//       (ejervalg 2 = A, 16/11: undtagelse fra +2 kun den nat). Ingen dryp-regel.
// RIGELIG_XP_RAA giver med vilje alt for meget XP, saa grænsen er det eneste, der bremser.

import test from "node:test";
import assert from "node:assert/strict";

import { applyDailyTick } from "./dailyTraining.js";
import {
  kraev, findes, xpParams, koebMedPrisliste, falskDb, evner,
  RIGELIG_XP_RAA, DOMMER_XP_RAA, DOMMER_VARIATION, UNG_KLATRER, SPRINTER, HAARD_KLATRING, NORMAL_SPURT, HVILE,
  STAERK_TRAENER, BEDSTE_FACILITET,
} from "./dommer6110.fixtures.mjs";

const GRAENSE = 2; // ejerens ord 16/11: "hoejst +2 pr. evne pr. dato"
const P = await xpParams();
const RIGELIG = await xpParams(RIGELIG_XP_RAA);
const { xpPriceForNextPoint } = await kraev("./developmentXp.ts", "xpPriceForNextPoint");
const pris = (params) => (niveau) => xpPriceForNextPoint(niveau, params);
const FAST_UR = () => 1_763_000_000_000;

const LAV_KLATRER = Object.freeze({ ...UNG_KLATRER, riderId: "dommer-lav-klatrer", abilities: evner(30, { climbing: 12, tempo: 14 }) });
const tick = (rytter, program, params, ekstra = {}) => applyDailyTick({
  ...rytter, dateStr: "2026-11-16", caps: {}, progress: {}, conditionMult: 1, program, developmentXp: params, ...ekstra,
});
// XP paa bjaelken maalt i prisen for evnens nuvaerende niveau.
const bjaelkeXp = (params, niveau, bar) => (bar ?? 0) * xpPriceForNextPoint(niveau, params);
const naer = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

test("R16 +2: naar XP raekker til flere point paa én dato, koebes hoejst 2, og resten venter omregnet", () => {
  const ud = tick(LAV_KLATRER, HAARD_KLATRING, RIGELIG);
  const fri = koebMedPrisliste({ level: 12, xp: ud.xp.climbing }, pris(RIGELIG));
  assert.ok(fri.point >= 3, `scenariet skal kunne give mindst 3 point (gav ${fri.point})`);
  assert.equal(ud.gains.climbing, GRAENSE);
  assert.equal(ud.abilities.climbing, 12 + GRAENSE);
  const brugt = xpPriceForNextPoint(12, RIGELIG) + xpPriceForNextPoint(13, RIGELIG);
  assert.ok(naer(bjaelkeXp(RIGELIG, 14, ud.progress.climbing), ud.xp.climbing - brugt), "resten staar paa bjaelken til den nye pris");
  assert.ok(ud.progress.climbing > 1, "resten er mere end et helt point og venter");
});

test("R16 +2: den gamle regel om +1 pr. loebsdag (hardDailyCap) gaelder ikke under XP; graensen er 2", () => {
  for (const ekstra of [
    { hardDailyCap: 1, budgetDivisor: 140, tickSeedKey: "dommer#gd3" }, // loebsdags-aksen, som motoren sender
    { hardDailyCap: 1 },
    { hardDailyCap: 2 },
    { hardDailyCap: 5 },
  ]) {
    const ud = tick(LAV_KLATRER, HAARD_KLATRING, RIGELIG, ekstra);
    assert.equal(ud.gains.climbing, GRAENSE, `${JSON.stringify(ekstra)}: hoejst ${GRAENSE}, ikke det gamle loft`);
  }
});

test("R16 +2: kontakten kraever ikke dato-loftet (#6210), og dato-loftet aendrer ikke svaret", async () => {
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

test("R16 +2: standardkarrieren bag skoen og prognose stiger ogsaa hoejst 2 pr. dato", async () => {
  const { expectedCareer, standardCareerShares } = await kraev("./developmentXpExpectedTop.ts", "expectedCareer", "standardCareerShares");
  const { xpPerDate } = await kraev("./developmentXp.ts", "xpPerDate");
  const rytter = { id: "dommer-karriere", abilities: evner(10), age: 20, potentiale: 6, primaryType: "climber", secondaryType: null };
  const datoer = 3;
  const karriere = expectedCareer(rytter, RIGELIG, { endAge: 20, datesPerSeason: datoer, declineLoad: { raceDays: datoer, hardDays: 0 } });
  assert.ok(karriere, "standardkarrieren skal kunne regnes");
  const andele = standardCareerShares("climber", null, RIGELIG);
  const [evne, andel] = Object.entries(andele).sort((a, b) => b[1] - a[1])[0];
  const dagsXp = xpPerDate({ potentiale: 6, age: 20 }, RIGELIG) * andel;
  assert.ok(koebMedPrisliste({ level: 10, xp: dagsXp }, pris(RIGELIG)).point > GRAENSE, "scenariet skal kunne give mere end +2 paa én dato");
  assert.equal(karriere.abilities[evne], 10 + GRAENSE * datoer, `${evne}: standardkarrieren foelger motorens +2 pr. dato`);
});

// ── NY (ejervalg 16/11): hele datoen gennem motoren, den vaerst taenkelige dag ────────
// Flere ticks paa samme dato (Traen nu om morgenen, aftenkoerslen, loebsdags-aksen),
// sessionens vaegt 2 (vo2max_climb), bedste traener og facilitet, Traen nu og en god dag.
test("R16 +2 gennem applyDailyTick: flere ticks paa samme dato giver hoejst +2 i alt, og bjaelken baerer resten (intet tabt, intet opstaaet)", async () => {
  const { developmentXpDayVariation } = await kraev("./developmentXpVariation.ts", "developmentXpDayVariation");
  const { programAbilityWeight } = await kraev("./training.js", "programAbilityWeight");
  assert.equal(programAbilityWeight(HAARD_KLATRING, "climbing"), 2, "sessionens vaegt 2");
  const params = await xpParams({ ...RIGELIG_XP_RAA, variation: DOMMER_VARIATION });
  const rytter = LAV_KLATRER;
  // En god dag: den dato i november, hvor rytterens variation er hoejest.
  const datoer = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
  const dato = datoer.reduce((a, b) => (developmentXpDayVariation({ riderId: rytter.riderId, dateStr: b }, params.variation)
    > developmentXpDayVariation({ riderId: rytter.riderId, dateStr: a }, params.variation) ? b : a));
  assert.ok(developmentXpDayVariation({ riderId: rytter.riderId, dateStr: dato }, params.variation) > 1.3, "en god dag");

  const faelles = { ...rytter, dateStr: dato, caps: {}, conditionMult: 1, program: HAARD_KLATRING, developmentXp: params,
    staff: STAERK_TRAENER, facilityTier: BEDSTE_FACILITET, riderLevel: "u23" };
  const ticks = [
    { trainNowBonus: true }, // Traen nu
    {}, // aftenkoerslen
    { budgetDivisor: 140, tickSeedKey: "dommer#gd2", hardDailyCap: 1 }, // loebsdags-aksen
    { budgetDivisor: 140, tickSeedKey: "dommer#gd3", hardDailyCap: 1 },
  ];
  let state = { abilities: rytter.abilities, progress: { climbing: 0.3 } };
  const brugt = {};
  let optjent = 0;
  for (const ekstra of ticks) {
    const ud = applyDailyTick({ ...faelles, ...ekstra, abilities: state.abilities, progress: state.progress, xpDateUsedGains: { ...brugt } });
    for (const [e, n] of Object.entries(ud.gains)) brugt[e] = (brugt[e] ?? 0) + n;
    optjent += ud.xp.climbing ?? 0;
    state = ud;
  }
  for (const [e, n] of Object.entries(brugt)) assert.ok(n <= GRAENSE, `${e}: +${n} paa én dato`);
  assert.equal(brugt.climbing, GRAENSE, "scenariet rammer graensen i fokus-evnen");
  const fri = koebMedPrisliste({ level: 12, bar: 0.3, xp: optjent }, pris(params));
  assert.ok(fri.point > GRAENSE, `uden graensen ville datoen give +${fri.point}`);
  // Bevarelse: startbjaelke + datoens XP = prisen for de koebte point + bjaelken bagefter.
  const foer = bjaelkeXp(params, 12, 0.3) + optjent;
  const efter = xpPriceForNextPoint(12, params) + xpPriceForNextPoint(13, params) + bjaelkeXp(params, 14, state.progress.climbing);
  assert.ok(naer(efter, foer), `intet XP tabt eller opstaaet (${efter} mod ${foer})`);

  // Naeste dato udbetaler resten, men igen hoejst +2.
  const naeste = applyDailyTick({ ...faelles, dateStr: "2026-12-01", program: HVILE, abilities: state.abilities, progress: state.progress });
  assert.equal(naeste.gains.climbing, GRAENSE, "resten kommer paa de naeste datoer, hoejst +2 ad gangen");
});

test("R16 +2: slukket kontakt er uroert af de nye felter (samme svar med og uden)", () => {
  const args = { ...SPRINTER, dateStr: "2026-11-16", caps: evner(99), progress: { sprint: 3.4 }, conditionMult: 1, program: NORMAL_SPURT };
  assert.deepEqual(applyDailyTick({ ...args, xpDateUsedGains: { sprint: 2 }, xpStoredBarPayout: true }), applyDailyTick(args));
});

test("R10 gemt fremgang: paa taendingsnatten udbetales en bjaelke over 1 helt, ogsaa uden ny XP (hviledag)", () => {
  const gemt = { climbing: 3.4, sprint: 2.2, tactics: 1.05, flat: 0.4 };
  const ud = tick(UNG_KLATRER, HVILE, P, { progress: gemt, xpStoredBarPayout: true });
  for (const evne of ["climbing", "sprint", "tactics"]) {
    const facit = koebMedPrisliste({ level: UNG_KLATRER.abilities[evne], bar: gemt[evne] }, pris(P));
    assert.ok(facit.point >= 1, `${evne}: scenariet skal have gemt mindst ét point`);
    assert.equal(ud.gains[evne], facit.point, `${evne}: alle gemte point udbetales`);
    assert.ok(ud.progress[evne] < 1, `${evne}: intet gemt tilbage`);
  }
  assert.ok(ud.gains.climbing > GRAENSE, "udbetalingen er undtaget fra +2");
  assert.equal(ud.gains.flat, undefined, "en bjaelke under 1 udbetaler intet");
  assert.equal(ud.progress.flat, 0.4);
  // Uden for taendingsnatten gaelder +2 ogsaa for en gemt bjaelke.
  const senere = tick(UNG_KLATRER, HVILE, P, { progress: gemt });
  assert.equal(senere.gains.climbing, GRAENSE);
});

test("R10 gemt fremgang: ingen dryp paa taendingsnatten, heller ikke naar motoren sender den gamle loebsdagsregel (+1 pr. tick)", () => {
  const gemt = { sprint: 3.7, acceleration: 2.5 };
  for (const program of [NORMAL_SPURT, HVILE]) {
    const ud = tick(SPRINTER, program, P, { progress: gemt, hardDailyCap: 1, budgetDivisor: 140, tickSeedKey: "dommer#gd1", xpStoredBarPayout: true });
    for (const evne of ["sprint", "acceleration"]) {
      const udbetaling = koebMedPrisliste({ level: SPRINTER.abilities[evne], bar: gemt[evne] }, pris(P));
      assert.ok(udbetaling.point >= 2, `${evne}: scenariet skal have gemt mindst to point`);
      assert.ok(ud.gains[evne] >= udbetaling.point, `${evne} (${program.intensity}): alt gemt udbetales i samme tick`);
      assert.ok(ud.gains[evne] <= Math.max(udbetaling.point, GRAENSE), `${evne}: dagens nye XP koeber intet ud over udbetalingen`);
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
