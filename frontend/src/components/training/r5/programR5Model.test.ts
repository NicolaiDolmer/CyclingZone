import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AVAILABLE_KINDS, PHONE_VIEWS, PROGRAM_PHONE_VIEW_STORE, PROGRAM_VIEW_STORE, buildLibrary, catalogWeekDays, clampDay,
  copyCandidates, copyDayIntoDraft, copyDayTargets, dayMarks, draftSteps, draftTotal, parseSubjectKey, programKeyOf,
  rememberedKind, rememberedPhoneView, riderPlan, riderWeekDays, setDraftCell, shortRiderName, startDayIndex, subjectKey,
  subjectsFor, weekCells, weekdayLong,
  GROUP_LIMIT_MODES, createdGroupId, dropDrafts, followAgainTarget, groupLimitDraft, groupLimitValid, groupLimitWrite,
  groupAfterPatch, groupMenuActions, groupMovePatch, groupPatch,
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

test("#8547 telefon: Dag er standard, kun Dag/Uge huskes, egen noegle", () => {
  assert.equal(rememberedPhoneView(null), "day");
  assert.equal(rememberedPhoneView("week"), "week");
  assert.equal(rememberedPhoneView("day"), "day");
  assert.equal(rememberedPhoneView("rotation"), "day");
  assert.deepEqual([...PHONE_VIEWS], ["day", "week"]);
  assert.notEqual(PROGRAM_PHONE_VIEW_STORE, PROGRAM_VIEW_STORE); // programtypen roeres ikke
});

test("#8547 telefon: korte rytternavne, dagnavne, startdag og pile-graense", () => {
  assert.equal(shortRiderName("Tomas Varga"), "T. Varga");
  assert.equal(shortRiderName("  Joran   van Bekker "), "J. van Bekker");
  assert.equal(shortRiderName("Pavel"), "Pavel");
  assert.equal(shortRiderName(""), "");
  assert.equal(weekdayLong("mon", "en"), "Monday");
  assert.equal(weekdayLong("sun", "en"), "Sunday");
  assert.equal(weekdayLong("thu", "da"), "torsdag");
  assert.equal(weekdayLong("xyz", "en"), "");
  assert.equal(startDayIndex(W, "thu"), 3);
  assert.equal(startDayIndex(W, "nope"), 0);
  assert.equal(startDayIndex(W, null), 0);
  assert.equal(clampDay(-1, W), 0);
  assert.equal(clampDay(7, W), 6);
  assert.equal(clampDay(3, W), 3);
});

test("#8547 telefon: dagens tegn tael loeb og ugemte rettelser, ikke koerte felter", () => {
  const cells = weekCells({
    days: week("tempo"), draft: { "thu:2": "sprint", "thu:3": "sprint" }, weekdays: W, todayWeekday: "thu",
    raceToday: new Set([1]), lockedToday: new Set([0]),
  });
  assert.deepEqual(dayMarks(cells[3]), { races: 1, changed: 2 });
  assert.deepEqual(dayMarks(cells[0]), { races: 0, changed: 0 });
});

// --- #8560 gruppestyring ---------------------------------------------------------------

test("#8560 menuen pr. gruppe: graensen kun naar traethedsreglerne er slaaet til", () => {
  assert.deepEqual(groupMenuActions({ limitEnabled: true }), ["rename", "members", "limit", "delete"]);
  assert.deepEqual(groupMenuActions({ limitEnabled: false }), ["rename", "members", "delete"]);
});

test("#8560 PATCH kun med det der er aendret; en ren omdoebning sender ikke medlemmer", () => {
  const g = GROUPS[0];
  assert.equal(groupPatch(g, "Climbers", ["b", "a"]), null);
  assert.equal(groupPatch(g, "  Climbers ", ["a", "b"]), null);
  assert.deepEqual(groupPatch(g, "Hills", ["a", "b"]), { name: "Hills" });
  assert.deepEqual(groupPatch(g, "Climbers", ["a", "c"]), { riderIds: ["a", "c"] });
  assert.deepEqual(groupPatch(g, "Hills", ["a"]), { name: "Hills", riderIds: ["a"] });
  assert.deepEqual(groupPatch(g, "Climbers", []), { riderIds: [] });
});

test("#8560 den nye gruppe er den id der ikke fandtes foer", () => {
  assert.equal(createdGroupId(["g1"], [{ id: "g1" }, { id: "g2" }]), "g2");
  assert.equal(createdGroupId(["g1"], [{ id: "g0" }, { id: "g1" }]), "g0");
  assert.equal(createdGroupId(["g1"], [{ id: "g1" }]), null);
  assert.equal(createdGroupId([], undefined), null);
});

test("#8560 foelg gruppen igen: rytter med egen plan, eller alle i gruppen med egen plan", () => {
  assert.deepEqual(followAgainTarget({ kind: "rider", id: "b" }, GROUPS), { groupId: "g1", groupName: "Climbers", riderIds: ["b"] });
  assert.equal(followAgainTarget({ kind: "rider", id: "a" }, GROUPS), null); // foelger allerede
  assert.equal(followAgainTarget({ kind: "rider", id: "c" }, GROUPS), null); // ikke i en gruppe
  assert.deepEqual(followAgainTarget({ kind: "group", id: "g1" }, GROUPS), { groupId: "g1", groupName: "Climbers", riderIds: ["b"] });
  const allFollow = [{ ...GROUPS[0], members: [{ riderId: "a", followsGroup: true }] }];
  assert.equal(followAgainTarget({ kind: "group", id: "g1" }, allFollow), null);
  assert.equal(followAgainTarget(null, GROUPS), null);
});

