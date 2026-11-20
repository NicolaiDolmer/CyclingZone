import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AVAILABLE_KINDS, buildLibrary, catalogWeekDays, copyCandidates, copyDayIntoDraft, copyDayTargets, draftSteps,
  draftTotal, parseSubjectKey, programKeyOf, rememberedKind, riderPlan, riderWeekDays, setDraftCell, subjectKey,
  subjectsFor, weekCells,
} from "./programR5Model.ts";
import type { CatalogProgram, ProgramWeekDays } from "../../../lib/trainingPrograms.ts";

const W = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const prog = (key: string, session: string): CatalogProgram => ({
  key, name: { en: key, da: key }, tagline: { en: "", da: "" }, targetTypes: [], audience: null,
  days: Object.fromEntries(W.map((w) => [w, session])),
});
const CATALOG = [prog("sprinter", "sprint"), prog("hill_climber", "vo2max"), prog("time_trial", "aero")];
const RIDERS = ["a", "b", "c", "d", "e"].map((id) => ({ id, name: `Rider ${id}`, type: null }));
const week = (session: string): ProgramWeekDays => Object.fromEntries(W.map((w) => [w, { session }]));

// Hold A: gruppen "Climbers" (a foelger, b har egen plan), c egen plan uden gruppe, d+e intet.
const GROUPS = [{
  id: "g1", name: "Climbers", programKey: "hill_climber",
  members: [{ riderId: "a", followsGroup: true }, { riderId: "b", followsGroup: false }],
}];
const INPUT = {
  catalog: CATALOG, groups: GROUPS, riders: RIDERS,
  ownPlanIds: new Set(["a", "b", "c"]), assigned: { b: "sprinter", c: "sprinter" },
};

test("visningen starter i Week blocks og husker kun et valg der findes", () => {
  assert.equal(rememberedKind(null), "week");
  assert.equal(rememberedKind("rotation"), "week"); // Rotation findes ikke i backend endnu
  assert.equal(rememberedKind("rotation", ["week", "rotation"]), "rotation");
  assert.equal(rememberedKind("noget"), "week");
  assert.deepEqual([...AVAILABLE_KINDS], ["week"]);
});

test("rytterens plan: gruppe, egen plan vinder, ellers intet", () => {
  assert.deepEqual(riderPlan("a", INPUT), { via: "group", groupId: "g1" });
  assert.deepEqual(riderPlan("b", INPUT), { via: "own", programKey: "sprinter" });
  assert.deepEqual(riderPlan("c", INPUT), { via: "own", programKey: "sprinter" });
  assert.deepEqual(riderPlan("d", INPUT), { via: "none" });
});

test("biblioteket: programmer i brug oeverst, grupper og ryttere med egen plan, No program", () => {
  const lib = buildLibrary(INPUT);
  assert.deepEqual(lib.programs.map((p) => p.key), ["sprinter", "hill_climber", "time_trial"]);
  const sprinter = lib.programs[0];
  assert.deepEqual(sprinter.riders, ["b", "c"]);
  assert.equal(sprinter.groups.length, 0);
  const climber = lib.programs[1];
  assert.deepEqual(climber.groups, [{ id: "g1", name: "Climbers", following: 1 }]);
  assert.equal(lib.programs[2].inUse, false);
  assert.deepEqual(lib.groups[0].members, [
    { riderId: "a", own: false, ownProgramKey: null },
    { riderId: "b", own: true, ownProgramKey: "sprinter" },
  ]);
  assert.deepEqual(lib.ownOnly, [{ riderId: "c", programKey: "sprinter" }]);
  assert.deepEqual(lib.noProgram, ["d", "e"]);
});

