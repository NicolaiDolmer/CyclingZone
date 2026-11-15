// DOMMER #6110: DE PRIVATE PARAMETRE mod ejerens regler (R5, R6, R11 og R16).
//   R5  Gradvist aldersfald fra 27: fuld til 26, mindre hvert aar, naesten intet fra 31 (ejer 12/11);
//       "naesten intet" er ca. en fjerdedel af fuld udvikling ved 31 (ejer 14/11).
//   R6  Mentale evner vokser laengere end fysiske (ejer 6/11).
//   R11 Daglig variation ca. 50-150 %, ingen hukommelse/saeson-perioder (ejer 12/11).
//   R16 Design uden store spring: en evne stiger normalt hoejst 1 point pr. dato, sjaeldent 2
//       (ungt toptalent, fokus, meget lav evne), aldrig 3 eller mere. Loeses i prisliste og
//       XP pr. dag, ikke med et loft (ejer 12/11). Lave evner goeres dyrere med en fast
//       prisbund (ejervalg A 14/11). Gaelder ogsaa loebsdage, ogsaa enkeltstart, hvor
//       loebsdags-gulvet (R15b) laegger hele loeftet i etapens faa evner.
//
// Proeven laeser de parametre, der skal taendes med. De er private (hard rule 17) og
// ligger ikke i repoet, saa proeven springes over, hvor filen ikke findes (fx i CI).
// Fil: miljoevariablen CZ_XP_PARAMS_FIL, ellers balance-internals/6110/xp-params.mjs.
// Filen skal eksportere XP_PRIVATE.xp (mjs) eller have feltet "xp" (json).
//
// Graenserne nedenfor er ejerens ord gjort til tal af dommeren. Hvor ejeren ikke har
// sagt et tal ("naesten intet", "meget lav evne", "ungt toptalent"), staar dommerens
// laesning som en navngiven konstant, og den er meldt til ejeren som et spoergsmaal.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { kraev, koebMedPrisliste, STAERK_TRAENER, BEDSTE_FACILITET } from "./dommer6110.fixtures.mjs";
import { traeningsdatoBrud, bundUdenforLavtOmraade, ALDRE, POTENTIALER } from "./dommer6110.r16traening.mjs";
import { aldersforloebBrud } from "./dommer6110.r5aldersforloeb.mjs";

const HER = path.dirname(fileURLToPath(import.meta.url));
const FIL = process.env.CZ_XP_PARAMS_FIL
  ? path.resolve(process.env.CZ_XP_PARAMS_FIL)
  : path.resolve(HER, "../../balance-internals/6110/xp-params.mjs");

// Dommerens laesning af ejerens ord (se toppen).
// R5's "naesten intet" (ca. en fjerdedel), "ca." og "jaevnt fald" staar i dommer6110.r5aldersforloeb.mjs.
// R6: mentale evner har intet eget loft (ejer 6/11: "samme prisliste, intet saerskilt loft";
// 13/11: "nogle aar laengere" end de fysiske, uden et tal), saa proeven saetter ingen oevre graense.
const UNGT_TOPTALENT = { maxAlder: 22, minPotentiale: 5 };
const MEGET_LAV_EVNE = 30;
const TRAEN_NU = 1.15; // ejer 7/11
// Oevre graense for "lave evner", som prisbunden maa goere dyrere (ejervalg A 14/11: "kun
// lave evner dyrere, top og midte er uroert"). EJEREN SKAL BEKRAEFTE TALLET: det er
// dommerens laesning, sat til samme vaerdi som "meget lav evne" ovenfor. Det er IKKE en
// regel i motoren (validPriceFloor), kun i dommerens proeve. Fable-dom 15/11 maalte, at
// motoren foerst er fri for +3 ved en graense et stykke over denne; ejeren vaelger mellem
// en hoejere graense og en anden loesning (fx en hoejere bund-pris).
const LAV_EVNE_GRAENSE = 40; // ejervalg 15/11 (#6110): graensen for lave evner

async function laesParametre() {
  if (!existsSync(FIL)) return null;
  const hele = FIL.endsWith(".json")
    ? JSON.parse(readFileSync(FIL, "utf8"))
    : (await import(pathToFileURL(FIL).href)).XP_PRIVATE;
  const raa = hele?.xp;
  const { validateDevelopmentXpParams } = await kraev("./developmentXp.ts", "validateDevelopmentXpParams");
  // Loebsdagens rolletillaeg og roller, som proevekoerslen bruger (valgfrie i filen).
  return { raa, params: validateDevelopmentXpParams(raa), rolleTillaeg: hele?.sim?.raceRoleYield ?? null, roller: hele?.sim?.raceRoles ?? null };
}

const laest = await laesParametre();
const spring = laest ? false : `de private parametre findes ikke her (${path.basename(FIL)})`;

test("private parametre: filen er gyldig for motoren", { skip: spring }, () => {
  assert.ok(laest.params, "motoren afviser de private parametre");
});

test("R5 private parametre: fuld udvikling til og med 26, mindre for hvert aar fra 27, naesten intet fra 31", { skip: spring }, async () => {
  const { xpAgeShare } = await kraev("./developmentXp.ts", "xpAgeShare");
  // Et jaevnt fald hvert aar fra 27 til 31 (fund 5); reglen staar i dommer6110.r5aldersforloeb.mjs.
  const fejl = aldersforloebBrud((alder) => xpAgeShare(alder, laest.params));
  assert.deepEqual(fejl, [], fejl.join("; "));
});

