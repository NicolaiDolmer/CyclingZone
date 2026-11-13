// #7801 rest-byg: "samme tal som foer" og "slukket er uaendret". Skrevet af den uafhaengige dommer
// FOER foerste kodelinje (AGENTS.md regel 40). Ejes af dommeren; byggeren aendrer ikke filen.
//
// GROEN paa main. Skal ogsaa vaere groen paa rest-byggets PR. Facit
// (__fixtures__/dommer7801RestBygFacit.json) er frosset paa origin/main FOER ombygningen og maa
// aldrig genskabes med ny kode: flytter et aftryk sig, har byggeriet aendret noget, der skulle staa
// stille. Facit er fingeraftryk og antal, aldrig tal (hard rule 17). Decimaltal er afrundet foer
// hash (#8113), saa Windows og Linux giver samme aftryk.
//
//   S1  Slukket: hvert svar og hvert databasekald er praecis som paa main (tre slukkede vaerdier).
//   S2  Taendt: hvert svar paa hver flade er praecis som paa main.
//   S3  Loebsmotorens indgang er urort: samme svar og samme kald, uanset kontakten.
//   S4  Taendt koster aldrig flere kald eller ventetider end paa main.
//   S5  Race Hub som i dag (kolonnerne efter hinanden) giver facit; soemmen i krav-filen maales mod det.
//   S6  Veje, der ikke er en skaerm, opfoerer sig som paa main, naar laegeopslaget fejler.
//   S7  Vagter: samme tal paa alle flader og i motoren; scenarierne rammer det, de skal.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  OFF_FLAGS, SCENARIO_NAMES, SURFACE_KEYS, TEAM_IDS, boardAsOnMain, enginePathsUnderMedicalFailure,
  fatigueNumbers, flagName, runAll, runBoard, runSurface,
} from "./dommer7801RestByg.harness.mjs";

const FACIT = JSON.parse(readFileSync(new URL("./__fixtures__/dommer7801RestBygFacit.json", import.meta.url), "utf8"));
const now = {};
for (const flag of [...OFF_FLAGS, "on"]) now[flagName(flag)] = await runAll(flag);

const diff = (flag, fields, { only = () => true, atMost = false } = {}) => {
  const out = [];
  for (const name of SCENARIO_NAMES) for (const { key, slags } of SURFACE_KEYS) {
    if (!only({ key, slags, name })) continue;
    const a = now[flag][name][key]; const b = FACIT.kontakt[flag][name][key];
    for (const f of fields) {
      const bad = atMost ? a[f] > b[f] : a[f] !== b[f];
      if (bad) out.push(`${name} / ${key} / ${f}${typeof a[f] === "number" ? `: ${a[f]} mod ${b[f]} paa main` : ""}`);
    }
  }
  return out;
};

test("facit daekker hele saettet", () => {
  assert.deepEqual(FACIT.scenarier, SCENARIO_NAMES);
  assert.equal(FACIT.flader, SURFACE_KEYS.length);
  for (const flag of [...OFF_FLAGS.map(flagName), "on"]) {
    for (const name of SCENARIO_NAMES) assert.equal(Object.keys(FACIT.kontakt[flag][name]).length, SURFACE_KEYS.length, `${flag} / ${name}`);
  }
});

for (const flag of OFF_FLAGS.map(flagName)) {
  test(`S1 slukket (${flag}): hvert svar og hvert kald er praecis som paa main`, () => {
    assert.deepEqual(diff(flag, ["svar", "kald", "runder", "form"]), []);
  });
}

test("S2 taendt: hvert svar paa hver flade er praecis som paa main", () => {
  assert.deepEqual(diff("on", ["svar"]), []);
});

test("S3 loebsmotorens indgang er urort: samme svar og samme kald, ogsaa med kontakten taendt", () => {
  assert.deepEqual(diff("on", ["svar", "kald", "runder", "form"], { only: ({ slags }) => slags === "motor" }), []);
});

test("S4 taendt koster aldrig flere kald eller ventetider end paa main", () => {
  assert.deepEqual(diff("on", ["kald", "runder"], { atMost: true }), []);
});

test("S5 Race Hub som i dag (kolonnerne efter hinanden) giver facit", async () => {
  for (const name of SCENARIO_NAMES) for (const team of TEAM_IDS) for (const flag of [undefined, "on"]) {
    const { svar, kald, runder, form } = await runBoard(name, flag, team, boardAsOnMain);
    assert.deepEqual({ svar, kald, runder, form }, FACIT.racehub[name][team][flagName(flag)], `${name} / ${team} / ${flagName(flag)}`);
  }
});

test("S6 veje, der ikke er en skaerm (motor, assistent, auto-udfyld, saesonplan), er som paa main, naar laegeopslaget fejler", async () => {
  assert.deepEqual(await enginePathsUnderMedicalFailure("midt_paa_dagen"), FACIT.motorvej_ved_laegefejl.midt_paa_dagen);
});

