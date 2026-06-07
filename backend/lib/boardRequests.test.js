// #1120 · Direkte enhedstests for boardRequests.js.
//
// Board-request-modulet var før kun dækket indirekte via boardEngine-integration.
// Disse tests rammer request-resolution-logikken, validators, gen-forhandlings-
// låsen og økonomi-/tærskel-konstanterne direkte. Modulet er overvejende rent —
// kun resolveBoardRequest når den IKKE afvises på availability-niveau kalder
// calculateBoardPerformance, som udleder en score fra mål-evalueringerne. Til de
// stier konstruerer vi tydeligt høj-/lav-scorende fixtures (god/dårlig standing)
// frem for at mocke, så testene pinner ægte adfærd.

import test from "node:test";
import assert from "node:assert/strict";

import {
  REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT,
  MID_CYCLE_PROGRESS_THRESHOLD_PCT,
  MID_CYCLE_SATISFACTION_DELTA_PCT,
  RENEGOTIATION_SEASON_PROGRESS_LOCK_PCT,
  MAJOR_PIVOT_REQUEST_TYPES,
  TRADEOFF_PAYLOADS_BY_REQUEST,
  isMajorPivotRequest,
  isValidBoardFocus,
  isValidBoardPlanType,
  isValidBoardRequestType,
  getBoardRequestDefinition,
  buildBoardRequestOptions,
  resolveBoardRequest,
  getBoardRenegotiationLock,
} from "./boardRequests.js";

// =====================================================================
// Fixtures
// =====================================================================

// Neutral identitetsprofil: hverken stærk national kerne eller stjerne-profil,
// så strongStarProfile/strongNationalCore-grenene IKKE udløses. Bruges som
// context.identityProfile, som resolveBoardRequest foretrækker (linje 115).
const NEUTRAL_IDENTITY = {
  national_core: { established: false, strength: "low" },
  star_profile: { level: "low" },
  youth_level: "medium",
  squad_status: "healthy",
  primary_specialization: "gc",
};

const STRONG_STAR_IDENTITY = {
  ...NEUTRAL_IDENTITY,
  star_profile: { level: "high" }, // hasStrongStarProfile → true
};

const STRONG_NATIONAL_IDENTITY = {
  ...NEUTRAL_IDENTITY,
  national_core: { established: true, strength: "high" }, // hasStrongNationalCore → true
};

// Et komplet mål-sæt med ét mål pr. kategori (ranking/results/identity/economy),
// så resolution-grenenes findGoalIndexByCategory rammer alle fire.
function fullGoalSet() {
  return [
    { type: "top_n_finish", target: 10, label: "Top 10 i divisionen", satisfaction_bonus: 10, satisfaction_penalty: 10 },
    { type: "stage_wins", target: 2, label: "Mindst 2 etapesejre", satisfaction_bonus: 8, satisfaction_penalty: 8 },
    { type: "min_u25_riders", target: 3, label: "Mindst 3 U25-ryttere", satisfaction_bonus: 6, satisfaction_penalty: 6 },
    { type: "no_outstanding_debt", label: "Ingen udestaaende gaeld", satisfaction_bonus: 5, satisfaction_penalty: 5 },
  ];
}

// Standing + team der får fullGoalSet til at evaluere klart "ahead" → høj
// adjustedOverallScore (passerer alle interne score-gates ≥ 0.66).
const STRONG_STANDING = { rank_in_division: 1, stage_wins: 6, gc_wins: 2 };
const STRONG_TEAM = {
  division: 3,
  riders: Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, is_u25: i < 4, popularity: 40 })),
};

// Et board klar til requests: plan signeret, 1yr, balanceret fokus.
function readyBoard(overrides = {}) {
  return {
    id: "board-1",
    team_id: "team-1",
    negotiation_status: "completed",
    plan_type: "1yr",
    focus: "balanced",
    satisfaction: 80,
    current_goals: fullGoalSet(),
    major_pivot_used_at: null,
    ...overrides,
  };
}

// Kontekst der ikke aktiverer nogen availability-blokeringer (rigeligt
// race-days tilbage, ingen request brugt, høj score), med neutral profil.
function openContext(overrides = {}) {
  return {
    requestUsedThisSeason: false,
    raceDaysLeft: 40,
    overallScore: 0.9,
    identityProfile: NEUTRAL_IDENTITY,
    activeSeasonId: "season-7",
    ...overrides,
  };
}

