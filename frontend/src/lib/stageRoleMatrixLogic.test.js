import test from "node:test";
import assert from "node:assert/strict";
import {
  baseRoleForRider,
  overridesIndex,
  resolveCell,
  buildDraftMatrix,
  isCellOverridden,
  setCell,
  diffToOverrides,
  isDirty,
  jerseyLeaderId,
  applyJerseyCaptainShortcut,
} from "./stageRoleMatrixLogic.js";

const RIDERS = [
  { rider_id: "a", name: "Anna", race_role: "captain" },
  { rider_id: "b", name: "Bo", race_role: null },
  { rider_id: "c", name: "Cleo", race_role: "hunter" },
];

test("baseRoleForRider: falder tilbage til helper når race_entries ingen rolle har", () => {
  assert.equal(baseRoleForRider({ race_role: "captain" }), "captain");
  assert.equal(baseRoleForRider({ race_role: null }), "helper");
  assert.equal(baseRoleForRider(undefined), "helper");
});

test("resolveCell: override vinder, ellers basis-rolle + normal effort", () => {
  const overridesMap = overridesIndex([{ stage_number: 3, rider_id: "a", race_role: "helper", effort: "save" }]);
  assert.deepEqual(resolveCell({ rider: RIDERS[0], stageNumber: 3, overridesMap }), { race_role: "helper", effort: "save" });
  assert.deepEqual(resolveCell({ rider: RIDERS[0], stageNumber: 4, overridesMap }), { race_role: "captain", effort: "normal" });
  assert.deepEqual(resolveCell({ rider: RIDERS[1], stageNumber: 4, overridesMap }), { race_role: "helper", effort: "normal" });
});

test("buildDraftMatrix: kun etaper > stagesCompleted, seedet fra basis + overrides", () => {
  const overrides = [{ stage_number: 3, rider_id: "c", race_role: "captain", effort: "protect" }];
  const matrix = buildDraftMatrix({ riders: RIDERS, overrides, stageNumbers: [1, 2, 3, 4], stagesCompleted: 2 });
  assert.deepEqual(Object.keys(matrix).map(Number).sort(), [3, 4]);
  assert.deepEqual(matrix[3].c, { race_role: "captain", effort: "protect" });
  assert.deepEqual(matrix[3].a, { race_role: "captain", effort: "normal" });
  assert.deepEqual(matrix[4].b, { race_role: "helper", effort: "normal" });
});

test("buildDraftMatrix: ingen kommende etaper (alt kørt) → tom matrix", () => {
  const matrix = buildDraftMatrix({ riders: RIDERS, overrides: [], stageNumbers: [1, 2], stagesCompleted: 2 });
  assert.deepEqual(matrix, {});
});

test("isCellOverridden: markerer kun reelle afvigelser fra basis/normal", () => {
  assert.equal(isCellOverridden({ race_role: "captain", effort: "normal" }, RIDERS[0]), false);
  assert.equal(isCellOverridden({ race_role: "helper", effort: "normal" }, RIDERS[0]), true, "rolle afveger fra basis-kaptajn");
  assert.equal(isCellOverridden({ race_role: "captain", effort: "save" }, RIDERS[0]), true, "effort afveger fra normal");
  assert.equal(isCellOverridden(null, RIDERS[0]), false);
});

test("setCell: ren opdatering, muterer ikke input, delvis patch bevarer resten af cellen", () => {
  const matrix = { 3: { a: { race_role: "captain", effort: "normal" } } };
  const next = setCell(matrix, 3, "a", { effort: "protect" });
  assert.deepEqual(next[3].a, { race_role: "captain", effort: "protect" });
  assert.deepEqual(matrix[3].a, { race_role: "captain", effort: "normal" }, "input uændret");
  const seeded = setCell(matrix, 4, "b", { race_role: "hunter" });
  assert.deepEqual(seeded[4].b, { race_role: "hunter", effort: "normal" }, "manglende celle seedes fra default");
});

test("diffToOverrides: kun afvigende celler, sorteret deterministisk (stage asc, rider_id asc)", () => {
  const matrix = buildDraftMatrix({ riders: RIDERS, overrides: [], stageNumbers: [3, 4], stagesCompleted: 2 });
  // b (basis helper) → hunter på etape 4; a (basis captain) uændret på begge etaper.
  const withOverride = setCell(matrix, 4, "b", { race_role: "hunter", effort: "save" });
  const diff = diffToOverrides({ matrix: withOverride, riders: RIDERS });
  assert.deepEqual(diff, [{ stage_number: 4, rider_id: "b", race_role: "hunter", effort: "save" }]);
});

test("diffToOverrides: ingen afvigelser → tomt array (uændret draft sender intet)", () => {
  const matrix = buildDraftMatrix({ riders: RIDERS, overrides: [], stageNumbers: [3], stagesCompleted: 2 });
  assert.deepEqual(diffToOverrides({ matrix, riders: RIDERS }), []);
});

