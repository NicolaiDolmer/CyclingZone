// DOMMER #6110: DE PRIVATE PARAMETRE mod ejerens regler (R5, R6, R11 og R16).
//   R5  Ejervalg 19/11 (kandidat B): XP er ens hele livet. Kroppen (fysiske evner + brosten)
//       aeldes ved saesonskiftet fra 29 aar, og trappen er dagens flyttet 2 aar frem, bremset af
//       loeb og haarde traeningsdage som i dag. Afloeser "fuld til 26, mindre hvert aar fra 27,
//       ca. en fjerdedel ved 31" (ejer 12/11 og 14/11).
//   R6  Ejervalg 19/11: mentale evner faar samme XP som fysiske, og teknik, taktik og de andre
//       mentale evner falder en smule sent i karrieren. Afloeser "vokser laengere" (ejer 6/11).
//   R11 Daglig variation ca. 50-150 %, ingen hukommelse/saeson-perioder (ejer 12/11).
//   R16 Design uden store spring: en evne stiger normalt hoejst 1 point pr. dato, sjaeldent 2,
//       aldrig 3 eller mere (ejer 12/11). Ejervalg 16/11: reglen holdes af motoren selv,
//       hoejst +2 pr. evne pr. dato, resten venter paa bjaelken; ingen prisbund. Erstatter
//       "loeses i prisliste, ikke med et loft" (12/11) og prisbunden (valg A 14/11). Gaelder
//       ogsaa loebsdage og enkeltstart, hvor loebsdags-gulvet (R15b) laegger hele loeftet i
//       etapens faa evner. Proeverne koeber derfor datoen GENNEM MOTORENS TICK.
//       Ejervalg 19/11: +2 gaelder et toptalent (5-6 stjerner) paa en meget lav evne UANSET
//       alder; alle andre hoejst +1. Afloeser "ungt toptalent" (ejervalg A 16/11).
//
// Proeven laeser de parametre, der skal taendes med. De er private (hard rule 17) og
// ligger ikke i repoet, saa proeven springes over, hvor filen ikke findes (fx i CI).
// Fil: miljoevariablen CZ_XP_PARAMS_FIL, ellers balance-internals/6110/xp-params.mjs.
// Filen skal eksportere XP_PRIVATE.xp (mjs) eller have feltet "xp" (json).
//
// Graenserne nedenfor er ejerens ord gjort til tal af dommeren. Hvor ejeren ikke har
// sagt et tal ("langt hen i karrieren", "lille sent fald", "meget lav evne"), staar dommerens
// laesning som en navngiven konstant, og den er meldt til ejeren som et spoergsmaal.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { kraev, STAERK_TRAENER, BEDSTE_FACILITET } from "./dommer6110.fixtures.mjs";
import { traeningsdatoBrud, motorensDatoKoeb, ALDRE, POTENTIALER } from "./dommer6110.r16traening.mjs";
import {
  xpAlderBrud, aldringstrappeBrud, sentFaldBrud, koerSkifte, kohorte, fald, stoersteFald,
  KROP, TEKNIK_MENTAL, FOERSTE_FALD, START_S6_DANSK_DATO,
} from "./dommer6110.r5aldersforloeb.mjs";

const HER = path.dirname(fileURLToPath(import.meta.url));
const FIL = process.env.CZ_XP_PARAMS_FIL
  ? path.resolve(process.env.CZ_XP_PARAMS_FIL)
  : path.resolve(HER, "../../balance-internals/6110/xp-params.mjs");

// Dommerens laesning af ejerens ord (se toppen).
// R5 og R6: "langt hen i karrieren", "sent" og "lille" staar i dommer6110.r5aldersforloeb.mjs.
// R16 "sjaeldent 2": +2 paa én dato kun for et toptalent paa en meget lav evne, uanset alder;
// alle andre hoejst +1 (ejervalg A 16/11 og ejervalg 19/11). Toptalent er ejerens ord: 5-6
// stjerner. Hvad "meget lav" er i tal, er et balancetal (hard rule 17): dommerens laesning
// staar i talfilen (dommer.plus2.megetLavEvne), aldrig her. Motorens egen graense
// (xp.datePlus2.belowLevel) maa ikke vaere loesere end dommerens laesning.
const TRAEN_NU = 1.15; // ejer 7/11
const TOPTALENT = 5; // ejer 19/11: "5-6-stjernede"
const NAESTE_UNDER_TOPTALENT = 4.5; // stjernerne gaar i halve trin; 4,5 er ikke et toptalent

