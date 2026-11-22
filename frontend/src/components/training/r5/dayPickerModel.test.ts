// #8580 · Dagsvælgerens rene model (ejer 22/11: A).
import test from "node:test";
import assert from "node:assert/strict";
import { dayKind, futureCounts, futureFields, ownRaces, pickerWindow, weekUsable, type WeekDay } from "./dayPickerModel.ts";
import { STAGE } from "./todayR5Model.ts";

const day = (races: WeekDay["races"], extra: Partial<WeekDay> = {}): WeekDay => ({ date: "2026-11-24", weekday: "tue", available: true, races, ...extra });

test("weekUsable: kun et tilgaengeligt svar med mindst en dag frem giver en dagsvaelger", () => {
  assert.equal(weekUsable(null), false);
  assert.equal(weekUsable({ available: false, reason: "disabled", days: [] }), false);
  assert.equal(weekUsable({ available: true, days: [day([])] }), false);
  assert.equal(weekUsable({ available: true, days: [day([]), day([])] }), true);
});

test("pickerWindow: desktop viser alle 8; telefonen 3 med den valgte i midten, klemt ved kanterne", () => {
  assert.deepEqual(pickerWindow(0, 8, false), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pickerWindow(0, 8, true), [0, 1, 2]);
  assert.deepEqual(pickerWindow(3, 8, true), [2, 3, 4]);
  assert.deepEqual(pickerWindow(7, 8, true), [5, 6, 7]);
});

test("dayKind: holdets etape foer endagsloeb; divisionens loeb uden holdets ryttere er traening", () => {
  const stage = { raceId: "gt", name: "Tour", kind: "stage" as const, stages: [6, 7], ownRiders: 2 };
  const one = { raceId: "c", name: "Classic", kind: "oneday" as const, stages: [1], ownRiders: 1 };
  const notOurs = { ...one, raceId: "x", ownRiders: 0 };
  assert.deepEqual(dayKind(day([one, stage])), { kind: "stage", stage: 6, name: "Tour" });
  assert.deepEqual(dayKind(day([one])), { kind: "oneday", stage: null, name: "Classic" });
  assert.deepEqual(dayKind(day([notOurs])), { kind: "training", stage: null, name: null });
  assert.deepEqual(ownRaces(day([notOurs, one])).map((r) => r.raceId), ["c"]);
});

test("futureFields: loeb fra serveren, hvile (bundet/skadet) fra serveren, ellers planens pas for ugedagen", () => {
  const programSlot = (slot: number) => ["sprint", "tempo", "endurance", "vo2max", "technique"][slot];
  assert.deepEqual(futureFields({ programSlot, planSession: null, fields: { raceSlots: [2], restSlots: [] } }),
    ["sprint", "tempo", STAGE, "vo2max", "technique"]);
  assert.deepEqual(futureFields({ programSlot, planSession: null, fields: { raceSlots: [], restSlots: [0, 1, 2, 3, 4] } }),
    ["rest", "rest", "rest", "rest", "rest"], "GT-hviledag / skadet = H x5");
  assert.deepEqual(futureFields({ programSlot: () => null, planSession: "endurance", fields: null }),
    ["endurance", "endurance", "endurance", "endurance", "endurance"], "uden ugeplan: rytterens fokus");
  assert.deepEqual(futureFields({ programSlot, planSession: null, fields: { raceSlots: [1], restSlots: [1] } })[1], STAGE, "etape vinder over hvile");
});

test("futureCounts: en rytter med mindst et loebsfelt koerer loeb; resten traener", () => {
  assert.deepEqual(futureCounts([{ fields: [STAGE, "rest", null, null, null] }, { fields: ["tempo", "tempo", "tempo", "tempo", "tempo"] }], STAGE),
    { training: 1, racing: 1 });
});
