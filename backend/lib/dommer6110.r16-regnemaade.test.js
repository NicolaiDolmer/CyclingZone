// DOMMER #6110 R16: proeven af proeven (Fable-dom 15/11, fund 1). Uden private tal.
//
// R16 (ejer 12/11): aldrig 3 point eller mere i en evne paa én dato. Dommerens private
// R16-proeve for traeningsdage regnede foerst datoens XP uden sessionens vaegt (vaegt 1),
// mens motoren ganger vaegten paa (op til 2). Denne proeve bygger syntetiske parametre,
// hvor den gamle regnemaade siger "hoejst +2", men et pas med vaegt 2 i motoren giver
// +3 eller mere, og beviser, at dommerens nye regnemaade (dommer6110.r16traening.mjs)
// fanger det. Prisbunden og tjekket for den (fund 2) er fjernet med ejervalg 16/11; i stedet
// proeves det, at motorens datoregel (hoejst +2 pr. evne pr. dato) holder de samme tal nede.

import test from "node:test";
import assert from "node:assert/strict";

import { kraev, koebMedPrisliste, STAERK_TRAENER, BEDSTE_FACILITET } from "./dommer6110.fixtures.mjs";
import { traeningsdatoBrud, traeningsPas, motorensDatoKoeb, ALDRE, POTENTIALER } from "./dommer6110.r16traening.mjs";

const TRAEN_NU = 1.15;
const GOD_DAG = 1.5;
const PRIS = 1000;

// Syntetisk model: naesten flad pris (eksponenten er naer nul), fuld XP i alle aldre, og
// lige saa meget XP, at den gamle regnemaade (vaegt 1) koeber hoejst 2 point fra en
// naesten fuld bjaelke: 0,999 + 1,6 point = 2 point. Med vaegt 2 er det 0,999 + 3,2 = 4.
async function syntetisk() {
  const { validateDevelopmentXpParams } = await kraev("./developmentXp.ts", "validateDevelopmentXpParams");
  const { facilityTrainingMultiplier, staffTrainingBonus } = await kraev("./staffTrainingBonus.js", "facilityTrainingMultiplier", "staffTrainingBonus");
  // Den gamle proeves stoerste traenerled (begge niveauer, fysisk og mental signatur-evne).
  const traener = Math.max(...["u23", "senior"].flatMap((riderLevel) => ["climbing", "tactics"].map((ability) =>
    facilityTrainingMultiplier({ facilityTier: BEDSTE_FACILITET, staff: STAERK_TRAENER })
      * staffTrainingBonus({ facilityTier: BEDSTE_FACILITET, staff: STAERK_TRAENER, ability, riderLevel }))));
  const xpPrDato = (1.6 * PRIS) / (traener * TRAEN_NU * GOD_DAG);
  const params = validateDevelopmentXpParams({
    price: { base: PRIS, exponent: 1e-9 },
    potentialXp: [{ at: 1, value: xpPrDato }, { at: 6, value: xpPrDato }],
    ageShare: { physical: [{ at: 16, value: 1 }], mental: [{ at: 16, value: 1 }] },
    offFocusShare: 0.2,
    raceOffFocusShare: 0.2,
    typeShare: { signatur: 1, sekundaer: 0.8, haandvaerk: 0.6, andenRolle: 0.4, svaghed: 0.3 },
  });
  assert.ok(params, "motoren afviser de syntetiske parametre");
  return { params, traener };
}

