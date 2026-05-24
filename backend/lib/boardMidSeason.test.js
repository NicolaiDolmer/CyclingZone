// S-02g · Tests for manager-konkurrence + mid-season + tradeoff/pivot.
// Q-batch 1B Q12 + Q15 + Q16 + Q-batch 1A Q3 + Q-batch 1C Q21
//
// Dækker:
//   - applyTradeoffTighteningToGoals (pure function, 2 kinds)
//   - isMajorPivotRequest (pure function, kun youth↔star krydsninger)
//   - resolveBoardRequest persisterer tradeoff + major_pivot_used_at
//   - getBoardRequestAvailability F4 + F5 + F6 guards
//   - buildBoardProposal tradeoff-integration
//   - evaluateMidSeasonTrigger pure-trigger-evaluering
//   - processMidSeasonReviewCron orchestrator + idempotens

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyTradeoffTighteningToGoals,
  buildBoardProposal,
  evaluateGoalProgress,
  evaluateMidSeasonTrigger,
  isMajorPivotRequest,
  MAJOR_PIVOT_REQUEST_TYPES,
  MID_CYCLE_PROGRESS_THRESHOLD_PCT,
  MID_CYCLE_SATISFACTION_DELTA_PCT,
  MID_SEASON_TITLE_PREFIX,
  REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT,
  TRADEOFF_PAYLOADS_BY_REQUEST,
  buildBoardRequestOptions,
  resolveBoardRequest,
} from "./boardEngine.js";
import { processMidSeasonReviewCron } from "./boardMidSeason.js";

// =====================================================================
// applyTradeoffTighteningToGoals — pure function (F3)
// =====================================================================

test("applyTradeoffTighteningToGoals tighten_identity_riders bumper min_u25_riders target", () => {
  const goals = [
    { type: "min_u25_riders", target: 4, label: "Min. 4 U25-ryttere", satisfaction_bonus: 5, satisfaction_penalty: 5 },
    { type: "stage_wins", target: 3, label: "3 etapesejre" },
  ];
  const result = applyTradeoffTighteningToGoals(goals, { kind: "tighten_identity_riders", delta: 1 });

  const u25 = result.find((g) => g.type === "min_u25_riders");
  assert.equal(u25.target, 5);
  assert.equal(u25.tradeoff_tightened, true);
  assert.match(u25.label, /5/);

  const stages = result.find((g) => g.type === "stage_wins");
  assert.equal(stages.target, 3, "Andre maal-typer paavirkes ikke");
  assert.equal(stages.tradeoff_tightened, undefined);
});

test("applyTradeoffTighteningToGoals tighten_identity_riders bumper min_national_riders target", () => {
  const goals = [
    { type: "min_national_riders", target: 3, nationality_code: "DK", label: "3 fra DK" },
  ];
  const result = applyTradeoffTighteningToGoals(goals, { kind: "tighten_identity_riders", delta: 1 });
  assert.equal(result[0].target, 4);
  assert.equal(result[0].tradeoff_tightened, true);
});

test("applyTradeoffTighteningToGoals raise_sponsor_growth_target bumper sponsor_growth", () => {
  const goals = [
    { type: "sponsor_growth", target: 10, label: "Sponsor +10%" },
    { type: "min_u25_riders", target: 4, label: "4 U25" },
  ];
  const result = applyTradeoffTighteningToGoals(goals, { kind: "raise_sponsor_growth_target", delta_pct: 5 });

  const sponsor = result.find((g) => g.type === "sponsor_growth");
  assert.equal(sponsor.target, 15);
  assert.equal(sponsor.tradeoff_tightened, true);

  const u25 = result.find((g) => g.type === "min_u25_riders");
  assert.equal(u25.target, 4, "U25 paavirkes ikke af sponsor-tradeoff");
});

test("applyTradeoffTighteningToGoals null payload returnerer goals uaendret", () => {
  const goals = [{ type: "stage_wins", target: 3 }];
  const result = applyTradeoffTighteningToGoals(goals, null);
  assert.deepEqual(result, goals);
});

