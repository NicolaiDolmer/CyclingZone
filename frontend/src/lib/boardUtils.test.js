import { test } from "node:test";
import assert from "node:assert/strict";
import { isBoardGoalAchieved, satisfactionToModifier, getPlanDuration, getEventSatisfactionTrend, computeOverallBoardSatisfaction } from "./boardUtils.js";
// #2596 · Drift-guard: satisfactionToModifier (bånd >=80/60/40/20, ellers
// 0.80) er duplikeret i frontend (boardUtils.js) og backend
// (boardEvaluation.js — den autoritative kilde for board.budget_modifier),
// fordi de er separate npm-packages. Denne fil pinner frontend-kopien mod
// den delte, dokumenterede bånd-tabel; backend/lib/boardEvaluation.test.js
// pinner backend-kopien mod SAMME tabel. Ændres ét bånd på én side, fejler
// den sides pin — så frontendens forklaringstekst (#2307's
// satisfactionExplainer) kan ikke stille drifte fra board.budget_modifier.
// (Direkte cross-import af boardEvaluation.js kan ikke bruges her: den
// trækker backend-only deps ind som ikke loader i CI's frontend-build-job.)

// #55 · De 7 nye S-02d-måltyper faldt før til default:false i frontendens egen
// evaluator, så header-tæller + top-3-ikoner undertalte opnåede mål. Fixet
// bruger backend-evalueringens autoritative `met`-flag (fuld sæson-slut-regel)
// for ALLE måltyper — IKKE `status`, som pro-rater mål midt-i-plan.

const NEW_TYPES = [
  "signature_rider",
  "relative_rank",
  "monument_podium",
  "jersey_wins",
  "profitable_transfers",
  "u25_development_delta",
  "domestic_dominance",
];

test("#55 · met=true = opnået for ALLE nye måltyper (kerne-bug)", () => {
  for (const type of NEW_TYPES) {
    assert.equal(
      isBoardGoalAchieved({ type, target: 1 }, { met: true, status: "ahead" }),
      true,
      `${type} med met=true skal være opnået`
    );
  }
});

test("#55 · met=false = ikke opnået, også når status='ahead' (anti-pro-rating)", () => {
  // Regression-guard: status "ahead" pro-rates cumulative/multi-year-mål
  // midt-i-plan. Det må IKKE tælle som opnået — kun det fulde mål (met).
  for (const type of NEW_TYPES) {
    assert.equal(
      isBoardGoalAchieved({ type, target: 5 }, { met: false, status: "ahead" }),
      false,
      `${type} "on pace" (status ahead, met false) må ikke være opnået`
    );
  }
});

test("#55 · met vinder over enhver status + over lokal fallback", () => {
  const goal = { type: "stage_wins", target: 3 };
  // Lokal beregning ville sige opnået (standing 4 >= 3), men met=false:
  assert.equal(
    isBoardGoalAchieved(goal, { met: false, status: "behind" }, { standing: { stage_wins: 4 } }),
    false
  );
  // Lokal beregning ville sige ikke-opnået (standing 1 < 3), men met=true:
  assert.equal(
    isBoardGoalAchieved(goal, { met: true, status: "ahead" }, { standing: { stage_wins: 1 } }),
    true
  );
});

test("fallback · legacy-typer beregnes lokalt når der ingen evaluering er", () => {
  assert.equal(
    isBoardGoalAchieved({ type: "min_u25_riders", target: 2 }, undefined, {
      riders: [{ is_u25: true }, { is_u25: true }, { is_u25: false }],
    }),
    true
  );
  assert.equal(
    isBoardGoalAchieved({ type: "top_n_finish", target: 3 }, undefined, {
      standing: { rank_in_division: 5 },
    }),
    false
  );
  assert.equal(
    isBoardGoalAchieved({ type: "no_outstanding_debt", target: 0 }, undefined, { activeLoanCount: 0 }),
    true
  );
  assert.equal(
    isBoardGoalAchieved({ type: "min_national_riders", target: 2, nationality_code: "DK" }, undefined, {
      riders: [{ nationality_code: "dk" }, { nationality_code: "DK" }, { nationality_code: "fr" }],
    }),
    true
  );
});

test("fallback · cumulative legacy-mål bruger cumulativeStats", () => {
  assert.equal(
    isBoardGoalAchieved({ type: "stage_wins", target: 5, cumulative: true }, undefined, {
      cumulativeStats: { stage_wins: 6 },
    }),
    true
  );
  assert.equal(
    isBoardGoalAchieved({ type: "gc_wins", target: 2, cumulative: true }, undefined, {
      cumulativeStats: { gc_wins: 1 },
    }),
    false
  );
});

test("fallback · evaluering uden met-flag falder til lokal (ikke status)", () => {
  // En evaluering der kun har status (fx pre-deploy/cached) må ikke bruge status
  // som opnået-signal; legacy-typer beregnes lokalt, nye typer → false (sikkert).
  assert.equal(
    isBoardGoalAchieved({ type: "min_riders", target: 2 }, { status: "ahead" }, { riders: [{}, {}] }),
    true
  );
  for (const type of NEW_TYPES) {
    assert.equal(isBoardGoalAchieved({ type, target: 1 }, { status: "ahead" }, {}), false);
  }
});

