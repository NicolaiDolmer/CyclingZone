// DOMMER #6110, regel R15b: LOEBSDAGEN, NAAR LOEBET PASSER TIL RYTTEREN.
// Kilde: ejer 13/11 (kommentarerne paa #6110 kl. 12:18, 13:36, 14:08 og 14:10 UTC):
//   "Kun naar loebet passer til rytteren": loebsdagen giver mindst lige saa meget XP i alt som
//   rytterens bedste haarde traeningspas samme dag.
//   "Mulighed 1: alle roller": reglen gaelder alle roller, naar etapen passer rytterens primaere type.
//   "Nej, kun den primaere type": den sekundaere type taeller ikke.
//   "Nej" til loeft, naar rytteren er sat til at koere roligt.
//   "Et gulv paa dagens samlede XP", fordelt paa de evner, etapen traener, kun naar loebet passer.
//   "Uden bonus": sammenligningen er uden Traen nu-bonussen.
// R15 (ejer 7/11) staar ved magt og doemmes stadig i dommer6110.loebsdag.test.js.
//
// Skrevet FOER koden. Maa ikke aendres af byggebanen. Tallene er dommerens EGNE proevetal, ikke
// de private parametre. Reglen skal holde for ALLE gyldige tal (ejeren stemmer de private tal
// senere), saa proeven koerer ogsaa med et saet skaeve tal: reglen kan ikke opfyldes ved at
// stemme et tal af efter dommerens proevetal.
//
// ── Dommerens laesning (se regel-R15b.md) ────────────────────────────────────────────────────
//   Loebet passer  rytterens PRIMAERE type har etapen som hjemmebane (tabellen HJEMMEBANE).
//                Rollen er ligegyldig (ogsaa en ukendt rolle).
//   Koerer roligt  dagens intention er under 1 (`academyRateMult`, som motoren sender den:
//                "koer roligt" og grupetto). Saa er der intet loeft.
//   XP i alt     summen af dagens XP over alle evner (tick'ets `xp`), foer der koebes point.
//   Bedste haarde pas  det pas blandt holdets haarde traeningspas (kataloget, niveau "hard"),
//                der giver rytteren mest XP i alt samme dato, med holdets traener og facilitet,
//                samme dagsudsving og UDEN Traen nu.
//   Gulvet       er loebsdagen under det bedste pas, loeftes den PRAECIS op til det, og loeftet
//                lander kun i de evner, etapen traener (loebsdagens `program.focusAbilities`).
//                Fordelingen mellem dem: se FORDELING. Er loebsdagen ikke under, aendres intet.
//   Decimaltal afrundes foer sammenligning (#8113).
// Aabne spoergsmaal til ejeren (springes over nederst, til ejeren har svaret): S12
// klassementsrytter, udbryder og rouleur; S13 grus, smaakuperet og holdtidskoersel.
//
// ── Det proeven kraever af motoren ───────────────────────────────────────────────────────────
// Loebsdagens ene kald faar holdets katalog med: withRaceDayRoleYieldXp(xp, ekstra,
// { params, profileType, role, catalogV3 }). Det, kaldet giver tilbage, spredes ind i
// applyDailyTick sammen med rytteren (type, traener, facilitet, dagens intention). Hvordan
// motoren baerer etape og katalog videre til tick'et, er byggerens valg.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { applyDailyTick } from "./dailyTraining.js";
import {
  kraev, xpParams, xpParamsMedVariation, evner, lofter, koebMedPrisliste, fingeraftryk,
  DOMMER_XP_RAA, RIGELIG_XP_RAA, UNG_KLATRER, SPRINTER, VETERAN, STAERK_TRAENER, BEDSTE_FACILITET,
} from "./dommer6110.fixtures.mjs";

const { withRaceDayRoleYieldXp } = await kraev("./developmentXpFlag.ts", "withRaceDayRoleYieldXp");
const { validateRaceDayRoleYieldParams, withRaceDayRoleYield, DECISIVE_ABILITY_BY_PROFILE } =
  await kraev("./raceDayRoleYield5950.js", "validateRaceDayRoleYieldParams", "withRaceDayRoleYield", "DECISIVE_ABILITY_BY_PROFILE");
const { applyTrainingCatalog } = await kraev("./trainingCatalogV3.js", "applyTrainingCatalog");
const { sessionsByLevelFor } = await kraev("./trainingDayTypes.js", "sessionsByLevelFor");
const { xpPriceForNextPoint } = await kraev("./developmentXp.ts", "xpPriceForNextPoint");

// ── Ejerens svar paa dommerens aabne spoergsmaal (regel-R15b.md) ─────────────────────────────
// null = ikke afgjort (proeven springes over), true = ejeren har sagt ja (proeven doemmer),
// false = ejeren har sagt nej. Kun lederen retter her, og kun efter ejerens ord.
const EJERSVAR = Object.freeze({ S12: null, S13: null });
// Ejer 13/11: loeftet "fordelt paa de evner, etapen traener". Dommerens laesning: samme procent
// i hver af etapens evner (som kortet "ligeligt, +7,4 % i hver", nu kun i etapens evner).
// Den anden laesning er samme antal XP til hver ("samme-xp"). Kun lederen retter her (S15).
const FORDELING = "samme-procent";

// ── Dommerens laesning ───────────────────────────────────────────────────────────────────────
const HJEMMEBANE = Object.freeze({
  climber: ["mountain", "high_mountain"], // klatrer: bjerg og hoejbjerg
  sprinter: ["flat"], // sprinter: flad
  puncheur: ["hilly", "classic"], // puncheur: kuperet (classic vises som kuperet)
  tt: ["itt", "itt_hilly"], // enkeltstartsrytter: enkeltstart
  brostensrytter: ["cobbles"], // brostensrytter: brosten
});
// Alle roller (ejer 13/11). null = rollen kunne ikke slaas op; motoren regner den som fri rolle.
const ROLLER = Object.freeze(["captain", "co_captain", "sprint_captain", "hunter", "free_role", "helper", "luxury_helper", null]);
const KAPTAJNER = Object.freeze(["captain", "co_captain", "sprint_captain"]);
// "Koer roligt" og grupetto, som motoren sender dem i dag (raceRoles.js: 0,85 og 0,7).
const KOER_ROLIGT = Object.freeze([0.85, 0.7]);

