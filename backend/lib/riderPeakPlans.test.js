import test from "node:test";
import assert from "node:assert/strict";

import {
  PEAK_WINDOW_RADIUS_DAYS,
  PEAK_LOCK_LEAD_DAYS,
  MAX_PEAK_PLANS_PER_SEASON,
  snapPeakWindow,
  isPlanLocked,
  recommendFocusForDemand,
  buildSuggestedTrainingBlock,
  canCreatePeakPlan,
  serializePlan,
} from "./riderPeakPlans.js";
import { dateStringToOrdinal } from "./racePeakPlans.js";
import { isValidWeekPlanDays, TRAINING_FOCUSES } from "./training.js";
import { RACE_V3_TUNING } from "./raceRoles.js";

// ── snapPeakWindow ────────────────────────────────────────────────────────────

test("snapPeakWindow snapper et 5-dags vindue symmetrisk om et endags-løb", () => {
  const w = snapPeakWindow(["2026-06-10"]);
  assert.deepEqual(w, { window_start: "2026-06-08", window_end: "2026-06-12" });
});

test("snapPeakWindow centrerer om et etapeløbs midterdag (dækker hele et kort løb)", () => {
  const w = snapPeakWindow(["2026-06-10", "2026-06-11", "2026-06-12"]);
  // center = 11/6 → [09/6, 13/6]
  assert.deepEqual(w, { window_start: "2026-06-09", window_end: "2026-06-13" });
});

test("snapPeakWindow er robust over for uordnede + duplikerede datoer", () => {
  const w = snapPeakWindow(["2026-06-12", "2026-06-10", "2026-06-10"]);
  // min=10/6, max=12/6, center=11/6 → [09/6, 13/6]
  assert.deepEqual(w, { window_start: "2026-06-09", window_end: "2026-06-13" });
});

test("snapPeakWindow respekterer en custom radius", () => {
  const w = snapPeakWindow(["2026-06-10"], { radiusDays: 1 });
  assert.deepEqual(w, { window_start: "2026-06-09", window_end: "2026-06-11" });
});

test("snapPeakWindow → null når der ingen gyldige datoer er", () => {
  assert.equal(snapPeakWindow([]), null);
  assert.equal(snapPeakWindow(null), null);
  assert.equal(snapPeakWindow(["ikke-en-dato"]), null);
});

test("default-radius giver et 5-dags vindue (spec §10: 4-6 dage)", () => {
  assert.equal(PEAK_WINDOW_RADIUS_DAYS, 2);
  const w = snapPeakWindow(["2026-06-10"]);
  const span = dateStringToOrdinal(w.window_end) - dateStringToOrdinal(w.window_start) + 1;
  assert.equal(span, 5);
});

// ── isPlanLocked ──────────────────────────────────────────────────────────────

const ord = (iso) => dateStringToOrdinal(iso);

test("isPlanLocked: eksplicit locked_at → altid låst", () => {
  const plan = { locked_at: "2026-06-01T00:00:00Z", window_start: "2026-07-01" };
  // Selv langt før lås-tærsklen: en persisteret locked_at er en hård lås.
  assert.equal(isPlanLocked(plan, ord("2026-06-02")), true);
});

test("isPlanLocked: NULL locked_at + nu FØR (start − 3d) → redigerbar", () => {
  const plan = { locked_at: null, window_start: "2026-07-10" };
  assert.equal(isPlanLocked(plan, ord("2026-07-06")), false); // tærskel = 07/7
});

test("isPlanLocked: NULL locked_at + nu PÅ (start − 3d) → låst", () => {
  const plan = { locked_at: null, window_start: "2026-07-10" };
  assert.equal(isPlanLocked(plan, ord("2026-07-07")), true);
});

test("isPlanLocked: NULL locked_at + nu EFTER tærskel → låst", () => {
  const plan = { locked_at: null, window_start: "2026-07-10" };
  assert.equal(isPlanLocked(plan, ord("2026-07-09")), true);
});

test("PEAK_LOCK_LEAD_DAYS er 3 (addendum §2)", () => {
  assert.equal(PEAK_LOCK_LEAD_DAYS, 3);
});

// ── recommendFocusForDemand ──────────────────────────────────────────────────

test("recommendFocusForDemand vælger fokusset med størst demand-dækning", () => {
  // Bjergløb → climbing/tempo tungt → vo2max (climbing,punch,tempo) dækker mest.
  const demand = { climbing: 0.6, tempo: 0.3, sprint: 0.1 };
  assert.equal(recommendFocusForDemand(demand), "vo2max");
});

