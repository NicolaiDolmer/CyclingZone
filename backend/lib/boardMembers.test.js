import test from "node:test";
import assert from "node:assert/strict";

import {
  computeGoalOwnerArchetypeKey,
  resolveGoalOwnerArchetypeKey,
  stampGoalOwner,
  stampGoalsOwners,
} from "./boardMembers.js";

// #3514 S-M2a · Stabilt mål-ejerskab (addendum "Stemme-kontrakten" punkt 1).
// Se boardMembers.js for kontrakt-teksten. Disse tests dækker kun
// ejerskabs-mekanikken, ikke resten af boardMembers.js (dækket indirekte af
// boardEngine.test.js/boardMandate.test.js).

const SPONSOR_ECONOMY_MEMBERS = [
  { archetype_key: "sponsoraten", is_chairman: true },
  { archetype_key: "ungdomsidealisten", is_chairman: false },
  { archetype_key: "resultatjaegeren", is_chairman: false },
];

// ── computeGoalOwnerArchetypeKey ─────────────────────────────────────────────

test("computeGoalOwnerArchetypeKey vaelger arketypen med hoejest category_alignment", () => {
  const owner = computeGoalOwnerArchetypeKey({ assignedMembers: SPONSOR_ECONOMY_MEMBERS, category: "economy" });
  assert.equal(owner, "sponsoraten"); // sponsoraten.category_alignment.economy = 1.0, højest i settet
});

test("computeGoalOwnerArchetypeKey falder tilbage til chairman uden kategori", () => {
  const owner = computeGoalOwnerArchetypeKey({ assignedMembers: SPONSOR_ECONOMY_MEMBERS, category: null });
  assert.equal(owner, "sponsoraten"); // chairman i settet
});

test("computeGoalOwnerArchetypeKey er uafhaengig af input-raekkefoelgen (deterministisk)", () => {
  const shuffled = [...SPONSOR_ECONOMY_MEMBERS].reverse();
  const a = computeGoalOwnerArchetypeKey({ assignedMembers: SPONSOR_ECONOMY_MEMBERS, category: "identity" });
  const b = computeGoalOwnerArchetypeKey({ assignedMembers: shuffled, category: "identity" });
  assert.equal(a, b);
});

test("computeGoalOwnerArchetypeKey returnerer fallbackChairmanKey naar der ingen medlemmer er", () => {
  const owner = computeGoalOwnerArchetypeKey({ assignedMembers: [], category: "economy", fallbackChairmanKey: "pragmatikeren" });
  assert.equal(owner, "pragmatikeren");
});

// ── stampGoalOwner / stampGoalsOwners: sæt ÉN gang ──────────────────────────

test("stampGoalOwner saetter owner_archetype_key ud fra maalets kategori", () => {
  const goal = { type: "no_outstanding_debt", category: "economy", target: 0 };
  const stamped = stampGoalOwner(goal, { assignedMembers: SPONSOR_ECONOMY_MEMBERS });
  assert.equal(stamped.owner_archetype_key, "sponsoraten");
  // Originalen er ikke muteret.
  assert.equal("owner_archetype_key" in goal, false);
});

test("stampGoalOwner er en no-op naar owner_archetype_key allerede er sat (ejerskab skifter aldrig)", () => {
  const goal = { type: "no_outstanding_debt", category: "economy", target: 0, owner_archetype_key: "ungdomsidealisten" };
  const stamped = stampGoalOwner(goal, { assignedMembers: SPONSOR_ECONOMY_MEMBERS });
  assert.equal(stamped, goal); // samme reference, intet nyt objekt oprettet
  assert.equal(stamped.owner_archetype_key, "ungdomsidealisten");
});

test("ejerskabs-stabilitet: samme mål beholder samme ejer over flere evalueringer, selv når assignedMembers skifter", () => {
  const original = { type: "no_outstanding_debt", category: "economy", target: 0 };
  const evaluation1 = stampGoalOwner(original, { assignedMembers: SPONSOR_ECONOMY_MEMBERS });
  assert.equal(evaluation1.owner_archetype_key, "sponsoraten");

  // En senere evaluering (fx efter chairman-udskiftning) sender ANDRE assignedMembers ind,
  // men målet har allerede sin ejer persisteret, den må IKKE genberegnes.
  const laterMembers = [
    { archetype_key: "traditionalisten", is_chairman: true },
    { archetype_key: "klassiker_purist", is_chairman: false },
  ];
  const evaluation2 = stampGoalOwner(evaluation1, { assignedMembers: laterMembers });
  assert.equal(evaluation2.owner_archetype_key, "sponsoraten");
});

test("stampGoalsOwners stempler en hel maal-liste", () => {
  const goals = [
    { type: "no_outstanding_debt", category: "economy", target: 0 },
    { type: "min_u25_riders", category: "identity", target: 5 },
  ];
  const stamped = stampGoalsOwners(goals, { assignedMembers: SPONSOR_ECONOMY_MEMBERS });
  assert.equal(stamped[0].owner_archetype_key, "sponsoraten");
  assert.equal(stamped[1].owner_archetype_key, "ungdomsidealisten");
});

// ── resolveGoalOwnerArchetypeKey: læse-tids-afledning, skriver ALDRIG tilbage ─

test("resolveGoalOwnerArchetypeKey bruger det persisterede felt naar det findes", () => {
  const goal = { category: "economy", owner_archetype_key: "gc_elsker" };
  const resolved = resolveGoalOwnerArchetypeKey({ goal, assignedMembers: SPONSOR_ECONOMY_MEMBERS });
  assert.equal(resolved, "gc_elsker");
});

test("resolveGoalOwnerArchetypeKey afleder med samme regel for et historisk maal uden feltet", () => {
  const goal = { category: "economy" };
  const resolved = resolveGoalOwnerArchetypeKey({ goal, assignedMembers: SPONSOR_ECONOMY_MEMBERS });
  assert.equal(resolved, "sponsoraten");
  // Ren funktion: kaldet må ikke have muteret input-goal'et (ingen write-back).
  assert.equal("owner_archetype_key" in goal, false);
});