test("programmet saettes kun paa en gruppe eller en rytter, og emnet kender sit program", () => {
  const lib = buildLibrary(INPUT);
  assert.deepEqual(subjectsFor("hill_climber", lib), [{ kind: "group", id: "g1" }]);
  assert.deepEqual(subjectsFor("sprinter", lib), [{ kind: "rider", id: "b" }, { kind: "rider", id: "c" }]);
  assert.deepEqual(subjectsFor("time_trial", lib), []);
  assert.equal(programKeyOf({ kind: "group", id: "g1" }, lib), "hill_climber");
  assert.equal(programKeyOf({ kind: "rider", id: "a" }, lib), "hill_climber");
  assert.equal(programKeyOf({ kind: "rider", id: "b" }, lib), "sprinter");
  assert.equal(programKeyOf({ kind: "rider", id: "d" }, lib), null);
  assert.equal(parseSubjectKey(subjectKey({ kind: "rider", id: "x-1" }))?.id, "x-1");
  assert.equal(parseSubjectKey("team"), null);
});

test("rytterens felter: egen raekke, ellers den saaede uge", () => {
  assert.equal(riderWeekDays("a", { a: week("tempo") }, {}, W).isSeed, false);
  assert.deepEqual(riderWeekDays("d", {}, { d: week("endurance") }, W), { days: week("endurance"), isSeed: true });
  assert.deepEqual(riderWeekDays("e", {}, {}, W), { days: null, isSeed: false });
  assert.equal(catalogWeekDays(CATALOG[0])?.mon?.session, "sprint");
});

test("kladden: rettelse, fortrudt rettelse og kopier en dag", () => {
  const days = week("tempo");
  let draft = setDraftCell({}, days, "mon", 0, "sprint");
  assert.deepEqual(draft, { "mon:0": "sprint" });
  assert.deepEqual(setDraftCell(draft, days, "mon", 0, "tempo"), {});
  draft = copyDayIntoDraft(draft, days, "mon", ["tue", "wed"]);
  assert.equal(draft["tue:0"], "sprint");
  assert.equal(draft["wed:0"], "sprint");
  assert.equal(draft["tue:1"], undefined); // samme session som gemt = ingen rettelse
  assert.deepEqual(draftSteps(draft, W).map((s) => `${s.weekday}:${s.slotIndex}`), ["mon:0", "tue:0", "wed:0"]);
  assert.equal(draftTotal({ x: draft, y: { "sun:4": "rest" } }), 4);
});

test("kopier en dag springer i dag over efter Train now", () => {
  assert.deepEqual(copyDayTargets("mon", "all", W, { todayWeekday: "wed", todayLocked: true }), ["tue", "thu", "fri", "sat", "sun"]);
  assert.deepEqual(copyDayTargets("mon", "wed", W, { todayWeekday: "wed", todayLocked: false }), ["wed"]);
  assert.deepEqual(copyDayTargets("mon", "mon", W), []);
});

test("ugen: dagens loebsfelter er graa, koerte felter laast, rettelser markeret", () => {
  const cells = weekCells({
    days: week("tempo"), draft: { "fri:2": "sprint" }, weekdays: W, todayWeekday: "thu",
    raceToday: new Set([0, 1]), lockedToday: new Set([0, 1, 2]),
  });
  assert.equal(cells[3][0].kind, "race");
  assert.equal(cells[3][1].kind, "race");
  assert.deepEqual(cells[3][2], { kind: "ran", session: "tempo" });
  assert.deepEqual(cells[3][3], { kind: "session", session: "tempo", changed: false });
  assert.deepEqual(cells[4][2], { kind: "session", session: "sprint", changed: true });
  assert.equal(cells[0][0].kind, "session"); // andre dage: serveren kender kun dagens loeb
});

test("Copy to riders: alle uden programmet som egen kopi, intet uden program", () => {
  const lib = buildLibrary(INPUT);
  assert.deepEqual(copyCandidates("sprinter", lib, RIDERS).map((r) => r.id), ["a", "d", "e"]);
  assert.deepEqual(copyCandidates(null, lib, RIDERS), []);
});