test("TRADEOFF_PAYLOADS_BY_REQUEST mapper request-type til hardkodet payload", () => {
  assert.equal(TRADEOFF_PAYLOADS_BY_REQUEST.lower_results_pressure.kind, "tighten_identity_riders");
  assert.equal(TRADEOFF_PAYLOADS_BY_REQUEST.lower_results_pressure.delta, 1);
  assert.equal(TRADEOFF_PAYLOADS_BY_REQUEST.ease_identity_requirements.kind, "raise_sponsor_growth_target");
  assert.equal(TRADEOFF_PAYLOADS_BY_REQUEST.ease_identity_requirements.delta_pct, 5);
  // more_youth_focus + more_results_focus har inline tradeoff i resolveBoardRequest, ingen deferred payload.
  assert.equal(TRADEOFF_PAYLOADS_BY_REQUEST.more_youth_focus, undefined);
  assert.equal(TRADEOFF_PAYLOADS_BY_REQUEST.more_results_focus, undefined);
});

// =====================================================================
// isMajorPivotRequest — pure function (F4)
// =====================================================================

test("isMajorPivotRequest more_youth_focus FRA star_signing er MAJOR", () => {
  assert.equal(isMajorPivotRequest({ requestType: "more_youth_focus", currentFocus: "star_signing" }), true);
});

test("isMajorPivotRequest more_results_focus FRA youth_development er MAJOR", () => {
  assert.equal(isMajorPivotRequest({ requestType: "more_results_focus", currentFocus: "youth_development" }), true);
});

test("isMajorPivotRequest more_youth_focus FRA balanced er IKKE major", () => {
  assert.equal(isMajorPivotRequest({ requestType: "more_youth_focus", currentFocus: "balanced" }), false);
});

test("isMajorPivotRequest more_results_focus FRA balanced er IKKE major", () => {
  assert.equal(isMajorPivotRequest({ requestType: "more_results_focus", currentFocus: "balanced" }), false);
});

test("isMajorPivotRequest lower_results_pressure er aldrig MAJOR", () => {
  assert.equal(isMajorPivotRequest({ requestType: "lower_results_pressure", currentFocus: "star_signing" }), false);
});

test("MAJOR_PIVOT_REQUEST_TYPES indeholder kun de 2 fokus-skift-types", () => {
  assert.ok(MAJOR_PIVOT_REQUEST_TYPES.has("more_youth_focus"));
  assert.ok(MAJOR_PIVOT_REQUEST_TYPES.has("more_results_focus"));
  assert.equal(MAJOR_PIVOT_REQUEST_TYPES.size, 2);
});

// =====================================================================
// resolveBoardRequest — persisterer tradeoff + major_pivot_used_at (F3 + F4)
// =====================================================================

// Hjælper: bygger samme 3yr-board-shape som boardEngine.test.js bruger til at teste
// resolveBoardRequest. 16 riders + division 3 + seasonsCompleted=2 går igennem mid-cycle-gate.
function makeRequestTestSetup({ focus = "balanced", planType = "3yr", satisfaction = 68 } = {}) {
  const proposal = buildBoardProposal({ focus, planType });
  return {
    board: {
      id: "board-1",
      focus: proposal.focus,
      plan_type: proposal.plan_type,
      satisfaction,
      negotiation_status: "completed",
      current_goals: proposal.goals,
    },
    standing: { rank_in_division: 4, stage_wins: 2, gc_wins: 0 },
    team: {
      sponsor_income: 110,
      riders: Array.from({ length: 16 }, (_, index) => ({
        id: `rider-${index}`,
        is_u25: index < 4,
      })),
    },
    context: {
      overallScore: 0.74,
      activeLoanCount: 0,
      planDuration: planType === "3yr" ? 3 : (planType === "5yr" ? 5 : 1),
      seasonsCompleted: planType === "1yr" ? 1 : 2,
      hasSeasonData: true,
      planStartSponsorIncome: 100,
      currentSponsorIncome: 110,
      cumulativeStats: { stageWins: 2, gcWins: 0 },
      activeSeasonId: "season-N",
    },
  };
}

