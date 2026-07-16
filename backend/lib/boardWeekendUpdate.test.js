// #1187-B · Unit-tests for den rene weekend-opdaterings-mekanik.
// Kør: node --test (backend/) — ingen DB, ingen env.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CHECKPOINT_KINDS,
  WEEKEND_SATISFACTION_CLAMP,
  WEEKEND_SATISFACTION_CLAMP_UP,
  BASELINE_SATISFACTION_MIN,
  BASELINE_SATISFACTION_MAX,
  computeWeekendSatisfactionUpdate,
  computeRealPoolPercentile,
  computeBaselineTargetSatisfaction,
  computeBaselineWeekendUpdate,
  getConsequenceCheckpoint,
  isConsequenceCheckpoint,
  resolveReasonCategory,
  resolveWeekendEconomyModifier,
} from "./boardWeekendUpdate.js";
import { satisfactionToModifier } from "./boardEvaluation.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// Minimal 1yr-plan med ét ranking-mål: scoren styres af rank_in_division alene,
// så testene kan ramme kendte satisfaction_delta-værdier. 1yr-planen giver
// personality med sports_ambition "high" → expectation-baseline 0.60 (#2309 ·
// mål-kalibrering, ned fra 0.66):
//   rank 1 / target 3  → score 1.133 → delta = round((1.133 − 0.60) · 55) = +29
//   rank 12 / target 3 → score 0     → delta = round((0 − 0.60) · 55)     = −33

function makeBoard(overrides = {}) {
  return {
    id: "board-test-1",
    plan_type: "1yr",
    focus: "balanced",
    satisfaction: 50,
    current_goals: [{ type: "top_n_finish", target: 3 }],
    ...overrides,
  };
}

const TEAM = { id: "team-test-1", division: 1, riders: [] };
const CONTEXT = { planDuration: 1, seasonsCompleted: 1, hasSeasonData: true };

function goodStanding() {
  return { team_id: TEAM.id, division: 1, rank_in_division: 1, stage_wins: 0, gc_wins: 0 };
}

function badStanding() {
  return { team_id: TEAM.id, division: 1, rank_in_division: 12, stage_wins: 0, gc_wins: 0 };
}

function runUpdate(overrides = {}) {
  return computeWeekendSatisfactionUpdate({
    board: makeBoard(),
    standing: goodStanding(),
    team: TEAM,
    context: CONTEXT,
    ...overrides,
  });
}

// ─── Clamp-grænser ────────────────────────────────────────────────────────────
// #2309 · asymmetrisk clamp: opad-grænsen (WEEKEND_SATISFACTION_CLAMP_UP = 8)
// er højere end nedad-grænsen (WEEKEND_SATISFACTION_CLAMP = 5) — boardet
// reagerer hurtigere på fremgang uden at gøre nedturen hårdere.

test("positiv bevægelse clampes til +8 pr. weekend (default op-grænse)", () => {
  const update = runUpdate();
  assert.equal(update.seasonDelta, 29);
  assert.equal(update.targetSatisfaction, 79);
  assert.equal(update.newSatisfaction, 58);
  assert.equal(update.appliedDelta, WEEKEND_SATISFACTION_CLAMP_UP);
  assert.equal(update.clampedByLimit, true);
});

test("negativ bevægelse clampes til -5 pr. weekend (default ned-grænse, uændret)", () => {
  const update = runUpdate({ standing: badStanding() });
  assert.equal(update.seasonDelta, -33);
  assert.equal(update.targetSatisfaction, 17);
  assert.equal(update.newSatisfaction, 45);
  assert.equal(update.appliedDelta, -WEEKEND_SATISFACTION_CLAMP);
  assert.equal(update.clampedByLimit, true);
});

test("bevægelse inden for clampen lander præcis på target", () => {
  // current 77, anker 50, target 79 → step +2 (ingen clamp, under begge grænser).
  const update = runUpdate({
    board: makeBoard({ satisfaction: 77 }),
    seasonStartSatisfaction: 50,
  });
  assert.equal(update.targetSatisfaction, 79);
  assert.equal(update.newSatisfaction, 79);
  assert.equal(update.appliedDelta, 2);
  assert.equal(update.clampedByLimit, false);
});

test("clampLimit (nedad) kan overstyres uafhængigt af op-grænsen", () => {
  // clampLimit ændrer kun downLimit — op-grænsen forbliver default (8) medmindre
  // clampLimitUp også angives eksplicit.
  const tightDown = runUpdate({ standing: badStanding(), clampLimit: 3 });
  assert.equal(tightDown.newSatisfaction, 47);
  assert.equal(tightDown.appliedDelta, -3);
});