// ── Tal ──────────────────────────────────────────────────────────────────────────────────────
const TAL = {
  dommer: await xpParams(),
  // Skaeve tal: lille andel til resten paa loebsdage, stor paa traeningsdage, stejl typetrappe.
  skaeve: await xpParams({
    ...DOMMER_XP_RAA, offFocusShare: 0.35, raceOffFocusShare: 0.05,
    typeShare: { signatur: 1, sekundaer: 0.6, haandvaerk: 0.4, andenRolle: 0.25, svaghed: 0.1 },
  }),
};
const ROLLETAL = {
  dommer: validateRaceDayRoleYieldParams({ stageBonus: 0.2, leadShare: 0.5 }),
  lille: validateRaceDayRoleYieldParams({ stageBonus: 0.05, leadShare: 0.8 }),
  // #5950 A (underkontakten "rollen styrer ogsaa basis-dagen").
  rolleStyrerBasis: Object.freeze({ ...validateRaceDayRoleYieldParams({ stageBonus: 0.2, leadShare: 0.5 }), roleDrivesBaseDay: true }),
};
const RIGELIG = await xpParams(RIGELIG_XP_RAA);
const DATO = "2026-11-16";
const dato = (n) => new Date(Date.UTC(2026, 10, 15) + n * 86_400_000).toISOString().slice(0, 10);

// ── Ryttere ──────────────────────────────────────────────────────────────────────────────────
const KLATRER = Object.freeze({ ...UNG_KLATRER, riderLevel: "u23" }); // klatrer, sekundaer puncheur, 19 aar
const SPURTER = Object.freeze({ ...SPRINTER, riderLevel: "senior" });
const PUNCHEUR = Object.freeze({ ...VETERAN, age: 29, riderLevel: "senior" }); // puncheur, sekundaer klatrer
const GAMMEL_PUNCHEUR = Object.freeze({ ...VETERAN, riderId: "dommer-veteran-33", riderLevel: "senior" }); // 33 aar
const ren = (type) => Object.freeze({
  riderId: `dommer-ren-${type}`, age: 24, potentiale: 3, primaryType: type, secondaryType: null,
  abilities: evner(55), riderLevel: "senior",
});
const KERNE_RYTTERE = [
  KLATRER, SPURTER, PUNCHEUR, GAMMEL_PUNCHEUR,
  ren("climber"), ren("sprinter"), ren("puncheur"), ren("tt"), ren("brostensrytter"),
];
const KERNE = KERNE_RYTTERE.flatMap((rytter) => HJEMMEBANE[rytter.primaryType]
  .flatMap((profil) => ROLLER.map((rolle) => ({ rytter, profil, rolle }))));

// ── Hjaelpere ────────────────────────────────────────────────────────────────────────────────
const sum = (xp) => Object.values(xp).reduce((a, b) => a + b, 0);
// #8113: motorens sidste ciffer er maskinafhaengigt. Alt sammenlignes paa 9 betydende cifre.
const rund = (x) => (typeof x === "number" && Number.isFinite(x) ? Number(x.toPrecision(9)) : x);
const rundAlt = (o) => {
  if (o === null || typeof o !== "object") return rund(o);
  if (Array.isArray(o)) return o.map(rundAlt);
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, rundAlt(o[k])]));
};

function faelles(rytter, { tal = TAL.dommer, traener = true, akse = false, dateStr = DATO } = {}) {
  return {
    ...rytter, dateStr, caps: {}, progress: {}, conditionMult: 1, developmentXp: tal,
    staff: traener ? STAERK_TRAENER : null, facilityTier: traener ? BEDSTE_FACILITET : null,
    ...(akse ? { budgetDivisor: 140, tickSeedKey: "dommer#gd7" } : {}),
  };
}

/** Loebsdagens ene kald, som motoren goer det: etape, rolle og holdets katalog. */
function loebskald(profil, rolle, { tal = TAL.dommer, rolletal = ROLLETAL.dommer, katalogV3 = true } = {}) {
  const loeb = withRaceDayRoleYieldXp(tal, {}, { params: rolletal, profileType: profil, role: rolle, catalogV3: katalogV3 });
  assert.equal(loeb.program?.focus, "race_day", "loebsdagen skal have sit eget program");
  return loeb;
}

/** Loebsdagens tick: kaldet spredt ind i tick'et sammen med rytteren. */
function loebsdag(rytter, profil, rolle, valg = {}, ekstra = {}) {
  return applyDailyTick({ ...faelles(rytter, valg), ...loebskald(profil, rolle, valg), ...ekstra });
}

/** De haarde traeningspas i holdets katalog, som motoren laeser dem. */
function haardePas(katalogV3) {
  return sessionsByLevelFor({ catalogV3: katalogV3 }).hard
    .map((pas) => applyTrainingCatalog({ focus: pas, intensity: "hard" }, { v3: katalogV3 }));
}

/** Rytterens bedste haarde pas: mest XP i alt, med holdets traener og facilitet, uden Traen nu. */
function bedsteHaardePas(rytter, valg = {}, ekstra = {}) {
  let bedst = null;
  for (const program of haardePas(valg.katalogV3 ?? true)) {
    const xp = applyDailyTick({ ...faelles(rytter, valg), program, ...ekstra }).xp;
    if (!bedst || sum(xp) > bedst.iAlt) bedst = { pas: program.focus, xp, iAlt: sum(xp) };
  }
  return bedst;
}

