// #8549 PR 2 · Week blocks i motoren mod dommer-scenarierne (7456-program-dommer-scenarier.md §2-3).
import test from "node:test";
import assert from "node:assert/strict";
import { weekPrioritySourceSlot, winningWeekEntry } from "./trainingWeekPriority.js";

const DAYS = [20, 21, 22, 23, 24]; // LD 1..5 = felt 0..4
const ENTRY = { session: "endurance", intensity: "easy", slots: ["sprint", "tempo", "technique", "vo2max", "threshold"] };
const week = (entry = ENTRY) => ({ entry, planKind: "week" });
const lock = (lockSlot, base = ENTRY) => ({ ...base, lockSlot });
// Kildefeltet for hvert af de fem felter, som motoren ville afregne dem i rækkefølge.
function dayPlan(winning, raceGameDays, settledFirst = []) {
  const out = [];
  const reports = [...settledFirst];
  for (let slot = 0; slot < 5; slot += 1) {
    const gd = DAYS[slot];
    const prior = reports.find((r) => r.game_day === gd);
    if (prior) { out.push(prior.report.race_day ? "L" : prior.report.source_slot); continue; }
    if (raceGameDays.includes(gd)) { out.push("L"); reports.push({ game_day: gd, report: { race_day: true } }); continue; }
    const { sourceSlot } = weekPrioritySourceSlot({ winning, programSlot: slot, dateDays: DAYS, raceGameDays, priorReports: reports });
    out.push(sourceSlot);
    reports.push({ game_day: gd, report: { source_slot: sourceSlot } });
  }
  return out;
}

test("OLD-1/OFF-2: plan_kind NULL eller 'rotation' = dagens kald, ogsaa med laas og loeb", () => {
  for (const planKind of [null, "rotation", undefined]) {
    for (let slot = 0; slot < 5; slot += 1) {
      assert.deepEqual(
        weekPrioritySourceSlot({ winning: { entry: lock(4), planKind }, programSlot: slot, dateDays: DAYS, raceGameDays: [24] }),
        { sourceSlot: slot, applied: false },
      );
    }
  }
  assert.deepEqual(weekPrioritySourceSlot({ winning: null, programSlot: 2, dateDays: DAYS }), { sourceSlot: 2, applied: false });
});

test("WB-1: ingen loeb = hvert felt koerer sit eget pas", () => {
  assert.deepEqual(dayPlan(week(lock(2)), []), [0, 1, 2, 3, 4]);
  assert.deepEqual(dayPlan(week(), []), [0, 1, 2, 3, 4]);
});

test("WB-2: laas E (hjem LD5), loeb LD5 -> A, B, C, E, L", () => {
  assert.deepEqual(dayPlan(week(lock(4)), [24]), [0, 1, 2, 4, "L"]);
});

test("WB-3: laas C (hjem LD3), loeb LD3 -> A, B, L, C, D (lige afstand = det senere)", () => {
  assert.deepEqual(dayPlan(week(lock(2)), [22]), [0, 1, "L", 2, 3]);
});

test("WB-4: laas E, loeb LD1+LD5 -> L, A, B, E, L", () => {
  assert.deepEqual(dayPlan(week(lock(4)), [20, 24]), ["L", 0, 1, 4, "L"]);
});

test("WB-6: LD1-4 afgjort som A-D, loebet i LD5 kommer sent -> A, B, C, D, L (E flytter ikke)", () => {
  // LD1-4 blev afregnet uden kendt loeb (kildefelt = eget felt), derefter loeb i LD5.
  const settled = [0, 1, 2, 3].map((s) => ({ game_day: DAYS[s], report: { source_slot: s } }));
  assert.deepEqual(dayPlan(week(lock(4)), [24], settled), [0, 1, 2, 3, "L"]);
});

test("WB-8: samme kilde pr. felt i raekkefoelge, ude af raekkefoelge (Traen nu) og efter etapen", () => {
  const winning = week(lock(4));
  const inOrder = dayPlan(winning, [20, 24]);
  // Ude af raekkefoelge: LD4 afregnes foerst (Traen nu), kun LD1-loebet er afregnet foer.
  const ld4 = weekPrioritySourceSlot({ winning, programSlot: 3, dateDays: DAYS, raceGameDays: [20, 24], priorReports: [{ game_day: 20, report: { race_day: true } }] });
  assert.equal(ld4.sourceSlot, inOrder[3]);
  const ld2 = weekPrioritySourceSlot({ winning, programSlot: 1, dateDays: DAYS, raceGameDays: [20, 24], priorReports: [{ game_day: 20, report: { race_day: true } }, { game_day: 23, report: { source_slot: ld4.sourceSlot } }] });
  assert.equal(ld2.sourceSlot, inOrder[1]);
});

test("WB-7: et felt, graensen erstattede, er afregnet MED sin kilde; laasen indhentes ikke", () => {
  const winning = week(lock(1));
  // LD1 = A, LD2 = loeb, LD3 = laasen B flyttet hertil men erstattet af graensen (kilde 1 brugt).
  const priors = [{ game_day: 20, report: { source_slot: 0 } }, { game_day: 21, report: { race_day: true } }, { game_day: 22, report: { source_slot: 1, intensity: "rest" } }];
  const ld4 = weekPrioritySourceSlot({ winning, programSlot: 3, dateDays: DAYS, raceGameDays: [21], priorReports: priors });
  assert.equal(ld4.sourceSlot, 2, "LD4 faar C, ikke laasen igen");
});

test("dato uden 5 loebsdage: dagens kald (ingen gaet)", () => {
  assert.deepEqual(weekPrioritySourceSlot({ winning: week(lock(4)), programSlot: 1, dateDays: [20, 21], raceGameDays: [21] }), { sourceSlot: 1, applied: false });
});

test("winningWeekEntry: samme lag som resolveDayProgram (rytter > eksplicit plan > hold)", () => {
  const teamRow = { days: { tue: ENTRY }, plan_kind: "week" };
  const riderRow = { days: { tue: lock(3) }, plan_kind: null };
  assert.deepEqual(winningWeekEntry({ weekday: "tue", riderRow, teamRow }), { entry: lock(3), planKind: null }, "rytterens egen raekke vinder, med sin plan_kind");
  assert.deepEqual(winningWeekEntry({ weekday: "tue", riderRow: null, teamRow }), { entry: ENTRY, planKind: "week" });
  assert.equal(winningWeekEntry({ weekday: "tue", riderRow: null, teamRow, hasExplicitPlan: true }), null, "eksplicit plan vinder over holdets raekke");
  assert.equal(winningWeekEntry({ weekday: "tue", riderRow: { days: { tue: { intensity: "hard" } } }, teamRow }), null, "gammel intensitets-raekke vinder");
});