test("robusthed · manglende goal/ctx kaster ikke", () => {
  assert.equal(isBoardGoalAchieved(null, undefined), false);
  assert.equal(isBoardGoalAchieved(undefined, { met: true }), true);
  assert.equal(isBoardGoalAchieved({ type: "min_riders", target: 1 }, undefined), false);
});

// Sanity for de øvrige helpers så filen dækker hele boardUtils.
test("satisfactionToModifier · ankerpunkter", () => {
  assert.equal(satisfactionToModifier(80), 1.20);
  assert.equal(satisfactionToModifier(40), 1.00);
  assert.equal(satisfactionToModifier(10), 0.80);
});

// #2596 · FE↔BE-paritet for satisfactionToModifier-båndene. Dækker begge
// bånd-kanter (fx 79 vs 80) for hvert af de 5 trin, så en enkelt
// off-by-one-ændring i backend (fx >80 i stedet for >=80) også fanges.
test("satisfactionToModifier · FE↔BE-paritet (#2596)", () => {
  // Delt, dokumenteret bånd-tabel — SAMME tabel pinnes backend-side i
  // backend/lib/boardEvaluation.test.js. Kant-prøverne (19/20, 39/40,
  // 59/60, 79/80) fanger en off-by-one (fx >80 i stedet for >=80).
  const expected = [
    [-10, 0.80], [0, 0.80], [19, 0.80],
    [20, 0.90], [21, 0.90], [39, 0.90],
    [40, 1.00], [41, 1.00], [59, 1.00],
    [60, 1.10], [61, 1.10], [79, 1.10],
    [80, 1.20], [81, 1.20], [100, 1.20], [150, 1.20],
  ];
  for (const [satisfaction, modifier] of expected) {
    assert.equal(
      satisfactionToModifier(satisfaction),
      modifier,
      `satisfaction=${satisfaction}: frontend satisfactionToModifier divergerer fra delt bånd-tabel`
    );
  }
});

test("getPlanDuration · 1/3/5", () => {
  assert.equal(getPlanDuration("1yr"), 1);
  assert.equal(getPlanDuration("3yr"), 3);
  assert.equal(getPlanDuration("5yr"), 5);
});

// #1451 · In-season trend-pil fra seneste løbs-event (modsat den sæson-slut-
// baserede getSatisfactionTrend). Seneste event (nyeste created_at) styrer pilen.
test("getEventSatisfactionTrend: seneste event styrer pilen", () => {
  const events = [
    { created_at: "2026-06-18T10:00:00Z", satisfaction_delta: 3 },
    { created_at: "2026-06-17T10:00:00Z", satisfaction_delta: -2 },
  ];
  assert.equal(getEventSatisfactionTrend(events).key, "up");
});
test("getEventSatisfactionTrend: tom liste → null", () => {
  assert.equal(getEventSatisfactionTrend([]), null);
});

// #1830 · Board-bred tilfredshed — ÉN delt kilde for Dashboard + Bestyrelse.
// Dashboard viste før den FØRSTE aktive plans tal (1yr→3yr→5yr), mens Bestyrelse
// viste gennemsnittet på tværs af planerne → 65% vs 67%. Begge skal nu kalde
// denne helper og få samme værdi.
test("computeOverallBoardSatisfaction: gennemsnit på tværs af planer (afrundet)", () => {
  // Reproducerer den rapporterede divergens: Dashboard tog 1yr=65 (først i
  // prioritet), Bestyrelse tog round((65+69)/2)=67. Nu giver helperen 67 begge steder.
  const plans = {
    "1yr": { board: { satisfaction: 65 } },
    "3yr": { board: { satisfaction: 69 } },
    "5yr": null,
  };
  assert.equal(computeOverallBoardSatisfaction(plans), 67);
});

test("computeOverallBoardSatisfaction: én plan → den plans tal", () => {
  assert.equal(
    computeOverallBoardSatisfaction({ "1yr": { board: { satisfaction: 65 } }, "3yr": null, "5yr": null }),
    65,
  );
});

test("computeOverallBoardSatisfaction: ingen planer / baseline-fase → null", () => {
  assert.equal(computeOverallBoardSatisfaction({ "1yr": null, "3yr": null, "5yr": null }), null);
  assert.equal(computeOverallBoardSatisfaction({}), null);
  assert.equal(computeOverallBoardSatisfaction(null), null);
  assert.equal(computeOverallBoardSatisfaction(undefined), null);
});

test("computeOverallBoardSatisfaction: ignorerer planer uden numerisk satisfaction", () => {
  const plans = {
    "1yr": { board: { satisfaction: 80 } },
    "3yr": { board: {} },          // mangler satisfaction
    "5yr": { board: { satisfaction: 60 } },
  };
  // Kun de to numeriske tæller: round((80+60)/2)=70.
  assert.equal(computeOverallBoardSatisfaction(plans), 70);
});