test("recommendFocusForDemand vælger sprint for et fladt sprint-løb", () => {
  const demand = { sprint: 0.7, acceleration: 0.2, flat: 0.1 };
  assert.equal(recommendFocusForDemand(demand), "sprint");
});

test("recommendFocusForDemand → null når demand mangler eller er tom", () => {
  assert.equal(recommendFocusForDemand(null), null);
  assert.equal(recommendFocusForDemand({}), null);
  assert.equal(recommendFocusForDemand({ ukendt_evne: 1 }), null);
});

// ── buildSuggestedTrainingBlock ──────────────────────────────────────────────

test("buildSuggestedTrainingBlock returnerer gyldige build+taper uge-rytmer", () => {
  const block = buildSuggestedTrainingBlock({ recommendedFocus: "vo2max" });
  assert.equal(block.recommendedFocus, "vo2max");
  assert.equal(block.leadupDays, RACE_V3_TUNING.PEAK_LEADUP_DAYS);
  assert.ok(isValidWeekPlanDays(block.weekRhythms.build), "build skal være en gyldig uge-rytme");
  assert.ok(isValidWeekPlanDays(block.weekRhythms.taper), "taper skal være en gyldig uge-rytme");
});

test("buildSuggestedTrainingBlock: taper har lavere samlet belastning end build (periodisering)", () => {
  const load = { rest: 0, easy: 1, normal: 2, hard: 3 };
  const sum = (days) => Object.values(days).reduce((s, d) => s + load[d.intensity], 0);
  const block = buildSuggestedTrainingBlock({ recommendedFocus: "sprint" });
  assert.ok(
    sum(block.weekRhythms.taper) < sum(block.weekRhythms.build),
    "taper-ugen skal aflaste (lavere fatigue ind i peaket)",
  );
});

test("buildSuggestedTrainingBlock tolererer manglende fokus", () => {
  const block = buildSuggestedTrainingBlock({});
  assert.equal(block.recommendedFocus, null);
  assert.ok(isValidWeekPlanDays(block.weekRhythms.build));
});

// ── canCreatePeakPlan ────────────────────────────────────────────────────────

test("canCreatePeakPlan: ok når under grænsen og mål-løbet er nyt", () => {
  const r = canCreatePeakPlan({ existingTargetRaceIds: ["r1"], targetRaceId: "r2" });
  assert.deepEqual(r, { ok: true, reason: null });
});

test("canCreatePeakPlan: max_reached ved 2 eksisterende planer", () => {
  const r = canCreatePeakPlan({ existingTargetRaceIds: ["r1", "r2"], targetRaceId: "r3" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "max_reached");
  assert.equal(MAX_PEAK_PLANS_PER_SEASON, 2);
});

test("canCreatePeakPlan: duplicate_target når rytteren allerede topper mod samme løb", () => {
  const r = canCreatePeakPlan({ existingTargetRaceIds: ["r1"], targetRaceId: "r1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "duplicate_target");
});

// ── serializePlan ────────────────────────────────────────────────────────────

test("serializePlan mapper DB-rækken til API-form + udleder locked", () => {
  const row = {
    id: "p1",
    rider_id: "rid",
    season_id: "sid",
    target_race_id: "race1",
    window_start: "2026-07-10",
    window_end: "2026-07-14",
    locked_at: null,
    created_at: "2026-06-01T10:00:00Z",
  };
  const out = serializePlan(row, ord("2026-07-06")); // før tærskel
  assert.deepEqual(out, {
    id: "p1",
    riderId: "rid",
    seasonId: "sid",
    targetRaceId: "race1",
    windowStart: "2026-07-10",
    windowEnd: "2026-07-14",
    lockedAt: null,
    locked: false,
    createdAt: "2026-06-01T10:00:00Z",
  });
});

test("serializePlan udleder locked=true efter lås-tærsklen", () => {
  const row = {
    id: "p1", rider_id: "rid", season_id: "sid", target_race_id: "race1",
    window_start: "2026-07-10", window_end: "2026-07-14", locked_at: null, created_at: "2026-06-01T10:00:00Z",
  };
  assert.equal(serializePlan(row, ord("2026-07-08")).locked, true);
});

test("TRAINING_FOCUSES-nøgler er gyldige fokus-anbefalinger", () => {
  // Guard: recommendFocusForDemand må kun returnere kendte fokus-nøgler.
  const demand = { climbing: 1 };
  assert.ok(Object.prototype.hasOwnProperty.call(TRAINING_FOCUSES, recommendFocusForDemand(demand)));
});