test("R6 private parametre: mentale evner vokser laengere end fysiske", { skip: spring }, async () => {
  const { xpAgeShare } = await kraev("./developmentXp.ts", "xpAgeShare");
  let laengere = false;
  for (let alder = 16; alder <= 40; alder++) {
    const fysisk = xpAgeShare(alder, laest.params);
    const mental = xpAgeShare(alder, laest.params, { mental: true });
    assert.ok(mental >= fysisk, `${alder} aar: mental ${mental} < fysisk ${fysisk}`);
    if (mental > fysisk) laengere = true;
  }
  assert.ok(laengere, "ved mindst én alder skal de mentale evner vokse mere end de fysiske");
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
test("R16 private parametre: aldrig 3 point eller mere paa én dato, heller ikke paa rytterens bedste dag", { skip: spring }, async () => {
  const { xpPriceForNextPoint } = await kraev("./developmentXp.ts", "xpPriceForNextPoint");
  const { TRAIN_NOW_BONUS_FACTOR } = await kraev("./trainNowBonus7737.ts", "TRAIN_NOW_BONUS_FACTOR");
  assert.equal(TRAIN_NOW_BONUS_FACTOR, TRAEN_NU, "Traen nu-bonussen er ejerens 1,15 (7/11)");
  const godDag = 1 + (laest.raa?.variation?.span ?? 0.5);
  // Én hel dato, hvert pas i begge kataloger, bedste traener og facilitet, Traen nu, god dag.
  const brud = await traeningsdatoBrud({
    params: laest.params, pris: (niveau) => xpPriceForNextPoint(niveau, laest.params),
    staff: STAERK_TRAENER, facilityTier: BEDSTE_FACILITET, dagMult: TRAEN_NU * godDag, bar: 0.999,
    aldre: ALDRE, potentialer: POTENTIALER, graense: () => 2,
  });
  assert.equal(brud.length, 0, `${brud.length} tilfaelde med +3 eller mere paa én dato, fx ${brud.slice(0, 3).map((b) => b.tekst).join("; ")}`);
});

test("R16 private parametre: normalt hoejst 1 point pr. dato; 2 kun for et ungt toptalent i fokus paa en meget lav evne", { skip: spring }, async () => {
  const { xpPriceForNextPoint } = await kraev("./developmentXp.ts", "xpPriceForNextPoint");
  // En normal dato: hvert pas i begge kataloger, ingen traener, ingen bonus, almindelig dag, tom bjaelke.
  const brud = await traeningsdatoBrud({
    params: laest.params, pris: (niveau) => xpPriceForNextPoint(niveau, laest.params),
    aldre: ALDRE, potentialer: POTENTIALER,
    graense: (alder, potentiale, niveau) => (
      alder <= UNGT_TOPTALENT.maxAlder && potentiale >= UNGT_TOPTALENT.minPotentiale && niveau < MEGET_LAV_EVNE ? 2 : 1),
  });
  assert.equal(brud.length, 0, `${brud.length} tilfaelde over graensen paa en normal dato, fx ${brud.slice(0, 3).map((b) => b.tekst).join("; ")}`);
});

test("R16 private parametre: prisbunden goer kun lave evner dyrere; top og midte er formlens egen", { skip: spring }, async () => {
  const { xpPriceForNextPoint } = await kraev("./developmentXp.ts", "xpPriceForNextPoint");
  const fejl = bundUdenforLavtOmraade(laest.params, LAV_EVNE_GRAENSE, { xpPriceForNextPoint });
  assert.deepEqual(fejl, [], fejl.join("; "));
});

// ── R16 paa loebsdage (ejer 14/11): samme regel, ogsaa naar loebsdags-gulvet loefter ──
// En loebsdato regnes som motoren: hver af datoens loebsdage giver XP efter
// developmentXpAbilityDelta (med gulvet mod en haard dag), R15b loefter en etape, der
// passer rytteren, og den gode dag ganges paa. Datoens XP koeber point fra en naesten
// fuld bjaelke. Graensetilfaeldet: alle datoens loebsdage paa samme profil, bedste
// traener og facilitet, hoejeste intention og hver rolle. XP stiger med potentialet og
// er fuld til 26 (R5), saa det hoejeste potentiale i fuld alder daekker resten.
async function loebsdatoBrud({ profiler }) {
  const { developmentXpAbilityDelta, xpPriceForNextPoint } = await kraev("./developmentXp.ts", "developmentXpAbilityDelta", "xpPriceForNextPoint");
  const { developmentXpRaceFitFloor, XP_RACE_FIT_HOME_STAGES } = await kraev("./developmentXpRaceFit.ts", "developmentXpRaceFitFloor", "XP_RACE_FIT_HOME_STAGES");
  const { withRaceDayRoleYieldXp } = await kraev("./developmentXpFlag.ts", "withRaceDayRoleYieldXp");
  const { raceDayProgram } = await kraev("./raceDayYield.js", "raceDayProgram");
  const { TRAINING_RACE_DAY_CONFIG, raceDayBudgetDivisor } = await kraev("./trainingRaceDayTick.js", "TRAINING_RACE_DAY_CONFIG", "raceDayBudgetDivisor");
  const { effortDevelopmentMultiplier, VALID_RACE_ROLES } = await kraev("./raceRoles.js", "effortDevelopmentMultiplier", "VALID_RACE_ROLES");
  const { TRAINING_CONFIG } = await kraev("./training.js", "TRAINING_CONFIG");
  const { EVNER } = await import("./dommer6110.fixtures.mjs");

  const params = laest.params;
  const pris = (niveau) => xpPriceForNextPoint(niveau, params);
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
          for (const ability of EVNER) {
            const xp = (loeftet[ability] ?? 0) * godDag * loebsdage;
            if (!(xp > 0)) continue;
            for (let niveau = 1; niveau <= 96; niveau++) {
              const { point } = koebMedPrisliste({ level: niveau, bar: 0.999, xp }, pris);
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