test("clampLimit + clampLimitUp kan overstyres sammen (symmetrisk følsomhedsanalyse ±3/±10)", () => {
  const tight = runUpdate({ clampLimit: 3, clampLimitUp: 3 });
  assert.equal(tight.newSatisfaction, 53);
  const loose = runUpdate({ clampLimit: 10, clampLimitUp: 10 });
  assert.equal(loose.newSatisfaction, 60);
});

test("clampLimitUp kan overstyres uafhængigt af nedad-grænsen", () => {
  const upOverride = runUpdate({ clampLimit: 5, clampLimitUp: 10 });
  assert.equal(upOverride.newSatisfaction, 60);
  assert.equal(upOverride.appliedDelta, 10);
});

test("satisfaction holder sig i [0, 100] uanset target", () => {
  const top = runUpdate({ board: makeBoard({ satisfaction: 98 }), seasonStartSatisfaction: 98 });
  assert.equal(top.targetSatisfaction, 100); // 98 + 29 clampes til 100
  assert.equal(top.newSatisfaction, 100);

  const bottom = runUpdate({
    board: makeBoard({ satisfaction: 2 }),
    standing: badStanding(),
    seasonStartSatisfaction: 2,
  });
  assert.equal(bottom.targetSatisfaction, 0); // 2 − 33 clampes til 0
  assert.equal(bottom.newSatisfaction, 0);
});

// ─── Target-anker (sæson-start) ───────────────────────────────────────────────

test("target ankres i seasonStartSatisfaction, ikke i den løbende værdi", () => {
  // Løbende værdi 70, men sæson-start var 40 → target = 40 + 29 = 69 (UNDER current).
  const update = runUpdate({
    board: makeBoard({ satisfaction: 70 }),
    seasonStartSatisfaction: 40,
  });
  assert.equal(update.targetSatisfaction, 69);
  assert.equal(update.newSatisfaction, 69);
  assert.equal(update.appliedDelta, -1);
});

test("uden eksplicit anker bruges board.satisfaction (første weekend)", () => {
  const update = runUpdate({ board: makeBoard({ satisfaction: 60 }) });
  assert.equal(update.seasonStartSatisfaction, 60);
  assert.equal(update.targetSatisfaction, 89);
  assert.equal(update.newSatisfaction, 68);
});

test("gentagne weekender konvergerer mod sæson-evalueringens tal (intet sæson-slut-spring)", () => {
  // Samme standing hele vejen: target 79 fra anker 50, op-grænse 8 pr. weekend
  // → 58, 66, 74, 79 (sidste step < 8), fladt derefter.
  let satisfaction = 50;
  const trajectory = [];
  for (let weekend = 1; weekend <= 7; weekend += 1) {
    const update = runUpdate({
      board: makeBoard({ satisfaction }),
      seasonStartSatisfaction: 50,
    });
    satisfaction = update.newSatisfaction;
    trajectory.push(satisfaction);
  }
  assert.deepEqual(trajectory, [58, 66, 74, 79, 79, 79, 79]);
});

// ─── Modifier-mapping ─────────────────────────────────────────────────────────

test("newModifier følger satisfactionToModifier af den NYE satisfaction", () => {
  const update = runUpdate();
  assert.equal(update.newModifier, satisfactionToModifier(update.newSatisfaction));
  assert.equal(update.newModifier, 1.00); // 58 ligger i 40-59-båndet

  // Kør videre fra 58 → 66 → 1.10-båndet.
  const next = runUpdate({
    board: makeBoard({ satisfaction: 58 }),
    seasonStartSatisfaction: 50,
  });
  assert.equal(next.newSatisfaction, 66);
  assert.equal(next.newModifier, 1.10);
});

// ─── Determinisme ─────────────────────────────────────────────────────────────

test("samme input giver identisk output (ren funktion)", () => {
  const first = runUpdate();
  const second = runUpdate();
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
});

test("null board giver null (defensivt)", () => {
  assert.equal(computeWeekendSatisfactionUpdate({ board: null }), null);
});

// ─── Test-mode-neutralisering (#805, beslutning 5) ────────────────────────────