// =====================================================================
// Eksporterede konstanter (forward-guards mod utilsigtet tærskel-drift)
// =====================================================================

test("eksporterede tærskel-konstanter har de forventede vaerdier", () => {
  assert.equal(REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT, 5);
  assert.equal(MID_CYCLE_PROGRESS_THRESHOLD_PCT, 50);
  assert.equal(MID_CYCLE_SATISFACTION_DELTA_PCT, 30);
  assert.equal(RENEGOTIATION_SEASON_PROGRESS_LOCK_PCT, 50);
});

test("MAJOR_PIVOT_REQUEST_TYPES indeholder kun youth↔star-krydsningerne", () => {
  assert.ok(MAJOR_PIVOT_REQUEST_TYPES.has("more_youth_focus"));
  assert.ok(MAJOR_PIVOT_REQUEST_TYPES.has("more_results_focus"));
  assert.ok(!MAJOR_PIVOT_REQUEST_TYPES.has("lower_results_pressure"));
  assert.ok(!MAJOR_PIVOT_REQUEST_TYPES.has("ease_identity_requirements"));
});

test("TRADEOFF_PAYLOADS_BY_REQUEST har deferred payloads for de to ikke-inline typer", () => {
  assert.deepEqual(TRADEOFF_PAYLOADS_BY_REQUEST.lower_results_pressure, {
    kind: "tighten_identity_riders",
    delta: 1,
  });
  assert.deepEqual(TRADEOFF_PAYLOADS_BY_REQUEST.ease_identity_requirements, {
    kind: "raise_sponsor_growth_target",
    delta_pct: 5,
  });
  // more_youth/results har inline-effekter → ingen deferred payload.
  assert.equal(TRADEOFF_PAYLOADS_BY_REQUEST.more_youth_focus, undefined);
  assert.equal(TRADEOFF_PAYLOADS_BY_REQUEST.more_results_focus, undefined);
});

// =====================================================================
// Validators
// =====================================================================

test("isValidBoardFocus accepterer kun de tre fokus-vaerdier", () => {
  assert.equal(isValidBoardFocus("youth_development"), true);
  assert.equal(isValidBoardFocus("star_signing"), true);
  assert.equal(isValidBoardFocus("balanced"), true);
  assert.equal(isValidBoardFocus("unknown"), false);
  assert.equal(isValidBoardFocus(undefined), false);
});

test("isValidBoardPlanType accepterer 1yr/3yr/5yr", () => {
  assert.equal(isValidBoardPlanType("1yr"), true);
  assert.equal(isValidBoardPlanType("3yr"), true);
  assert.equal(isValidBoardPlanType("5yr"), true);
  assert.equal(isValidBoardPlanType("2yr"), false);
});

test("isValidBoardRequestType accepterer de fire request-typer", () => {
  for (const type of [
    "lower_results_pressure",
    "more_youth_focus",
    "more_results_focus",
    "ease_identity_requirements",
  ]) {
    assert.equal(isValidBoardRequestType(type), true, `${type} skal vaere gyldig`);
  }
  assert.equal(isValidBoardRequestType("more_money"), false);
  assert.equal(isValidBoardRequestType(null), false);
});

test("getBoardRequestDefinition returnerer definition med type for gyldig request", () => {
  const def = getBoardRequestDefinition("lower_results_pressure");
  assert.equal(def.type, "lower_results_pressure");
  assert.equal(def.label, "Saenk resultatpresset");
  assert.ok(typeof def.description === "string" && def.description.length > 0);
});

test("getBoardRequestDefinition returnerer null for ukendt request", () => {
  assert.equal(getBoardRequestDefinition("nope"), null);
});

// =====================================================================
// isMajorPivotRequest
// =====================================================================

test("isMajorPivotRequest: more_youth_focus FRA star_signing er MAJOR", () => {
  assert.equal(isMajorPivotRequest({ requestType: "more_youth_focus", currentFocus: "star_signing" }), true);
});

test("isMajorPivotRequest: more_results_focus FRA youth_development er MAJOR", () => {
  assert.equal(isMajorPivotRequest({ requestType: "more_results_focus", currentFocus: "youth_development" }), true);
});