const ALLE_VALG = [];
for (const [talNavn, tal] of Object.entries(TAL)) {
  for (const [rolleNavn, rolletal] of Object.entries(ROLLETAL)) {
    for (const katalogV3 of [true, false]) {
      for (const traener of [true, false]) {
        for (const akse of [false, true]) {
          ALLE_VALG.push({
            tal, rolletal, katalogV3, traener, akse,
            navn: `tal=${talNavn} rolletal=${rolleNavn} katalog=${katalogV3 ? "v3" : "gammelt"} ${traener ? "staerk traener" : "uden traener"}${akse ? " loebsdags-aksen" : ""}`,
          });
        }
      }
    }
  }
}

/**
 * Alle brud paa R15b for en liste af tilfaelde, paa tvaers af tal, katalog, traener og akse.
 * `skjulTal` (de private parametre): meldingen viser kun, hvor mange procent der mangler.
 */
function brudPaaR15b(tilfaelde, valgListe = ALLE_VALG, { skjulTal = false } = {}) {
  const brud = [];
  for (const { rytter, profil, rolle } of tilfaelde) {
    for (const valg of valgListe) {
      const loeb = sum(loebsdag(rytter, profil, rolle, valg).xp);
      const bedste = bedsteHaardePas(rytter, valg);
      if (!(rund(loeb) >= rund(bedste.iAlt))) {
        const hvor = `${rytter.riderId} ${profil} ${rolle} [${valg.navn}]`;
        brud.push(skjulTal
          ? `${hvor}: loebsdagen giver ${((1 - loeb / bedste.iAlt) * 100).toFixed(1)} % mindre XP i alt end det bedste haarde pas (${bedste.pas})`
          : `${hvor}: loebsdag ${loeb.toFixed(1)} XP i alt < bedste haarde pas (${bedste.pas}) ${bedste.iAlt.toFixed(1)}`);
      }
    }
  }
  return brud;
}
const vis = (brud) => `${brud.length} brud. De foerste:\n  ${brud.slice(0, 15).join("\n  ")}`;

// ═══ R15b: REGLEN ════════════════════════════════════════════════════════════════════════════

test("R15b: scenariet maaler noget (rytterens bedste haarde pas er mere end en haard dag i etapens evner)", () => {
  // Var de to ens, ville R15 allerede give R15b, og proeven nedenfor ville vaere tom.
  const loeb = loebskald("mountain", "captain");
  const haardDag = { focus: "dommer_haard_dag", intensity: "hard", focusAbilities: loeb.program.focusAbilities };
  const snaever = sum(applyDailyTick({ ...faelles(KLATRER), program: haardDag }).xp);
  const bedste = bedsteHaardePas(KLATRER);
  assert.ok(bedste.iAlt > snaever * 1.05, `bedste pas ${bedste.iAlt.toFixed(1)} mod haard dag i etapens evner ${snaever.toFixed(1)}`);
  // "Bedste" er rytterens eget: en klatrer og en sprinter har ikke samme bedste pas.
  assert.notEqual(bedste.pas, bedsteHaardePas(SPURTER).pas);
  // Katalogerne er forskellige, saa "holdets katalog" er ikke ligegyldigt.
  assert.ok(haardePas(true).length > haardePas(false).length);
  // Traener og facilitet loefter det bedste pas, saa "med holdets traener og facilitet" kan maerkes.
  assert.ok(bedste.iAlt > bedsteHaardePas(KLATRER, { traener: false }).iAlt * 1.15);
});

test("R15b: paa en etape, der passer rytterens primaere type, giver loebsdagen i ALLE roller mindst hans bedste haarde pas", () => {
  assert.equal(KERNE.length, 15 * ROLLER.length, "alle fem typer med hjemmebane, alle roller");
  const brud = brudPaaR15b(KERNE);
  assert.equal(brud.length, 0, vis(brud));
});

test("R15b: ejerens eget eksempel, klatreren i bjergene, som kaptajn og som hjaelper", () => {
  // Med dommerens proevetal paa main 13/11: kaptajn 637,4 og hjaelper 638,5 XP i alt mod 684,3 for klatreintervallerne.
  const bedste = bedsteHaardePas(KLATRER);
  for (const rolle of ["captain", "helper"]) {
    const loeb = sum(loebsdag(KLATRER, "mountain", rolle).xp);
    assert.ok(rund(loeb) >= rund(bedste.iAlt), `bjergetapen som ${rolle} ${loeb.toFixed(1)} XP i alt < bedste haarde pas (${bedste.pas}) ${bedste.iAlt.toFixed(1)}`);
  }
});

test("R15b: reglen gaelder ogsaa, naar rytteren koerer haardere end normalt (dagens intention over 1)", () => {
  const brud = [];
  for (const { rytter, profil, rolle } of KERNE) {
    const loeb = sum(loebsdag(rytter, profil, rolle, {}, { academyRateMult: 1.1 }).xp);
    const bedste = bedsteHaardePas(rytter);
    if (!(rund(loeb) >= rund(bedste.iAlt))) brud.push(`${rytter.riderId} ${profil} ${rolle}: ${loeb.toFixed(1)} < ${bedste.iAlt.toFixed(1)}`);
  }
  assert.equal(brud.length, 0, vis(brud));
});

