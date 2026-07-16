import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectTrainingMoment, dayTopCandidate, recentSignature, variantIndex, MOMENT_TYPES,
} from "./trainingMoment.js";

function row(overrides = {}) {
  return {
    rider_id: "r1", name: "Jansen", focus: "vo2max", intensity: "normal",
    injured: false, status: null, form: 50, gains: {}, gains_detail: {}, ...overrides,
  };
}

test("selectTrainingMoment: null uden report-rows", () => {
  assert.equal(selectTrainingMoment(null, null, []), null);
  assert.equal(selectTrainingMoment({ tick_date: "2026-07-15", report: {} }, null, []), null);
  assert.equal(selectTrainingMoment({ tick_date: "2026-07-15", report: { riders: [] } }, null, []), null);
});

test("selectTrainingMoment: gennembrud vinder over topform og skarp dag", () => {
  const rows = [
    row({ rider_id: "r1", name: "Jansen", form: 80, status: "over" }), // topform + skarp
    row({ rider_id: "r2", name: "Dubois", gains: { climbing: 1 }, gains_detail: { climbing: { from: 71, to: 72 } } }),
  ];
  const moment = selectTrainingMoment({ tick_date: "2026-07-15", report: { riders: rows } }, null, []);
  assert.equal(moment.type, MOMENT_TYPES.BREAKTHROUGH);
  assert.equal(moment.riderId, "r2");
  assert.equal(moment.from, 71);
  assert.equal(moment.to, 72);
});

test("selectTrainingMoment: nærmer-sig-gennembrud fra live progress, ekskluderer dagens egne gennembrud", () => {
  const rows = [
    row({ rider_id: "r1", name: "Jansen", focus: "vo2max" }),
    row({ rider_id: "r2", name: "Dubois", focus: "vo2max", gains: { climbing: 1 }, gains_detail: { climbing: { from: 71, to: 72 } } }),
  ];
  const progress = {
    r1: { climbing: 0.2, punch: 0.5, tempo: 0.93 }, // tæt på gennembrud
    r2: { climbing: 0.95 }, // allerede gennembrudt i dag — skal IKKE tælle som "nærmer sig"
  };
  const moment = selectTrainingMoment({ tick_date: "2026-07-15", report: { riders: rows } }, progress, []);
  // r2's faktiske gennembrud vinder over r1's anticipation (højere score-bånd).
  assert.equal(moment.type, MOMENT_TYPES.BREAKTHROUGH);
  assert.equal(moment.riderId, "r2");
});

test("selectTrainingMoment: nærmer-sig-gennembrud vises når ingen har et faktisk gennembrud", () => {
  const rows = [row({ rider_id: "r1", name: "Jansen", focus: "vo2max", form: 50 })];
  const progress = { r1: { climbing: 0.2, punch: 0.5, tempo: 0.93 } };
  const moment = selectTrainingMoment({ tick_date: "2026-07-15", report: { riders: rows } }, progress, []);
  assert.equal(moment.type, MOMENT_TYPES.NEAR_BREAKTHROUGH);
  assert.equal(moment.riderId, "r1");
  assert.equal(moment.ability, "tempo");
  assert.equal(moment.pct, 93);
});

test("selectTrainingMoment: quiet-fallback når intet stikker ud, men nogen trænede", () => {
  const rows = [row({ rider_id: "r1", form: 50, status: null }), row({ rider_id: "r2", form: 40 })];
  const moment = selectTrainingMoment({ tick_date: "2026-07-15", report: { riders: rows } }, null, []);
  assert.equal(moment.type, MOMENT_TYPES.QUIET);
  assert.equal(moment.allRest, false);
  assert.equal(moment.trained, 2);
});

test("selectTrainingMoment: quiet allRest=true når hele truppen hviler", () => {
  const rows = [row({ rider_id: "r1", intensity: "rest" }), row({ rider_id: "r2", intensity: "rest" })];
  const moment = selectTrainingMoment({ tick_date: "2026-07-15", report: { riders: rows } }, null, []);
  assert.equal(moment.type, MOMENT_TYPES.QUIET);
  assert.equal(moment.allRest, true);
});