test("isMajorPivotRequest: pivots til/fra balanced er IKKE major", () => {
  assert.equal(isMajorPivotRequest({ requestType: "more_youth_focus", currentFocus: "balanced" }), false);
  assert.equal(isMajorPivotRequest({ requestType: "more_results_focus", currentFocus: "balanced" }), false);
});

test("isMajorPivotRequest: ikke-pivot request-typer er aldrig major", () => {
  assert.equal(isMajorPivotRequest({ requestType: "lower_results_pressure", currentFocus: "star_signing" }), false);
  assert.equal(isMajorPivotRequest({ requestType: "ease_identity_requirements", currentFocus: "youth_development" }), false);
});

// =====================================================================
// buildBoardRequestOptions
// =====================================================================

test("buildBoardRequestOptions returnerer [] uden board", () => {
  assert.deepEqual(buildBoardRequestOptions({ board: null }), []);
  assert.deepEqual(buildBoardRequestOptions({}), []);
});

test("buildBoardRequestOptions returnerer alle 4 typer med definition + disabled-felter", () => {
  const options = buildBoardRequestOptions({ board: readyBoard(), context: openContext() });
  assert.equal(options.length, 4);
  for (const opt of options) {
    assert.ok(opt.type, "hver option har type");
    assert.ok(opt.label, "hver option har label");
    assert.ok("disabled" in opt, "hver option har disabled-flag");
    assert.ok("disabled_reason" in opt, "hver option har disabled_reason");
  }
});

test("buildBoardRequestOptions disabler ALT naar planen ikke er forhandlet faerdig", () => {
  const options = buildBoardRequestOptions({
    board: readyBoard({ negotiation_status: "pending" }),
    context: openContext(),
  });
  assert.ok(options.every((o) => o.disabled === true));
  assert.ok(options.every((o) => /forhandl en ny plan/i.test(o.disabled_reason)));
});

test("buildBoardRequestOptions disabler ALT i slutfase-vinduet (≤5 race-days)", () => {
  const options = buildBoardRequestOptions({
    board: readyBoard(),
    context: openContext({ raceDaysLeft: REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT }),
  });
  assert.ok(options.every((o) => o.disabled === true));
  assert.ok(options.every((o) => /slutfase/i.test(o.disabled_reason)));
});

test("buildBoardRequestOptions disabler ALT naar saesonens request allerede er brugt", () => {
  const options = buildBoardRequestOptions({
    board: readyBoard(),
    context: openContext({ requestUsedThisSeason: true }),
  });
  assert.ok(options.every((o) => o.disabled === true));
});

test("buildBoardRequestOptions: more_youth_focus disabled naar planen allerede er ungdomsrettet", () => {
  const options = buildBoardRequestOptions({
    board: readyBoard({ focus: "youth_development" }),
    context: openContext(),
  });
  const youth = options.find((o) => o.type === "more_youth_focus");
  assert.equal(youth.disabled, true);
  assert.match(youth.disabled_reason, /ungdomsretning/i);
});

test("buildBoardRequestOptions: more_results_focus disabled naar planen allerede presser resultater", () => {
  const options = buildBoardRequestOptions({
    board: readyBoard({ focus: "star_signing" }),
    context: openContext(),
  });
  const results = options.find((o) => o.type === "more_results_focus");
  assert.equal(results.disabled, true);
  assert.match(results.disabled_reason, /topresultater/i);
});

test("buildBoardRequestOptions: MAJOR-pivot disabled naar en major drejning allerede er brugt", () => {
  // star_signing-board med opbrugt major-pivot → more_youth_focus (major) blokeret.
  const options = buildBoardRequestOptions({
    board: readyBoard({ focus: "star_signing", major_pivot_used_at: "2026-05-01T00:00:00.000Z" }),
    context: openContext(),
  });
  const youth = options.find((o) => o.type === "more_youth_focus");
  assert.equal(youth.disabled, true);
  assert.match(youth.disabled_reason, /MAJOR drejning/i);
});