test("resolveWeekendEconomyModifier neutraliserer i board_test_mode", () => {
  assert.equal(resolveWeekendEconomyModifier({ modifier: 1.2, boardTestMode: true }), 1.0);
  assert.equal(resolveWeekendEconomyModifier({ modifier: 0.8, boardTestMode: true }), 1.0);
  assert.equal(resolveWeekendEconomyModifier({ modifier: 1.2, boardTestMode: false }), 1.2);
  assert.equal(resolveWeekendEconomyModifier({ modifier: 0.8 }), 0.8);
  // Ugyldige værdier falder tilbage til 1.0 (spejler `?? 1.0` i economyEngine).
  assert.equal(resolveWeekendEconomyModifier({ modifier: null }), 1.0);
  assert.equal(resolveWeekendEconomyModifier({ modifier: 0 }), 1.0);
});

// ─── Checkpoints (beslutning 3) ───────────────────────────────────────────────

test("checkpoints ligger ved mid-season og sæson-slut", () => {
  // 5 weekender: mid = floor(5/2) = 2, slut = 5.
  assert.equal(getConsequenceCheckpoint({ completedWeekends: 2, totalWeekends: 5 }), CHECKPOINT_KINDS.MID_SEASON);
  assert.equal(getConsequenceCheckpoint({ completedWeekends: 5, totalWeekends: 5 }), CHECKPOINT_KINDS.SEASON_END);
  for (const done of [1, 3, 4]) {
    assert.equal(getConsequenceCheckpoint({ completedWeekends: done, totalWeekends: 5 }), null);
  }

  // 4 weekender: mid = 2, slut = 4. 6 weekender: mid = 3, slut = 6.
  assert.equal(getConsequenceCheckpoint({ completedWeekends: 2, totalWeekends: 4 }), CHECKPOINT_KINDS.MID_SEASON);
  assert.equal(getConsequenceCheckpoint({ completedWeekends: 4, totalWeekends: 4 }), CHECKPOINT_KINDS.SEASON_END);
  assert.equal(getConsequenceCheckpoint({ completedWeekends: 3, totalWeekends: 6 }), CHECKPOINT_KINDS.MID_SEASON);

  // 1 weekend: den ene weekend ER sæson-slut, intet mid-checkpoint.
  assert.equal(getConsequenceCheckpoint({ completedWeekends: 1, totalWeekends: 1 }), CHECKPOINT_KINDS.SEASON_END);
  assert.equal(getConsequenceCheckpoint({ completedWeekends: 0, totalWeekends: 5 }), null);

  assert.equal(isConsequenceCheckpoint({ completedWeekends: 2, totalWeekends: 5 }), true);
  assert.equal(isConsequenceCheckpoint({ completedWeekends: 3, totalWeekends: 5 }), false);
});

// ─── resolveReasonCategory (#1451 · "hvorfor"-kategori pr. weekend-event) ──────

test("resolveReasonCategory: positiv delta → strongest_category", () => {
  const evaluation = { feedback: { strongest_category: "results", weakest_category: "identity" } };
  assert.equal(resolveReasonCategory({ evaluation, satisfactionDelta: 3 }), "results");
});
test("resolveReasonCategory: negativ delta → weakest_category", () => {
  const evaluation = { feedback: { strongest_category: "results", weakest_category: "identity" } };
  assert.equal(resolveReasonCategory({ evaluation, satisfactionDelta: -2 }), "identity");
});
test("resolveReasonCategory: delta 0 eller manglende feedback → null", () => {
  assert.equal(resolveReasonCategory({ evaluation: { feedback: { strongest_category: "results" } }, satisfactionDelta: 0 }), null);
  assert.equal(resolveReasonCategory({ evaluation: null, satisfactionDelta: 3 }), null);
});

// ─── Baseline-bestyrelsen lever (#2521) ────────────────────────────────────────
// Sæson 1/baseline-boards har ingen forhandlede mål (current_goals=[]), så
// evaluateBoardSeason kan ikke bruges. computeBaselineWeekendUpdate udleder i
// stedet et target af placerings-percentil + økonomi og bruger SAMME clamp-
// inerti som computeWeekendSatisfactionUpdate, bare klampet til [30,75].

function realTeamStanding({ teamId, rank, leagueDivisionId = 4, division = 1, isAi = false, isBank = false, isFrozen = false, isTest = false }) {
  return {
    team_id: teamId,
    division,
    league_division_id: leagueDivisionId,
    rank_in_division: rank,
    team: { is_ai: isAi, is_bank: isBank, is_frozen: isFrozen, is_test_account: isTest },
  };
}

