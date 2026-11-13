// DOMMER #6110, regler R2-R8 og R12-R14: XP-modellens grundregler.
//   R2  Én faelles prisliste: hoejere evne koster mere, ingen mur (ejer 6/11).
//   R3  Potentialet afgoer XP pr. dag; forskellen ligger i XP, ikke i prisen (ejer 6/11).
//   R4  Alder er aldrig en turbo: samme rytter tjener ca. det samme som ung (ejer 6/11).
//   R5  Udviklingen ebber gradvist ud fra 27 aar, naesten intet fra 31 (ejer 12/11, kort 3).
//   R6  Mentale evner: samme prisliste, vokser laengere end fysiske (ejer 6/11).
//   R7  Traening giver mest i fokus og lidt i resten (ejer 6/11, Aa1).
//   R8  Typen: alt kan traenes, evner uden for typen faar mindre; typen er anlaeg (ejer 6/11).
//   R12 En hel traeningsdag giver aldrig nul (ejer 5/11 og 6/11).
//   R13 Form og traethed paavirker ikke udviklingen (ejer 23/10, S29).
//   R14 Traen nu-bonus er 15 % (ejer 7/11).
// Alle scenarier er dommerens egne. Tallene i DOMMER_XP_RAA er ikke de private parametre.

import test from "node:test";
import assert from "node:assert/strict";

import { applyDailyTick } from "./dailyTraining.js";
import {
  kraev, xpParams, koebMedPrisliste, evner,
  UNG_KLATRER, SPRINTER, VETERAN, HAARD_KLATRING, NORMAL_SPURT, LET_UDHOLDENHED, LOEBSLAERE, HVILE,
} from "./dommer6110.fixtures.mjs";

const P = await xpParams();
const { xpPriceForNextPoint } = await kraev("./developmentXp.ts", "xpPriceForNextPoint");
const pris = (niveau) => xpPriceForNextPoint(niveau, P);

const tick = (rytter, program, ekstra = {}) => applyDailyTick({
  ...rytter, dateStr: "2026-11-16", caps: {}, progress: {}, conditionMult: 1, program, developmentXp: P, ...ekstra,
});
const taet = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

test("R2 prisliste: hvert point koster mere end det forrige, og prisen er endelig helt op til 99", () => {
  for (let niveau = 1; niveau <= 98; niveau++) {
    assert.ok(Number.isFinite(pris(niveau)) && pris(niveau) > 0, `pris ved ${niveau}`);
    if (niveau > 1) assert.ok(pris(niveau) > pris(niveau - 1), `prisen skal stige fra ${niveau - 1} til ${niveau}`);
  }
});

test("R2 prisliste: samme pris for alle ryttere; kun XP og prislisten afgoer, hvor mange point der koebes", () => {
  for (const rytter of [UNG_KLATRER, SPRINTER, VETERAN]) {
    for (const program of [HAARD_KLATRING, NORMAL_SPURT, LOEBSLAERE]) {
      const progress = { climbing: 0.6, sprint: 0.95, tactics: 0.2 };
      const ud = tick(rytter, program, { progress });
      assert.ok(Object.keys(ud.xp ?? {}).length > 0, "tick'et skal oplyse XP pr. evne");
      for (const [evne, xp] of Object.entries(ud.xp)) {
        const facit = koebMedPrisliste({ level: rytter.abilities[evne], bar: progress[evne] ?? 0, xp }, pris);
        assert.equal(ud.gains[evne] ?? 0, facit.point, `${rytter.riderId} ${evne}: point`);
        assert.equal(ud.abilities[evne], facit.level, `${rytter.riderId} ${evne}: evne`);
        assert.ok(taet(ud.progress[evne] * pris(facit.level), facit.rest, 1e-9), `${rytter.riderId} ${evne}: resten staar paa bjaelken`);
      }
    }
  }
});