test("buildBoardRequestOptions: 5yr-plan tidligt i forloebet laaser drejning (mid-cycle)", () => {
  const options = buildBoardRequestOptions({
    board: readyBoard({ plan_type: "5yr", focus: "star_signing" }),
    context: openContext({ planDuration: 5, seasonsCompleted: 1, satisfactionDeltaPct: 0 }),
  });
  // Mindst de fokus-drejende typer skal vaere laaste tidligt i en 5yr-plan.
  const youth = options.find((o) => o.type === "more_youth_focus");
  assert.equal(youth.disabled, true);
  assert.match(youth.disabled_reason, /5-aarsplanen/i);
});

test("buildBoardRequestOptions: 5yr-plan med stor tilfredsheds-delta aabner alligevel (deltaMet)", () => {
  const options = buildBoardRequestOptions({
    board: readyBoard({ plan_type: "5yr", focus: "star_signing" }),
    context: openContext({ planDuration: 5, seasonsCompleted: 1, satisfactionDeltaPct: 35 }),
  });
  // Delta > 30% åbner re-orientering → more_youth_focus rammer ikke mid-cycle-laasen.
  const youth = options.find((o) => o.type === "more_youth_focus");
  assert.ok(!/for tidligt i forloebet/i.test(youth.disabled_reason || ""));
});

// =====================================================================
// resolveBoardRequest — guards
// =====================================================================

test("resolveBoardRequest kaster uden board", () => {
  assert.throws(
    () => resolveBoardRequest({ requestType: "lower_results_pressure" }),
    /Board profile required/,
  );
});

test("resolveBoardRequest kaster ved ugyldig request_type", () => {
  assert.throws(
    () => resolveBoardRequest({ board: readyBoard(), requestType: "more_money" }),
    /Invalid request_type/,
  );
});

test("resolveBoardRequest returnerer rejected (uden updated_board) naar availability blokerer", () => {
  const result = resolveBoardRequest({
    board: readyBoard({ negotiation_status: "pending" }),
    requestType: "lower_results_pressure",
    context: openContext(),
  });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.updated_board, null);
  assert.deepEqual(result.goal_changes, []);
  assert.equal(result.request_type, "lower_results_pressure");
  assert.equal(result.request_label, "Saenk resultatpresset");
});

// =====================================================================
// resolveBoardRequest — lower_results_pressure
// =====================================================================

test("lower_results_pressure (neutral, høj score): lemper sportsmål + strammer økonomi → tradeoff", () => {
  const result = resolveBoardRequest({
    board: readyBoard(),
    requestType: "lower_results_pressure",
    team: STRONG_TEAM,
    standing: STRONG_STANDING,
    context: openContext(),
  });

  assert.equal(result.outcome, "tradeoff"); // 2 relaxed (ranking+results) → tradeoff
  const kinds = result.goal_changes.map((c) => c.kind);
  assert.equal(kinds.filter((k) => k === "relaxed").length, 2);
  assert.ok(kinds.includes("tightened"), "økonomimål strammes som modydelse");
  // Deferred tradeoff-payload sættes for denne type.
  assert.equal(result.has_deferred_tradeoff, true);
  assert.deepEqual(result.updated_board.tradeoff_payload, TRADEOFF_PAYLOADS_BY_REQUEST.lower_results_pressure);
  assert.equal(result.updated_board.tradeoff_active_until_season_id, "season-7");
  assert.equal(result.is_major_pivot, false);
  assert.equal(result.updated_board.major_pivot_used_at, null);
});

test("lower_results_pressure: afvises internt naar den udledte score er for lav", () => {
  // Availability passerer (satisfaction ≥ 35, ingen context.overallScore, neutral
  // profil), men dårlig standing → calculateBoardPerformance giver score < 0.52
  // → intern afvisning i resolveBoardRequest.
  const result = resolveBoardRequest({
    board: readyBoard({
      satisfaction: 50,
      current_goals: [
        { type: "top_n_finish", target: 1, label: "Top 1 i divisionen", satisfaction_bonus: 10, satisfaction_penalty: 10 },
        { type: "stage_wins", target: 12, label: "Mindst 12 etapesejre", satisfaction_bonus: 8, satisfaction_penalty: 8 },
      ],
    }),
    requestType: "lower_results_pressure",
    team: { division: 3, riders: [] },
    standing: { rank_in_division: 60, stage_wins: 0, gc_wins: 0 },
    context: openContext({ overallScore: null }),
  });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.updated_board, null);
});

