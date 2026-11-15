// #7801 rest-byg: dommerens KRAV-proever. Skrevet FOER foerste kodelinje (AGENTS.md regel 40).
// Ejes af dommeren; byggeren aendrer ikke filen.
//
// Til forskel fra "samme tal som foer" (dommer7801RestByg.sammeTal.test.js, groen paa main) er de
// proever, der er maerket ROED, roede paa main med vilje. De siger, hvad rest-bygget skal levere.
//   K1  FARTEN: en visning med kontakten taendt koster faa ekstra opslag og faa ekstra ventetider.   ROED
//   K2  FARTEN, Race Hub: ekstra-prisen vokser ikke med antallet af loebskolonner.                    ROED
//   K3  "UKENDT": regelpanelets tal er ukendt (null), naar tallet lige nu ikke kan regnes.            ROED
//   K4  LAEGEOPSLAGET: fejler det, viser fladen en streg, aldrig et tal uden bonus.                   ROED
//   K5  ENHVER LAESEFEJL: en flade viser det rigtige tal eller en streg, aldrig et forkert tal.
//       ROED for rytternes evner paa udtagelsen; resten er groen paa main og er vagter.
//
// "Runde" = en ventetid paa databasen (se harnessen). Alt maales paa opdigtede verdener.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FAIL_MODES, MEDICAL_TABLES, RACEHUB_RACES, TEAM_IDS, boardFunction, countCalls, fatigueNumbers, flagName,
  runBoard, runSurface, runWithFailure, targetsRead,
} from "./dommer7801RestByg.harness.mjs";

const FACIT = JSON.parse(readFileSync(new URL("./__fixtures__/dommer7801RestBygFacit.json", import.meta.url), "utf8"));

// ── K1: farten pr. flade ──────────────────────────────────────────────────────────────────────
// Maalt paa main (midt paa dagen, hold A): udtagelse 9 kald/5 runder slukket og 23/18 taendt; Hold-fane
// 14/11 og 28/24; rytterkort 1/1 og 16/15; regelpanel 6/6 og 19/18; saesonplan 2/2 og 13/12;
// Traening (traethedsdelen) 2/2 og 19/18. De 14 ekstra kald paa udtagelsen ligger i 13 runder.
// Loftet er, hvad der er noedvendigt, naar intet laeses to gange og uafhaengige opslag sendes samtidig,
// plus én runde i reserve. Kan et loft ikke naas inden for reglerne, saa stop og kom til dommeren.
const SPEED_SCENARIOS = ["midt_paa_dagen", "morgen_foer_etaper", "aften_alle_koert", "hviledag", "laege_byttet"];
const EXTRA_OVER_OFF = { // [ekstra kald, ekstra runder] oven i samme visning med kontakten slukket
  udtagelse: [9, 3], holdfane: [9, 3], regelpanel: [9, 3], saesonplan: [9, 3], rytterkort: [11, 4],
};
const SPEED_KEYS = [
  ...RACEHUB_RACES.flatMap((race) => TEAM_IDS.flatMap((team) => [`udtagelse|${race}|${team}`, `holdfane|${race}|${team}`])),
  "rytterkort|a1|team-a", "rytterkort|a2|team-a", "rytterkort|a4|team-a", "rytterkort|b1|team-b",
  "regelpanel|team-a", "regelpanel|team-b", "saesonplan|team-a", "saesonplan|team-b",
];
for (const [kind, [extraCalls, extraRounds]] of Object.entries(EXTRA_OVER_OFF)) {
  test(`K1 farten, ${kind}: taendt koster hoejst ${extraCalls} kald og ${extraRounds} ventetider mere end slukket`, async () => {
    const over = [];
    for (const name of SPEED_SCENARIOS) for (const key of SPEED_KEYS.filter((k) => k.startsWith(`${kind}|`))) {
      const off = countCalls((await runSurface(name, undefined, key)).log);
      const on = countCalls((await runSurface(name, "on", key)).log);
      if (on.kald - off.kald > extraCalls || on.runder - off.runder > extraRounds) {
        over.push(`${name} / ${key}: +${on.kald - off.kald} kald, +${on.runder - off.runder} ventetider`);
      }
    }
    assert.deepEqual(over, []);
  });
}