// ── Gulvet: praecis op til det bedste pas, og kun i etapens evner ────────────────────────────
// XP pr. evne paa loebsdagen FOER loeftet, maalt af dommeren paa origin/main d5d2511ac (13/11)
// med dommerens proevetal, staerk traener, bedste facilitet og katalog v3. Fire decimaler.
// I alle syv tilfaelde ligger loebsdagen under det bedste haarde pas, saa gulvet skal loefte.
const GULV_TILFAELDE = [
  { noegle: "klatrer|mountain|captain", rytter: KLATRER, profil: "mountain", rolle: "captain" },
  { noegle: "klatrer|mountain|helper", rytter: KLATRER, profil: "mountain", rolle: "helper" },
  { noegle: "ren-tt|itt|free_role", rytter: ren("tt"), profil: "itt", rolle: "free_role" },
  { noegle: "ren-puncheur|classic|hunter", rytter: ren("puncheur"), profil: "classic", rolle: "hunter" },
  { noegle: "ren-brostensrytter|cobbles|luxury_helper", rytter: ren("brostensrytter"), profil: "cobbles", rolle: "luxury_helper" },
  { noegle: "veteran-33|hilly|captain", rytter: GAMMEL_PUNCHEUR, profil: "hilly", rolle: "captain" },
  // Underkontakten #5950 A: hjaelperens loebsdag traener hjaelpe-evnerne, saa det er dem, loeftet lander i.
  { noegle: "ren-tt|itt|helper|rolleStyrerBasis", rytter: ren("tt"), profil: "itt", rolle: "helper", valg: { rolletal: ROLLETAL.rolleStyrerBasis } },
];
const FOER_LOEFT = Object.freeze({
  "klatrer|mountain|captain": {"climbing": 180.6675, "time_trial": 8.896, "flat": 11.8614, "tempo": 29.6535, "sprint": 8.896, "acceleration": 11.8614, "punch": 29.6535, "endurance": 159.0675, "recovery": 11.8614, "durability": 63.627, "descending": 10.9443, "cobblestone": 10.9443, "positioning": 21.8886, "aggression": 10.9443, "tactics": 16.4164, "teamwork": 27.3607, "leadership": 22.8964},
  "klatrer|mountain|helper": {"climbing": 164.4675, "time_trial": 8.896, "flat": 11.8614, "tempo": 40.4535, "sprint": 8.896, "acceleration": 11.8614, "punch": 29.6535, "endurance": 159.0675, "recovery": 11.8614, "durability": 65.787, "descending": 10.9443, "cobblestone": 10.9443, "positioning": 21.8886, "aggression": 10.9443, "tactics": 16.4164, "teamwork": 38.1607, "leadership": 16.4164},
  "ren-tt|itt|free_role": {"climbing": 4.2833, "time_trial": 81.788, "flat": 5.711, "tempo": 30.2885, "sprint": 4.2833, "acceleration": 5.711, "punch": 4.2833, "endurance": 6.4044, "recovery": 5.711, "durability": 5.711, "descending": 5.2695, "cobblestone": 5.2695, "positioning": 7.9042, "aggression": 5.2695, "tactics": 7.9042, "teamwork": 8.9442, "leadership": 9.4642},
  "ren-puncheur|classic|hunter": {"climbing": 5.711, "time_trial": 4.2833, "flat": 5.711, "tempo": 14.2776, "sprint": 4.2833, "acceleration": 5.711, "punch": 86.988, "endurance": 14.2776, "recovery": 5.711, "durability": 30.6352, "descending": 5.2695, "cobblestone": 5.2695, "positioning": 71.0683, "aggression": 7.3495, "tactics": 7.9042, "teamwork": 7.9042, "leadership": 7.9042},
  "ren-brostensrytter|cobbles|luxury_helper": {"climbing": 4.2833, "time_trial": 5.711, "flat": 79.188, "tempo": 5.711, "sprint": 5.711, "acceleration": 5.711, "punch": 14.2776, "endurance": 14.2776, "recovery": 5.711, "durability": 30.6352, "descending": 5.2695, "cobblestone": 73.6683, "positioning": 18.3737, "aggression": 5.2695, "tactics": 7.9042, "teamwork": 11.0242, "leadership": 7.9042},
  "veteran-33|hilly|captain": {"climbing": 2.1209, "time_trial": 0.1483, "flat": 0.1977, "tempo": 2.6511, "sprint": 0.1483, "acceleration": 0.1977, "punch": 3.0111, "endurance": 0.4942, "recovery": 0.1977, "durability": 0.1977, "descending": 0.1824, "cobblestone": 0.1824, "positioning": 0.456, "aggression": 1.4592, "tactics": 2.1889, "teamwork": 2.9185, "leadership": 3.0529},
  "ren-tt|itt|helper|rolleStyrerBasis": {"climbing": 4.2833, "time_trial": 14.2776, "flat": 5.711, "tempo": 23.7138, "sprint": 4.2833, "acceleration": 5.711, "punch": 4.2833, "endurance": 23.7138, "recovery": 5.711, "durability": 5.711, "descending": 5.2695, "cobblestone": 5.2695, "positioning": 7.9042, "aggression": 5.2695, "tactics": 7.9042, "teamwork": 33.1421, "leadership": 7.9042},
});
const foerLoeftNu = () => Object.fromEntries(GULV_TILFAELDE.map(({ noegle, rytter, profil, rolle, valg }) =>
  [noegle, Object.fromEntries(Object.entries(loebsdag(rytter, profil, rolle, valg).xp).map(([e, x]) => [e, Number(x.toFixed(4))]))]));

