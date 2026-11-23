// #8546: ryttere uden plan (og kun gammel ugerytme) faar det koerte niveau paa score-raekken.
//
// Facit (effortLevelsNoPlan8546.golden.json) er frosset paa merge-basen (#7587); se generatoren
// effortLevelsNoPlan8546.golden.mjs. Kravene:
//   1. kontakten off (manglende, off, beta): hele udfaldet er basens, bit for bit.
//   2. kontakten on: traeningen (alt undtagen det koerte niveau) er basens for ALLE ryttere.
//   3. kontakten on: hver raekke fra datoens pas har det koerte niveau, lig kvitteringens intensitet;
//      en rytter uden plan koerer og gemmes paa Mellem.
//   4. kontakten on: en rytter der koerer paa sessionens eget niveau (fx en plan paa standardniveau)
//      klassificeres af bremsen praecis som paa basen. Kun ryttere hvis koerte niveau afviger fra
//      tabellen, taelles anderledes, og saa efter det de koerte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { runScenario, fingerprint, brakeLevel, SCENARIOS, FLAG_VARIANTS } from "./effortLevelsNoPlan8546.golden.mjs";
import { executedEffortForScore } from "./trainingEffortLevels.js";
import { SESSION_INTENSITY_V3 } from "./trainingDayTypes.js";
import { computeSeasonLoad } from "./seasonDevelopmentLoad.js";

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(readFileSync(join(here, "effortLevelsNoPlan8546.golden.json"), "utf8"));

const quiet = async (fn) => {
  const { warn, log } = console;
  console.warn = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.warn = warn; console.log = log; }
};

const runs = new Map();
async function run(name, variant, flags = FLAG_VARIANTS[variant]) {
  const key = `${name}|${variant}`;
  if (!runs.has(key)) runs.set(key, await quiet(() => runScenario(name, flags)));
  return runs.get(key);
}
const receiptFor = (state, row) => state.training_rider_ticks
  ?.find((t) => t.rider_id === row.rider_id && t.game_day === row.game_day)?.report ?? null;
const passRow = (row) => row.was_race_day === false && row.session != null;
const planRiders = (state) => new Set((state.training_plans ?? []).map((p) => p.rider_id));

test("facit er fra merge-basen og daekker alle scenarier og kontakt-varianter", () => {
  assert.match(GOLDEN.mergeBase, /^[0-9a-f]{40}$/);
  for (const name of SCENARIOS) for (const variant of Object.keys(FLAG_VARIANTS)) assert.ok(GOLDEN.scenarios[name]?.[variant], `${name}/${variant}`);
  // Paa basen var on lig off for disse hold: kontakten blev aldrig laest (fejlen i #8546).
  for (const name of SCENARIOS) assert.equal(GOLDEN.scenarios[name].on.full, GOLDEN.scenarios[name].off.full, name);
});

test("krav 1: kontakten off, manglende eller beta = basens udfald bit for bit", async () => {
  for (const name of SCENARIOS) {
    for (const variant of ["missing", "off"]) {
      const now = fingerprint(await run(name, variant));
      assert.deepEqual(now, GOLDEN.scenarios[name][variant], `${name}/${variant} (merge-base ${GOLDEN.mergeBase})`);
    }
    const beta = fingerprint(await run(name, "beta", { training_effort_levels: "beta" }));
    assert.deepEqual(beta, GOLDEN.scenarios[name].off, `${name}/beta`);
  }
});

test("krav 2: kontakten on roerer ikke traeningen; kun det koerte niveau paa scoren er nyt", async () => {
  for (const name of SCENARIOS) {
    const now = fingerprint(await run(name, "on"));
    assert.equal(now.training, GOLDEN.scenarios[name].on.training, `${name}: traeningen er basens`);
    assert.notEqual(now.full, GOLDEN.scenarios[name].on.full, `${name}: score-raekkerne har nu det koerte niveau`);
  }
});