test("#8560 kladder uden emne forsvinder, resten bliver", () => {
  const drafts = { "group:g1": { "mon:0": "sprint" }, "rider:b": { "tue:1": "aero" } };
  assert.deepEqual(dropDrafts(drafts, ["group:g1"]), { "rider:b": { "tue:1": "aero" } });
  assert.deepEqual(dropDrafts(drafts, ["group:nope"]), drafts);
  assert.ok(dropDrafts(drafts, ["rider:b"]) !== drafts);
});

const LIMIT_DEFAULTS = { threshold: 70, fallback: "light" };

test("#8560 gruppens graense i dialogen: Holdets / Egen: N / Fra", () => {
  assert.deepEqual(groupLimitDraft(null, LIMIT_DEFAULTS), { mode: "team", threshold: "70", fallback: "light" });
  assert.deepEqual(groupLimitDraft({ threshold: null, fallback: "off" }, LIMIT_DEFAULTS), { mode: "off", threshold: "70", fallback: "light" });
  assert.deepEqual(groupLimitDraft({ threshold: 55, fallback: "rest" }, LIMIT_DEFAULTS), { mode: "own", threshold: "55", fallback: "rest" });
  assert.deepEqual([...GROUP_LIMIT_MODES], ["team", "own", "off"]);
});

test("#8560 graensen skrives kun ved en aendring, og et ugyldigt tal blokerer", () => {
  const own = (threshold: string, fallback = "light") => ({ mode: "own" as const, threshold, fallback });
  assert.deepEqual(groupLimitWrite({ mode: "team", threshold: "70", fallback: "light" }, null), { ok: true, change: null });
  assert.deepEqual(groupLimitWrite({ mode: "off", threshold: "70", fallback: "light" }, null), { ok: true, change: { mode: "off" } });
  assert.deepEqual(groupLimitWrite({ mode: "team", threshold: "70", fallback: "light" }, { threshold: 60, fallback: "rest" }), { ok: true, change: { mode: "team" } });
  assert.deepEqual(groupLimitWrite({ mode: "off", threshold: "70", fallback: "light" }, { threshold: null, fallback: "off" }), { ok: true, change: null });
  assert.deepEqual(groupLimitWrite(own("60", "rest"), { threshold: 60, fallback: "rest" }), { ok: true, change: null });
  assert.deepEqual(groupLimitWrite(own("65", "rest"), { threshold: 60, fallback: "rest" }), { ok: true, change: { mode: "own", own: { threshold: 65, fallback: "rest" } } });
  assert.deepEqual(groupLimitWrite(own("60"), null), { ok: true, change: { mode: "own", own: { threshold: 60, fallback: "light" } } });
  for (const bad of ["", "abc", "-1", "101", "6.5"]) {
    assert.deepEqual(groupLimitWrite(own(bad), null), { ok: false }, bad);
    assert.equal(groupLimitValid(own(bad)), false, bad);
  }
  assert.equal(groupLimitValid({ mode: "off", threshold: "", fallback: "light" }), true);
});

test("#8560 efter et lykket PATCH sammenligner naeste Gem med det gemte (Codex P2)", () => {
  const g = GROUPS[0];
  const saved = { ...g, name: "Hills" };
  // Serverens svar vinder.
  assert.equal(groupAfterPatch(g, { name: "Hills" }, [saved]), saved);
  // Uden svar bygges snapshottet af patchen; en tilbagerulning bliver derefter en aendring.
  const snap = groupAfterPatch(g, { name: "Hills", riderIds: ["a"] }, undefined);
  assert.equal(snap.name, "Hills");
  assert.deepEqual(snap.members.map((m) => m.riderId), ["a"]);
  assert.deepEqual(groupPatch(snap, g.name, g.members.map((m) => m.riderId)), { name: g.name, riderIds: g.members.map((m) => m.riderId) });
});
test("#8608 gruppeskift bevarer alle modtagergruppens medlemmer", () => {
  assert.deepEqual(groupMovePatch(GROUPS[0], "d"), { riderIds: ["a", "b", "d"] });
  assert.equal(groupMovePatch(GROUPS[0], "a"), null);
  assert.equal(groupMovePatch(GROUPS[0], "b"), null);
});

test("W1 drafts an effort-only edit, copies the effort and preserves recovery", () => {
  const days = week("sprint");
  days.mon = { session: "sprint", effort: "easy", slotEfforts: [null, "hard"] };
  let draft = setDraftCell({}, days, "mon", 0, "sprint", "normal");
  draft = setDraftCell(draft, days, "mon", 1, "recovery");
  draft = copyDayIntoDraft(draft, days, "mon", ["tue"], true);
  const writes = draftSteps(draft, W);
  assert.deepEqual(writes.slice(0, 4), [
    { weekday: "mon", slotIndex: 0, session: "sprint", effort: "normal" },
    { weekday: "mon", slotIndex: 1, session: "recovery" },
    { weekday: "tue", slotIndex: 0, session: "sprint", effort: "normal" },
    { weekday: "tue", slotIndex: 1, session: "recovery" },
  ]);
  assert.deepEqual(setDraftCell({}, days, "mon", 0, "sprint", "easy"), {});
  assert.deepEqual(draftSteps(setDraftCell({}, days, "mon", 1, "sprint", null), W),
    [{ weekday: "mon", slotIndex: 1, session: "sprint", effort: null }]);
});

test("W1 copies a standard-level pass without inheriting the target day's override", () => {
  const days = week("endurance");
  days.tue = { session: "endurance", effort: "hard" };
  const writes = draftSteps(copyDayIntoDraft({}, days, "mon", ["tue"], true), W);
  assert.equal(writes.length, 5);
  assert.ok(writes.every((write) => write.effort && write.effort !== "hard"));
});