test("resolveBoardRequest lower_results_pressure approved → tradeoff_payload + tradeoff_active_until_season_id", () => {
  const setup = makeRequestTestSetup({ focus: "balanced", planType: "3yr" });
  const result = resolveBoardRequest({
    ...setup,
    requestType: "lower_results_pressure",
  });
  assert.notEqual(result.outcome, "rejected");
  assert.equal(result.updated_board.tradeoff_active_until_season_id, "season-N");
  assert.equal(result.updated_board.tradeoff_payload.kind, "tighten_identity_riders");
  assert.equal(result.has_deferred_tradeoff, true);
  assert.equal(result.is_major_pivot, false);
  assert.equal(result.updated_board.major_pivot_used_at, null);
});

test("resolveBoardRequest more_youth_focus FRA star_signing → major_pivot_used_at sat", () => {
  const setup = makeRequestTestSetup({ focus: "star_signing", planType: "3yr", satisfaction: 70 });
  const result = resolveBoardRequest({
    ...setup,
    requestType: "more_youth_focus",
  });
  assert.notEqual(result.outcome, "rejected");
  assert.ok(result.updated_board.major_pivot_used_at);
  assert.match(result.updated_board.major_pivot_used_at, /\d{4}-\d{2}-\d{2}/);
  assert.equal(result.is_major_pivot, true);
  // more_youth_focus har INGEN deferred tradeoff (inline-tradeoff i resolveBoardRequest)
  assert.equal(result.updated_board.tradeoff_payload, null);
  assert.equal(result.has_deferred_tradeoff, false);
});

test("resolveBoardRequest rejected → tradeoff/pivot felter er null", () => {
  // satisfaction <35 trigger early-reject for lower_results_pressure
  const board = {
    id: "board-1",
    plan_type: "1yr",
    focus: "balanced",
    satisfaction: 25,
    negotiation_status: "completed",
    current_goals: [{ type: "top_n_finish", target: 3 }],
  };
  const result = resolveBoardRequest({
    board,
    requestType: "lower_results_pressure",
    team: { riders: [] },
    standing: { rank_in_division: 3, division: 3 },
    context: { activeLoanCount: 0, planDuration: 1, seasonsCompleted: 1, activeSeasonId: "season-N" },
  });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.updated_board, null);
});

// =====================================================================
// buildBoardRequestOptions — F4/F5/F6 availability guards
// =====================================================================

function makeAvailabilityBoard(overrides = {}) {
  return {
    id: "board-1",
    plan_type: "1yr",
    focus: "balanced",
    satisfaction: 60,
    negotiation_status: "completed",
    current_goals: [
      { type: "top_n_finish", target: 3, category: "ranking" },
      { type: "stage_wins", target: 4, category: "results" },
      { type: "min_u25_riders", target: 4, category: "identity" },
      { type: "no_outstanding_debt", target: 0, category: "economy" },
    ],
    ...overrides,
  };
}

test("F5 · raceDaysLeft <= 5 → alle requests disabled med window-block-reason", () => {
  const board = makeAvailabilityBoard();
  const options = buildBoardRequestOptions({
    board,
    context: { raceDaysLeft: 3, planDuration: 1, seasonsCompleted: 1, satisfactionDeltaPct: 10 },
  });
  assert.equal(options.length, 4);
  for (const opt of options) {
    assert.equal(opt.disabled, true, `${opt.type} skal vaere disabled`);
    assert.match(opt.disabled_reason, /slutfase|sidste/i, `${opt.type} reason matcher window-block`);
  }
});

test("F5 · raceDaysLeft = 6 → window-block ikke triggered", () => {
  const board = makeAvailabilityBoard();
  const options = buildBoardRequestOptions({
    board,
    context: { raceDaysLeft: 6, planDuration: 1, seasonsCompleted: 1, satisfactionDeltaPct: 10 },
  });
  // mindst én request skal være enabled (lower_results_pressure, satisfaction=60 OK)
  const enabled = options.filter((o) => !o.disabled);
  assert.ok(enabled.length > 0, "Mindst én request skal vaere enabled");
});

test("F5 · konstant matcher master-doc 5 race-days", () => {
  assert.equal(REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT, 5);
});

test("F6 · 5yr plan med 0% gennemfoert + lille satisfaction-delta → disabled", () => {
  const board = makeAvailabilityBoard({ plan_type: "5yr" });
  const options = buildBoardRequestOptions({
    board,
    context: { raceDaysLeft: 30, planDuration: 5, seasonsCompleted: 0, satisfactionDeltaPct: 10 },
  });
  for (const opt of options) {
    assert.equal(opt.disabled, true);
    assert.match(opt.disabled_reason, /5-aarsplan|gennemfoert|re-orientering/i);
  }
});