test("R15b gulvet: loebsdagen loeftes praecis op til det bedste haarde pas, og loeftet lander kun i de evner, etapen traener", () => {
  // foerLoeftNu er den funktion, dommeren tog facit med paa main; her taelles kun, at facit er helt.
  assert.deepEqual(Object.keys(foerLoeftNu()).sort(), Object.keys(FOER_LOEFT).sort());
  for (const { noegle, rytter, profil, rolle, valg = {} } of GULV_TILFAELDE) {
    const foer = FOER_LOEFT[noegle];
    assert.ok(foer, `${noegle}: facit mangler`);
    const etapensEvner = loebskald(profil, rolle, valg).program.focusAbilities;
    const bedste = bedsteHaardePas(rytter, valg);
    const mangler = bedste.iAlt - sum(foer);
    assert.ok(mangler > bedste.iAlt * 0.01, `${noegle}: scenariet skal ligge under det bedste pas foer loeftet`);
    const nu = loebsdag(rytter, profil, rolle, valg).xp;
    // Praecis op til: ikke under (reglen), ikke over (et gulv, ikke et tillaeg).
    assert.ok(Math.abs(sum(nu) - bedste.iAlt) <= bedste.iAlt * 1e-6,
      `${noegle}: loebsdagen skal ende praecis paa det bedste haarde pas ${bedste.iAlt.toFixed(2)} XP i alt (er ${sum(nu).toFixed(2)}, var ${sum(foer).toFixed(2)})`);
    const iEtapen = etapensEvner.reduce((a, evne) => a + (foer[evne] ?? 0), 0);
    for (const evne of new Set([...Object.keys(foer), ...Object.keys(nu)])) {
      const var_ = foer[evne] ?? 0;
      const er = nu[evne] ?? 0;
      if (!etapensEvner.includes(evne)) {
        assert.ok(Math.abs(er - var_) <= 0.001, `${noegle} ${evne}: loeftet maa kun lande i etapens evner (${etapensEvner.join(", ")}); ${evne} gik fra ${var_} til ${er.toFixed(4)}`);
        continue;
      }
      const ventet = FORDELING === "samme-xp" ? var_ + mangler / etapensEvner.length : var_ * (1 + mangler / iEtapen);
      assert.ok(er > var_, `${noegle} ${evne}: hver af etapens evner skal have del i loeftet`);
      assert.ok(Math.abs(er - ventet) <= 0.005, `${noegle} ${evne}: ventede ${ventet.toFixed(3)} (${FORDELING}), fik ${er.toFixed(3)} (foer loeftet ${var_})`);
    }
  }
});

// ═══ R15b MAA IKKE BRYDE DE ANDRE REGLER ═════════════════════════════════════════════════════

test("R15b + R14: sammenligningen er uden Traen nu, og bonussen gaelder kun traeningspas (ejer 13/11)", () => {
  for (const { rytter, profil, rolle } of KERNE) {
    const uden = loebsdag(rytter, profil, rolle).xp;
    const med = loebsdag(rytter, profil, rolle, {}, { trainNowBonus: true }).xp;
    assert.deepEqual(rundAlt(med), rundAlt(uden), `${rytter.riderId} ${profil} ${rolle}: Traen nu maa ikke aendre loebsdagens XP`);
  }
  // Modproeve: paa traeningspasset er bonussen 15 %, saa det er bonussen, der er holdt ude af sammenligningen.
  const bedste = bedsteHaardePas(KLATRER);
  const medBonus = bedsteHaardePas(KLATRER, {}, { trainNowBonus: true });
  assert.equal(rund(medBonus.iAlt), rund(bedste.iAlt * 1.15));
});

test("R15b + R11: ét udsving pr. rytter pr. dato, ogsaa naar loebsdagen er loeftet, og reglen holder hver dag", async () => {
  const med = await xpParamsMedVariation();
  const faktorer = [];
  for (const { rytter, profil, rolle } of [
    { rytter: KLATRER, profil: "mountain", rolle: "captain" }, { rytter: ren("tt"), profil: "itt", rolle: "helper" },
  ]) {
    for (let d = 0; d < 14; d++) {
      const dateStr = dato(d);
      const pasUden = bedsteHaardePas(rytter, { dateStr });
      const pasMed = bedsteHaardePas(rytter, { dateStr, tal: med });
      const faktor = pasMed.iAlt / pasUden.iAlt; // dagens udsving, laest paa traeningspasset
      assert.ok(faktor >= 0.5 - 1e-9 && faktor <= 1.5 + 1e-9, `${dateStr}: udsving ${faktor}`);
      const loebUden = loebsdag(rytter, profil, rolle, { dateStr }).xp;
      const loebMed = loebsdag(rytter, profil, rolle, { dateStr, tal: med }).xp;
      for (const evne of Object.keys(loebUden)) {
        assert.ok(Math.abs(loebMed[evne] / loebUden[evne] - faktor) < 1e-9,
          `${rytter.riderId} ${dateStr} ${evne}: loebsdagen skal have praecis dagens udsving (${faktor}), ogsaa i det, gulvet loefter`);
      }
      assert.ok(rund(sum(loebMed)) >= rund(pasMed.iAlt),
        `${rytter.riderId} ${dateStr}: loebsdag ${sum(loebMed).toFixed(1)} < bedste haarde pas ${pasMed.iAlt.toFixed(1)} paa en dag med udsving ${faktor.toFixed(2)}`);
      faktorer.push(faktor);
    }
  }
  assert.ok(Math.max(...faktorer) - Math.min(...faktorer) > 0.5, "dagene skal vaere tydeligt forskellige, ellers maaler proeven intet");
});

test("R15b + R15: den loeftede loebsdag er stadig mindst en haard dag i hver evne og mere i det, etapen kraever", () => {
  for (const valg of ALLE_VALG.filter((v) => !v.akse)) {
    for (const { rytter, profil, rolle } of KERNE) {
      const loeb = loebskald(profil, rolle, valg);
      const etapensEvner = loeb.program.focusAbilities;
      const haardDag = {
        focus: "dommer_haard_dag", intensity: "hard", focusAbilities: etapensEvner,
        ...(loeb.program.focusWeights ? { focusWeights: loeb.program.focusWeights } : {}),
      };
      const haard = applyDailyTick({ ...faelles(rytter, valg), program: haardDag }).xp;
      const loebsdagen = loebsdag(rytter, profil, rolle, valg).xp;
      const hvor = `${rytter.riderId} ${profil} ${rolle} [${valg.navn}]`;
      for (const evne of Object.keys(haard)) {
        assert.ok(rund(loebsdagen[evne] ?? 0) >= rund(haard[evne]), `${hvor} ${evne}: loebsdag ${loebsdagen[evne]} < haard dag ${haard[evne]}`);
      }
      const iEtapen = (xp) => etapensEvner.reduce((a, evne) => a + (xp[evne] ?? 0), 0);
      assert.ok(iEtapen(loebsdagen) > iEtapen(haard), `${hvor}: etapens evner samlet`);
      if (KAPTAJNER.includes(rolle)) {
        const afgoerende = DECISIVE_ABILITY_BY_PROFILE[profil];
        assert.ok(loebsdagen[afgoerende] > haard[afgoerende], `${hvor}: kaptajnen skal have mere i ${afgoerende}`);
      }
    }
  }
});