test("lower_results_pressure: stærk stjerne-profil giver kun delvis lettelse uden 2x relaxed", () => {
  // strongStarProfile + høj satisfaction/score passerer gates, men star-grenen
  // gør ikke noget der ændrer outcome-strukturen radikalt — vi pinner blot at
  // den ikke kaster og returnerer en gyldig (ikke-rejected) afgørelse.
  const result = resolveBoardRequest({
    board: readyBoard({ satisfaction: 85 }),
    requestType: "lower_results_pressure",
    team: STRONG_TEAM,
    standing: STRONG_STANDING,
    context: openContext({ identityProfile: STRONG_STAR_IDENTITY }),
  });
  assert.notEqual(result.outcome, "rejected");
  assert.ok(["partial", "tradeoff"].includes(result.outcome));
});

// =====================================================================
// resolveBoardRequest — more_youth_focus
// =====================================================================

test("more_youth_focus FRA star_signing med høj tilfredshed → fuldt ungdomsspor + MAJOR pivot", () => {
  const result = resolveBoardRequest({
    board: readyBoard({ focus: "star_signing", satisfaction: 80 }),
    requestType: "more_youth_focus",
    team: STRONG_TEAM,
    standing: STRONG_STANDING,
    context: openContext({ identityProfile: NEUTRAL_IDENTITY }),
  });
  assert.equal(result.outcome, "tradeoff");
  assert.equal(result.updated_board.focus, "youth_development"); // ingen balanced-bridge
  assert.equal(result.is_major_pivot, true);
  assert.equal(typeof result.updated_board.major_pivot_used_at, "string");
  assert.ok(result.goal_changes.length > 0);
});

test("more_youth_focus FRA star_signing med lav tilfredshed → balanced-bridge (gradvis drejning)", () => {
  const result = resolveBoardRequest({
    board: readyBoard({ focus: "star_signing", satisfaction: 50 }),
    requestType: "more_youth_focus",
    team: STRONG_TEAM,
    standing: STRONG_STANDING,
    context: openContext({ identityProfile: NEUTRAL_IDENTITY }),
  });
  assert.equal(result.updated_board.focus, "balanced"); // satisfaction < 65 → bridge
  assert.equal(result.outcome, "tradeoff");
});

// =====================================================================
// resolveBoardRequest — more_results_focus
// =====================================================================

test("more_results_focus FRA youth_development med høj tilfredshed → fuldt star-spor (approved) + MAJOR", () => {
  const result = resolveBoardRequest({
    board: readyBoard({ focus: "youth_development", satisfaction: 80 }),
    requestType: "more_results_focus",
    team: STRONG_TEAM,
    standing: STRONG_STANDING,
    context: openContext({ identityProfile: NEUTRAL_IDENTITY }),
  });
  assert.equal(result.updated_board.focus, "star_signing"); // satisfaction ≥ 68 → ingen bridge
  assert.equal(result.outcome, "approved");
  assert.equal(result.is_major_pivot, true);
});

test("more_results_focus FRA youth_development med lav tilfredshed → balanced-bridge (tradeoff)", () => {
  const result = resolveBoardRequest({
    board: readyBoard({ focus: "youth_development", satisfaction: 50 }),
    requestType: "more_results_focus",
    team: STRONG_TEAM,
    standing: STRONG_STANDING,
    context: openContext({ identityProfile: NEUTRAL_IDENTITY }),
  });
  assert.equal(result.updated_board.focus, "balanced"); // satisfaction < 68 + ikke stærk star → bridge
  assert.equal(result.outcome, "tradeoff");
});

// =====================================================================
// resolveBoardRequest — ease_identity_requirements
// =====================================================================

test("ease_identity_requirements (neutral, høj score): lemper identitet + strammer ranking → tradeoff + deferred", () => {
  const result = resolveBoardRequest({
    board: readyBoard(),
    requestType: "ease_identity_requirements",
    team: STRONG_TEAM,
    standing: STRONG_STANDING,
    context: openContext(),
  });
  assert.equal(result.outcome, "tradeoff");
  const kinds = result.goal_changes.map((c) => c.kind);
  assert.ok(kinds.includes("relaxed"), "identitetsmål lempes");
  assert.ok(kinds.includes("tightened"), "ranking/results strammes til gengæld");
  assert.equal(result.has_deferred_tradeoff, true);
  assert.deepEqual(result.updated_board.tradeoff_payload, TRADEOFF_PAYLOADS_BY_REQUEST.ease_identity_requirements);
});