test("F6 · 5yr plan med >=50% gennemfoert → mid-cycle aabnet", () => {
  const board = makeAvailabilityBoard({ plan_type: "5yr" });
  const options = buildBoardRequestOptions({
    board,
    context: { raceDaysLeft: 30, planDuration: 5, seasonsCompleted: 3, satisfactionDeltaPct: 5 },
  });
  // mindst én bør være enabled
  const enabled = options.filter((o) => !o.disabled);
  assert.ok(enabled.length > 0, "50%+ progress skal aabne mid-cycle");
});

test("F6 · 3yr plan med store satisfaction-delta (>30%) → mid-cycle aabnet", () => {
  const board = makeAvailabilityBoard({ plan_type: "3yr" });
  const options = buildBoardRequestOptions({
    board,
    context: { raceDaysLeft: 30, planDuration: 3, seasonsCompleted: 0, satisfactionDeltaPct: 35 },
  });
  const enabled = options.filter((o) => !o.disabled);
  assert.ok(enabled.length > 0, ">30% delta skal aabne mid-cycle");
});

test("F6 · 1yr plan har ingen mid-cycle-laasning", () => {
  const board = makeAvailabilityBoard({ plan_type: "1yr" });
  const options = buildBoardRequestOptions({
    board,
    context: { raceDaysLeft: 30, planDuration: 1, seasonsCompleted: 0, satisfactionDeltaPct: 5 },
  });
  const enabled = options.filter((o) => !o.disabled);
  assert.ok(enabled.length > 0, "1yr plan skal aldrig blive blokeret af mid-cycle");
});

test("F6 · konstanter matcher master-doc 50% / 30%", () => {
  assert.equal(MID_CYCLE_PROGRESS_THRESHOLD_PCT, 50);
  assert.equal(MID_CYCLE_SATISFACTION_DELTA_PCT, 30);
});

test("F4 · MAJOR pivot blokeres af major_pivot_used_at", () => {
  const board = makeAvailabilityBoard({
    focus: "star_signing",
    major_pivot_used_at: "2026-05-05T10:00:00Z",
  });
  const options = buildBoardRequestOptions({
    board,
    context: { raceDaysLeft: 30, planDuration: 1, seasonsCompleted: 0, satisfactionDeltaPct: 5 },
  });
  const youth = options.find((o) => o.type === "more_youth_focus");
  assert.equal(youth.disabled, true);
  assert.match(youth.disabled_reason, /MAJOR|drejning|frisk plan/i);
});

test("F4 · ikke-MAJOR request (lower_results_pressure) tillades selv naar major_pivot_used_at sat", () => {
  const board = makeAvailabilityBoard({
    focus: "balanced",
    major_pivot_used_at: "2026-05-05T10:00:00Z",
  });
  const options = buildBoardRequestOptions({
    board,
    context: { raceDaysLeft: 30, planDuration: 1, seasonsCompleted: 0, satisfactionDeltaPct: 5 },
  });
  const lower = options.find((o) => o.type === "lower_results_pressure");
  assert.equal(lower.disabled, false, "lower_results_pressure er ikke MAJOR pivot");
});

// =====================================================================
// buildBoardProposal — tradeoff integration
// =====================================================================

test("buildBoardProposal med tradeoffPayload markerer tradeoff_applied + modificerer goals", () => {
  const proposal = buildBoardProposal({
    focus: "youth_development",
    planType: "1yr",
    team: { division: 3 },
    riders: [],
    standing: { rank_in_division: 3, division: 3 },
    tradeoffPayload: { kind: "tighten_identity_riders", delta: 1 },
  });
  assert.equal(proposal.tradeoff_applied, true);
  const u25 = proposal.goals.find((g) => g.type === "min_u25_riders");
  assert.ok(u25, "youth_development genererer min_u25_riders");
  assert.equal(u25.tradeoff_tightened, true);
});