async function laesParametre() {
  if (!existsSync(FIL)) return null;
  const hele = FIL.endsWith(".json")
    ? JSON.parse(readFileSync(FIL, "utf8"))
    : (await import(pathToFileURL(FIL).href)).XP_PRIVATE;
  const raa = hele?.xp;
  const { validateDevelopmentXpParams } = await kraev("./developmentXp.ts", "validateDevelopmentXpParams");
  // Loebsdagens rolletillaeg og roller, som proevekoerslen bruger (valgfrie i filen).
  return {
    raa, params: validateDevelopmentXpParams(raa), rolleTillaeg: hele?.sim?.raceRoleYield ?? null, roller: hele?.sim?.raceRoles ?? null,
    plus2: hele?.dommer?.plus2 ?? null,
    // Ejerens praecise aldersgraenser (18-19/11) staar kun i talfilen (hard rule 17).
    alder: hele?.dommer?.alder ?? null,
  };
}

const laest = await laesParametre();
const spring = laest ? false : `de private parametre findes ikke her (${path.basename(FIL)})`;

test("private parametre: filen er gyldig for motoren", { skip: spring }, () => {
  assert.ok(laest.params, "motoren afviser de private parametre");
});

test("R5 og R6 private parametre: XP er ens hele livet, og ens for fysiske og mentale evner (ejervalg 19/11)", { skip: spring }, async () => {
  const { xpAgeShare } = await kraev("./developmentXp.ts", "xpAgeShare");
  // Reglen staar i dommer6110.r5aldersforloeb.mjs: samme XP til langt hen i karrieren, aldrig en turbo.
  assert.ok(laest.alder, "talfilen mangler dommer.alder (ejerens praecise aldersgraenser)");
  const fejl = xpAlderBrud(
    (alder) => xpAgeShare(alder, laest.params),
    (alder) => xpAgeShare(alder, laest.params, { mental: true }),
    laest.alder,
  );
  assert.deepEqual(fejl, [], fejl.join("; "));
});

/** Saesonskiftets aldring under XP, laest af motoren fra talfilen. */
async function privatAldring() {
  const { xpAgingConfig, agingV2BaseDrop, agingBrake } = await kraev("./riderProgression.js", "xpAgingConfig", "agingV2BaseDrop", "agingBrake");
  const cfg = xpAgingConfig(laest.params);
  assert.ok(cfg, "talfilen har ingen aldring (xp.aging): saesonskiftet ville aelde efter dagens regel, ikke fra 29 (ejervalg 19/11)");
  return { cfg, agingV2BaseDrop, agingBrake };
}

test("R5 private parametre: kroppens aldring begynder fra 29, og trappen er dagens flyttet 2 aar frem", { skip: spring }, async () => {
  const { cfg, agingV2BaseDrop, agingBrake } = await privatAldring();
  const fejl = aldringstrappeBrud((alder) => agingV2BaseDrop(alder, cfg), (alder) => agingV2BaseDrop(alder));
  assert.deepEqual(fejl, [], fejl.join("; "));
  // Loeb og haarde traeningsdage bremser som i dag.
  for (const load of [null, { raceDays: 30, hardDays: 0 }, { raceDays: 60, hardDays: 40 }, { raceDays: 0, hardDays: 90 }, { raceDays: 120, hardDays: 0 }]) {
    assert.equal(agingBrake(load, cfg), agingBrake(load), `bremsen ved ${JSON.stringify(load)} skal vaere dagens`);
  }
});

// Talfilen koert gennem motorens saesonskifte (falsk database, kontakten taendt for skiftets dato).
async function privatSkifte(ryttere) {
  const flag = await kraev("./developmentXpFlag.ts", "DEVELOPMENT_XP_FLAG_KEY", "DEVELOPMENT_XP_FROM_DATE_KEY", "DEVELOPMENT_XP_PARAMS_KEY");
  return koerSkifte({
    ryttere,
    app: { [flag.DEVELOPMENT_XP_FLAG_KEY]: "on", [flag.DEVELOPMENT_XP_FROM_DATE_KEY]: START_S6_DANSK_DATO },
    privat: { [flag.DEVELOPMENT_XP_PARAMS_KEY]: laest.raa },
  });
}

