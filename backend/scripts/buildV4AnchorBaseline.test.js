// backend/scripts/buildV4AnchorBaseline.test.js
// #5572: `--population=`/`--out=` til side-om-side-maaling. Default skal vaere
// UAENDRET (den pinnede gate), og en anden population maa aldrig kunne
// overskrive v4-anker-baselinen — at flytte gaten er en ejerbeslutning.
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveRunTargets } from "./buildV4AnchorBaseline.mjs";

const GATE_POPULATION = "backend/scripts/baselines/population-snapshot-2026-09-07.json";
const GATE_OUT = "backend/scripts/baselines/v4-anchor-baseline.json";
const OTHER_POPULATION = "backend/scripts/baselines/population-snapshot-2026-09-24.json";

test("uden flag: den pinnede gate, praecis som foer", () => {
  assert.deepEqual(resolveRunTargets([]), { population: GATE_POPULATION, out: GATE_OUT, isGate: true });
});

test("anden population uden --out afvises (gaten flyttes ikke)", () => {
  assert.throws(() => resolveRunTargets([`--population=${OTHER_POPULATION}`]), /ejerbeslutning/);
});

test("anden population med --out peget paa baselinen afvises ogsaa", () => {
  assert.throws(
    () => resolveRunTargets([`--population=${OTHER_POPULATION}`, `--out=${GATE_OUT}`]),
    /ejerbeslutning/,
  );
});

test("paa Windows kan en anden bogstav-case ikke snige sig uden om gate-vagten", { skip: process.platform !== "win32" }, () => {
  assert.throws(
    () => resolveRunTargets([`--population=${OTHER_POPULATION}`, `--out=${GATE_OUT.toUpperCase()}`]),
    /ejerbeslutning/,
  );
});

test("anden population + --out andetsteds: tilladt, ikke gaten", () => {
  const t = resolveRunTargets([`--population=${OTHER_POPULATION}`, "--out=/tmp/x.json"]);
  assert.equal(t.population, OTHER_POPULATION);
  assert.equal(t.out, "/tmp/x.json");
  assert.equal(t.isGate, false);
});

test("gate-population til en anden --out: tilladt, ikke gaten", () => {
  const t = resolveRunTargets(["--out=/tmp/y.json"]);
  assert.equal(t.population, GATE_POPULATION);
  assert.equal(t.isGate, false);
});
