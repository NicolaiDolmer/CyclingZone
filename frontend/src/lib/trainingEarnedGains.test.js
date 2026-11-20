// #8476: under XP er point betalt fra bjaelken (bar_paid) ikke dagens traening. De taeller
// ikke som "+N i dag", gennembrud eller dagens historie, og den skarpe dag findes ikke.
// Med kontakten slukket er alt som i dag (facit herunder er skrevet i haanden ud fra
// koden foer aendringen, ikke genereret af den nye kode).
import { test } from "node:test";
import assert from "node:assert/strict";
import { earnedGains, earnedGainTotal, earnedJumps } from "./trainingEarnedGains.js";
import { selectTrainingMoment, dayTopCandidate, MOMENT_TYPES } from "./trainingMoment.js";
import { todayGainTotal } from "./trainingReport.js";

/** @param {Record<string, any>} [overrides] @returns {any} */
function row(overrides = {}) {
  return {
    rider_id: "r1", name: "Rytter A", focus: "vo2max", intensity: "normal", receipt_status: "complete",
    injured: false, injury_days: 0, status: null, form: 50, gains: {}, gains_detail: {}, activities: [], ...overrides,
  };
}

// Rytter med ét point betalt fra bjaelken paa datoens foerste slot og intet tjent.
const paidOnly = row({
  rider_id: "paid", name: "Rytter B", intensity: "rest",
  gains: { climbing: 1 }, gains_detail: { climbing: { from: 70, to: 71 } },
  activities: [{ intensity: "rest", bar_paid: { climbing: 1 } }, { intensity: "rest" }],
});
// Rytter med to point: ét fra bjaelken, ét tjent paa datoen.
const mixed = row({
  rider_id: "mixed", name: "Rytter C",
  gains: { sprint: 2 }, gains_detail: { sprint: { from: 60, to: 62 } },
  activities: [{ intensity: "normal", bar_paid: { sprint: 1 } }, { intensity: "normal", bar_paid: {} }],
});

test("earnedGains: point betalt fra bjaelken taeller ikke som dagens", () => {
  assert.deepEqual(earnedGains(paidOnly), {});
  assert.equal(earnedGainTotal(paidOnly), 0);
  assert.deepEqual(earnedGains(mixed), { sprint: 1 });
  assert.equal(earnedGainTotal(mixed), 1);
  // Uden bar_paid er alt tjent paa datoen (samme tal som i dag).
  const plain = row({ gains: { climbing: 2, sprint: 0 } });
  assert.deepEqual(earnedGains(plain), { climbing: 2 });
  assert.equal(earnedGainTotal(plain), todayGainTotal(plain));
});

test("earnedGains: raekkens bar_paid er reserve naar intet slot baerer feltet, og aldrig mere end de landede point", () => {
  assert.deepEqual(earnedGains(row({ gains: { climbing: 2 }, bar_paid: { climbing: 1 } })), { climbing: 1 });
  assert.deepEqual(earnedGains(row({ gains: { climbing: 1 }, bar_paid: { climbing: 3 } })), {});
});

test("earnedGains: foer aftenafregningen laeses gains fra trained_now og bar_paid fra slottene", () => {
  const pending = row({
    receipt_status: "pending", gains: {},
    trained_now: { gains: { tempo: 2 }, gains_detail: { tempo: { from: 50, to: 52 } }, gain_percent: {} },
    activities: [{ bar_paid: { tempo: 1 } }],
  });
  assert.deepEqual(earnedGains(pending, pending.trained_now), { tempo: 1 });
  assert.deepEqual(earnedJumps(pending, pending.trained_now), [{ ability: "tempo", n: 1, from: 51, to: 52 }]);
});

test("earnedJumps: springet starter efter bjaelkens point", () => {
  assert.deepEqual(earnedJumps(paidOnly), []);
  assert.deepEqual(earnedJumps(mixed), [{ ability: "sprint", n: 1, from: 61, to: 62 }]);
});

const run = (riders, tick_date = "2026-11-20") => ({ tick_date, report: { riders } });

test("XP: en rytter med kun bjaelkens point er ikke dagens gennembrud", () => {
  const moment = selectTrainingMoment(run([paidOnly]), null, [], { xp: true });
  assert.equal(moment.type, MOMENT_TYPES.QUIET);
  const best = selectTrainingMoment(run([paidOnly, mixed]), null, [], { xp: true });
  assert.equal(best.type, MOMENT_TYPES.BREAKTHROUGH);
  assert.equal(best.riderId, "mixed");
  assert.deepEqual([best.n, best.from, best.to], [1, 61, 62]);
});

test("XP: den skarpe dag findes ikke", () => {
  const sharp = row({ status: "over" });
  assert.equal(selectTrainingMoment(run([sharp]), null, [], { xp: true }).type, MOMENT_TYPES.QUIET);
  assert.equal(dayTopCandidate([sharp], { xp: true }), null);
});

test("kontakten slukket: dagens historie er som foer (bjaelkens point og skarp dag taeller)", () => {
  // Facit fra koden foer #8476: gains taeller fuldt, from/to fra gains_detail, skarp dag score 500.
  const off = selectTrainingMoment(run([paidOnly]), null, []);
  assert.equal(off.type, MOMENT_TYPES.BREAKTHROUGH);
  assert.deepEqual([off.riderId, off.ability, off.n, off.from, off.to, off.score], ["paid", "climbing", 1, 70, 71, 10001]);
  assert.deepEqual(selectTrainingMoment(run([paidOnly]), null, [], { xp: false }), off);
  const sharp = row({ status: "over" });
  assert.deepEqual(dayTopCandidate([sharp]), { type: MOMENT_TYPES.SHARP_DAY, riderId: "r1", riderName: "Rytter A", score: 500 });
  assert.equal(selectTrainingMoment(run([sharp]), null, []).type, MOMENT_TYPES.SHARP_DAY);
  assert.equal(todayGainTotal(paidOnly), 1);
});