test("R5 private parametre gennem saesonskiftet: ingen under 29 mister noget, 29-aarige uden loeb mister fysiske point", { skip: spring }, async () => {
  const unge = [22, 25, 27, 28].flatMap((alder) => kohorte({ alder, navn: "privat" }));
  const foerste = kohorte({ alder: FOERSTE_FALD, navn: "privat" });
  const { efter } = await privatSkifte([...unge, ...foerste]);
  for (const r of unge) {
    assert.equal(fald(r, efter, KROP), 0, `${r.id}: en ${r.alder}-aarig maa ikke miste fysiske point`);
    assert.equal(fald(r, efter, TEKNIK_MENTAL), 0, `${r.id}: en ${r.alder}-aarig maa ikke miste teknik eller mentale point`);
  }
  for (const r of foerste) assert.ok(fald(r, efter, KROP) >= 1, `${r.id}: en 29-aarig uden loeb skal miste fysiske point`);
});

test("R6 private parametre gennem saesonskiftet: teknik og mentale evner falder en smule, sent, og bremses af loeb", { skip: spring }, async () => {
  const { cfg, agingV2BaseDrop } = await privatAldring();
  const ANTAL = 240;
  // Faldet pr. evne pr. saeson uden loeb, maalt paa en kohorte i hver alder.
  const maalt = new Map();
  for (let alder = 16; alder <= 45; alder++) {
    const ryttere = kohorte({ alder, antal: ANTAL, navn: "privat-sent" });
    const { efter } = await privatSkifte(ryttere);
    const iAlt = ryttere.reduce((a, r) => a + fald(r, efter, TEKNIK_MENTAL), 0);
    maalt.set(alder, iAlt / (ANTAL * TEKNIK_MENTAL.length));
    for (const r of ryttere) assert.ok(stoersteFald(r, efter, TEKNIK_MENTAL) <= 1, `${r.id}: hoejst ét point i en evne pr. saeson (en smule)`);
  }
  // Reglen staar i dommer6110.r5aldersforloeb.mjs: sent (tidligst efter kroppens foerste trin) og lille.
  const fejl = sentFaldBrud((alder) => maalt.get(alder), (alder) => agingV2BaseDrop(alder, cfg), laest.alder?.sentFra);
  assert.deepEqual(fejl, [], fejl.join("; "));
  // Bremset af loeb som de fysiske: en fuld saeson stopper faldet, en halv tager en del af det.
  const sent = [...maalt.entries()].find(([, v]) => v > 0)[0];
  const koer = async (belastning) => {
    const ryttere = kohorte({ alder: sent + 1, antal: ANTAL, belastning, navn: "privat-bremse" });
    const { efter } = await privatSkifte(ryttere);
    const iAlt = (gruppe) => ryttere.reduce((a, r) => a + fald(r, efter, gruppe), 0);
    return { sent: iAlt(TEKNIK_MENTAL), krop: iAlt(KROP) };
  };
  const ingen = await koer(null);
  const halv = await koer({ raceDays: 60, hardDays: 0 });
  const fuld = await koer({ raceDays: 120, hardDays: 0 });
  assert.equal(fuld.sent, 0, "en fuld saeson med loeb stopper det sene fald");
  assert.ok(halv.sent < ingen.sent, "loeb bremser det sene fald");
  assert.ok(Math.abs(halv.sent / ingen.sent - halv.krop / ingen.krop) <= 0.1, "samme bremse som de fysiske evner");
});

test("R11 private parametre: daglig variation ca. 50-150 % uden hukommelse", { skip: spring }, () => {
  const v = laest.raa?.variation;
  assert.ok(v && typeof v === "object", "IKKE BYGGET: de private parametre har ingen daglig variation");
  assert.ok(Math.abs(v.span - 0.5) <= 0.05, `udsvinget skal vaere ca. 50 % til hver side (var ${v.span})`);
  assert.equal(v.memory, 0, "ingen hukommelse: ingen saeson-perioder");
  assert.ok(laest.params?.variation, "IKKE BYGGET: motoren laeser ikke variationen fra parametrene");
});