// Traening: traethedsdelen henter ogsaa rytternes naeste etape (fem opslag efter hinanden, deles med
// traeningsmotoren og roeres ikke) og om aftenen aftenens prognose. Derfor maales den mod main taendt:
// mindst fire faerre kald (intet laeses to gange) og mindst ti faerre ventetider (de to kaeder sendes samtidig).
test("K1 farten, Traening: mindst 4 faerre kald og mindst 10 faerre ventetider end paa main taendt", async () => {
  const over = [];
  for (const name of SPEED_SCENARIOS) for (const team of TEAM_IDS) {
    const key = `traening|${team}`;
    const main = FACIT.kontakt.on[name][key];
    const on = countCalls((await runSurface(name, "on", key)).log);
    if (on.kald > main.kald - 4 || on.runder > main.runder - 10) over.push(`${name} / ${key}: ${on.kald} kald og ${on.runder} ventetider (main: ${main.kald} og ${main.runder})`);
  }
  assert.deepEqual(over, []);
});

// ── K2: Race Hub ──────────────────────────────────────────────────────────────────────────────
// Paa main kalder Race Hub udtagelsen én gang pr. loebskolonne, efter hinanden: 5 kolonner koster
// 44 kald/24 runder slukket og 110 kald/85 runder taendt for hold A. Ruten ligger i api.js og kan ikke
// koeres i en proeve, saa kravet maales paa en soem i raceSelection.js:
//   getSelectionContextsForRaces({ supabase, races, teamId, now }) -> én kontekst pr. loeb, i samme raekkefoelge,
//   hver praecis lig getSelectionContext for det loeb.
// Navnet er dommerens. Vil byggeren have en anden soem, saa kom til dommeren foerst.
test("K2 Race Hub: soemmen getSelectionContextsForRaces findes", () => {
  assert.equal(typeof boardFunction(), "function", "raceSelection.js skal eksportere getSelectionContextsForRaces({ supabase, races, teamId, now })");
});

for (const name of SPEED_SCENARIOS) for (const team of TEAM_IDS) {
  test(`K2 Race Hub, ${name} / ${team}: samme svar pr. kolonne, slukket praecis som i dag, taendt uden en raekke ventetider pr. kolonne`, async () => {
    const board = boardFunction();
    assert.equal(typeof board, "function", "soemmen mangler");
    const main = FACIT.racehub[name][team];
    const off = await runBoard(name, undefined, team, board);
    assert.deepEqual({ svar: off.svar, kald: off.kald, runder: off.runder, form: off.form }, main.mangler, "slukket: samme svar og samme kald som kolonnerne efter hinanden paa main");
    const on = await runBoard(name, "on", team, board);
    assert.deepEqual(on.svar, main.on.svar, "taendt: hver kolonne har praecis samme svar som paa main");
    const columns = RACEHUB_RACES.length;
    const maxCalls = main.mangler.kald + 9 + 2 * (columns - 1);
    const maxRounds = main.mangler.runder + 4;
    assert.ok(on.kald <= maxCalls, `taendt: ${on.kald} kald for ${columns} kolonner (main: ${main.on.kald}). Hoejst ${maxCalls}.`);
    assert.ok(on.runder <= maxRounds, `taendt: ${on.runder} ventetider for ${columns} kolonner (main: ${main.on.runder}). Hoejst ${maxRounds}, uanset antal kolonner.`);
  });
}

