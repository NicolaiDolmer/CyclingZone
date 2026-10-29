// Selvtest for scripts/check-feature-registry-flags.mjs (#4921).
//
// Reglerne testes uden DB: evaluateFlags er ren, og det er praecis de fire
// regel-grene der afgoer om gaten er noget vaerd.

import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateFlags,
  findPendingFlagKeys,
  findStale,
  normalizeFlagValue,
  parseBaseRef,
} from "./check-feature-registry-flags.mjs";

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

test("dormant + flag on fejler, dormant + flag off er OK (#4928, identisk med building)", () => {
  const [fail] = evaluateFlags([entry({ flag: "f", state: "dormant" })], new Map([["f", "on"]]));
  assert.equal(fail.level, "FAIL");
  assert.match(fail.reason, /flaget er taendt/);
  const [ok] = evaluateFlags([entry({ flag: "f", state: "dormant" })], new Map([["f", "off"]]));
  assert.equal(ok.level, "OK");
});

test("ukendt flag-noegle fejler", () => {
  const [row] = evaluateFlags([entry({ flag: "mangler", state: "live" })], new Map());
  assert.equal(row.level, "FAIL");
  assert.match(row.reason, /findes ikke i prod app_config/);
});

test("poster uden flag evalueres ikke", () => {
  assert.deepEqual(evaluateFlags([entry({})], new Map()), []);
});

const seed = (value) =>
  `INSERT INTO public.app_config (key, value, description)\nVALUES ('new_flag', ${value}, 'x')\nON CONFLICT (key) DO NOTHING;`;

test("findPendingFlagKeys: migration der seeder off/false/beta er pending", () => {
  for (const v of [`'"off"'::jsonb`, `'false'::jsonb`, `'"beta"'::jsonb`, "false"]) {
    assert.deepEqual([...findPendingFlagKeys([seed(v)])], ["new_flag"], v);
  }
});

test("findPendingFlagKeys: migration der saetter on/true er IKKE pending", () => {
  for (const v of [`'"on"'::jsonb`, `'true'::jsonb`, "true", `'"ON"'::jsonb`]) {
    assert.equal(findPendingFlagKeys([seed(v)]).size, 0, v);
  }
});

test("findPendingFlagKeys: kun app_config-inserts, kun den praecise noegle, kommentarer ignoreres", () => {
  const other = `INSERT INTO public.other_table (key, value) VALUES ('new_flag', 'false'::jsonb);`;
  const commented = `-- INSERT INTO public.app_config (key, value) VALUES ('new_flag', 'false'::jsonb);`;
  assert.equal(findPendingFlagKeys([other, commented, ""]).size, 0);
  const multi = `INSERT INTO app_config (key, value) VALUES ('a_flag', '"off"'::jsonb), ('b_flag', 'true'::jsonb);`;
  assert.deepEqual([...findPendingFlagKeys([multi])], ["a_flag"]);
});

test("PR-kontekst: ny flag med pending-migration godkendes (PENDING)", () => {
  const pending = findPendingFlagKeys([seed(`'"off"'::jsonb`)]);
  const [row] = evaluateFlags([entry({ flag: "new_flag", state: "building" })], new Map(), pending);
  assert.equal(row.level, "PENDING");
});

test("PR-kontekst: migration der saetter on afvises (FAIL)", () => {
  const pending = findPendingFlagKeys([seed(`'"on"'::jsonb`)]);
  const [row] = evaluateFlags([entry({ flag: "new_flag", state: "live" })], new Map(), pending);
  assert.equal(row.level, "FAIL");
});

test("PR-kontekst: ingen migration for noeglen = FAIL som foer", () => {
  const pending = findPendingFlagKeys([seed(`'"off"'::jsonb`)]);
  const [row] = evaluateFlags([entry({ flag: "anden_flag" })], new Map(), pending);
  assert.equal(row.level, "FAIL");
});

test("push-kontekst (ingen baseRef): uaendret, FAIL for ukendt noegle", () => {
  assert.equal(parseBaseRef([], {}), null);
  assert.equal(parseBaseRef([], { GITHUB_EVENT_NAME: "push" }), null);
  assert.equal(parseBaseRef([], { GITHUB_EVENT_NAME: "pull_request" }), "origin/main");
  assert.equal(parseBaseRef(["--base-ref", "origin/dev"], {}), "origin/dev");
  const [row] = evaluateFlags([entry({ flag: "new_flag" })], new Map());
  assert.equal(row.level, "FAIL");
});

test("pending-noegle der findes i prod evalueres normalt", () => {
  const pending = new Set(["f"]);
  const [row] = evaluateFlags([entry({ flag: "f", state: "live" })], new Map([["f", "off"]]), pending);
  assert.equal(row.level, "FAIL");
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