test("diffToOverrides: sortering på tværs af flere etaper og ryttere", () => {
  let matrix = buildDraftMatrix({ riders: RIDERS, overrides: [], stageNumbers: [3, 4], stagesCompleted: 2 });
  matrix = setCell(matrix, 4, "c", { race_role: "helper" });
  matrix = setCell(matrix, 3, "b", { race_role: "sprint_captain" });
  matrix = setCell(matrix, 3, "a", { effort: "save" });
  const diff = diffToOverrides({ matrix, riders: RIDERS });
  assert.deepEqual(diff.map((o) => `${o.stage_number}:${o.rider_id}`), ["3:a", "3:b", "4:c"]);
});

test("isDirty: samme matrix → false; enhver cellendring → true", () => {
  const base = buildDraftMatrix({ riders: RIDERS, overrides: [], stageNumbers: [3, 4], stagesCompleted: 2 });
  const copy = buildDraftMatrix({ riders: RIDERS, overrides: [], stageNumbers: [3, 4], stagesCompleted: 2 });
  assert.equal(isDirty(base, copy), false);
  const changed = setCell(base, 3, "a", { effort: "protect" });
  assert.equal(isDirty(changed, copy), true);
});

test("isDirty: forskellig etape-dækning (fx efter reload med anden stagesCompleted) → true", () => {
  const a = buildDraftMatrix({ riders: RIDERS, overrides: [], stageNumbers: [3, 4], stagesCompleted: 2 });
  const b = buildDraftMatrix({ riders: RIDERS, overrides: [], stageNumbers: [4], stagesCompleted: 3 });
  assert.equal(isDirty(a, b), true);
});

test("jerseyLeaderId: føreren er min rytter → hans id; ellers null", () => {
  const gcRows = [{ rank: 1, rider_id: "x" }, { rank: 2, rider_id: "a" }];
  assert.equal(jerseyLeaderId({ gcRows, myRiderIds: ["a", "b"] }), null, "føreren x er ikke min rytter");
  assert.equal(jerseyLeaderId({ gcRows, myRiderIds: ["x", "b"] }), "x");
  assert.equal(jerseyLeaderId({ gcRows: [], myRiderIds: ["a"] }), null, "ingen klassement endnu");
  assert.equal(jerseyLeaderId({ gcRows: [{ rank: 1, rider_id: null }], myRiderIds: ["a"] }), null);
});

test("applyJerseyCaptainShortcut: sætter kaptajn på alle kommende etaper + demoterer anden kaptajn", () => {
  const matrix = buildDraftMatrix({ riders: RIDERS, overrides: [], stageNumbers: [3, 4, 5], stagesCompleted: 2 });
  // a er basis-kaptajn; gør c (basis hunter) til den nye fører-kaptajn.
  const next = applyJerseyCaptainShortcut({ matrix, leaderId: "c", stageNumbers: [3, 4, 5], stagesCompleted: 2 });
  for (const sn of [3, 4, 5]) {
    assert.equal(next[sn].c.race_role, "captain", `etape ${sn}: c er kaptajn`);
    assert.equal(next[sn].a.race_role, "helper", `etape ${sn}: tidligere kaptajn a demoteret til helper`);
  }
});

test("applyJerseyCaptainShortcut: bevarer den nye kaptajns eksisterende effort, rører ikke andre effort-værdier", () => {
  let matrix = buildDraftMatrix({ riders: RIDERS, overrides: [], stageNumbers: [3], stagesCompleted: 2 });
  matrix = setCell(matrix, 3, "c", { effort: "save" });
  matrix = setCell(matrix, 3, "a", { effort: "protect" });
  const next = applyJerseyCaptainShortcut({ matrix, leaderId: "c", stageNumbers: [3], stagesCompleted: 2 });
  assert.deepEqual(next[3].c, { race_role: "captain", effort: "save" });
  assert.deepEqual(next[3].a, { race_role: "helper", effort: "protect" }, "demotering rører kun rollen, ikke effort");
});

test("applyJerseyCaptainShortcut: leder allerede kaptajn → idempotent, ingen anden rytter påvirket", () => {
  const matrix = buildDraftMatrix({ riders: RIDERS, overrides: [], stageNumbers: [3], stagesCompleted: 2 });
  const next = applyJerseyCaptainShortcut({ matrix, leaderId: "a", stageNumbers: [3], stagesCompleted: 2 });
  assert.deepEqual(next[3].a, { race_role: "captain", effort: "normal" });
  assert.deepEqual(next[3].b, { race_role: "helper", effort: "normal" });
  assert.deepEqual(next[3].c, { race_role: "hunter", effort: "normal" });
});

test("applyJerseyCaptainShortcut: ren funktion — muterer ikke input-matrixen", () => {
  const matrix = buildDraftMatrix({ riders: RIDERS, overrides: [], stageNumbers: [3], stagesCompleted: 2 });
  const snapshot = JSON.parse(JSON.stringify(matrix));
  applyJerseyCaptainShortcut({ matrix, leaderId: "c", stageNumbers: [3], stagesCompleted: 2 });
  assert.deepEqual(matrix, snapshot);
});
