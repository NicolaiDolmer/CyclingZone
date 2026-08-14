import test from "node:test";
import assert from "node:assert/strict";
import { focusSignal, focusPanelRows, hasAnySignal, hasAnyPerSeason, FOCUS_SIGNAL } from "./trainingFocus.js";
import { TRAINING_FOCUS_KEYS, TRAINING_FOCUS_ABILITIES } from "./training.js";

test("focusSignal: strength er den eneste positive paastand", () => {
  assert.equal(focusSignal("strength"), FOCUS_SIGNAL.STRONG);
});

// PINNET, #3747. `limited` er den bucket hvor haandvaerks-evner (tag 0,95) og
// anden-rolle-evner (tag 0,70) lander SAMMEN. Chippen der oversatte den til
// "Limited upside for this rider type" sagde derfor det samme om to evner hvis
// lofter ligger 36 % fra hinanden. Panelet siger ingenting i stedet.
//
// Naar trin 4 (#3741) splitter bucketen i to, skal DENNE test aendres bevidst —
// det er hele pointen med at pinne den.
test("focusSignal: limited giver INGEN paastand, ikke en svag en", () => {
  assert.equal(focusSignal("limited"), FOCUS_SIGNAL.NONE);
});

// `blocked` er maalt uopnaaelig: 0 af 384 kombinationer paa baade main og
// #3741's konstanter. Mapningen beholdes alligevel, saa en fremtidig
// konstant-aendring giver et signal i stedet for tavshed.
test("focusSignal: blocked mapper stadig, selvom den er uopnaaelig i dag", () => {
  assert.equal(focusSignal("blocked"), FOCUS_SIGNAL.WEAK);
});

test("focusSignal: ukendt/manglende niveau gaetter ikke", () => {
  assert.equal(focusSignal(undefined), FOCUS_SIGNAL.NONE);
  assert.equal(focusSignal(null), FOCUS_SIGNAL.NONE);
  assert.equal(focusSignal("nonsens"), FOCUS_SIGNAL.NONE);
});

test("focusPanelRows: én raekke pr. fokus, i TRAINING_FOCUS_KEYS-raekkefoelge", () => {
  const rows = focusPanelRows({ trainability: null });
  assert.deepEqual(rows.map((r) => r.focus), [...TRAINING_FOCUS_KEYS]);
  for (const row of rows) {
    assert.deepEqual([...row.abilities], [...TRAINING_FOCUS_ABILITIES[row.focus]]);
  }
});

test("focusPanelRows: aktivt fokus markeres, og kun det", () => {
  const rows = focusPanelRows({ trainability: null, activeFocus: "sprint" });
  assert.deepEqual(rows.filter((r) => r.active).map((r) => r.focus), ["sprint"]);
});

test("focusPanelRows: assistentens default vises KUN naar rytteren intet har valgt", () => {
  const uden = focusPanelRows({ trainability: null, activeFocus: null, assistantFocus: "endurance" });
  assert.deepEqual(uden.filter((r) => r.isAssistantDefault).map((r) => r.focus), ["endurance"]);

  // Assistenten overskriver aldrig et managervalg (server-haandhaevet, #1894).
  const med = focusPanelRows({ trainability: null, activeFocus: "sprint", assistantFocus: "endurance" });
  assert.deepEqual(med.filter((r) => r.isAssistantDefault), []);
});

test("focusPanelRows: signalet oversaettes pr. fokus", () => {
  const rows = focusPanelRows({
    trainability: { sprint: "strength", endurance: "limited", technique: "blocked" },
  });
  const by = Object.fromEntries(rows.map((r) => [r.focus, r.signal]));
  assert.equal(by.sprint, FOCUS_SIGNAL.STRONG);
  assert.equal(by.endurance, FOCUS_SIGNAL.NONE);
  assert.equal(by.technique, FOCUS_SIGNAL.WEAK);
  // Fokus uden data i map'et gaetter ikke.
  assert.equal(by.vo2max, FOCUS_SIGNAL.NONE);
});

test("hasAnySignal: en rytter hvor ALT er limited faar ingen signal-kolonne", () => {
  const alt = Object.fromEntries(TRAINING_FOCUS_KEYS.map((k) => [k, "limited"]));
  assert.equal(hasAnySignal(focusPanelRows({ trainability: alt })), false);
  assert.equal(hasAnySignal(focusPanelRows({ trainability: { ...alt, sprint: "strength" } })), true);
  assert.equal(hasAnySignal([]), false);
  assert.equal(hasAnySignal(undefined), false);
});

// Point pr. sæson pr. fokus kommer foerst med trin 4 (#3741). Indtil da er
// kolonnen fravaerende — ikke tom, ikke nul, ikke et gaet.
test("hasAnyPerSeason: kolonnen findes foerst naar trin 4 fylder den", () => {
  assert.equal(hasAnyPerSeason(focusPanelRows({ trainability: null })), false);
  const med = focusPanelRows({ trainability: null, perSeason: { sprint: { sprint: 6.9 } } });
  assert.equal(hasAnyPerSeason(med), true);
  assert.deepEqual(med.find((r) => r.focus === "sprint").perSeason, { sprint: 6.9 });
});

test("hasAnyPerSeason: et tomt objekt pr. fokus taeller ikke som data", () => {
  const rows = focusPanelRows({ trainability: null, perSeason: { sprint: {} } });
  assert.equal(hasAnyPerSeason(rows), false);
});