test("R3 potentiale: hoejere potentiale giver mere XP i alle traenede evner, aldrig mindre", () => {
  const xpVed = (potentiale) => tick({ ...SPRINTER, potentiale }, NORMAL_SPURT).xp;
  let forrige = xpVed(1);
  for (const potentiale of [2, 3, 4, 5, 6]) {
    const nu = xpVed(potentiale);
    for (const evne of Object.keys(nu)) assert.ok(nu[evne] > forrige[evne], `potentiale ${potentiale} ${evne}`);
    forrige = nu;
  }
});

test("R3 potentiale: rytterens nuvaerende evner aendrer ikke hans XP (forskellen ligger i prisen)", () => {
  const lav = tick({ ...UNG_KLATRER, abilities: evner(20) }, HAARD_KLATRING).xp;
  const hoej = tick({ ...UNG_KLATRER, abilities: evner(85) }, HAARD_KLATRING).xp;
  assert.deepEqual(Object.keys(lav).sort(), Object.keys(hoej).sort());
  for (const evne of Object.keys(lav)) assert.ok(taet(lav[evne], hoej[evne]), evne);
});

test("R4 alder er aldrig en turbo: samme rytter tjener det samme som 17-, 19-, 23- og 26-aarig", () => {
  const xpVed = (age) => tick({ ...UNG_KLATRER, age }, HAARD_KLATRING).xp.climbing;
  const fuld = xpVed(26);
  for (const age of [16, 17, 19, 21, 23, 25]) {
    assert.ok(xpVed(age) <= fuld * (1 + 1e-9), `en ${age}-aarig maa ikke tjene mere end en 26-aarig`);
    assert.ok(xpVed(age) >= fuld * 0.95, `en ${age}-aarig skal tjene ca. det samme som en 26-aarig`);
  }
});

test("R5 gradvist aldersfald: fuld til 26, mindre for hvert aar fra 27, naesten intet fra 31, aldrig nul", () => {
  const xpVed = (age) => tick({ ...UNG_KLATRER, age }, HAARD_KLATRING).xp.climbing;
  const fuld = xpVed(26);
  let forrige = fuld;
  for (const age of [27, 28, 29, 30, 31]) {
    const nu = xpVed(age);
    assert.ok(nu < forrige, `XP skal falde fra ${age - 1} til ${age} (intet brat stop, intet plateau)`);
    assert.ok(nu > 0, `XP maa aldrig vaere nul (${age} aar)`);
    forrige = nu;
  }
  assert.ok(xpVed(27) >= fuld * 0.5, "faldet er gradvist: en 27-aarig er ikke stoppet");
  assert.ok(xpVed(31) <= fuld * 0.15, "naesten intet fra 31");
  for (const age of [32, 34, 37]) assert.ok(xpVed(age) > 0 && xpVed(age) <= xpVed(31), `${age} aar`);
});

test("R6 mentale evner: samme prisliste, og de vokser laengere end de fysiske", () => {
  // Loebslaere traener baade en fysisk-teknisk og mentale evner i samme pas.
  const andel = (age, evne) => tick({ ...VETERAN, age }, LOEBSLAERE).xp[evne] / tick({ ...VETERAN, age: 24 }, LOEBSLAERE).xp[evne];
  for (const age of [27, 28, 29, 30, 31, 33]) {
    assert.ok(andel(age, "tactics") >= andel(age, "positioning") - 1e-9, `${age} aar: mental maa ikke faa mindre end fysisk`);
  }
  assert.ok(andel(29, "tactics") > andel(29, "positioning"), "som 29-aarig vokser de mentale evner stadig mere end de fysiske");
  // Samme prisliste: en mental og en fysisk evne paa samme niveau koster det samme.
  const ud = tick({ ...VETERAN, abilities: evner(60) }, LOEBSLAERE, { progress: { tactics: 0.5, positioning: 0.5 } });
  for (const evne of ["tactics", "positioning"]) {
    const facit = koebMedPrisliste({ level: 60, bar: 0.5, xp: ud.xp[evne] }, pris);
    assert.equal(ud.gains[evne] ?? 0, facit.point, evne);
  }
});