test("krav 3: kontakten on: hver raekke fra datoens pas har kvitteringens koerte niveau", async () => {
  for (const name of SCENARIOS) {
    const { state } = await run(name, "on");
    const rows = state.rider_training_scores ?? [];
    assert.ok(rows.some(passRow), `${name}: scenariet har traeningsraekker`);
    for (const row of rows.filter(passRow)) {
      assert.ok("intensity" in row, `${name}: ${row.rider_id} har noeglen`);
      const receipt = receiptFor(state, row);
      assert.ok(receipt, `${name}: kvittering for ${row.rider_id} dag ${row.game_day}`);
      assert.equal(row.intensity, executedEffortForScore(receipt.intensity), `${name}: ${row.rider_id} dag ${row.game_day}`);
    }
    // Loebsdage gemmer intet niveau (bremsen ser dem aldrig som traening).
    for (const row of rows.filter((r) => r.was_race_day)) assert.equal(row.intensity ?? null, null, `${name}: loebsdag ${row.rider_id}`);
  }
});

test("krav 3: uden plan koeres og gemmes Mellem (assistentens fokus), ogsaa via trykket", async () => {
  for (const name of ["noPlanOnly", "noPlanPress"]) {
    const { state } = await run(name, "on");
    const rows = (state.rider_training_scores ?? []).filter(passRow);
    assert.ok(rows.length > 0, name);
    assert.ok(rows.every((row) => row.intensity === "normal"), `${name}: alle uden plan paa Mellem`);
    // Fejlen: tabel-niveauet ville taelle mindst én af dem som en haard dag.
    assert.ok(rows.some((row) => SESSION_INTENSITY_V3[row.session] === "hard"), `${name}: mindst én session er haard i tabellen`);
    const before = computeSeasonLoad({ trainingRows: rows.map(({ intensity: _l, ...r }) => r) });
    const after = computeSeasonLoad({ trainingRows: rows });
    assert.ok([...before.values()].some((v) => v.hardDays > 0), `${name}: basen talte haarde dage`);
    assert.ok([...after.values()].every((v) => v.hardDays === 0), `${name}: Mellem er ingen haard dag`);
  }
});

test("krav 4: ryttere der koerer paa sessionens eget niveau taelles af bremsen praecis som paa basen", async () => {
  let same = 0, changed = 0;
  for (const name of SCENARIOS) {
    const { state } = await run(name, "on");
    const now = fingerprint({ state, answers: [] }).brake;
    const base = GOLDEN.scenarios[name].on.brake;
    assert.deepEqual(Object.keys(now).sort(), Object.keys(base).sort(), `${name}: samme ryttere har score-raekker`);
    const rowsByRider = Map.groupBy(state.rider_training_scores ?? [], (row) => row.rider_id);
    for (const [riderId, rows] of rowsByRider) {
      const atTableLevel = rows.filter(passRow).every((row) => row.intensity === SESSION_INTENSITY_V3[row.session]);
      if (atTableLevel) {
        assert.equal(now[riderId], base[riderId], `${name}: ${riderId} koerer paa tabel-niveauet og taelles som paa basen`);
        same += 1;
      } else {
        // Afviger det koerte niveau, er klassifikationen det koerte niveau (krav 3), ikke tabellen.
        assert.notEqual(now[riderId], base[riderId], `${name}: ${riderId}`);
        assert.ok(rows.filter(passRow).every((row) => brakeLevel(row) === row.intensity), `${name}: ${riderId}`);
        changed += 1;
      }
    }
  }
  assert.ok(same > 0 && changed > 0, `begge slags ryttere er daekket (${same} uaendrede, ${changed} rettede)`);
  // standardOnly: alle har en plan paa sessionens eget niveau, og bremsen er basens for hele holdet.
  const { state } = await run("standardOnly", "on");
  assert.deepEqual(fingerprint({ state, answers: [] }).brake, GOLDEN.scenarios.standardOnly.on.brake, "standardOnly");
  assert.ok((state.rider_training_scores ?? []).every((row) => !passRow(row) || planRiders(state).has(row.rider_id)));
});

test("kontakten laeses for hvert hold uden programceller og plan paa andet niveau", async () => {
  for (const name of ["noPlanOnly", "standardOnly"]) {
    const { fake } = await run(name, "on");
    assert.ok(fake.effortSwitchReads.length > 0, `${name}: kontakten blev laest`);
  }
});
