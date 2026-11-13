// #7982 trin 4a: the press's memory between its day fields (trainNowPressMemory.js), the pure
// selection it plans a later day field with (planPressDay) and the part timer. The judge's set
// (trainNowSameResult7982.test.js) proves the whole press gives the same result as before; these
// pin the small rules the memory relies on.
import test from "node:test";
import assert from "node:assert/strict";
import { asStoredJsonb, createTrainNowPressMemory, watchReads } from "./trainNowPressMemory.js";
import { planPressDay } from "./dailyTrainingEngine.js";
import { createDayPartTimer } from "./trainNowWholeDay.js";

const rows = (...ids) => ids.map((id) => ({ id, team_id: "team", is_retired: false }));
const work = (ids, extra = {}) => ({ expected_rider_ids: ids, quarantined_rider_ids: [], opening_conditions: Object.fromEntries(ids.map((id) => [id, { form: 50, fatigue: 20 }])), status: "partial", ...extra });

function captured({ ids = ["a", "b", "c"], receipts = [] } = {}) {
  const memory = createTrainNowPressMemory();
  memory.capture({
    input: { tickDate: "2026-11-09", abilityRows: ids.map((id) => ({ rider_id: id, climbing: 50, ability_progress: { zz: 0.5, a: 0.25 } })), conditionRows: [], raceLoadRows: [], dateWork: work(ids) },
    selection: { rosterRows: rows(...ids), dateWork: work(ids), eligibleIds: ids, waitingIds: ids, riderIds: ids, instantRiderIds: new Set(), trainNowBonusRiderIds: new Set(), dateReceipts: receipts },
    raceFacts: new Map(),
  });
  return memory;
}

const commitArgs = (ids, extra = {}) => ({
  p_team_id: "team", p_season_id: "season", p_game_day: 41, p_tick_date: "2026-11-09", p_now: "2026-11-09T06:00:00.000Z",
  p_report: { riders: ids.map((id) => ({ rider_id: id, gains: { climbing: 1 }, intensity: "normal" })) },
  p_abilities: ids.map((id) => ({ riderId: id, patch: { climbing: 51, ability_progress: { zz: 0.1, a: 0.2 } } })),
  p_conditions: [], p_race_loads: [], ...extra,
});

test("asStoredJsonb: what a jsonb column gives back (JSON only, keys shortest first)", () => {
  assert.deepEqual(Object.keys(asStoredJsonb({ climbing: 1, tt: 2, ab: 3 })), ["ab", "tt", "climbing"]);
  assert.deepEqual(asStoredJsonb({ a: undefined, b: [1, { yy: 1, x: 2 }] }), { b: [1, { x: 2, yy: 1 }] });
  assert.equal(asStoredJsonb(undefined), undefined);
});

test("afterCommit: abilities and receipts are what the database now holds", () => {
  const memory = captured();
  memory.afterCommit({ args: commitArgs(["a", "b"]), data: { already_ran: false, applied_rider_ids: ["b", "a"], work_status: "partial" } });
  const input = memory.dayInput();
  const a = input.abilityRows.find((row) => row.rider_id === "a");
  assert.equal(a.climbing, 51);
  assert.deepEqual(Object.keys(a.ability_progress), ["a", "zz"], "jsonb key order");
  assert.equal(input.abilityRows.find((row) => row.rider_id === "c").climbing, 50, "a rider not in the save is unchanged");
  const receipts = memory.selection.dateReceipts;
  assert.deepEqual(receipts.map((row) => [row.rider_id, row.game_day, row.tick_date]), [["a", 41, "2026-11-09"], ["b", 41, "2026-11-09"]]);
  assert.equal(memory.ready, true);
  assert.equal(memory.committed, true);
});

test("afterCommit: the memory steps aside when the database did not apply exactly what was sent", () => {
  for (const data of [
    { already_ran: true, work_status: "partial" },
    { already_ran: false, applied_rider_ids: ["a"], work_status: "partial" },
    { already_ran: false, work_status: "partial" },
  ]) {
    const memory = captured();
    memory.afterCommit({ args: commitArgs(["a", "b"]), data });
    assert.equal(memory.ready, false, JSON.stringify(data));
    assert.equal(memory.dayInput(), null);
  }
});