test("R15b + R9: gulvet er ikke et loft, og den gamle regel om +1 pr. loebsdag klipper heller ikke den loeftede dag", () => {
  // RIGELIG_XP_RAA giver med vilje alt for meget XP; det er den eneste maade at se et skjult loft.
  const lav = Object.freeze({ ...KLATRER, riderId: "dommer-lav-klatrer", abilities: evner(30, { climbing: 12, endurance: 14 }) });
  for (const akse of [false, true]) {
    const valg = { tal: RIGELIG, akse };
    const fri = loebsdag(lav, "mountain", "captain", valg);
    const medGammelRegel = loebsdag(lav, "mountain", "captain", valg, { hardDailyCap: 1 });
    assert.deepEqual(rundAlt(medGammelRegel.xp), rundAlt(fri.xp), "hardDailyCap maa ikke aendre XP under XP-modellen");
    assert.deepEqual(medGammelRegel.gains, fri.gains, "hardDailyCap maa ikke klippe koebet");
    const facit = koebMedPrisliste({ level: 12, xp: fri.xp.climbing }, (niveau) => xpPriceForNextPoint(niveau, RIGELIG));
    assert.ok(facit.point >= 2, `scenariet skal give mindst 2 point i klatring (gav ${facit.point})`);
    assert.equal(fri.gains.climbing, facit.point, "alle point, XP'en raekker til, koebes samme dato");
    const bedste = bedsteHaardePas(lav, valg);
    assert.ok(rund(sum(fri.xp)) >= rund(bedste.iAlt), `rigelig XP${akse ? " (loebsdags-aksen)" : ""}: loebsdag ${sum(fri.xp).toFixed(1)} < bedste haarde pas ${bedste.iAlt.toFixed(1)}`);
  }
});

// ── R1: slukket kontakt er uaendret ──────────────────────────────────────────────────────────
// Fingeraftrykket er taget af dommeren paa origin/main d5d2511ac (13/11), FOER R15b blev bygget.
// Afrundet til 9 betydende cifre foer hash (#8113). Maa ikke rettes til.
const SLUKKET_FOER_R15B = "d5e0d470ecd784f600888333e130d6899fc5a810a964197b376aa3d978c06d3e";
const SLUKKET_ANTAL = 360;

function slukketScenarier() {
  const ud = [];
  let n = 0;
  for (const { rytter, profil, rolle } of KERNE) {
    for (const rolletal of [ROLLETAL.dommer, ROLLETAL.rolleStyrerBasis, null]) {
      n += 1;
      const { riderLevel, ...r } = rytter;
      ud.push({
        ...r, dateStr: dato(n % 5), caps: lofter(rytter.abilities, 4 + (n % 9)),
        progress: n % 2 ? {} : { climbing: 0.93, sprint: 0.4, punch: 0.97, time_trial: 0.95, cobblestone: 0.9, endurance: 1.6 },
        conditionMult: [0.9, 1, 1.08][n % 3], hardDailyCap: 1,
        program: { focus: "race_day", intensity: "normal", focusAbilities: ["climbing", "endurance"] }, // overskrives af rolletillaegget, naar det er taendt
        ...(n % 4 === 0 ? { staff: STAERK_TRAENER, facilityTier: BEDSTE_FACILITET, riderLevel } : {}),
        ...(n % 3 === 0 ? { budgetDivisor: 140, tickSeedKey: `dommer-r15b#gd${n}` } : {}),
        ...(n % 5 === 0 ? { trainNowBonus: true } : {}),
        ...(n % 7 === 0 ? { academyRateMult: [0.7, 0.85, 1.1][n % 3] } : {}),
        // Det nye felt (catalogV3) sendes med, som motoren vil goere det.
        ...withRaceDayRoleYieldXp(null, {}, { params: rolletal, profileType: profil, role: rolle, catalogV3: n % 2 === 0 }),
      });
    }
  }
  return ud;
}
const slukketAftryk = (r) => rundAlt({ abilities: r.abilities, progress: r.progress, gains: r.gains, score: r.score, status: r.status });

test("R15b + R1: med slukket kontakt er loebsdagen praecis som foer, ogsaa paa en etape, der passer rytteren", () => {
  // 1) Det ene kald giver det samme som i dag, og det nye felt siver ikke ind i den gamle model.
  for (const { profil, rolle } of KERNE) {
    for (const rolletal of [ROLLETAL.dommer, ROLLETAL.rolleStyrerBasis, null]) {
      for (const catalogV3 of [true, false, undefined]) {
        const ekstra = { developmentScore: null };
        const nu = withRaceDayRoleYieldXp(null, ekstra, { params: rolletal, profileType: profil, role: rolle, catalogV3 });
        const foer = withRaceDayRoleYield(ekstra, { params: rolletal, profileType: profil, role: rolle });
        assert.deepEqual(nu, foer, `${profil} ${rolle}: slukket XP skal give praecis det gamle kald`);
      }
    }
  }
  // 2) Selve tick'et i den gamle model er uaendret (frosset paa main foer R15b).
  const scenarier = slukketScenarier();
  const aftryk = scenarier.map((s) => slukketAftryk(applyDailyTick(s)));
  assert.ok(scenarier.filter((s) => Object.keys(applyDailyTick(s).gains).length > 0).length >= 10, "scenarierne skal koebe point, ellers er fingeraftrykket tomt");
  assert.equal(aftryk.length, SLUKKET_ANTAL);
  assert.equal(fingeraftryk(aftryk), SLUKKET_FOER_R15B, "den gamle models loebsdag har flyttet sig: slukket kontakt er ikke laengere som foer");
});