test("buildBoardProposal uden tradeoffPayload markerer tradeoff_applied = false", () => {
  const proposal = buildBoardProposal({
    focus: "balanced",
    planType: "1yr",
    team: { division: 3 },
    riders: [],
    standing: { rank_in_division: 3, division: 3 },
  });
  assert.equal(proposal.tradeoff_applied, false);
  assert.ok(proposal.goals.every((g) => !g.tradeoff_tightened));
});

// =====================================================================
// evaluateMidSeasonTrigger — pure trigger-evaluering
// =====================================================================

test("evaluateMidSeasonTrigger satisfaction <50 → trigger=true reason=low_satisfaction", async () => {
  const result = await evaluateMidSeasonTrigger({
    satisfaction: 45,
    goals: [],
    standing: null,
    team: { riders: [] },
    divisionManagerCount: null,
  });
  assert.equal(result.trigger, true);
  assert.equal(result.reason, "low_satisfaction");
});

test("evaluateMidSeasonTrigger satisfaction >=50 + 50%+ goals 'behind' → trigger=true many_behind", async () => {
  // 4 mål, 2 'behind' → 50%
  const goals = [
    { type: "top_n_finish", target: 1 },              // rank=4 → behind
    { type: "stage_wins", target: 10 },               // 0 stage wins → behind
    { type: "min_u25_riders", target: 1 },            // 1 U25 → ahead
    { type: "no_outstanding_debt", target: 0 },       // ingen gæld → ahead
  ];
  const result = await evaluateMidSeasonTrigger({
    satisfaction: 60,
    goals,
    standing: { rank_in_division: 4, division: 3 },
    team: { riders: [{ is_u25: true }] },
    divisionManagerCount: 6,
    getRiders: async () => [{ is_u25: true }],
  });
  assert.equal(result.trigger, true);
  assert.equal(result.reason, "many_behind");
});

test("evaluateMidSeasonTrigger satisfaction >=50 + alle goals OK → trigger=false", async () => {
  const goals = [
    { type: "min_u25_riders", target: 1 },
    { type: "no_outstanding_debt", target: 0 },
  ];
  const result = await evaluateMidSeasonTrigger({
    satisfaction: 70,
    goals,
    standing: { rank_in_division: 1, division: 3 },
    team: { riders: [{ is_u25: true }] },
    divisionManagerCount: 6,
    getRiders: async () => [{ is_u25: true }],
  });
  assert.equal(result.trigger, false);
});

// =====================================================================
// processMidSeasonReviewCron — orchestrator + idempotens
// =====================================================================

test("processMidSeasonReviewCron sends banner naar satisfaction <50 ved midpoint", async () => {
  const notifications = [];
  const state = makeMidSeasonState({
    raceDaysCompleted: 30,    // = midpoint (60/2)
    raceDaysTotal: 60,
    boardSatisfaction: 40,    // < 50 → low_satisfaction trigger
  });
  const supabase = makeFakeSupabase(state);

  const summary = await processMidSeasonReviewCron({
    supabase,
    notifyUser: async (args) => {
      notifications.push({ ...args });
      // Persistér til state.notifications så idempotency-tjek virker ved replay
      state.notifications.push({
        id: `notif-${state.notifications.length + 1}`,
        user_id: args.userId,
        type: args.type,
        title: args.title,
        message: args.message,
        related_id: args.relatedId,
      });
      return { delivered: true, deduped: false };
    },
  });

  assert.equal(summary.teams_checked, 1);
  assert.equal(summary.banners_sent, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "board_critical");
  assert.match(notifications[0].title, new RegExp(MID_SEASON_TITLE_PREFIX));
  assert.match(notifications[0].title, /sæson 5/);
});

test("processMidSeasonReviewCron skipper foer midpoint", async () => {
  const state = makeMidSeasonState({
    raceDaysCompleted: 20,    // < midpoint
    raceDaysTotal: 60,
    boardSatisfaction: 30,
  });
  const supabase = makeFakeSupabase(state);

  const summary = await processMidSeasonReviewCron({
    supabase,
    notifyUser: async () => ({ delivered: true, deduped: false }),
  });

  assert.equal(summary.teams_checked, 0);
  assert.equal(summary.banners_sent, 0);
});

