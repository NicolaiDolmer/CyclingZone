// Race Engine v3 (#2224), slice S5 — form-peaks (spec §10 + addendum §2).
import test from "node:test";
import assert from "node:assert/strict";

import {
  peakPhaseForWindow,
  resolvePeakPhase,
  computeTrainingQuality,
  peakScoreComponent,
  peakComponentForStage,
  consistencySignal,
  focusCoverage,
  focusMatchSignal,
  healthSignal,
  fatigueControlSignal,
  trainingQualityForWindow,
} from "./racePeaks.js";
import { RACE_V3_TUNING as T } from "./raceRoles.js";
import { TRAINING_FOCUSES } from "./training.js";

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

// ── per-vindue tq (addendum §2: trainingQuality er pr. (rytter, optakts-vindue)) ─

test("stage: per-vindue trainingQuality vinder over rytter-niveau-fallback", () => {
  // To vinduer med hver sin tq; etapen ligger i vindue B (tq=0.3) — B's tq bruges,
  // ikke rytter-fallback (1) eller vindue A's tq (0.9).
  const windows = [
    { start: 10, end: 14, trainingQuality: 0.9 },
    { start: 30, end: 34, trainingQuality: 0.3 },
  ];
  assert.equal(
    peakComponentForStage({ stageDay: 32, windows, trainingQuality: 1 }),
    T.PEAK_MAX * 0.3
  );
});

test("stage: vindue uden per-vindue tq falder tilbage til rytter-niveau (bagudkompat, flag-off-test)", () => {
  // Præcis formen fra raceEngineV3FlagOff.test.js: windows uden tq + rytter-tq.
  assert.equal(
    peakComponentForStage({ stageDay: 12, windows: [{ start: 10, end: 14 }], trainingQuality: 0.8 }),
    T.PEAK_MAX * 0.8
  );
});

test("stage: payback fra ét vindue mens intet vindue peaker → −PEAK_PAYBACK", () => {
  const windows = [{ start: 10, end: 14, trainingQuality: 0.5 }];
  assert.equal(peakComponentForStage({ stageDay: 16, windows }), -T.PEAK_PAYBACK);
});

// ── consistencySignal ─────────────────────────────────────────────────────────

test("consistency: andel trænede optakts-dage", () => {
  assert.equal(consistencySignal(7, 14), 0.5);
  assert.equal(consistencySignal(14, 14), 1);
  assert.equal(consistencySignal(0, 14), 0);
});

test("consistency: klampes til [0,1]; ingen optakts-dage → undefined (neutral default)", () => {
  assert.equal(consistencySignal(20, 14), 1); // >100% klampes
  assert.equal(consistencySignal(3, 0), undefined);
  assert.equal(consistencySignal(3, -1), undefined);
});

// ── focusCoverage + focusMatchSignal ──────────────────────────────────────────

const HIGH_MOUNTAIN = { climbing: 0.52, endurance: 0.18, tempo: 0.08, recovery: 0.06, punch: 0.04, tactics: 0.02, randomness: 0.10 };

test("focusCoverage: summerer demand-vægte for fokus' evner", () => {
  // vo2max = [climbing, punch, tempo] → 0.52 + 0.04 + 0.08 = 0.64
  assert.ok(Math.abs(focusCoverage(TRAINING_FOCUSES.vo2max, HIGH_MOUNTAIN) - 0.64) < 1e-9);
  // sprint = [sprint, acceleration] → 0 (bjerg efterspørger dem ikke)
  assert.equal(focusCoverage(TRAINING_FOCUSES.sprint, HIGH_MOUNTAIN), 0);
});

test("focusMatch: trænede kun det bedst-matchende fokus → 1", () => {
  const s = focusMatchSignal({ vo2max: 10 }, HIGH_MOUNTAIN, TRAINING_FOCUSES);
  assert.ok(Math.abs(s - 1) < 1e-9, `forventede 1, fik ${s}`);
});

test("focusMatch: trænede kun irrelevant fokus → 0", () => {
  assert.equal(focusMatchSignal({ sprint: 10 }, HIGH_MOUNTAIN, TRAINING_FOCUSES), 0);
});

test("focusMatch: blandet fokus ligger mellem 0 og 1 og er monotont", () => {
  const mostlyRight = focusMatchSignal({ vo2max: 8, sprint: 2 }, HIGH_MOUNTAIN, TRAINING_FOCUSES);
  const mostlyWrong = focusMatchSignal({ vo2max: 2, sprint: 8 }, HIGH_MOUNTAIN, TRAINING_FOCUSES);
  assert.ok(mostlyRight > mostlyWrong, `${mostlyRight} skal være > ${mostlyWrong}`);
  assert.ok(mostlyRight > 0 && mostlyRight < 1);
});

