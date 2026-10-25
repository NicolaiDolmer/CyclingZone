// #6853 / #5764: de tre svar-former giver samme { lo, hi, role, showRole }.
import test from "node:test";
import assert from "node:assert/strict";
import {
  potentialFromAcademy,
  potentialFromEstimate,
  potentialFromReport,
  potentialRowFromReport,
} from "./potentialDisplay6853.ts";

test("estimate: flag slukket = tallet uden typeboks (dagens visning)", () => {
  assert.deepEqual(
    potentialFromEstimate({ prog: { lo: 40, hi: 48 }, role: "climber" }),
    { lo: 40, hi: 48, role: "climber", showRole: false },
  );
});

test("estimate: serverens bedste rolle giver typeboksen", () => {
  assert.deepEqual(
    potentialFromEstimate({ prog: { lo: 44, hi: 52 }, role: "puncheur", bestRole: true }),
    { lo: 44, hi: 52, role: "puncheur", showRole: true },
  );
});

test("estimate: ældre payload med kun ceil-alias virker stadig", () => {
  assert.equal(potentialFromEstimate({ ceil: { lo: 30, hi: 36 }, role: "gc" })?.lo, 30);
});

test("estimate: skjult, uden bånd eller uden data giver null", () => {
  assert.equal(potentialFromEstimate({ hidden: true, prog: { lo: 1, hi: 2 } }), null);
  assert.equal(potentialFromEstimate({ role: "climber" }), null);
  assert.equal(potentialFromEstimate(null), null);
  assert.equal(potentialFromEstimate(undefined), null);
});

test("estimate: ingen typeboks uden en rolle at vise", () => {
  assert.equal(potentialFromEstimate({ prog: { lo: 40, hi: 48 }, bestRole: true })?.showRole, false);
});

test("akademi: samme form som tabellerne, også via estimates", () => {
  const prognosis = { band: { lo: 31, hi: 57, role: "sprinter", bestRole: true } };
  const expected = { lo: 31, hi: 57, role: "sprinter", showRole: true };
  assert.deepEqual(potentialFromAcademy(prognosis), expected);
  assert.deepEqual(potentialFromEstimate({ academyPrognosis: prognosis }), expected);
  assert.equal(potentialFromAcademy({ band: null }), null);
  assert.equal(potentialFromAcademy({ band: { lo: 31, hi: null, role: "gc" } }), null);
  assert.equal(potentialFromAcademy({ band: { lo: 31, hi: 40, role: "gc" } })?.showRole, false);
});

const types = [
  { key: "climber", progLo: 40, progHi: 50 },
  { key: "puncheur", progLo: 44, progHi: 52 },
];

test("rapport: uden displayKey står tallet på den naturlige rolle", () => {
  assert.equal(potentialRowFromReport({ types, primaryKey: "climber" })?.key, "climber");
  assert.deepEqual(
    potentialFromReport({ types, primaryKey: "climber" }),
    { lo: 40, hi: 50, role: "climber", showRole: false },
  );
});

test("rapport: displayKey fra serveren vælger rækken og viser typeboksen", () => {
  assert.deepEqual(
    potentialFromReport({ types, primaryKey: "climber", displayKey: "puncheur" }),
    { lo: 44, hi: 52, role: "puncheur", showRole: true },
  );
});

test("rapport: samme rytter giver samme tal i tabellen og på Scouting-fanen", () => {
  const fromTable = potentialFromEstimate({ prog: { lo: 44, hi: 52 }, role: "puncheur", bestRole: true });
  const fromReport = potentialFromReport({ types, primaryKey: "climber", displayKey: "puncheur" });
  assert.deepEqual(fromTable, fromReport);
});

test("rapport: ukendt nøgle eller tom rapport giver null", () => {
  assert.equal(potentialFromReport({ types, primaryKey: "sprinter" }), null);
  assert.equal(potentialFromReport(null), null);
  assert.equal(potentialRowFromReport({ types: null, primaryKey: "climber" }), null);
});