test("processMidSeasonReviewCron skipper i baseline-fasen (window=locked)", async () => {
  const state = makeMidSeasonState({
    raceDaysCompleted: 30,
    boardSatisfaction: 20,
    windowState: "locked",
  });
  const supabase = makeFakeSupabase(state);

  const summary = await processMidSeasonReviewCron({
    supabase,
    notifyUser: async () => ({ delivered: true, deduped: false }),
  });
  assert.equal(summary.teams_checked, 0);
  assert.equal(summary.banners_sent, 0);
});

test("processMidSeasonReviewCron skipper i onboarding-fasen (window=pending_5yr)", async () => {
  const state = makeMidSeasonState({
    raceDaysCompleted: 30,
    boardSatisfaction: 20,
    windowState: "pending_5yr",
  });
  const supabase = makeFakeSupabase(state);

  const summary = await processMidSeasonReviewCron({
    supabase,
    notifyUser: async () => ({ delivered: true, deduped: false }),
  });
  assert.equal(summary.banners_sent, 0);
});

test("processMidSeasonReviewCron er idempotent — eksisterende notif skipper", async () => {
  const state = makeMidSeasonState({
    raceDaysCompleted: 30,
    boardSatisfaction: 30,
  });
  // Pre-existing mid-season-notif for samme sæson + board
  state.notifications.push({
    id: "notif-pre",
    user_id: "user-1",
    type: "board_critical",
    title: `${MID_SEASON_TITLE_PREFIX} (sæson 5)`,
    message: "(eksisterende)",
    related_id: "board-1",
  });
  const supabase = makeFakeSupabase(state);

  const summary = await processMidSeasonReviewCron({
    supabase,
    notifyUser: async () => ({ delivered: true, deduped: false }),
  });
  assert.equal(summary.banners_sent, 0, "Skal IKKE re-fyre eksisterende mid-season-banner");
});

test("processMidSeasonReviewCron sender ikke til AI/bank/frozen teams", async () => {
  const state = makeMidSeasonState({
    raceDaysCompleted: 30,
    boardSatisfaction: 20,
  });
  // Tilføj AI-team OG bank-team — de skal ikke få banner
  state.teams.push({
    id: "team-ai",
    user_id: "user-ai",
    is_ai: true,
    is_bank: false,
    is_frozen: false,
    is_test_account: false,
    division: 1,
    name: "AI hold",
  });
  state.teams.push({
    id: "team-bank",
    user_id: null,
    is_ai: false,
    is_bank: true,
    is_frozen: false,
    is_test_account: false,
    division: 1,
    name: "Bank",
  });
  const supabase = makeFakeSupabase(state);

  const banners = [];
  const summary = await processMidSeasonReviewCron({
    supabase,
    notifyUser: async (args) => {
      banners.push(args);
      return { delivered: true, deduped: false };
    },
  });
  assert.equal(summary.teams_checked, 1, "Kun manager-team taelles");
  assert.equal(banners.length, 1);
  assert.equal(banners[0].userId, "user-1");
});

test("processMidSeasonReviewCron: per-team fail kalder captureExceptionFn med teamId+seasonId+seasonNumber (Refs #614 P2-A)", async () => {
  const state = makeMidSeasonState({
    raceDaysCompleted: 30,
    raceDaysTotal: 60,
    boardSatisfaction: 40,
  });
  const supabase = makeFakeSupabase(state);

  const captureCalls = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    const summary = await processMidSeasonReviewCron({
      supabase,
      notifyUser: async () => { throw new Error("simulated mid-season notify fail"); },
      captureExceptionFn: (err, ctx) => { captureCalls.push({ err, ctx }); },
    });
    assert.equal(summary.errors, 1);
  } finally {
    console.error = originalError;
  }

  assert.equal(captureCalls.length, 1);
  assert.equal(captureCalls[0].ctx.tags.cron, "board-mid-season");
  assert.equal(captureCalls[0].ctx.extra.teamId, "team-1");
  assert.equal(captureCalls[0].ctx.extra.seasonNumber, 5);
});

