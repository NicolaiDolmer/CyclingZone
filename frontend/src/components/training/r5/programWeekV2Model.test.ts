// #7947 W1 v2: kladden med indsats, "Plan for" og tabellen Alle ryttere.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLAN_FOR_ALL, allRidersRows, copyDayIntoDraftV2, daysFromToday, defaultEffort, draftStepsV2, effortChanged,
  passSession, planForSubject, resolvePlanFor, savedEffort, setDraftPass, shownEffort, withDraftEfforts, type DraftV2,
} from "./programWeekV2Model.ts";
import { moveWeekBlock } from "./programR5Model.ts";
import { trainingW1V2On } from "./trainingW1V2Flag.ts";
import type { ProgramWeekDays } from "../../../lib/trainingPrograms.ts";

const W = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const week = (session: string, extra: Record<string, unknown> = {}): ProgramWeekDays =>
  Object.fromEntries(W.map((w) => [w, { session, ...extra }])) as ProgramWeekDays;

test("kontakten: kun et eksplicit true taender", () => {
  assert.equal(trainingW1V2On({ training_w1_v2: true }), true);
  assert.equal(trainingW1V2On({ training_w1_v2: false }), false);
  assert.equal(trainingW1V2On({ training_w1_v2: "on" }), false);
  assert.equal(trainingW1V2On(null), false);
  assert.equal(trainingW1V2On({}), false);
});

test("en ren sessionsrettelse er en streng (som R5) og sender ingen indsats", () => {
  const days = week("tempo");
  const d = setDraftPass({}, days, "mon", 0, { session: "sprint" });
  assert.deepEqual(d, { "mon:0": "sprint" });
  assert.deepEqual(draftStepsV2(d, W, true), [{ weekday: "mon", slotIndex: 0, session: "sprint" }]);
  // Tilbage til det gemte = ingen rettelse.
  assert.deepEqual(setDraftPass(d, days, "mon", 0, { session: "tempo" }), {});
});

test("indsatsen: rettet indsats kommer med, kun med kontakten on", () => {
  const days = week("tempo");
  const base = defaultEffort("tempo");
  const other = base === "hard" ? "easy" : "hard";
  const d = setDraftPass({}, days, "tue", 2, { effort: other });
  assert.deepEqual(d, { "tue:2": { session: "tempo", effort: other } });
  assert.equal(shownEffort(days, d, "tue", 2), other);
  assert.equal(effortChanged(d, "tue", 2), true);
  assert.deepEqual(draftStepsV2(d, W, true), [{ weekday: "tue", slotIndex: 2, session: "tempo", effort: other }]);
  // Slukket kontakt: skrivningen er praecis som i dag (ingen effort-noegle).
  assert.deepEqual(draftStepsV2(d, W, false), [{ weekday: "tue", slotIndex: 2, session: "tempo" }]);
  // Sessionens eget niveau igen = ingen rettelse.
  assert.deepEqual(setDraftPass(d, days, "tue", 2, { effort: base }), {});
});

test("en sessionsrettelse beholder en rettet indsats", () => {
  const days = week("tempo");
  const pick = (["easy", "normal", "hard"] as const).find((e) => e !== defaultEffort("sprint") && e !== defaultEffort("tempo"))!;
  const d1 = setDraftPass({}, days, "wed", 0, { effort: pick });
  const d2 = setDraftPass(d1, days, "wed", 0, { session: "sprint" });
  assert.deepEqual(d2["wed:0"], { session: "sprint", effort: pick });
  // Er den valgte indsats sessionens eget niveau, er der kun sessionsrettelsen tilbage.
  const own = defaultEffort("sprint")!;
  const d3 = setDraftPass(setDraftPass({}, days, "wed", 0, { effort: own }), days, "wed", 0, { session: "sprint" });
  assert.equal(d3["wed:0"], "sprint");
});

