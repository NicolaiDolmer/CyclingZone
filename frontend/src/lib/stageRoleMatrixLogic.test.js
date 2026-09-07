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
  isJerseyLeaderCaptainOnAllRemainingStages,
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

test("#4538: diffToOverrides sender ALDRIG en override for en abandoned rytter, selv med en override-celle i matrixen", () => {
  const abandonedRiders = [RIDERS[0], { ...RIDERS[1], abandoned: true }, RIDERS[2]];
  let matrix = buildDraftMatrix({ riders: abandonedRiders, overrides: [], stageNumbers: [3, 4], stagesCompleted: 2 });
  // b er udgået, men bar en override fra FØR han udgik (havde dengang en fremtidig etape).
  matrix = setCell(matrix, 4, "b", { race_role: "hunter", effort: "save" });
  matrix = setCell(matrix, 3, "c", { race_role: "helper" }); // ikke-udgået rytters ændring skal stadig med
  const diff = diffToOverrides({ matrix, riders: abandonedRiders });
  assert.deepEqual(diff, [{ stage_number: 3, rider_id: "c", race_role: "helper", effort: "normal" }]);
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

// #4917/#2034 — førertrøje-genvej.
test("jerseyLeaderId: finder MIN rytter med GC-rang 1, ellers null", () => {
  const gcRankByRider = new Map([["a", 3], ["c", 1]]);
  assert.equal(jerseyLeaderId({ riders: RIDERS, gcRankByRider }), "c");
  assert.equal(jerseyLeaderId({ riders: RIDERS, gcRankByRider: new Map([["a", 2]]) }), null, "ingen af mine ryttere fører");
  assert.equal(jerseyLeaderId({ riders: RIDERS, gcRankByRider: null }), null, "GC endnu ukendt (ingen resultater)");
});

test("jerseyLeaderId: en udgået fører tæller ikke — han kan alligevel ikke sættes til kaptajn", () => {
  const abandonedLeader = [RIDERS[0], { ...RIDERS[2], abandoned: true }];
  const gcRankByRider = new Map([["a", 4], ["c", 1]]);
  assert.equal(jerseyLeaderId({ riders: abandonedLeader, gcRankByRider }), null);
});

test("applyJerseyCaptainShortcut: forfremmer føreren, demoterer den forrige kaptajn, kun på redigerbare etaper", () => {
  // a er basis-kaptajn; c bliver GC-fører og skal overtage kaptajnbåndet på
  // etape 3-4 (etape 2 er allerede kørt og indgår slet ikke i draft-matrixen).
  const matrix = buildDraftMatrix({ riders: RIDERS, overrides: [], stageNumbers: [2, 3, 4], stagesCompleted: 2 });
  const next = applyJerseyCaptainShortcut({ matrix, leaderId: "c", stageNumbers: [2, 3, 4], stagesCompleted: 2 });
  assert.deepEqual(next[3].c, { race_role: "captain", effort: "normal" });
  assert.deepEqual(next[3].a, { race_role: "helper", effort: "normal" }, "den forrige kaptajn demoteres til helper");
  assert.deepEqual(next[4].c, { race_role: "captain", effort: "normal" });
  assert.deepEqual(next[4].a, { race_role: "helper", effort: "normal" });
  assert.equal(next[2], undefined, "kørt etape indgår slet ikke i draft-matrixen og må ikke oprettes af genvejen");
});

test("#4917 CodeRabbit 7/9: isJerseyLeaderCaptainOnAllRemainingStages skal tjekke ALLE resterende etaper, ikke kun den næste — leder er kaptajn på næste etape men ikke på en senere → genvejen skal stadig vises", () => {
  const overridesMap = overridesIndex([{ stage_number: 4, rider_id: "c", race_role: "helper", effort: "normal" }]);
  // c (basis-rolle hunter) er allerede kaptajn på etape 3 (via override, ikke sat her men
  // resolveCell falder tilbage til basis "hunter" ≠ captain — brug rider med basis captain
  // og override på en SENERE etape der fjerner kaptajnbåndet igen).
  const rider = { rider_id: "c", name: "Cleo", race_role: "captain" };
  const stageNumbers = [3, 4, 5];
  const stagesCompleted = 2;
  // c er kaptajn (basis) på etape 3, men override'et på etape 4 gør ham til helper der.
  assert.equal(
    isJerseyLeaderCaptainOnAllRemainingStages({ rider, stageNumbers, stagesCompleted, overridesMap }),
    false,
    "kaptajn på næste etape (3) men IKKE på en senere (4) → funktionen skal svare false, så genvejen vises",
  );
});

test("isJerseyLeaderCaptainOnAllRemainingStages: kaptajn på ALLE resterende etaper → true (genvejen skjules)", () => {
  const rider = { rider_id: "c", name: "Cleo", race_role: "captain" };
  const stageNumbers = [3, 4, 5];
  const stagesCompleted = 2;
  assert.equal(
    isJerseyLeaderCaptainOnAllRemainingStages({ rider, stageNumbers, stagesCompleted, overridesMap: overridesIndex([]) }),
    true,
  );
});

test("applyJerseyCaptainShortcut: bevarer førerens EGEN effort, rører aldrig andre ryttere end kaptajnen", () => {
  let matrix = buildDraftMatrix({ riders: RIDERS, overrides: [], stageNumbers: [3], stagesCompleted: 2 });
  matrix = setCell(matrix, 3, "c", { effort: "protect" }); // føreren havde allerede en effort sat
  matrix = setCell(matrix, 3, "b", { race_role: "hunter", effort: "save" }); // uvedkommende rytter
  const next = applyJerseyCaptainShortcut({ matrix, leaderId: "c", stageNumbers: [3], stagesCompleted: 2 });
  assert.deepEqual(next[3].c, { race_role: "captain", effort: "protect" }, "effort bevares, kun rollen sættes");
  assert.deepEqual(next[3].b, { race_role: "hunter", effort: "save" }, "uvedkommende rytters række er urørt");
});