// R16 paa traeningsdage regnes GENNEM MOTOREN (Fable-dom 15/11, fund 1): datoens XP er
// motorens developmentXpAbilityDelta over alle traeningspas i begge kataloger, saa
// sessionens vaegt (op til 2 i dag, 1,5 i v3) er med. Se dommer6110.r16traening.mjs.
test("R16 private parametre: aldrig 3 point eller mere paa én dato gennem motoren, heller ikke paa rytterens bedste dag", { skip: spring }, async () => {
  const { xpPriceForNextPoint } = await kraev("./developmentXp.ts", "xpPriceForNextPoint");
  const { TRAIN_NOW_BONUS_FACTOR } = await kraev("./trainNowBonus7737.ts", "TRAIN_NOW_BONUS_FACTOR");
  assert.equal(TRAIN_NOW_BONUS_FACTOR, TRAEN_NU, "Traen nu-bonussen er ejerens 1,15 (7/11)");
  const godDag = 1 + (laest.raa?.variation?.span ?? 0.5);
  // Én hel dato, hvert pas i begge kataloger, bedste traener og facilitet, Traen nu, god dag.
  const brud = await traeningsdatoBrud({
    params: laest.params, pris: (niveau) => xpPriceForNextPoint(niveau, laest.params),
    staff: STAERK_TRAENER, facilityTier: BEDSTE_FACILITET, dagMult: TRAEN_NU * godDag, bar: 0.999,
    aldre: ALDRE, potentialer: POTENTIALER, graense: () => 2, koeb: await motorensDatoKoeb(laest.params),
  });
  assert.equal(brud.length, 0, `${brud.length} tilfaelde med +3 eller mere paa én dato, fx ${brud.slice(0, 3).map((b) => b.tekst).join("; ")}`);
});

/** "Toptalent paa en meget lav evne" (ejer 19/11: 5-6 stjerner, uanset alder); "meget lav" fra talfilen (dommer.plus2). */
function toptalentPaaMegetLavEvne() {
  const p = laest.plus2;
  assert.ok(p && Number.isFinite(p.megetLavEvne),
    "talfilen mangler dommerens laesning af 'meget lav evne' (dommer.plus2.megetLavEvne)");
  return (_alder, potentiale, niveau) => potentiale >= TOPTALENT && niveau < p.megetLavEvne;
}

test("R16 private parametre (ejervalg 19/11): motorens graenser for +2 er uden alder, gaelder 5-6 stjerner og er ikke loesere end dommerens laesning", { skip: spring }, () => {
  toptalentPaaMegetLavEvne();
  const p = laest.plus2;
  const m = laest.params.datePlus2;
  assert.ok(m, "talfilen har ingen xp.datePlus2: motoren giver da ingen +2; ejervalget kraever graenserne");
  assert.equal(m.maxAge, undefined, "talfilen har stadig en aldersgraense for +2; ejervalg 19/11: uanset alder");
  assert.ok(m.minPotential <= TOPTALENT, "en 5-stjernet er et toptalent (ejer 19/11: 5-6 stjerner)");
  assert.ok(m.minPotential > NAESTE_UNDER_TOPTALENT, "motoren kalder lavere potentialer end 5 stjerner toptalenter");
  assert.ok(m.belowLevel <= p.megetLavEvne, "motoren kalder hoejere evner meget lave end dommeren");
});

test("R16 private parametre (ejervalg 19/11): et toptalent paa en meget lav evne faar +2 i ALLE aldre, alle andre hoejst +1", { skip: spring }, async () => {
  const { xpPriceForNextPoint } = await kraev("./developmentXp.ts", "xpPriceForNextPoint");
  const koeb = await motorensDatoKoeb(laest.params);
  const megetLav = laest.params.datePlus2?.belowLevel;
  assert.ok(Number.isFinite(megetLav) && megetLav > 3, "talfilen skal saette graensen for en meget lav evne");
  // XP nok til mange point, saa kun datoreglen bremser.
  const rigeligt = (niveau) => 10 * xpPriceForNextPoint(niveau + 9, laest.params);
  for (const alder of ALDRE) {
    for (const niveau of [1, 2, 3]) {
      for (const potentiale of [TOPTALENT, 5.5, 6]) {
        assert.equal(koeb({ level: niveau, xp: rigeligt(niveau), alder, potentiale }).point, 2, `${potentiale} stjerner, ${alder} aar, evne ${niveau}: +2 uanset alder`);
      }
      for (const potentiale of [NAESTE_UNDER_TOPTALENT, 3, 1]) {
        assert.equal(koeb({ level: niveau, xp: rigeligt(niveau), alder, potentiale }).point, 1, `${potentiale} stjerner, ${alder} aar, evne ${niveau}: hoejst +1`);
      }
    }
    for (const niveau of [megetLav, megetLav + 15, 70]) {
      assert.equal(koeb({ level: niveau, xp: rigeligt(niveau), alder, potentiale: 6 }).point, 1, `6 stjerner, ${alder} aar, evne ${niveau} (ikke meget lav): hoejst +1`);
    }
  }
});