test("ease_identity_requirements: afvises ved stærk national kerne + moderat tilfredshed", () => {
  const result = resolveBoardRequest({
    board: readyBoard({ satisfaction: 60 }), // < 65
    requestType: "ease_identity_requirements",
    team: STRONG_TEAM,
    standing: STRONG_STANDING,
    context: openContext({ identityProfile: STRONG_NATIONAL_IDENTITY, overallScore: null }),
  });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.updated_board, null);
  assert.match(result.summary, /nationale kerne/i);
});

// =====================================================================
// getBoardRenegotiationLock
// =====================================================================

test("getBoardRenegotiationLock: ulåst naar planen ikke er signeret (completed)", () => {
  assert.deepEqual(getBoardRenegotiationLock({ board: { negotiation_status: "pending" } }), { locked: false });
  assert.deepEqual(getBoardRenegotiationLock({ board: null }), { locked: false });
});

test("getBoardRenegotiationLock: ulåst ved saesonstart (ingen race-days kørt)", () => {
  const board = { negotiation_status: "completed" };
  assert.deepEqual(
    getBoardRenegotiationLock({ board, activeSeason: { race_days_total: 100, race_days_completed: 0 } }),
    { locked: false },
  );
  assert.deepEqual(
    getBoardRenegotiationLock({ board, activeSeason: { race_days_total: 0, race_days_completed: 0 } }),
    { locked: false },
  );
});

test("getBoardRenegotiationLock: WINDOW-laas naar ≤5 race-days tilbage (med errorCode/params)", () => {
  const lock = getBoardRenegotiationLock({
    board: { negotiation_status: "completed" },
    activeSeason: { race_days_total: 100, race_days_completed: 95 }, // 5 tilbage
  });
  assert.equal(lock.locked, true);
  assert.equal(lock.code, "BOARD_RENEGOTIATION_LOCKED_WINDOW");
  assert.equal(lock.errorCode, "board_renegotiation_locked_window");
  assert.deepEqual(lock.errorParams, { raceDays: REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT });
});

test("getBoardRenegotiationLock: PROGRESS-laas naar ≥50% af saesonen er kørt", () => {
  const lock = getBoardRenegotiationLock({
    board: { negotiation_status: "completed" },
    activeSeason: { race_days_total: 100, race_days_completed: 50 }, // 50% præcis, 50 tilbage
  });
  assert.equal(lock.locked, true);
  assert.equal(lock.code, "BOARD_RENEGOTIATION_LOCKED_PROGRESS");
  assert.equal(lock.errorCode, "board_renegotiation_locked_progress");
  assert.deepEqual(lock.errorParams, { percent: RENEGOTIATION_SEASON_PROGRESS_LOCK_PCT });
});

test("getBoardRenegotiationLock: WINDOW vinder over PROGRESS naar begge gaelder", () => {
  // 94/100: progress 94% (≥50) OG 6 race-days tilbage (>5) → kun progress.
  const progressOnly = getBoardRenegotiationLock({
    board: { negotiation_status: "completed" },
    activeSeason: { race_days_total: 100, race_days_completed: 94 },
  });
  assert.equal(progressOnly.code, "BOARD_RENEGOTIATION_LOCKED_PROGRESS");
  // 96/100: 4 race-days tilbage (≤5) → window-grenen rammer først.
  const windowFirst = getBoardRenegotiationLock({
    board: { negotiation_status: "completed" },
    activeSeason: { race_days_total: 100, race_days_completed: 96 },
  });
  assert.equal(windowFirst.code, "BOARD_RENEGOTIATION_LOCKED_WINDOW");
});

test("getBoardRenegotiationLock: ulåst tidligt i saesonen (under 50% + rigeligt race-days)", () => {
  assert.deepEqual(
    getBoardRenegotiationLock({
      board: { negotiation_status: "completed" },
      activeSeason: { race_days_total: 100, race_days_completed: 40 }, // 40%, 60 tilbage
    }),
    { locked: false },
  );
});
