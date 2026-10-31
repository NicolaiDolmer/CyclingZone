// #5950: harnessens rene dele. Syntetiske tal (hard rule 17), ikke kalibreringen.
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGE_GROUPS, ROLES, ageGroupFor, runHarness, syntheticPopulation, toVerdictMarkdown, yieldRatio,
} from "./raceDayRoleYieldSim5950.mjs";

const PARAMS = Object.freeze({ stageBonus: 0.5, leadShare: 0.6 });

test("#5950 harness: aldersgrupper daekker 17-33 uden huller", () => {
  for (let age = 17; age <= 33; age += 1) assert.ok(ageGroupFor(age), String(age));
  assert.equal(ageGroupFor(16), null);
  assert.deepEqual(AGE_GROUPS.map((g) => g.key), ["junior", "u23", "senior"]);
});

test("#5950 harness: populationen er deterministisk og daekker alle aldersgrupper", () => {
  const a = syntheticPopulation();
  const b = syntheticPopulation();
  assert.deepEqual(a, b);
  for (const g of AGE_GROUPS) assert.ok(a.some((r) => ageGroupFor(r.age) === g.key), g.key);
});

test("#5950 harness: loebsdagen giver aldrig mindre end en haard dag, og intet tillaeg = praecis en haard dag", () => {
  const rider = syntheticPopulation().find((r) => r.age === 24);
  for (const role of ROLES) {
    assert.ok(yieldRatio(rider, "flat", role, PARAMS) >= 1, role);
    assert.ok(Math.abs(yieldRatio(rider, "flat", role, { stageBonus: 0, leadShare: 0.6 }) - 1) < 1e-12, role);
  }
});

test("#5950 harness: dommen er inside/outside pr. aldersgruppe og rolle, uden tal i markdown", () => {
  const population = syntheticPopulation().filter((r) => r.potentiale === 3 && [17, 20, 26].includes(r.age));
  const wide = runHarness({ params: PARAMS, band: { min: 1, max: 10 }, population });
  assert.equal(wide.allInside, true);
  const narrow = runHarness({ params: PARAMS, band: { min: 1, max: 1 }, population });
  assert.equal(narrow.allInside, false);
  const md = toVerdictMarkdown(wide);
  for (const g of AGE_GROUPS) assert.ok(md.includes(`| ${g.key} |`));
  assert.ok(!/\d\.\d/.test(md), "ingen decimaltal i dommen");
});