test("R16 private parametre: en normal dato giver hoejst 1; +2 kun for et toptalent paa en meget lav evne, uanset alder", { skip: spring }, async () => {
  const { xpPriceForNextPoint } = await kraev("./developmentXp.ts", "xpPriceForNextPoint");
  const toptalent = toptalentPaaMegetLavEvne();
  // En normal dato: hvert pas i begge kataloger, ingen traener, ingen bonus, almindelig dag, tom bjaelke.
  // Datoen koebes gennem motorens tick med rytterens alder og potentiale (motorensDatoKoeb).
  const brud = await traeningsdatoBrud({
    params: laest.params, pris: (niveau) => xpPriceForNextPoint(niveau, laest.params),
    aldre: ALDRE, potentialer: POTENTIALER, koeb: await motorensDatoKoeb(laest.params),
    graense: (alder, potentiale, niveau) => (toptalent(alder, potentiale, niveau) ? 2 : 1),
  });
  assert.equal(brud.length, 0, `${brud.length} tilfaelde over graensen paa en normal dato, fx ${brud.slice(0, 3).map((b) => b.tekst).join("; ")}`);
});

test("R16 private parametre: heller ikke paa rytterens bedste dag faar andre end et toptalent paa en meget lav evne +2", { skip: spring }, async () => {
  const { xpPriceForNextPoint } = await kraev("./developmentXp.ts", "xpPriceForNextPoint");
  const toptalent = toptalentPaaMegetLavEvne();
  const godDag = 1 + (laest.raa?.variation?.span ?? 0.5);
  const brud = await traeningsdatoBrud({
    params: laest.params, pris: (niveau) => xpPriceForNextPoint(niveau, laest.params),
    staff: STAERK_TRAENER, facilityTier: BEDSTE_FACILITET, dagMult: TRAEN_NU * godDag, bar: 0.999,
    aldre: ALDRE, potentialer: POTENTIALER, koeb: await motorensDatoKoeb(laest.params),
    graense: (alder, potentiale, niveau) => (toptalent(alder, potentiale, niveau) ? 2 : 1),
  });
  assert.equal(brud.length, 0, `${brud.length} tilfaelde, fx ${brud.slice(0, 3).map((b) => b.tekst).join("; ")}`);
});

test("R16 private parametre: ingen prisbund (ejervalg 16/11)", { skip: spring }, () => {
  assert.equal(laest.raa?.price?.floor, undefined, "talfilen har stadig en prisbund; ejervalg 16/11 fjernede den");
});