test("computeRealPoolPercentile: bedste placering i puljen → 1, ringeste → 0", () => {
  const standings = [
    realTeamStanding({ teamId: "t1", rank: 1 }),
    realTeamStanding({ teamId: "t2", rank: 2 }),
    realTeamStanding({ teamId: "t3", rank: 3 }),
  ];
  assert.equal(computeRealPoolPercentile({ teamId: "t1", standing: standings[0], standings }), 1);
  assert.equal(computeRealPoolPercentile({ teamId: "t3", standing: standings[2], standings }), 0);
  assert.equal(computeRealPoolPercentile({ teamId: "t2", standing: standings[1], standings }), 0.5);
});

test("computeRealPoolPercentile: AI/bank/frosne/test-hold tælles IKKE med i puljen", () => {
  const standings = [
    realTeamStanding({ teamId: "real-1", rank: 1 }),
    realTeamStanding({ teamId: "ai-1", rank: 2, isAi: true }),
    realTeamStanding({ teamId: "bank-1", rank: 3, isBank: true }),
    realTeamStanding({ teamId: "frozen-1", rank: 4, isFrozen: true }),
    realTeamStanding({ teamId: "test-1", rank: 5, isTest: true }),
    realTeamStanding({ teamId: "real-2", rank: 6 }),
  ];
  // Kun real-1 og real-2 er i den rigtige pulje → real-1 (rank 1, bedst blandt de to) = 1.
  assert.equal(computeRealPoolPercentile({ teamId: "real-1", standing: standings[0], standings }), 1);
  assert.equal(computeRealPoolPercentile({ teamId: "real-2", standing: standings[5], standings }), 0);
});

test("computeRealPoolPercentile: <2 rigtige hold i puljen → neutral 0.5", () => {
  const standings = [realTeamStanding({ teamId: "solo", rank: 1 })];
  assert.equal(computeRealPoolPercentile({ teamId: "solo", standing: standings[0], standings }), 0.5);
});

test("computeRealPoolPercentile: falder tilbage til division uden league_division_id", () => {
  const standings = [
    { team_id: "t1", division: 2, league_division_id: null, rank_in_division: 1, team: { is_ai: false } },
    { team_id: "t2", division: 2, league_division_id: null, rank_in_division: 2, team: { is_ai: false } },
  ];
  assert.equal(computeRealPoolPercentile({ teamId: "t1", standing: standings[0], standings }), 1);
});

test("computeBaselineTargetSatisfaction: neutral percentil + sund økonomi ligger over centeret", () => {
  const standings = [
    realTeamStanding({ teamId: "t1", rank: 1 }),
    realTeamStanding({ teamId: "t2", rank: 2 }), // midterst i en 3-holds pulje → percentil 0.5
    realTeamStanding({ teamId: "t3", rank: 3 }),
  ];
  const result = computeBaselineTargetSatisfaction({
    teamId: "t2",
    standing: standings[1],
    standings,
    balance: 100000,
    activeLoanCount: 0,
  });
  assert.equal(result.percentile, 0.5);
  assert.equal(result.economyComponent, 5);
  assert.equal(result.loanPenalty, 0);
  assert.equal(result.targetSatisfaction, 55); // 50 + 0 + 5 − 0
});

test("computeBaselineTargetSatisfaction: bedste placering + sund økonomi trækker target op", () => {
  const standings = [
    realTeamStanding({ teamId: "t1", rank: 1 }),
    realTeamStanding({ teamId: "t2", rank: 2 }),
  ];
  const result = computeBaselineTargetSatisfaction({
    teamId: "t1",
    standing: standings[0],
    standings,
    balance: 50000,
    activeLoanCount: 0,
  });
  assert.equal(result.targetSatisfaction, 73); // 50 + 18 (percentil 1) + 5
});

test("computeBaselineTargetSatisfaction: ringeste placering + negativ saldo + laan trækker mod gulvet", () => {
  const standings = [
    realTeamStanding({ teamId: "t1", rank: 1 }),
    realTeamStanding({ teamId: "t2", rank: 2 }),
  ];
  const result = computeBaselineTargetSatisfaction({
    teamId: "t2",
    standing: standings[1],
    standings,
    balance: -500,
    activeLoanCount: 2,
  });
  // 50 − 18 (percentil 0) − 5 (negativ saldo) − 12 (2 laan × 6) = 15 → klampet til 30.
  assert.equal(result.targetSatisfaction, BASELINE_SATISFACTION_MIN);
});