test("R16-regnemaaden: kataloget har pas med vaegt 2 (i dag) og 1,5 (v3), som proeven skal regne med", async () => {
  const { programAbilityWeight } = await kraev("./training.js", "programAbilityWeight");
  const vaegte = new Map();
  for (const { katalog, program } of await traeningsPas()) {
    for (const evne of program.focusAbilities ?? []) vaegte.set(`${katalog}:${programAbilityWeight(program, evne)}`, true);
  }
  // Ogsaa uden focusAbilities paa programmet (dagens katalog) skal pas med vaegt 2 vaere med.
  const { TRAINING_FOCUSES } = await kraev("./training.js", "TRAINING_FOCUSES");
  for (const { katalog, program } of await traeningsPas()) {
    for (const evne of TRAINING_FOCUSES[program.focus] ?? []) vaegte.set(`${katalog}:${programAbilityWeight(program, evne)}`, true);
  }
  assert.ok(vaegte.has("i dag:2"), "dagens katalog har et pas med vaegt 2");
  assert.ok(vaegte.has("v3:1.5"), "v3-kataloget har et pas med vaegt 1,5");
});

test("R16-regnemaaden: den gamle regnemaade uden vaegt ser hoejst +2 i de syntetiske tal", async () => {
  const { params, traener } = await syntetisk();
  const { xpPerDate, xpPriceForNextPoint } = await kraev("./developmentXp.ts", "xpPerDate", "xpPriceForNextPoint");
  const pris = (niveau) => xpPriceForNextPoint(niveau, params);
  let hoejst = 0;
  for (const mental of [false, true]) {
    for (const alder of ALDRE) {
      for (const potentiale of POTENTIALER) {
        const xp = xpPerDate({ potentiale, age: alder, mental }, params) * traener * TRAEN_NU * GOD_DAG;
        for (let niveau = 1; niveau <= 96; niveau++) hoejst = Math.max(hoejst, koebMedPrisliste({ level: niveau, bar: 0.999, xp }, pris).point);
      }
    }
  }
  assert.equal(hoejst, 2, "den gamle regnemaade skal sige +2 her, ellers beviser proeven nedenfor intet");
});

test("R16-regnemaaden: regnet gennem motoren over alle pas fanger +3 fra et pas med vaegt 2", async () => {
  const { params } = await syntetisk();
  const { xpPriceForNextPoint } = await kraev("./developmentXp.ts", "xpPriceForNextPoint");
  const brud = await traeningsdatoBrud({
    params, pris: (niveau) => xpPriceForNextPoint(niveau, params),
    staff: STAERK_TRAENER, facilityTier: BEDSTE_FACILITET, dagMult: TRAEN_NU * GOD_DAG, bar: 0.999,
    aldre: ALDRE, potentialer: POTENTIALER, graense: () => 2,
  });
  assert.ok(brud.length > 0, "dommerens regnemaade skal fange +3 paa én dato, naar sessionens vaegt er 2");
  assert.ok(brud.some((b) => b.point >= 3 && b.vaegt === 2 && b.katalog === "i dag"),
    `bruddet skal komme fra et pas med vaegt 2 i dagens katalog, fik fx ${brud[0]?.tekst}`);
});

test("R16 datoreglen (ejervalg 16/11): de samme tal koebt gennem motorens tick giver aldrig +3 paa én dato", { skip: "R16 er afloest af G3a (spec 2026-11-20 §3, #8520): ingen graense pr. dato under XP" }, async () => {
  const { params } = await syntetisk();
  const { xpPriceForNextPoint } = await kraev("./developmentXp.ts", "xpPriceForNextPoint");
  const pris = (niveau) => xpPriceForNextPoint(niveau, params);
  const faelles = {
    params, pris, staff: STAERK_TRAENER, facilityTier: BEDSTE_FACILITET, dagMult: TRAEN_NU * GOD_DAG, bar: 0.999,
    aldre: ALDRE, potentialer: POTENTIALER, graense: () => 2,
  };
  assert.ok((await traeningsdatoBrud(faelles)).length > 0, "uden motorens datoregel giver tallene +3");
  const brud = await traeningsdatoBrud({ ...faelles, koeb: await motorensDatoKoeb(params) });
  assert.equal(brud.length, 0, `motoren skal holde datoen paa hoejst +2, fik fx ${brud[0]?.tekst}`);
});
