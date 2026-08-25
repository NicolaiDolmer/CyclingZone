import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateActiveSeasonInvariant } from "./activeSeasonInvariant.js";

// #4229. Den 25/8 stod spillet uden aktiv saeson i ca. fire timer, fordi
// kalender-regenereringen kraever `status='upcoming'` og ingen satte den tilbage.
// Alder, rangliste, daglig traening og akademi-flytning laa nede for alle
// spillere imens.
//
// Nattevagten ville have rapporteret GROENT hele vejen igennem: alle fire
// kalender-invarianter svarer ordret "OK — ingen aktiv saeson at kontrollere"
// naar der ingen aktiv saeson er. Vagten var altsaa mest tavs praecis naar
// spillet var mest i stykker. Denne invariant er den der raaber op.

test("praecis én aktiv saeson er groent", () => {
  const r = evaluateActiveSeasonInvariant([{ id: "s3", number: 3, status: "active" }]);
  assert.equal(r.ok, true);
  assert.match(r.detail, /saeson 3/);
});

test("NUL aktive saesoner er ROEDT - det er selve hullet", () => {
  const r = evaluateActiveSeasonInvariant([]);
  assert.equal(r.ok, false);
  assert.match(r.detail, /ingen aktiv saeson/i);
  assert.equal(r.violations.length, 1);
});

test("to aktive saesoner er ROEDT - kalendere og stillinger ville blande sig", () => {
  const r = evaluateActiveSeasonInvariant([
    { id: "s2", number: 2, status: "active" },
    { id: "s3", number: 3, status: "active" },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.detail, /2 aktive/);
});

test("null/undefined behandles som nul aktive, ikke som en fejl i vagten selv", () => {
  assert.equal(evaluateActiveSeasonInvariant(null).ok, false);
  assert.equal(evaluateActiveSeasonInvariant(undefined).ok, false);
});

test("violation-raekken baerer nok til at handle paa den", () => {
  const r = evaluateActiveSeasonInvariant([]);
  const v = r.violations[0];
  assert.equal(v.active_count, 0);
  assert.ok(v.hint.includes("upcoming"), "skal pege paa den kendte aarsag: en saeson efterladt som 'upcoming'");
});