// ── R16 paa loebsdage (ejer 14/11): samme regel, ogsaa naar loebsdags-gulvet loefter ──
// En loebsdato regnes som motoren: hver af datoens loebsdage giver XP efter
// developmentXpAbilityDelta (med gulvet mod en haard dag), R15b loefter en etape, der
// passer rytteren, og den gode dag ganges paa. Datoens XP koeber point fra en naesten
// fuld bjaelke, gennem motorens tick for hver af datoens loebsdage. Graensetilfaeldet: alle datoens loebsdage paa samme profil, bedste
// traener og facilitet, hoejeste intention og hver rolle. XP stiger med potentialet og
// er ens hele livet (R5, ejervalg 19/11), saa det hoejeste potentiale daekker resten.
async function loebsdatoBrud({ profiler }) {
  const { developmentXpAbilityDelta, developmentXpTick } = await kraev("./developmentXp.ts", "developmentXpAbilityDelta", "developmentXpTick");
  const { developmentXpRaceFitFloor, XP_RACE_FIT_HOME_STAGES } = await kraev("./developmentXpRaceFit.ts", "developmentXpRaceFitFloor", "XP_RACE_FIT_HOME_STAGES");
  const { withRaceDayRoleYieldXp } = await kraev("./developmentXpFlag.ts", "withRaceDayRoleYieldXp");
  const { raceDayProgram } = await kraev("./raceDayYield.js", "raceDayProgram");
  const { TRAINING_RACE_DAY_CONFIG, raceDayBudgetDivisor } = await kraev("./trainingRaceDayTick.js", "TRAINING_RACE_DAY_CONFIG", "raceDayBudgetDivisor");
  const { effortDevelopmentMultiplier, VALID_RACE_ROLES } = await kraev("./raceRoles.js", "effortDevelopmentMultiplier", "VALID_RACE_ROLES");
  const { TRAINING_CONFIG } = await kraev("./training.js", "TRAINING_CONFIG");
  const { EVNER } = await import("./dommer6110.fixtures.mjs");

  const params = laest.params;
  const godDag = 1 + (laest.raa?.variation?.span ?? 0.5);
  const intention = Math.max(...["grupetto", "save", "normal", "protect", "all_out"].map(effortDevelopmentMultiplier));
  const loebsdage = TRAINING_RACE_DAY_CONFIG.raceDaysPerDate;
  const budgetDivisor = raceDayBudgetDivisor();
  const roller = laest.rolleTillaeg ? (laest.roller?.map((r) => r.role) ?? VALID_RACE_ROLES) : ["free_role"];
  const potentiale = params.potentialXp.at(-1).at;
  const brud = [];
  for (const primaryType of Object.keys(XP_RACE_FIT_HOME_STAGES)) {
    for (const profileType of profiler) {
      for (const role of roller) {
        for (const alder of [19, 24]) {
          const riderLevel = alder <= 22 ? "u23" : "senior";
          const rider = {
            age: alder, potentiale, primaryType, secondaryType: null, staff: STAERK_TRAENER,
            facilityTier: BEDSTE_FACILITET, riderLevel, trainingCfg: TRAINING_CONFIG, budgetDivisor,
          };
          const kald = withRaceDayRoleYieldXp(params, {}, { params: laest.rolleTillaeg, profileType, role, catalogV3: true });
          const program = kald.program ?? raceDayProgram(profileType);
          const tillaeg = kald.abilityYieldMult ?? {};
          const dag = Object.fromEntries(EVNER.map((ability) => [ability, developmentXpAbilityDelta({
            ...rider, ability, program, academyRateMult: intention, yieldMult: tillaeg[ability] > 0 ? tillaeg[ability] : 1,
          }, params)]));
          const loeftet = developmentXpRaceFitFloor({ day: dag, program, fit: kald.xpRaceDayFit, academyRateMult: intention, rider }, params) ?? dag;
          // Datoens loebsdage koebes gennem motorens tick, hver med datoens tidligere gevinster.
          for (let niveau = 1; niveau <= 96; niveau++) {
            let tilstand = { abilities: Object.fromEntries(EVNER.map((a) => [a, niveau])), progress: Object.fromEntries(EVNER.map((a) => [a, 0.999])) };
            const brugt = {};
            for (let dag = 0; dag < loebsdage; dag++) {
              tilstand = developmentXpTick({ ...tilstand, dateUsedGains: { ...brugt }, rider: { age: alder, potentiale }, xpFor: (a) => (loeftet[a] ?? 0) * godDag }, params);
              for (const [a, n] of Object.entries(tilstand.gains)) brugt[a] = (brugt[a] ?? 0) + n;
            }
            for (const [ability, point] of Object.entries(brugt)) {
              if (point >= 3) brud.push(`${primaryType} ${profileType} ${role} alder ${alder} ${ability} evne ${niveau}: +${point}`);
            }
          }
        }
      }
    }
  }
  return brud;
}

test("R16 private parametre: aldrig 3 point eller mere paa én loebsdato", { skip: spring }, async () => {
  const { RACE_PROFILE_ABILITY_MAP } = await kraev("./dailyTraining.js", "RACE_PROFILE_ABILITY_MAP");
  const brud = await loebsdatoBrud({ profiler: Object.keys(RACE_PROFILE_ABILITY_MAP) });
  assert.equal(brud.length, 0, `${brud.length} tilfaelde med +3 eller mere paa en loebsdato, fx ${brud.slice(0, 3).join("; ")}`);
});

test("R16 private parametre: aldrig 3 point eller mere paa en enkeltstart, ogsaa naar gulvet laegger loeftet i faa evner", { skip: spring }, async () => {
  const brud = await loebsdatoBrud({ profiler: ["itt", "itt_hilly", "ttt"] });
  assert.equal(brud.length, 0, `${brud.length} tilfaelde med +3 eller mere paa en enkeltstart, fx ${brud.slice(0, 3).join("; ")}`);
});