// ═══ ALLE ANDRE LOEBSDAGE ER UAENDREDE ═══════════════════════════════════════════════════════
// Ejerens svar 13/11 siger, hvem der IKKE loeftes: en etape, der ikke passer den primaere type
// ("kun naar loebet passer"), en etape, der kun passer den sekundaere type ("Nej, kun den
// primaere type"), og en rytter, der er sat til at koere roligt ("Nej"). Hvor reglen allerede
// holder, har et gulv intet at loefte. Flytter en bygning nogen af disse tal, er det en
// balanceaendring, ejeren ikke har set: vis den som et kort; siger ejeren ja, retter lederen
// tallene her. Byggebanen retter dem ikke.
// Tallene er XP i alt med dommerens proevetal, staerk traener, bedste facilitet og katalog v3,
// maalt paa origin/main d5d2511ac (13/11). Tre decimaler.
const UAENDRET = Object.freeze({
  "passer ikke|dommer-ung-klatrer|flat|captain": 454.082,
  "passer ikke|dommer-ung-klatrer|flat|helper": 466.502,
  "passer ikke|dommer-ung-klatrer|itt|captain": 476.725,
  "passer ikke|dommer-ung-klatrer|itt|helper": 481.045,
  "passer ikke|dommer-ung-klatrer|cobbles|captain": 465.515,
  "passer ikke|dommer-ung-klatrer|cobbles|helper": 474.155,
  "passer ikke|dommer-sprinter|mountain|captain": 254.502,
  "passer ikke|dommer-sprinter|mountain|helper": 254.762,
  "passer ikke|dommer-sprinter|hilly|captain": 224.387,
  "passer ikke|dommer-sprinter|hilly|helper": 221.527,
  "passer ikke|dommer-sprinter|itt|captain": 203.614,
  "passer ikke|dommer-sprinter|itt|helper": 200.84,
  "passer ikke|dommer-sprinter|cobbles|captain": 303.624,
  "passer ikke|dommer-sprinter|cobbles|helper": 306.224,
  "passer ikke|dommer-veteran|flat|captain": 74.183,
  "passer ikke|dommer-veteran|flat|helper": 75.983,
  "passer ikke|dommer-veteran|itt|captain": 77.202,
  "passer ikke|dommer-veteran|itt|helper": 77.442,
  "passer ikke|dommer-veteran|cobbles|captain": 75.707,
  "passer ikke|dommer-veteran|cobbles|helper": 77.291,
  "kun sekundaer type|dommer-veteran|mountain|captain": 94.603,
  "kun sekundaer type|dommer-veteran|mountain|helper": 95.323,
  "kun sekundaer type|dommer-veteran|high_mountain|free_role": 103.353,
  "kun sekundaer type|dommer-ung-klatrer|classic|captain": 604.22,
  "kun sekundaer type|dommer-ung-klatrer|classic|hunter": 602.06,
  "koerer roligt 0.85|dommer-ung-klatrer|mountain|captain": 629.34,
  "koerer roligt 0.85|dommer-ung-klatrer|mountain|helper": 630.258,
  "koerer roligt 0.85|dommer-ren-tt|itt|free_role": 201.886,
  "koerer roligt 0.7|dommer-ung-klatrer|mountain|captain": 621.24,
  "koerer roligt 0.7|dommer-ung-klatrer|mountain|helper": 621.996,
  "koerer roligt 0.7|dommer-ren-tt|itt|free_role": 199.572,
  "holder allerede|dommer-sprinter|flat|captain": 349.017,
  "holder allerede|dommer-sprinter|flat|helper": 343.817,
  "holder allerede|dommer-veteran|hilly|captain": 105.532,
  "holder allerede|dommer-veteran|hilly|luxury_helper": 106.108,
  "holder allerede|dommer-ren-climber|high_mountain|captain": 335.833,
  "holder allerede|dommer-ren-climber|high_mountain|hunter": 334.793,
});

function uaendretNu() {
  const ud = {};
  const iAlt = (...a) => sum(loebsdag(...a).xp);
  // Etapen passer hverken den primaere eller den sekundaere type.
  for (const [rytter, profiler] of [
    [KLATRER, ["flat", "itt", "cobbles"]], [SPURTER, ["mountain", "hilly", "itt", "cobbles"]], [PUNCHEUR, ["flat", "itt", "cobbles"]],
  ]) {
    for (const profil of profiler) {
      for (const rolle of ["captain", "helper"]) ud[`passer ikke|${rytter.riderId}|${profil}|${rolle}`] = iAlt(rytter, profil, rolle);
    }
  }
  // Etapen passer kun den sekundaere type (ejer 13/11: taeller ikke).
  for (const [rytter, profil, rolle] of [
    [PUNCHEUR, "mountain", "captain"], [PUNCHEUR, "mountain", "helper"], [PUNCHEUR, "high_mountain", "free_role"],
    [KLATRER, "classic", "captain"], [KLATRER, "classic", "hunter"],
  ]) ud[`kun sekundaer type|${rytter.riderId}|${profil}|${rolle}`] = iAlt(rytter, profil, rolle);
  // Etapen passer, men rytteren er sat til at koere roligt (ejer 13/11: intet loeft).
  for (const intention of KOER_ROLIGT) {
    for (const [rytter, profil, rolle] of [[KLATRER, "mountain", "captain"], [KLATRER, "mountain", "helper"], [ren("tt"), "itt", "free_role"]]) {
      ud[`koerer roligt ${intention}|${rytter.riderId}|${profil}|${rolle}`] = iAlt(rytter, profil, rolle, {}, { academyRateMult: intention });
    }
  }
  // Etapen passer, og reglen holder allerede i dag: gulvet har intet at loefte.
  for (const [rytter, profil, rolle] of [
    [SPURTER, "flat", "captain"], [SPURTER, "flat", "helper"], [PUNCHEUR, "hilly", "captain"], [PUNCHEUR, "hilly", "luxury_helper"],
    [ren("climber"), "high_mountain", "captain"], [ren("climber"), "high_mountain", "hunter"],
  ]) ud[`holder allerede|${rytter.riderId}|${profil}|${rolle}`] = iAlt(rytter, profil, rolle);
  return ud;
}