test("focusMatch: ingen trænede dage / manglende demand → undefined (neutral default)", () => {
  assert.equal(focusMatchSignal({}, HIGH_MOUNTAIN, TRAINING_FOCUSES), undefined);
  assert.equal(focusMatchSignal({ vo2max: 5 }, null, TRAINING_FOCUSES), undefined);
});

// ── healthSignal ──────────────────────────────────────────────────────────────

test("health: ingen skade → 1", () => {
  assert.equal(healthSignal({ injuredUntil: null, leadupStart: 100, leadupEnd: 114 }), 1);
});

test("health: skade helet før optakten → 1", () => {
  assert.equal(healthSignal({ injuredUntil: 99, leadupStart: 100, leadupEnd: 114 }), 1);
});

test("health: skade der spiser optakts-dage reducerer monotont", () => {
  // optakt [100,114): 14 dage. injuredUntil=106 → dage 100..106 = 7 tabte → 1-7/14 = 0.5
  assert.ok(Math.abs(healthSignal({ injuredUntil: 106, leadupStart: 100, leadupEnd: 114 }) - 0.5) < 1e-9);
  const early = healthSignal({ injuredUntil: 102, leadupStart: 100, leadupEnd: 114 });
  const late = healthSignal({ injuredUntil: 110, leadupStart: 100, leadupEnd: 114 });
  assert.ok(early > late, `tidlig-helet (${early}) skal give højere sundhed end sen (${late})`);
});

test("health: ugyldigt optakts-vindue → undefined", () => {
  assert.equal(healthSignal({ injuredUntil: null, leadupStart: 114, leadupEnd: 114 }), undefined);
});

// ── fatigueControlSignal ──────────────────────────────────────────────────────

test("fatigueControl: lav træthed ved taper = høj kvalitet", () => {
  assert.equal(fatigueControlSignal(0), 1);
  assert.equal(fatigueControlSignal(100), 0);
  assert.equal(fatigueControlSignal(30), 0.7);
});

test("fatigueControl: manglende/ugyldig fatigue → undefined (neutral default)", () => {
  assert.equal(fatigueControlSignal(null), undefined);
  assert.equal(fatigueControlSignal(undefined), undefined);
  assert.equal(fatigueControlSignal(NaN), undefined);
});

// ── trainingQualityForWindow (assemblér 4 signaler → computeTrainingQuality) ───

test("tqForWindow: perfekt optakt → 1", () => {
  const q = trainingQualityForWindow({
    trainedDays: 14, leadupDays: 14,
    focusCounts: { vo2max: 14 }, demandVector: HIGH_MOUNTAIN, focusAbilitiesMap: TRAINING_FOCUSES,
    injuredUntil: null, leadupStart: 100, leadupEnd: 114,
    fatigue: 0,
  });
  assert.equal(q, 1);
});

test("tqForWindow: elendig optakt → gulvet", () => {
  const q = trainingQualityForWindow({
    trainedDays: 0, leadupDays: 14,
    focusCounts: { sprint: 1 }, demandVector: HIGH_MOUNTAIN, focusAbilitiesMap: TRAINING_FOCUSES,
    injuredUntil: 113, leadupStart: 100, leadupEnd: 114,
    fatigue: 100,
  });
  assert.equal(q, T.PEAK_TQ_FLOOR);
});

test("tqForWindow: tom kontekst → neutral (mellem gulv og 1) via computeTrainingQuality-defaults", () => {
  const q = trainingQualityForWindow({ leadupDays: 0, leadupStart: 0, leadupEnd: 0 });
  assert.ok(q > T.PEAK_TQ_FLOOR && q < 1, `forventede mellemværdi, fik ${q}`);
});

test("tqForWindow: monotont voksende i konsistens (alt andet lige)", () => {
  const base = {
    leadupDays: 14, focusCounts: { vo2max: 7 }, demandVector: HIGH_MOUNTAIN,
    focusAbilitiesMap: TRAINING_FOCUSES, injuredUntil: null, leadupStart: 100, leadupEnd: 114, fatigue: 30,
  };
  const lo = trainingQualityForWindow({ ...base, trainedDays: 3 });
  const hi = trainingQualityForWindow({ ...base, trainedDays: 13 });
  assert.ok(hi > lo, `hi(${hi}) skal være > lo(${lo})`);
});