test("R7 fokus: en evne faar mest, naar den er i passets fokus, og lidt, naar den ikke er", () => {
  const iFokus = tick(UNG_KLATRER, HAARD_KLATRING).xp.climbing;
  const udenFor = tick(UNG_KLATRER, { focus: "sprint", intensity: "hard" }).xp.climbing;
  assert.ok(udenFor > 0, "lidt i resten: en evne uden for fokus faar stadig XP");
  assert.ok(iFokus > udenFor * 2, "mest i fokus");
});

test("R8 type: alt kan traenes, og evner uden for typen faar mindre (signatur mest, svaghed mindst)", () => {
  // Klatrer med puncheur som anden type. I et spurt-pas er alle fem evner uden for fokus,
  // saa kun typen skiller dem: signatur, sekundaer, haandvaerk, anden rolle, svaghed.
  const xp = tick(UNG_KLATRER, NORMAL_SPURT).xp;
  const raekke = ["climbing", "positioning", "tactics", "flat", "time_trial"].map((evne) => xp[evne]);
  for (let i = 1; i < raekke.length; i++) assert.ok(raekke[i] <= raekke[i - 1] + 1e-9, `klasse ${i} maa ikke faa mere end klassen over`);
  assert.ok(raekke[0] > raekke[4], "signaturen faar mere end svagheden");
  assert.ok(raekke[4] > 0, "ogsaa en svaghed kan traenes");
});

test("R8 type: typen er anlaeg og foelger ikke med ved omskoling", () => {
  // En klatrer, der er traenet om til sprinter, tjener stadig XP som klatrer.
  const foer = tick(UNG_KLATRER, NORMAL_SPURT).xp;
  const omskolet = tick({ ...UNG_KLATRER, abilities: evner(40, { sprint: 88, acceleration: 86, climbing: 30 }) }, NORMAL_SPURT).xp;
  for (const evne of ["sprint", "acceleration", "climbing"]) assert.ok(taet(foer[evne], omskolet[evne]), evne);
});

test("R12 aldrig nul: en gammel rytter med lavt potentiale og en evne i toppen faar stadig XP af en traeningsdag", () => {
  const gammel = { ...VETERAN, age: 36, potentiale: 1, abilities: evner(70, { endurance: 97 }) };
  const ud = tick(gammel, LET_UDHOLDENHED, { progress: { endurance: 0.1 } });
  assert.ok(ud.xp.endurance > 0, "XP i fokus-evnen");
  assert.ok(ud.progress.endurance > 0.1, "bjaelken flytter sig");
  assert.ok(Object.values(ud.xp).every((x) => x > 0));
});

test("R12 hviledag: ingen XP paa en hviledag", () => {
  assert.deepEqual(tick(UNG_KLATRER, HVILE).xp, {});
});

test("R13 form og traethed: dagsformen aendrer ikke udviklingen", () => {
  const frisk = tick(SPRINTER, NORMAL_SPURT, { conditionMult: 1.3, progress: { sprint: 0.9 } });
  const traet = tick(SPRINTER, NORMAL_SPURT, { conditionMult: 0.55, progress: { sprint: 0.9 } });
  assert.deepEqual(traet.xp, frisk.xp);
  assert.deepEqual(traet.gains, frisk.gains);
  assert.deepEqual(traet.progress, frisk.progress);
});

test("R14 Traen nu: bonussen er 15 % mere XP i hver evne paa en traeningsdag", () => {
  const uden = tick(SPRINTER, NORMAL_SPURT).xp;
  const med = tick(SPRINTER, NORMAL_SPURT, { trainNowBonus: true }).xp;
  for (const evne of Object.keys(uden)) assert.ok(taet(med[evne], uden[evne] * 1.15, 1e-9), evne);
  assert.deepEqual(tick(SPRINTER, HVILE, { trainNowBonus: true }).xp, {}, "ingen bonus paa en hviledag");
});
