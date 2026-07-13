// Race Engine v3 (#2224), slice S5 — form-peaks (spec §10 + addendum §2).
import test from "node:test";
import assert from "node:assert/strict";

import {
  peakPhaseForWindow,
  resolvePeakPhase,
  computeTrainingQuality,
  peakScoreComponent,
  peakComponentForStage,
} from "./racePeaks.js";
import { RACE_V3_TUNING as T } from "./raceRoles.js";

// ── peakPhaseForWindow ────────────────────────────────────────────────────────

test("phase: inde i vinduet → peak", () => {
  assert.equal(peakPhaseForWindow(12, 10, 14, 7), "peak");
  assert.equal(peakPhaseForWindow(10, 10, 14, 7), "peak"); // inklusiv start
  assert.equal(peakPhaseForWindow(14, 10, 14, 7), "peak"); // inklusiv slut
});

test("phase: dagene efter vinduet i payback-længden → payback", () => {
  assert.equal(peakPhaseForWindow(15, 10, 14, 7), "payback"); // dagen efter
  assert.equal(peakPhaseForWindow(21, 10, 14, 7), "payback"); // slut+7 inklusiv
});

test("phase: før vinduet og efter payback → none", () => {
  assert.equal(peakPhaseForWindow(9, 10, 14, 7), "none");
  assert.equal(peakPhaseForWindow(22, 10, 14, 7), "none"); // slut+8
});

test("phase: ugyldig etape-dag → none", () => {
  assert.equal(peakPhaseForWindow(NaN, 10, 14, 7), "none");
  assert.equal(peakPhaseForWindow(undefined, 10, 14, 7), "none");
});

// ── resolvePeakPhase ──────────────────────────────────────────────────────────

test("resolve: ingen vinduer → none", () => {
  assert.equal(resolvePeakPhase(12, []), "none");
  assert.equal(resolvePeakPhase(12, null), "none");
});

test("resolve: peak vinder over payback ved overlap", () => {
  // Vindue A (10-14) payback rammer dag 16; Vindue B (16-20) peak på dag 16.
  const windows = [{ start: 10, end: 14 }, { start: 16, end: 20 }];
  assert.equal(resolvePeakPhase(16, windows, 7), "peak");
});

test("resolve: kun payback → payback", () => {
  assert.equal(resolvePeakPhase(15, [{ start: 10, end: 14 }], 7), "payback");
});

test("resolve: springer ugyldige vinduer over", () => {
  assert.equal(resolvePeakPhase(12, [{ start: null, end: 14 }, { start: 10, end: 14 }], 7), "peak");
});

// ── computeTrainingQuality ────────────────────────────────────────────────────

test("tq: alt maks → 1", () => {
  assert.equal(computeTrainingQuality({ consistency: 1, focusMatch: 1, health: 1, fatigueControl: 1 }), 1);
});

test("tq: alt nul → gulvet (PEAK_TQ_FLOOR)", () => {
  assert.equal(
    computeTrainingQuality({ consistency: 0, focusMatch: 0, health: 0, fatigueControl: 0 }),
    T.PEAK_TQ_FLOOR
  );
});

test("tq: manglende signaler → neutrale defaults (mellem gulv og 1)", () => {
  const q = computeTrainingQuality({});
  assert.ok(q > T.PEAK_TQ_FLOOR && q < 1, `forventede mellemværdi, fik ${q}`);
});

test("tq: monotont voksende i konsistens (alt andet lige)", () => {
  const base = { focusMatch: 0.5, health: 0.5, fatigueControl: 0.5 };
  const lo = computeTrainingQuality({ ...base, consistency: 0.2 });
  const hi = computeTrainingQuality({ ...base, consistency: 0.9 });
  assert.ok(hi > lo, `hi(${hi}) skal være > lo(${lo})`);
});

test("tq: signaler uden for [0,1] klampes", () => {
  assert.equal(
    computeTrainingQuality({ consistency: 5, focusMatch: 5, health: 5, fatigueControl: 5 }),
    1
  );
});

// ── peakScoreComponent ────────────────────────────────────────────────────────

test("komponent: peak med fuld træning → PEAK_MAX", () => {
  assert.equal(peakScoreComponent({ phase: "peak", trainingQuality: 1 }), T.PEAK_MAX);
});

test("komponent: peak skalerer med træningskvalitet", () => {
  assert.equal(peakScoreComponent({ phase: "peak", trainingQuality: 0.5 }), T.PEAK_MAX * 0.5);
});

test("komponent: payback = −PEAK_PAYBACK uanset træning", () => {
  assert.equal(peakScoreComponent({ phase: "payback", trainingQuality: 1 }), -T.PEAK_PAYBACK);
  assert.equal(peakScoreComponent({ phase: "payback", trainingQuality: 0 }), -T.PEAK_PAYBACK);
});

test("komponent: none → 0", () => {
  assert.equal(peakScoreComponent({ phase: "none" }), 0);
});

test("komponent: trainingQuality klampes til [0,1]", () => {
  assert.equal(peakScoreComponent({ phase: "peak", trainingQuality: 2 }), T.PEAK_MAX);
  assert.equal(peakScoreComponent({ phase: "peak", trainingQuality: -1 }), 0);
});

// ── peakComponentForStage (integration) + flag-off analog ─────────────────────

test("stage: ingen vinduer → 0 (flag-off / ingen plan = bit-identisk)", () => {
  assert.equal(peakComponentForStage({ stageDay: 12, windows: [] }), 0);
  assert.equal(peakComponentForStage({ stageDay: 12 }), 0);
});

test("stage: i peak-vindue → PEAK_MAX × tq", () => {
  const v = peakComponentForStage({ stageDay: 12, windows: [{ start: 10, end: 14 }], trainingQuality: 0.8 });
  assert.equal(v, T.PEAK_MAX * 0.8);
});

test("stage: i payback → −PEAK_PAYBACK", () => {
  const v = peakComponentForStage({ stageDay: 16, windows: [{ start: 10, end: 14 }], trainingQuality: 1 });
  assert.equal(v, -T.PEAK_PAYBACK);
});

test("stage: deterministisk — samme inputs → samme output", () => {
  const args = { stageDay: 11, windows: [{ start: 10, end: 14 }], trainingQuality: 0.6 };
  assert.equal(peakComponentForStage(args), peakComponentForStage(args));
});
