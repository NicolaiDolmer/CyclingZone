// #1187-B · Unit-tests for den rene weekend-opdaterings-mekanik.
// Kør: node --test (backend/) — ingen DB, ingen env.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CHECKPOINT_KINDS,
  WEEKEND_SATISFACTION_CLAMP,
  computeWeekendSatisfactionUpdate,
  getConsequenceCheckpoint,
  isConsequenceCheckpoint,
  resolveReasonCategory,
  resolveWeekendEconomyModifier,
} from "./boardWeekendUpdate.js";
import { satisfactionToModifier } from "./boardEvaluation.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// Minimal 1yr-plan med ét ranking-mål: scoren styres af rank_in_division alene,
// så testene kan ramme kendte satisfaction_delta-værdier. 1yr-planen giver
// personality med sports_ambition "high" → expectation-baseline 0.66:
//   rank 1 / target 3  → score 1.133 → delta = round((1.133 − 0.66) · 55) = +26
//   rank 12 / target 3 → score 0     → delta = round((0 − 0.66) · 55)     = −36

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

test("positiv bevægelse clampes til +5 pr. weekend (default)", () => {
  const update = runUpdate();
  assert.equal(update.seasonDelta, 26);
  assert.equal(update.targetSatisfaction, 76);
  assert.equal(update.newSatisfaction, 55);
  assert.equal(update.appliedDelta, WEEKEND_SATISFACTION_CLAMP);
  assert.equal(update.clampedByLimit, true);
});

test("negativ bevægelse clampes til -5 pr. weekend (default)", () => {
  const update = runUpdate({ standing: badStanding() });
  assert.equal(update.seasonDelta, -36);
  assert.equal(update.targetSatisfaction, 14);
  assert.equal(update.newSatisfaction, 45);
  assert.equal(update.appliedDelta, -WEEKEND_SATISFACTION_CLAMP);
  assert.equal(update.clampedByLimit, true);
});

test("bevægelse inden for clampen lander præcis på target", () => {
  // current 74, anker 50, target 76 → step +2 (ingen clamp).
  const update = runUpdate({
    board: makeBoard({ satisfaction: 74 }),
    seasonStartSatisfaction: 50,
  });
  assert.equal(update.targetSatisfaction, 76);
  assert.equal(update.newSatisfaction, 76);
  assert.equal(update.appliedDelta, 2);
  assert.equal(update.clampedByLimit, false);
});

test("clampLimit kan overstyres (±3 og ±10 til følsomhedsanalyse)", () => {
  const tight = runUpdate({ clampLimit: 3 });
  assert.equal(tight.newSatisfaction, 53);
  const loose = runUpdate({ clampLimit: 10 });
  assert.equal(loose.newSatisfaction, 60);
  const tightDown = runUpdate({ standing: badStanding(), clampLimit: 3 });
  assert.equal(tightDown.newSatisfaction, 47);
});

test("satisfaction holder sig i [0, 100] uanset target", () => {
  const top = runUpdate({ board: makeBoard({ satisfaction: 98 }), seasonStartSatisfaction: 98 });
  assert.equal(top.targetSatisfaction, 100); // 98 + 26 clampes til 100
  assert.equal(top.newSatisfaction, 100);

  const bottom = runUpdate({
    board: makeBoard({ satisfaction: 2 }),
    standing: badStanding(),
    seasonStartSatisfaction: 2,
  });
  assert.equal(bottom.targetSatisfaction, 0); // 2 − 36 clampes til 0
  assert.equal(bottom.newSatisfaction, 0);
});

// ─── Target-anker (sæson-start) ───────────────────────────────────────────────

test("target ankres i seasonStartSatisfaction, ikke i den løbende værdi", () => {
  // Løbende værdi 70, men sæson-start var 40 → target = 40 + 26 = 66 (UNDER current).
  const update = runUpdate({
    board: makeBoard({ satisfaction: 70 }),
    seasonStartSatisfaction: 40,
  });
  assert.equal(update.targetSatisfaction, 66);
  assert.equal(update.newSatisfaction, 66);
  assert.equal(update.appliedDelta, -4);
});

test("uden eksplicit anker bruges board.satisfaction (første weekend)", () => {
  const update = runUpdate({ board: makeBoard({ satisfaction: 60 }) });
  assert.equal(update.seasonStartSatisfaction, 60);
  assert.equal(update.targetSatisfaction, 86);
  assert.equal(update.newSatisfaction, 65);
});

test("gentagne weekender konvergerer mod sæson-evalueringens tal (intet sæson-slut-spring)", () => {
  // Samme standing hele vejen: target 76 fra anker 50 → 55, 60, 65, 70, 75, 76, 76.
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
  assert.deepEqual(trajectory, [55, 60, 65, 70, 75, 76, 76]);
});

// ─── Modifier-mapping ─────────────────────────────────────────────────────────

test("newModifier følger satisfactionToModifier af den NYE satisfaction", () => {
  const update = runUpdate();
  assert.equal(update.newModifier, satisfactionToModifier(update.newSatisfaction));
  assert.equal(update.newModifier, 1.00); // 55 ligger i 40-59-båndet

  // Kør videre til 60 → 1.10-båndet.
  const next = runUpdate({
    board: makeBoard({ satisfaction: 55 }),
    seasonStartSatisfaction: 50,
  });
  assert.equal(next.newSatisfaction, 60);
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