test("K2 Race Hub: ruten i api.js bruger soemmen og kalder ikke laengere udtagelsen én gang pr. kolonne", () => {
  const src = readFileSync(new URL("../routes/api.js", import.meta.url), "utf8");
  assert.match(src, /getSelectionContextsForRaces\(\{/, "Race Hub-ruten skal kalde getSelectionContextsForRaces");
  assert.doesNotMatch(src, /for \(const race of cols\) \{\s*const ctx = await getSelectionContext\(/, "kolonneloekken med ét kald pr. loeb skal vaere vaek");
});

// ── Laesefejl: faelles regel ──────────────────────────────────────────────────────────────────
// For hver flade, hvert maal fladen laeser med kontakten taendt, og hver fejlmaade (fejlsvar, kort
// gateway-fejl, kast): hver rytter har enten det rigtige tal eller intet tal. Fladen maa ogsaa falde
// helt ud (kast eller fejlstatus), som i dag, naar det er fladens egne grunddata, der mangler.
// Undtaget er selve kontakten: kan den ikke laeses, er funktionen slukket (en fejl maa aldrig taende den).
const FLAG = "app_config:fatigue_now_7801";
async function wrongNumbers(name, key, target, mode) {
  const right = new Map(fatigueNumbers(key, (await runSurface(name, "on", key)).svar));
  const { svar } = await runWithFailure(name, key, target, mode);
  if (svar?.kastet) return [];
  if (key.startsWith("regelpanel|") && svar.status !== 200) return [];
  return (fatigueNumbers(key, svar) ?? []).filter(([id, fatigue]) => fatigue !== null && fatigue !== right.get(id)).map(([id]) => id);
}
async function sweep(name, key, pick) {
  const bad = [];
  for (const target of (await targetsRead(name, key)).filter((t) => t !== FLAG && pick(t))) for (const mode of FAIL_MODES) {
    const wrong = await wrongNumbers(name, key, target, mode);
    if (wrong.length) bad.push(`${target} (${mode}): forkert tal for ${wrong.length} ${wrong.length === 1 ? "rytter" : "ryttere"}`);
  }
  return bad;
}
const isMedical = (target) => MEDICAL_TABLES.includes(target);
const FAILURE_SCENARIOS = ["midt_paa_dagen", "traen_nu_trykket"];
const SCREENS = ["udtagelse|r-etape|team-a", "udtagelse|r-imorgen|team-a", "holdfane|r-etape|team-a", "rytterkort|a2|team-a", "rytterkort|a8|team-a", "traening|team-a"];

// ── K3: "ukendt" paa regelpanelet ─────────────────────────────────────────────────────────────
// Koden i dag: routes/trainingFatigueRules.js linje 108 kalder fatigueByRiderNow uden onError: "throw",
// saa en laesefejl giver morgenens tal, og linje 109 goer et manglende tal til tallet fra morgenen eller 0.
for (const name of FAILURE_SCENARIOS) {
  test(`K3 ukendt, ${name}: kan dagens etaper ikke laeses, svarer regelpanelet uden tal (null), ikke med morgenens tal`, async () => {
    const key = "regelpanel|team-a";
    for (const mode of FAIL_MODES) {
      const { svar } = await runWithFailure(name, key, "training_race_loads", mode);
      if (name === "traen_nu_trykket" && svar.status !== 200) continue; // et Traen nu-stempel uden bevis maa stadig faelde hele svaret
      assert.equal(svar.status, 200, `${mode}: panelet skal stadig svare, saa taelleren kan vise ukendt`);
      assert.equal(svar.body.enabled, true);
      assert.equal(svar.body.fatigueNow, true);
      const withNumber = svar.body.roster.filter((r) => r.id !== "a5" && r.fatigue !== null).map((r) => r.id);
      const stamped = name === "traen_nu_trykket" ? ["a1", "a4", "a6"] : [];
      assert.deepEqual(withNumber.filter((id) => !stamped.includes(id)), [], `${mode}: ryttere uden et beregnet tal skal have fatigue null`);
    }
  });
  test(`K3 ukendt, ${name}: regelpanelet viser aldrig et forkert tal ved nogen laesefejl`, async () => {
    assert.deepEqual(await sweep(name, "regelpanel|team-a", (t) => !isMedical(t)), []);
  });
}

// ── K4: laegeopslaget ─────────────────────────────────────────────────────────────────────────
// Koden i dag: riderFatigueNow.js linje 231 kalder loadMedicalBonusByTeam uden retryOnTransient, og
// trainingStaffContext.js linje 111 til 131 svarer da "ingen afdeling" ved enhver fejl. Tallet regnes
// saa uden bonus og staar for hoejt, uden en streg.
for (const name of FAILURE_SCENARIOS) for (const key of [...SCREENS, "regelpanel|team-a"]) {
  test(`K4 laegeopslaget fejler, ${name} / ${key}: streg eller det rigtige tal, aldrig tallet uden bonus`, async () => {
    assert.deepEqual(await sweep(name, key, isMedical), []);
  });
}

// ── K5: enhver anden laesefejl ────────────────────────────────────────────────────────────────
// Roed paa main for udtagelsen: raceSelection.js linje 580 og 587 tjekker ikke, om opslaget af rytternes
// evner fejlede, saa tallet regnes med standard-restitution (50) for alle.
for (const name of FAILURE_SCENARIOS) for (const key of SCREENS) {
  test(`K5 enhver anden laesefejl, ${name} / ${key}: streg eller det rigtige tal, aldrig et forkert tal`, async () => {
    assert.deepEqual(await sweep(name, key, (t) => !isMedical(t)), []);
  });
}

test("K5 undtagelsen er kun selve kontakten: kan den ikke laeses, er funktionen slukket som i dag", async () => {
  for (const mode of FAIL_MODES) {
    const failed = (await runWithFailure("midt_paa_dagen", "udtagelse|r-etape|team-a", FLAG, mode)).svar;
    const off = (await runSurface("midt_paa_dagen", undefined, "udtagelse|r-etape|team-a")).svar;
    assert.deepEqual(fatigueNumbers("udtagelse|r-etape|team-a", failed), fatigueNumbers("udtagelse|r-etape|team-a", off), mode);
  }
  assert.equal(flagName(undefined), "mangler");
});