test("R15b: loebsdagen er uaendret, naar etapen ikke passer den primaere type, naar rytteren koerer roligt, og naar reglen allerede holder", () => {
  const nu = uaendretNu();
  assert.deepEqual(Object.keys(nu).sort(), Object.keys(UAENDRET).sort());
  const flyttet = Object.keys(nu)
    .filter((k) => Math.abs(nu[k] - UAENDRET[k]) > 0.001) // facit staar med tre decimaler
    .map((k) => `${k}: ${UAENDRET[k]} -> ${nu[k].toFixed(3)}`);
  assert.equal(flyttet.length, 0, `R15b har flyttet tal, den ikke skal flytte:\n  ${flyttet.join("\n  ")}`);
});

test("R15b: scenariet for 'koerer roligt' maaler noget (samme rytter loeftes ved normal indsats)", () => {
  // Uden denne modproeve kunne proeven ovenfor vaere groen, fordi intet nogensinde loeftes.
  for (const intention of KOER_ROLIGT) {
    const roligt = sum(loebsdag(KLATRER, "mountain", "captain", {}, { academyRateMult: intention }).xp);
    assert.ok(roligt < bedsteHaardePas(KLATRER).iAlt * 0.99, `intention ${intention}: en rytter, der koerer roligt, skal ligge under sit bedste pas`);
  }
  assert.ok(rund(sum(loebsdag(KLATRER, "mountain", "captain", {}, { academyRateMult: 1 }).xp)) >= rund(bedsteHaardePas(KLATRER).iAlt),
    "ved normal indsats skal klatreren i bjergene naa sit bedste haarde pas");
});

// ═══ DE PRIVATE PARAMETRE (springes over, hvor filen ikke findes, fx i CI) ══════════════════
// Samme fil som dommer6110.private-parametre.test.js: miljoevariablen CZ_XP_PARAMS_FIL, ellers
// balance-internals/6110/xp-params.mjs (XP_PRIVATE.xp) eller en json-fil med feltet "xp".
// Rolletillaeggets private tal laeses ikke her; dommerens tre saet bruges. Meldingerne viser
// kun procenter, aldrig XP-tal (hard rule 17).
const HER = path.dirname(fileURLToPath(import.meta.url));
const PRIVAT_FIL = process.env.CZ_XP_PARAMS_FIL
  ? path.resolve(process.env.CZ_XP_PARAMS_FIL)
  : path.resolve(HER, "../../balance-internals/6110/xp-params.mjs");

async function privateTal() {
  if (!existsSync(PRIVAT_FIL)) return null;
  const raa = PRIVAT_FIL.endsWith(".json")
    ? JSON.parse(readFileSync(PRIVAT_FIL, "utf8")).xp
    : (await import(pathToFileURL(PRIVAT_FIL).href)).XP_PRIVATE?.xp;
  const { validateDevelopmentXpParams } = await kraev("./developmentXp.ts", "validateDevelopmentXpParams");
  return { params: validateDevelopmentXpParams(raa) };
}
const privat = await privateTal();

test("R15b private parametre: reglen holder ogsaa med de tal, der skal taendes med",
  { skip: privat ? false : `de private parametre findes ikke her (${path.basename(PRIVAT_FIL)})` }, () => {
    assert.ok(privat.params, "motoren afviser de private parametre");
    const valgListe = ALLE_VALG.filter((v) => v.tal === TAL.dommer)
      .map((v) => ({ ...v, tal: privat.params, navn: v.navn.replace("tal=dommer", "tal=private") }));
    const brud = brudPaaR15b(KERNE, valgListe, { skjulTal: true });
    assert.equal(brud.length, 0, vis(brud));
  });

// ═══ AABNE SPOERGSMAAL TIL EJEREN (S12, S13): springes over, til ejeren har svaret ══════════
const paaTvaersAfRoller = (rytter, profiler) => profiler.flatMap((profil) => ["captain", "hunter", "helper"].map((rolle) => ({ rytter, profil, rolle })));
const UDVIDELSER = [
  { svar: "S12", navn: "klassementsrytter i bjerg og paa enkeltstart, udbryder paa kuperet og smaakuperet, rouleur paa flad og holdtidskoersel", tilfaelde: [
    ...paaTvaersAfRoller(ren("gc"), ["mountain", "high_mountain", "itt", "itt_hilly"]),
    ...paaTvaersAfRoller(ren("baroudeur"), ["hilly", "classic", "rolling"]),
    ...paaTvaersAfRoller(ren("rouleur"), ["flat", "ttt"]),
  ] },
  { svar: "S13", navn: "graense-etaper: smaakuperet for puncheur, grus for brostensrytter, holdtidskoersel for enkeltstartsrytter", tilfaelde: [
    ...paaTvaersAfRoller(ren("puncheur"), ["rolling"]),
    ...paaTvaersAfRoller(ren("brostensrytter"), ["gravel"]),
    ...paaTvaersAfRoller(ren("tt"), ["ttt"]),
  ] },
];

for (const { svar, navn, tilfaelde } of UDVIDELSER) {
  const spring = EJERSVAR[svar] === true ? false
    : EJERSVAR[svar] === false ? `ejeren har sagt nej (${svar})` : `afventer ejerens svar (${svar})`;
  test(`R15b ${svar}: ${navn}`, { skip: spring }, () => {
    const brud = brudPaaR15b(tilfaelde);
    assert.equal(brud.length, 0, vis(brud));
  });
}