test("afterCommit: a rider whose condition or race load was saved is never counted from memory again", () => {
  const memory = captured();
  memory.afterCommit({ args: commitArgs(["a"], { p_conditions: [{ rider_id: "a", form: 50, fatigue: 20, provisional: true }] }), data: { applied_rider_ids: ["a"] } });
  assert.ok(memory.dirtyRiderIds.has("a"));
  const plan = planPressDay(memory.selection, { raceDay: 42, eligibleRiderIds: ["a", "b"], unresolvedSlotsByRider: {}, deadlineReached: false, dirtyRiderIds: memory.dirtyRiderIds });
  assert.equal(plan, null);
});

test("dayInput: every day field gets its own copy of the rows", () => {
  const memory = captured();
  const first = memory.dayInput();
  first.abilityRows[0].climbing = 99;
  first.dateWork.status = "complete";
  const second = memory.dayInput();
  assert.equal(second.abilityRows[0].climbing, 50);
  assert.equal(second.dateWork.status, "partial");
});

test("planPressDay: the same selection steps as a day field that reads, or null when a rider is not held", () => {
  const memory = captured({ receipts: [{ rider_id: "b", game_day: 42, tick_date: "2026-11-09", report: {} }] });
  const plan = planPressDay(memory.selection, { raceDay: 42, eligibleRiderIds: ["a", "b", "c"], unresolvedSlotsByRider: {}, deadlineReached: false });
  assert.deepEqual(plan.riders.map((row) => row.id), ["a", "c"], "a rider with a receipt for the race day already has it");
  assert.equal(planPressDay(memory.selection, { raceDay: 42, eligibleRiderIds: ["a", "x"], unresolvedSlotsByRider: {}, deadlineReached: false }).riders.length, 1);
  const waiting = planPressDay(memory.selection, { raceDay: 42, eligibleRiderIds: ["a"], unresolvedSlotsByRider: { a: [{ gameDay: 43 }] }, deadlineReached: false });
  assert.equal(waiting, null, "a rider waiting for his race (not stamped) leaves nobody to train");
});

test("planPressDay: a rider the first day field did not read makes the day field read", () => {
  const memory = createTrainNowPressMemory();
  memory.capture({
    input: { abilityRows: [], conditionRows: [], raceLoadRows: [], dateWork: work(["a", "b"]) },
    selection: { rosterRows: rows("a", "b"), dateWork: work(["a", "b"]), eligibleIds: ["a"], waitingIds: ["a"], riderIds: ["a"], instantRiderIds: new Set(), trainNowBonusRiderIds: new Set(), dateReceipts: [] },
  });
  assert.equal(planPressDay(memory.selection, { raceDay: 42, eligibleRiderIds: ["a", "b"], unresolvedSlotsByRider: {}, deadlineReached: false }), null);
  assert.equal(planPressDay(memory.selection, { raceDay: 42, eligibleRiderIds: ["a"], unresolvedSlotsByRider: {}, deadlineReached: false }).riders.length, 1);
});

test("watchReads: notes an error or a throw, and changes neither the calls nor the answers", async () => {
  const answers = { ok: { data: [1], error: null }, bad: { data: null, error: { message: "x" } } };
  const client = {
    from(table) {
      const query = { select: () => query, eq: () => query, then: (resolve, reject) => (table === "boom" ? Promise.reject(new Error("net")) : Promise.resolve(answers[table])).then(resolve, reject) };
      return query;
    },
    rpc: async () => ({ data: { ok: true }, error: null }),
  };
  const watch = watchReads(client);
  assert.deepEqual(await watch.client.from("ok").select("*").eq("a", 1), answers.ok);
  assert.deepEqual(await watch.client.rpc("f", {}), { data: { ok: true }, error: null });
  assert.equal(watch.failed, false);
  assert.deepEqual(await watch.client.from("bad").select("*"), answers.bad);
  assert.equal(watch.failed, true);
  const second = watchReads(client);
  await assert.rejects(async () => { await second.client.from("boom").select("*"); }, /net/);
  assert.equal(second.failed, true);
});

test("createDayPartTimer: milliseconds per part, from one lap to the next", () => {
  let now = 100;
  const timer = createDayPartTimer({ clock: () => now });
  now = 130; timer.lap("load");
  now = 135; timer.lap("compute");
  now = 200; timer.lap("save");
  assert.deepEqual(timer.laps, [["load", 30], ["compute", 5], ["save", 65]]);
});