test("processMidSeasonReviewCron skipper hold uden 1yr-completed plan", async () => {
  const state = makeMidSeasonState({
    raceDaysCompleted: 30,
    boardSatisfaction: 20,
  });
  // Erstat completed plan med pending → cron skal skip
  state.board_profiles[0].negotiation_status = "pending";
  const supabase = makeFakeSupabase(state);

  const summary = await processMidSeasonReviewCron({
    supabase,
    notifyUser: async () => ({ delivered: true, deduped: false }),
  });
  assert.equal(summary.banners_sent, 0);
});

// =====================================================================
// Test fixtures
// =====================================================================

function makeMidSeasonState({
  raceDaysCompleted = 30,
  raceDaysTotal = 60,
  boardSatisfaction = 50,
  windowState = "complete",
} = {}) {
  return {
    teams: [{
      id: "team-1",
      user_id: "user-1",
      is_ai: false,
      is_bank: false,
      is_frozen: false,
      is_test_account: false,
      division: 3,
      name: "Test Hold",
      season_1_identity_basis: null,
    }],
    riders: [{ team_id: "team-1", is_u25: true, popularity: 50 }],
    seasons: [{
      id: "season-5",
      number: 5,
      status: "active",
      race_days_completed: raceDaysCompleted,
      race_days_total: raceDaysTotal,
    }],
    board_profiles: [{
      id: "board-1",
      team_id: "team-1",
      plan_type: "1yr",
      satisfaction: boardSatisfaction,
      current_goals: [
        { type: "top_n_finish", target: 3 },
        { type: "stage_wins", target: 5 },
      ],
      negotiation_status: "completed",
      is_baseline: false,
    }],
    season_standings: [{
      team_id: "team-1",
      season_id: "season-5",
      division: 3,
      rank_in_division: 4,
      total_points: 200,
      stage_wins: 1,
      gc_wins: 0,
      prize_money: 50000,
    }],
    transfer_windows: [{
      id: "tw-1",
      board_negotiation_state: windowState,
      created_at: "2026-05-05T00:00:00Z",
    }],
    notifications: [],
  };
}

// makeFakeSupabase — minimal version til mid-season tests (samme pattern som boardEngine.test.js).
// Supports eq/in/limit/order/maybeSingle/select/insert/update/delete/upsert.
function makeFakeSupabase(state) {
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function ensureTable(table) {
    if (!state[table]) state[table] = [];
    return state[table];
  }

  function makeQuery(table, action, payload = null) {
    const filters = [];
    let order = null;
    let limit = null;

    function matches(row) {
      return filters.every((filter) => {
        if (filter.type === "eq") return row[filter.column] === filter.value;
        if (filter.type === "in") return filter.values.includes(row[filter.column]);
        if (filter.type === "gte") return row[filter.column] >= filter.value;
        return true;
      });
    }

    function execute() {
      const rows = ensureTable(table);

      if (action === "select") {
        let result = rows.filter(matches);
        if (order) {
          result = [...result].sort((a, b) => {
            const av = a[order.column];
            const bv = b[order.column];
            if (av === bv) return 0;
            const cmp = av < bv ? -1 : 1;
            return order.ascending ? cmp : -cmp;
          });
        }
        if (limit != null) result = result.slice(0, limit);
        return Promise.resolve({ data: clone(result), error: null });
      }

      if (action === "insert") {
        const newRows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
          id: row.id || `${table}-${Math.random().toString(36).slice(2, 8)}`,
          ...clone(row),
        }));
        rows.push(...newRows);
        return Promise.resolve({ data: clone(newRows), error: null });
      }

      return Promise.resolve({ data: null, error: null });
    }

    const query = {
      eq(column, value) { filters.push({ type: "eq", column, value }); return query; },
      in(column, values) { filters.push({ type: "in", column, values }); return query; },
      gte(column, value) { filters.push({ type: "gte", column, value }); return query; },
      order(column, opts = {}) { order = { column, ascending: opts.ascending !== false }; return query; },
      limit(n) { limit = n; return query; },
      select() { return query; },
      single() { return execute().then((r) => ({ data: r.data[0] || null, error: r.error })); },
      maybeSingle() { return execute().then((r) => ({ data: r.data[0] || null, error: r.error })); },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    return query;
  }

  return {
    from(table) {
      ensureTable(table);
      return {
        select() { return makeQuery(table, "select"); },
        insert(payload) { return makeQuery(table, "insert", payload); },
      };
    },
  };
}