test("computeBaselineTargetSatisfaction: laan-penalty er cappet ved 2, selv med flere aktive laan", () => {
  const standings = [realTeamStanding({ teamId: "t1", rank: 1 }), realTeamStanding({ teamId: "t2", rank: 2 })];
  const twoLoans = computeBaselineTargetSatisfaction({ teamId: "t2", standing: standings[1], standings, balance: 100, activeLoanCount: 2 });
  const fiveLoans = computeBaselineTargetSatisfaction({ teamId: "t2", standing: standings[1], standings, balance: 100, activeLoanCount: 5 });
  assert.equal(twoLoans.targetSatisfaction, fiveLoans.targetSatisfaction);
  assert.equal(twoLoans.loanPenalty, 12);
});

test("computeBaselineTargetSatisfaction: target ligger altid i [30,75]", () => {
  const standings = [realTeamStanding({ teamId: "t1", rank: 1 }), realTeamStanding({ teamId: "t2", rank: 2 })];
  for (const balance of [-999999, 0, 999999]) {
    for (const loans of [0, 1, 2, 10]) {
      const result = computeBaselineTargetSatisfaction({ teamId: "t2", standing: standings[1], standings, balance, activeLoanCount: loans });
      assert.ok(result.targetSatisfaction >= BASELINE_SATISFACTION_MIN);
      assert.ok(result.targetSatisfaction <= BASELINE_SATISFACTION_MAX);
    }
  }
});

test("computeBaselineWeekendUpdate: bevæger sig mod target med samme inerti-clamp som negotierede boards", () => {
  const standings = [realTeamStanding({ teamId: "t1", rank: 1 }), realTeamStanding({ teamId: "t2", rank: 2 })];
  const board = { id: "baseline-1", plan_type: "baseline", is_baseline: true, satisfaction: 50 };
  const update = computeBaselineWeekendUpdate({
    board,
    teamId: "t1",
    standing: standings[0],
    standings,
    balance: 10000,
    activeLoanCount: 0,
  });
  assert.equal(update.previousSatisfaction, 50);
  assert.equal(update.targetSatisfaction, 73);
  // rawStep = 23, clamp op-grænse 8 → new = 58.
  assert.equal(update.appliedDelta, WEEKEND_SATISFACTION_CLAMP_UP);
  assert.equal(update.newSatisfaction, 58);
});

test("computeBaselineWeekendUpdate: nedad-bevægelse respekterer den (uændrede) ±5-grænse", () => {
  const standings = [realTeamStanding({ teamId: "t1", rank: 1 }), realTeamStanding({ teamId: "t2", rank: 2 })];
  const board = { id: "baseline-2", plan_type: "baseline", is_baseline: true, satisfaction: 60 };
  const update = computeBaselineWeekendUpdate({
    board,
    teamId: "t2",
    standing: standings[1],
    standings,
    balance: -1000,
    activeLoanCount: 2,
  });
  // target = 30 (klampet gulv), current 60 → rawStep -30, ned-grænse 5 → new 55.
  assert.equal(update.targetSatisfaction, BASELINE_SATISFACTION_MIN);
  assert.equal(update.appliedDelta, -WEEKEND_SATISFACTION_CLAMP);
  assert.equal(update.newSatisfaction, 55);
});

test("computeBaselineWeekendUpdate: satisfaction konvergerer mod target over flere weekender, aldrig forbi", () => {
  const standings = [realTeamStanding({ teamId: "t1", rank: 1 }), realTeamStanding({ teamId: "t2", rank: 2 })];
  let satisfaction = 50;
  const trajectory = [];
  for (let weekend = 1; weekend <= 5; weekend += 1) {
    const update = computeBaselineWeekendUpdate({
      board: { id: "baseline-3", plan_type: "baseline", is_baseline: true, satisfaction },
      teamId: "t1",
      standing: standings[0],
      standings,
      balance: 1,
      activeLoanCount: 0,
    });
    satisfaction = update.newSatisfaction;
    trajectory.push(satisfaction);
  }
  // target 73, op-grænse 8: 58, 66, 73, 73, 73 (sidste step < 8, konvergeret).
  assert.deepEqual(trajectory, [58, 66, 73, 73, 73]);
  assert.ok(trajectory.every((value) => value <= BASELINE_SATISFACTION_MAX));
});

test("computeBaselineWeekendUpdate: null board giver null (defensivt, samme kontrakt som computeWeekendSatisfactionUpdate)", () => {
  assert.equal(computeBaselineWeekendUpdate({ board: null }), null);
});