// ── S7: vagter (laeser tallene direkte; intet tal skrives ud) ─────────────────────────────────
const numbers = async (name, flag, key) => new Map(fatigueNumbers(key, (await runSurface(name, flag, key)).svar));

for (const name of ["midt_paa_dagen", "aften_alle_koert", "traen_nu_trykket", "laege_byttet"]) {
  test(`S7 taendt, ${name}: samme tal paa Traening, rytterkort, regelpanel, udtagelse og Hold-fane`, async () => {
    const training = await numbers(name, "on", "traening|team-a");
    assert.ok(training.size >= 9);
    const others = {
      regelpanel: await numbers(name, "on", "regelpanel|team-a"),
      udtagelse_loeb_i_morgen: await numbers(name, "on", "udtagelse|r-imorgen|team-a"),
      udtagelse_koert_loeb: await numbers(name, "on", "udtagelse|r-koert|team-a"),
      holdfane_loeb_i_morgen: await numbers(name, "on", "holdfane|r-imorgen|team-a"),
      saesonplan: await numbers(name, "on", "saesonplan|team-a"),
    };
    for (const [id, fatigue] of training) {
      assert.equal((await numbers(name, "on", `rytterkort|${id}|team-a`)).get(id), fatigue, `rytterkort ${id}`);
      for (const [label, map] of Object.entries(others)) if (map.has(id)) assert.equal(map.get(id), fatigue, `${label} ${id}`);
    }
  });
}

test("S7 taendt, midt paa dagen: fladernes tal er det tal, motoren starter rytteren paa ved naeste etape i dag", async () => {
  const surface = await numbers("midt_paa_dagen", "on", "udtagelse|r-etape|team-a");
  const tab = await numbers("midt_paa_dagen", "on", "holdfane|r-etape|team-a");
  const engine = (await runSurface("midt_paa_dagen", "on", "motor|r-etape|3")).svar.entrants;
  let checked = 0;
  for (const [id, fatigue] of engine) {
    if (!id.startsWith("a")) continue;
    assert.equal(surface.get(id), fatigue, `udtagelse ${id}`);
    assert.equal(tab.get(id), fatigue, `Hold-fane ${id}`);
    checked += 1;
  }
  assert.ok(checked >= 5);
});

test("S7 scenarierne rammer det, de skal", async () => {
  const off = await numbers("midt_paa_dagen", undefined, "udtagelse|r-etape|team-a");
  const on = await numbers("midt_paa_dagen", "on", "udtagelse|r-etape|team-a");
  // Flere etaper samme dag: tallet flytter sig. En let etape giver mere hvile end traethed: tallet falder.
  assert.ok(on.get("a1") > off.get("a1"), "rytter med to haarde etaper i dag");
  assert.ok(on.get("a2") < off.get("a2"), "rytter med to lette etaper i dag");
  // Rytter uden etaper, skadet rytter: uaendret. Rytter uden tilstand: streg.
  assert.equal(on.get("a4"), off.get("a4"));
  assert.equal(on.get("a3"), off.get("a3"));
  assert.equal(on.get("a5"), null);
  // Foer dagens foerste etape og paa en hviledag er taendt lig slukket.
  for (const name of ["morgen_foer_etaper", "hviledag", "model_v2_slukket"]) {
    assert.deepEqual([...await numbers(name, "on", "udtagelse|r-etape|team-a")], [...await numbers(name, undefined, "udtagelse|r-etape|team-a")], name);
  }
  // To hold: laegeafdelingen foelger holdet. Samme rytterdata paa to hold giver forskellige tal.
  const a = await numbers("aften_alle_koert", "on", "traening|team-a");
  const b = await numbers("aften_alle_koert", "on", "traening|team-b");
  assert.notEqual(a.get("a1"), b.get("b1"), "a1 og b1 er ens paa naer holdets laegeafdeling");
  // Traen nu: de tre slags stempler giver alle et tal, og det afregnede stempel bruger den gemte tilstand.
  const stamped = await numbers("traen_nu_trykket", "on", "traening|team-a");
  for (const id of ["a1", "a4", "a6"]) assert.equal(typeof stamped.get(id), "number", `stemplet ${id}`);
  // Skoennet ved start til en etape i morgen findes om aftenen (aftenens opgoerelse).
  const evening = (await runSurface("aften_alle_koert", "on", "traening|team-a")).svar;
  assert.equal(typeof evening.get("a1").fatigueAtStart, "number", "skoen ved start i morgen");
  assert.equal(evening.get("a4").fatigueAtStart, null, "ingen etape, intet skoen");
});

test("S7 samme udgangspunkt giver samme svar hver gang (intet vaegur, ingen tilfaeldighed)", async () => {
  const again = await runAll("on");
  assert.deepEqual(again, now.on);
});