test("selectTrainingMoment: cooldown springer samme rytter over når et alternativ findes", () => {
  const rows = [
    row({ rider_id: "r1", name: "Jansen", gains: { climbing: 1 }, gains_detail: { climbing: { from: 71, to: 72 } } }),
    row({ rider_id: "r2", name: "Dubois", form: 85, status: "over" }),
  ];
  const yesterday = { tick_date: "2026-07-14", report: { riders: [row({ rider_id: "r1", gains: { climbing: 1 }, gains_detail: { climbing: { from: 70, to: 71 } } })] } };
  const moment = selectTrainingMoment({ tick_date: "2026-07-15", report: { riders: rows } }, null, [yesterday]);
  // r1 var gårsdagens gennembrud-historie → i dag skal r2 (topform) vælges i stedet,
  // selvom r1's gennembrud har en isoleret højere score.
  assert.equal(moment.riderId, "r2");
  assert.equal(moment.type, MOMENT_TYPES.PEAK_FORM);
});

test("selectTrainingMoment: cooldown giver alligevel ALTID en historie, selv hvis alt er cooled down", () => {
  const rows = [row({ rider_id: "r1", name: "Jansen", gains: { climbing: 1 }, gains_detail: { climbing: { from: 71, to: 72 } } })];
  const yesterday = { tick_date: "2026-07-14", report: { riders: [row({ rider_id: "r1", gains: { climbing: 1 }, gains_detail: { climbing: { from: 70, to: 71 } } })] } };
  const moment = selectTrainingMoment({ tick_date: "2026-07-15", report: { riders: rows } }, null, [yesterday]);
  assert.equal(moment.riderId, "r1"); // eneste kandidat — cooldown kan ikke fjerne den sidste historie
  assert.equal(moment.type, MOMENT_TYPES.BREAKTHROUGH);
});

test("selectTrainingMoment: deterministisk variant — samme input giver samme variant", () => {
  const rows = [row({ rider_id: "r1", name: "Jansen", gains: { climbing: 1 }, gains_detail: { climbing: { from: 71, to: 72 } } })];
  const a = selectTrainingMoment({ tick_date: "2026-07-15", report: { riders: rows } }, null, []);
  const b = selectTrainingMoment({ tick_date: "2026-07-15", report: { riders: rows } }, null, []);
  assert.equal(a.variant, b.variant);
  assert.ok(a.variant >= 0 && a.variant < 4);
});

test("dayTopCandidate: null uden rækker, gennembrud slår topform", () => {
  assert.equal(dayTopCandidate([]), null);
  assert.equal(dayTopCandidate(null), null);
  const rows = [
    row({ rider_id: "r1", form: 90 }),
    row({ rider_id: "r2", gains: { climbing: 1 }, gains_detail: { climbing: { from: 71, to: 72 } } }),
  ];
  assert.equal(dayTopCandidate(rows).type, MOMENT_TYPES.BREAKTHROUGH);
  assert.equal(dayTopCandidate(rows).riderId, "r2");
});

test("recentSignature: samler rytter-id'er + typer fra tidligere dages topvalg", () => {
  const runs = [
    { tick_date: "2026-07-14", report: { riders: [row({ rider_id: "r1", gains: { climbing: 1 }, gains_detail: { climbing: { from: 70, to: 71 } } })] } },
    { tick_date: "2026-07-13", report: { riders: [row({ rider_id: "r2", form: 90 })] } },
  ];
  const sig = recentSignature(runs);
  assert.equal(sig.riderIds.has("r1"), true);
  assert.equal(sig.riderIds.has("r2"), true);
  assert.equal(sig.types.has(MOMENT_TYPES.BREAKTHROUGH), true);
  assert.equal(sig.types.has(MOMENT_TYPES.PEAK_FORM), true);
});

test("variantIndex: deterministisk og inden for [0, count)", () => {
  const a = variantIndex(["2026-07-15", "r1", "breakthrough"], 4);
  const b = variantIndex(["2026-07-15", "r1", "breakthrough"], 4);
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 4);
  assert.equal(variantIndex(["x"], 1), 0);
});