test("hvile og aktiv restitution har ingen indsats", () => {
  const days = week("rest");
  assert.equal(shownEffort(days, {}, "mon", 0), null);
  const d = setDraftPass({}, days, "mon", 0, { effort: "hard" });
  assert.deepEqual(d, {}, "en hel dag kender ingen indsats");
  const rec = setDraftPass({}, week("tempo"), "mon", 0, { session: "recovery" });
  assert.equal(shownEffort(week("tempo"), rec, "mon", 0), null);
  assert.deepEqual(draftStepsV2(rec, W, true), [{ weekday: "mon", slotIndex: 0, session: "recovery" }]);
});

test("den gemte indsats: feltets egen, ellers dagens", () => {
  const days = week("tempo", { effort: "easy", slotEfforts: [null, "hard", null, null, null] });
  assert.equal(savedEffort(days, "mon", 0), "easy");
  assert.equal(savedEffort(days, "mon", 1), "hard");
  assert.equal(shownEffort(days, {}, "mon", 1), "hard");
  assert.equal(savedEffort(week("tempo", { effort: "bogus" }), "mon", 0), null);
});

test("kopier en dag tager sessioner og rettede indsatser med", () => {
  const days = week("tempo");
  let d: DraftV2 = setDraftPass({}, days, "mon", 0, { session: "sprint" });
  d = setDraftPass(d, days, "mon", 1, { effort: defaultEffort("tempo") === "hard" ? "easy" : "hard" });
  const copied = copyDayIntoDraftV2(d, days, "mon", ["tue"], true);
  assert.equal(passSession(days, copied, "tue", 0), "sprint");
  assert.equal(shownEffort(days, copied, "tue", 1), shownEffort(days, d, "mon", 1));
  // Uden kontakten kopieres kun sessionerne.
  const plain = copyDayIntoDraftV2(d, days, "mon", ["tue"], false);
  assert.equal(effortChanged(plain, "tue", 1), false);
});

// #8813 (Codex paa #8780): en kildes standardindsats kopieres som det niveau dagen viser, ikke som
// null, saa maaldagens egen dagsindsats ikke overtager den ved gemning.
test("kopier en dag tager den viste indsats med, ogsaa en standardindsats", () => {
  const base = defaultEffort("tempo")!;
  const dayLevel = base === "hard" ? "easy" : "hard";
  const days = { ...week("tempo"), tue: { session: "tempo", effort: dayLevel } } as ProgramWeekDays;
  assert.equal(shownEffort(days, {}, "mon", 0), base);
  assert.equal(shownEffort(days, {}, "tue", 0), dayLevel);
  const copied = copyDayIntoDraftV2({}, days, "mon", ["tue"], true);
  // Visning og gemt vaerdi er ens: tirsdag viser mandagens niveau og sender det eksplicit.
  assert.equal(shownEffort(days, copied, "tue", 0), base);
  const tue = draftStepsV2(copied, W, true).filter((s) => s.weekday === "tue");
  assert.equal(tue.length, 5);
  assert.ok(tue.every((s) => s.effort === base), "hvert pas sendes med kildens niveau");
  // Har maaldagen allerede samme niveau, er kopien ingen rettelse.
  assert.deepEqual(copyDayIntoDraftV2({}, week("tempo"), "mon", ["tue"], true), {});
});

test("null i kladden foelger dagens indsats, som API'et", () => {
  const days = week("tempo", { effort: defaultEffort("tempo") === "hard" ? "easy" : "hard" });
  const d: DraftV2 = { "mon:0": { session: "sprint", effort: null } };
  assert.equal(shownEffort(days, d, "mon", 0), days.mon.effort);
});

