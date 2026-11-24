import test from "node:test";
import assert from "node:assert/strict";
import { neighbours, otherUnsavedStages, sortPhoneRiders, type PhoneSortable } from "./tacticsPhoneModel.ts";

const rider = (id: string, role: string | null, n: Partial<PhoneSortable> = {}): PhoneSortable => ({
  id, name: id, role, routeMatch: null, rating: null, form: null, fatigue: null, ...n,
});

const team = [
  rider("Halvorsen", "helper", { routeMatch: 83, rating: 60, form: 50, fatigue: 40 }),
  rider("Peeters", "sprint_captain", { routeMatch: 44, rating: 70, form: 70, fatigue: 10 }),
  rider("Journal", "hunter", { routeMatch: 67, rating: 65, form: null, fatigue: 22 }),
  rider("Pedersen", "captain", { routeMatch: 88, rating: 80, form: 64, fatigue: 30 }),
  rider("Visser", "luxury_helper", { routeMatch: 61, rating: 55, form: 40, fatigue: null }),
  rider("Ahn", "helper", { routeMatch: 61, rating: 50, form: 45, fatigue: 12 }),
];

test("standard er rolle: kaptajnen først, spillets hierarki, navn ved lige rolle", () => {
  assert.deepEqual(sortPhoneRiders(team, "role").map((r) => r.id), ["Pedersen", "Peeters", "Journal", "Visser", "Ahn", "Halvorsen"]);
});

test("rutematch, rating og form: højeste først; lige tal står efter rolle", () => {
  assert.deepEqual(sortPhoneRiders(team, "routeMatch").map((r) => r.id), ["Pedersen", "Halvorsen", "Journal", "Visser", "Ahn", "Peeters"]);
  assert.deepEqual(sortPhoneRiders(team, "rating").map((r) => r.id), ["Pedersen", "Peeters", "Journal", "Halvorsen", "Visser", "Ahn"]);
  // Manglende form står sidst.
  assert.equal(sortPhoneRiders(team, "form").at(-1)?.id, "Journal");
});

test("træthed: den friskeste først, manglende tal sidst", () => {
  assert.deepEqual(sortPhoneRiders(team, "fatigue").map((r) => r.id), ["Peeters", "Ahn", "Journal", "Pedersen", "Halvorsen", "Visser"]);
});

test("sorteringen ændrer ikke listen den får", () => {
  const before = team.map((r) => r.id);
  sortPhoneRiders(team, "rating");
  assert.deepEqual(team.map((r) => r.id), before);
});

test("arkets forrige/næste følger listen og stopper i enderne", () => {
  assert.deepEqual(neighbours(["a", "b", "c"], "a"), { index: 0, prev: null, next: "b" });
  assert.deepEqual(neighbours(["a", "b", "c"], "b"), { index: 1, prev: "a", next: "c" });
  assert.deepEqual(neighbours(["a", "b", "c"], "c"), { index: 2, prev: "b", next: null });
  assert.deepEqual(neighbours(["a"], "x"), { index: -1, prev: null, next: null });
});

test("ugemte etaper: andre etapers ordrer, kladder og indsats, aldrig den åbne", () => {
  const base = { activeStage: 4, draftMatrix: {}, initialMatrix: {}, includeOrders: true, bulkStages: [] as number[] };
  assert.deepEqual(otherUnsavedStages({ ...base, ordersByStage: { 4: { a: 2 }, 3: { a: 1 } }, initialOrdersByStage: { 4: { a: 1 }, 3: { a: 1 } } }), []);
  assert.deepEqual(otherUnsavedStages({ ...base, ordersByStage: { 3: { a: 2 }, 5: { a: 1 } }, initialOrdersByStage: { 3: { a: 1 }, 5: { a: 1 } } }), [3]);
  assert.deepEqual(otherUnsavedStages({ ...base, ordersByStage: {}, initialOrdersByStage: {}, bulkStages: [5, 2, 4] }), [2, 5]);
  // Ordrer uden ordrevisning tæller ikke.
  assert.deepEqual(otherUnsavedStages({ ...base, includeOrders: false, ordersByStage: { 3: { a: 2 } }, initialOrdersByStage: { 3: { a: 1 } } }), []);
});

test("ugemte etaper: et rolleskift alene tæller ikke, en ændret indsats gør", () => {
  const initialMatrix = { 3: { r1: { race_role: "helper", effort: "normal" } }, 5: { r1: { race_role: "helper", effort: "normal" } } };
  const roleOnly = { 3: { r1: { race_role: "captain", effort: "normal" } }, 5: { r1: { race_role: "captain", effort: "normal" } } };
  const effort = { 3: { r1: { race_role: "helper", effort: "normal" } }, 5: { r1: { race_role: "helper", effort: "save" } } };
  const common = { activeStage: 3, initialMatrix, ordersByStage: {}, initialOrdersByStage: {}, includeOrders: true, bulkStages: [] };
  assert.deepEqual(otherUnsavedStages({ ...common, draftMatrix: roleOnly }), []);
  assert.deepEqual(otherUnsavedStages({ ...common, draftMatrix: effort }), [5]);
});
