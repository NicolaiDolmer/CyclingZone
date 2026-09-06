// Selvtest for scripts/check-feature-registry-flags.mjs (#4921).
//
// Reglerne testes uden DB: evaluateFlags er ren, og det er praecis de fire
// regel-grene der afgoer om gaten er noget vaerd.

import assert from "node:assert/strict";
import test from "node:test";

import { evaluateFlags, findStale, normalizeFlagValue } from "./check-feature-registry-flags.mjs";

const entry = (over) => ({
  id: "x",
  area: "ops",
  title_en: "X",
  title_da: "X",
  state: "live",
  verified: "2026-09-06",
  ...over,
});

test("normalizeFlagValue haandterer boolean og streng ens", () => {
  assert.equal(normalizeFlagValue(true), "true");
  assert.equal(normalizeFlagValue(false), "false");
  assert.equal(normalizeFlagValue("ON"), "on");
  assert.equal(normalizeFlagValue(" beta "), "beta");
  assert.equal(normalizeFlagValue(null), "");
});

test("live kraever on/true", () => {
  const flags = new Map([["f", "off"]]);
  const [row] = evaluateFlags([entry({ flag: "f", state: "live" })], flags);
  assert.equal(row.level, "FAIL");
  assert.match(row.reason, /live kraever flag on\/true/);

  for (const value of ["on", "true"]) {
    const [ok] = evaluateFlags([entry({ flag: "f", state: "live" })], new Map([["f", value]]));
    assert.equal(ok.level, "OK", `${value} burde vaere OK`);
  }
});

test("beta kraever beta", () => {
  const [fail] = evaluateFlags([entry({ flag: "f", state: "beta" })], new Map([["f", "on"]]));
  assert.equal(fail.level, "FAIL");
  const [ok] = evaluateFlags([entry({ flag: "f", state: "beta" })], new Map([["f", "beta"]]));
  assert.equal(ok.level, "OK");
});

test("ikke-live/beta med taendt flag fejler", () => {
  for (const state of ["idea", "spec", "building", "retired"]) {
    const [row] = evaluateFlags([entry({ flag: "f", state })], new Map([["f", "on"]]));
    assert.equal(row.level, "FAIL", `${state} + on burde fejle`);
    const [ok] = evaluateFlags([entry({ flag: "f", state })], new Map([["f", "off"]]));
    assert.equal(ok.level, "OK", `${state} + off burde vaere OK`);
  }
});

test("ukendt flag-noegle fejler", () => {
  const [row] = evaluateFlags([entry({ flag: "mangler", state: "live" })], new Map());
  assert.equal(row.level, "FAIL");
  assert.match(row.reason, /findes ikke i prod app_config/);
});

test("poster uden flag evalueres ikke", () => {
  assert.deepEqual(evaluateFlags([entry({})], new Map()), []);
});

test("findStale flager kun poster aeldre end 60 dage", () => {
  const now = new Date("2026-09-06T12:00:00Z");
  const stale = findStale(
    [entry({ id: "frisk", verified: "2026-08-01" }), entry({ id: "gammel", verified: "2026-05-01" })],
    now,
  );
  assert.equal(stale.length, 1);
  assert.equal(stale[0].id, "gammel");
  assert.ok(stale[0].days > 60);
});