// #8813 (Codex paa #8780): ugeprioritet rydder dagens felt-kladde; indsatserne skal med i blokken.
test("withDraftEfforts: rettede indsatser laegges ind i dagens feltindsatser", () => {
  const entry = { slots: ["tempo", "sprint", "tempo", "tempo", "tempo"], lockSlot: null, slotEfforts: [null, "easy", null, null, null] as Array<"easy" | "normal" | "hard" | null> };
  assert.equal(withDraftEfforts(entry, {}, "mon"), entry, "ingen rettelser = dagen uaendret");
  assert.equal(withDraftEfforts(entry, { "mon:0": "sprint" }, "mon"), entry, "en ren sessionsrettelse flytter ingen indsats");
  const merged = withDraftEfforts(entry, { "mon:3": { session: "tempo", effort: "hard" }, "tue:0": { session: "tempo", effort: "easy" } }, "mon");
  assert.deepEqual(merged.slotEfforts, [null, "easy", null, "hard", null]);
  assert.deepEqual(merged.slots, entry.slots);
  // Flyttes passet, flytter indsatsen med (moveWeekBlock), og laasen bevarer den.
  const moved = moveWeekBlock(merged, 3, 0);
  assert.deepEqual(moved.slotEfforts, ["hard", null, "easy", null, null]);
  assert.deepEqual({ ...merged, lockSlot: 3 }.slotEfforts, merged.slotEfforts);
  // En dag uden gemte feltindsatser faar et fuldt array.
  const fresh = withDraftEfforts({ session: "tempo" } as { session: string; slotEfforts?: null }, { "wed:2": { session: "tempo", effort: "easy" } }, "wed");
  assert.deepEqual(fresh.slotEfforts, [null, null, "easy", null, null]);
});

test("Plan for: gemt valg, ellers foerste gruppe, ellers Alle ryttere", () => {
  const groups = [{ id: "g1" }, { id: "g2" }];
  const riders = [{ id: "r1" }];
  assert.equal(resolvePlanFor("group:g2", { groups, riders }), "group:g2");
  assert.equal(resolvePlanFor("rider:r1", { groups, riders }), "rider:r1");
  assert.equal(resolvePlanFor("rider:gone", { groups, riders }), "group:g1");
  assert.equal(resolvePlanFor(null, { groups: [], riders }), PLAN_FOR_ALL);
  assert.equal(resolvePlanFor(PLAN_FOR_ALL, { groups, riders }), PLAN_FOR_ALL);
  assert.deepEqual(planForSubject("group:g1"), { kind: "group", id: "g1" });
  assert.equal(planForSubject(PLAN_FOR_ALL), null);
});

test("dagene fra i dag rundt om ugen", () => {
  assert.deepEqual(daysFromToday(W, "fri"), ["fri", "sat", "sun", "mon", "tue", "wed", "thu"]);
  assert.deepEqual(daysFromToday(W, "mon"), W);
});

test("Alle ryttere: gruppe, program og ugens sessioner pr. rytter", () => {
  const riders = [
    { id: "a", name: "Rytter A", type: null },
    { id: "b", name: "Rytter B", type: null },
    { id: "c", name: "Rytter C", type: null },
  ];
  const groups = [{
    id: "g", name: "Gruppe 1", programKey: "p1", days: week("tempo", { slots: ["tempo", "sprint", null, null, null] }),
    members: [{ riderId: "a", followsGroup: true }, { riderId: "b", followsGroup: false }],
  }];
  const rows = allRidersRows({
    riders, groups, riderWeekPlans: { b: week("rest") }, seeds: {}, assigned: { b: "p2" }, weekdays: W,
  });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(byId.a.plan, { via: "group", programKey: "p1" });
  assert.deepEqual(byId.a.group, { id: "g", name: "Gruppe 1" });
  assert.deepEqual(byId.a.sessions.mon, ["tempo", "sprint"]);
  assert.deepEqual(byId.b.plan, { via: "own", programKey: "p2" });
  assert.deepEqual(byId.b.sessions.mon, ["rest"]);
  assert.deepEqual(byId.c.plan, { via: "none" });
  assert.equal(byId.c.group, null);
  assert.deepEqual(byId.c.sessions.mon, []);
});
