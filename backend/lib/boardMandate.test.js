import test from "node:test";
import assert from "node:assert/strict";

import {
  MANDATE_MIGRATION_WEIGHTS,
  MANDATE_CONSEQUENCE_BANDS,
  MANDATE_BONUS_OFFER_ABOVE,
  MILESTONE_MISS_MAX_PENALTY,
  adjustmentsAllowedFor,
  buildCategoryScores,
  buildMilestoneKey,
  computeMigratedConfidence,
  computeMilestoneHitReward,
  computeMilestoneMissPenalty,
  consequenceLayersFor,
  counterofferGenerosityFor,
  getTrustTier,
  isBonusBand,
  isHeadlineMilestone,
  isUnsignedLongPlan,
  mergeCategoryScoresForMigration,
  planToMandate,
  planToMilestones,
} from "./boardMandate.js";
import { CONSEQUENCE_CONSTANTS } from "./boardConsequences.js";

// ── Migrations-vægte (ejer-beslutning 7) ─────────────────────────────────────

test("migrations-vægtene er præcis ejerens 50/30/20", () => {
  assert.deepEqual(MANDATE_MIGRATION_WEIGHTS, { "1yr": 0.50, "3yr": 0.30, "5yr": 0.20 });
});

test("confidence er det vægtede snit når alle tre planer findes", () => {
  const { confidence, source } = computeMigratedConfidence({ "1yr": 80, "3yr": 60, "5yr": 40 });
  // 80*0.5 + 60*0.3 + 40*0.2 = 40 + 18 + 8 = 66
  assert.equal(confidence, 66);
  assert.equal(source.renormalized, false);
  assert.deepEqual(source.inputs, { "1yr": 80, "3yr": 60, "5yr": 40 });
});

test("manglende plan renormaliserer vægtene i stedet for at tælle som 0", () => {
  const { confidence, source } = computeMigratedConfidence({ "1yr": 80 });
  assert.equal(confidence, 80, "et hold uden 3/5-års-plan må ikke straffes for det");
  assert.equal(source.renormalized, true);
  assert.deepEqual(source.effective_weights, { "1yr": 1 });
});

test("1yr+3yr uden 5yr renormaliserer til 0,625/0,375", () => {
  const { confidence } = computeMigratedConfidence({ "1yr": 80, "3yr": 40 });
  // (80*0.5 + 40*0.3) / 0.8 = 64 / 0.8 = 65
  assert.equal(confidence, 65);
});

test("hold helt uden planer får neutral 50 med kvittering for hvorfor", () => {
  const { confidence, source } = computeMigratedConfidence({});
  assert.equal(confidence, 50);
  assert.equal(source.fallback, "no_plans_neutral_50");
});

test("confidence kan aldrig ligge under den laveste af de gamle satisfactions", () => {
  // Et vægtet snit kan matematisk ikke gå under sit minimum. Testen er en
  // forward-guard: den fanger hvis nogen senere lægger en straf ind i formlen,
  // for det ville betyde at hold falder gennem konsekvens-tærskler uforskyldt.
  for (const [s1, s3, s5] of [[10, 90, 90], [45, 41, 40], [0, 0, 100], [77, 12, 33]]) {
    const { confidence } = computeMigratedConfidence({ "1yr": s1, "3yr": s3, "5yr": s5 });
    assert.ok(confidence >= Math.min(s1, s3, s5) - 1, `${confidence} < min(${s1},${s3},${s5})`);
    assert.ok(confidence <= Math.max(s1, s3, s5) + 1);
  }
});

test("ugyldige input ignoreres frem for at forgifte snittet", () => {
  const { confidence } = computeMigratedConfidence({ "1yr": 80, "3yr": null, "5yr": "n/a" });
  assert.equal(confidence, 80);
});

// ── Aldrig-underskrevne lange planer ─────────────────────────────────────────

test("aldrig-underskrevet 3/5-års-forhandling udelades (22 rækker målt i prod 17/8)", () => {
  assert.equal(isUnsignedLongPlan({
    plan_type: "3yr", negotiation_status: "pending",
    plan_end_season_number: null, seasons_completed: 0,
  }), true);
});

test("en 1-års-plan udelades ALDRIG - pending er dens normale tilstand ved sæsonskifte", () => {
  assert.equal(isUnsignedLongPlan({
    plan_type: "1yr", negotiation_status: "pending",
    plan_end_season_number: null, seasons_completed: 0,
  }), false, "147 af 208 1yr-rækker stod pending 17/8 - de bærer stadig spillerens mandat");
});

test("en lang plan der ER underskrevet eller har kørt en sæson beholdes", () => {
  assert.equal(isUnsignedLongPlan({
    plan_type: "3yr", negotiation_status: "completed",
    plan_end_season_number: 4, seasons_completed: 1,
  }), false);
  assert.equal(isUnsignedLongPlan({
    plan_type: "5yr", negotiation_status: "pending",
    plan_end_season_number: null, seasons_completed: 2,
  }), false, "sæsoner kørt = en reel relation, uanset forhandlingsstatus");
});

// ── Tillids-trappen (ejer-beslutning 6) ──────────────────────────────────────

test("tillids-trappen rammer ejerens tærskler præcist", () => {
  assert.equal(adjustmentsAllowedFor(0), 1);
  assert.equal(adjustmentsAllowedFor(29), 1);
  assert.equal(adjustmentsAllowedFor(30), 2);
  assert.equal(adjustmentsAllowedFor(74), 2);
  assert.equal(adjustmentsAllowedFor(75), 3);
  assert.equal(adjustmentsAllowedFor(100), 3);
});

test("bestyrelsen strækker sig længere i modtilbud øverst på trappen", () => {
  assert.ok(counterofferGenerosityFor(80) > counterofferGenerosityFor(50));
  assert.ok(counterofferGenerosityFor(50) > counterofferGenerosityFor(20));
});

test("ugyldig confidence falder tilbage til standard-trinnet, ikke til det strengeste", () => {
  assert.equal(getTrustTier(undefined).key, "standard");
  assert.equal(getTrustTier("noget").key, "standard");
});

// ── Kategoriscorer ───────────────────────────────────────────────────────────

test("kategoriscorer klippes til 0-100 så intet metter kan vise over 100 %", () => {
  const scores = buildCategoryScores({
    results: { score: 1.15 },
    economy: { score: 0.4 },
    ranking: { score: 0 },
  });
  assert.deepEqual(scores, { results: 100, economy: 40, ranking: 0 });
});

test("kategori uden mål udelades helt frem for at blive gættet til 50", () => {
  const scores = buildCategoryScores({ results: { score: 0.8 }, identity: null });
  assert.deepEqual(Object.keys(scores), ["results"]);
});

test("kategoriscorer ved migration bruger samme 50/30/20-vægte som confidence", () => {
  const merged = mergeCategoryScoresForMigration({
    "1yr": { results: 80 },
    "3yr": { results: 60 },
    "5yr": { results: 40 },
  });
  assert.equal(merged.results, 66);
});

// ── Visions-milepæle ─────────────────────────────────────────────────────────

const stageWinGoal = {
  type: "stage_wins", target: 5, weight: 1, category: "results",
  importance: "required", satisfaction_bonus: 10, satisfaction_penalty: 4,
};

test("3-års-planens mål bliver milepæle med planens EGEN slut-sæson (grandfathering)", () => {
  const { milestones, skipped } = planToMilestones(
    { plan_type: "3yr", plan_end_season_number: 3 },
    [stageWinGoal],
  );
  assert.equal(skipped.length, 0);
  assert.equal(milestones.length, 1);
  assert.equal(milestones[0].target_season_number, 3);
  assert.equal(milestones[0].origin, "3yr");
  assert.equal(milestones[0].status, "pending");
});

test("plan uden slut-sæson springes over med grund frem for at få en gættet sæson", () => {
  const { milestones, skipped } = planToMilestones({ plan_type: "5yr" }, [stageWinGoal]);
  assert.equal(milestones.length, 0);
  assert.equal(skipped[0].reason, "missing_plan_end_season_number");
});

test("milepæls-nøglen er stabil på tværs af kørsler (idempotent migration)", () => {
  const a = buildMilestoneKey({ origin: "3yr", goal: stageWinGoal, targetSeasonNumber: 3, index: 0 });
  const b = buildMilestoneKey({ origin: "3yr", goal: stageWinGoal, targetSeasonNumber: 3, index: 0 });
  assert.equal(a, b);
  assert.notEqual(a, buildMilestoneKey({ origin: "5yr", goal: stageWinGoal, targetSeasonNumber: 3, index: 0 }));
});

test("løbende forpligtelser er ikke headline på visionstidslinjen", () => {
  assert.equal(isHeadlineMilestone({ type: "no_outstanding_debt", importance: "required" }), false);
  assert.equal(isHeadlineMilestone({ type: "min_riders", importance: "required" }), false);
  assert.equal(isHeadlineMilestone(stageWinGoal), true);
  assert.equal(isHeadlineMilestone({ type: "monument_podium", importance: "bonus" }), true);
});

test("løbende forpligtelser BEVARES som milepæle - de foldes kun sammen i UI'et", () => {
  const { milestones } = planToMilestones(
    { plan_type: "3yr", plan_end_season_number: 4 },
    [stageWinGoal, { type: "no_outstanding_debt", target: 0, weight: 1, importance: "required" }],
  );
  assert.equal(milestones.length, 2, "ingen spillerdata må forsvinde ved migrationen");
  assert.deepEqual(milestones.map((m) => m.is_headline), [true, false]);
});

// ── Milepæls-udfald (ejer-beslutning 3) ──────────────────────────────────────

test("misset milepæl bruger målets egen straf, skaleret efter vægt", () => {
  assert.equal(computeMilestoneMissPenalty({ satisfaction_penalty: 8 }, 1), 8);
  assert.equal(computeMilestoneMissPenalty({ satisfaction_penalty: 8 }, 0.5), 4);
});

test("et enkelt misset mål kan aldrig alene kaste et hold gennem to konsekvens-lag", () => {
  const worst = computeMilestoneMissPenalty({ satisfaction_penalty: 99 }, 2);
  assert.equal(worst, MILESTONE_MISS_MAX_PENALTY);
  // 40 (løncap) minus det værst tænkelige slag må stadig ligge over 15 (tvangssalg).
  assert.ok(CONSEQUENCE_CONSTANTS.SATISFACTION_THRESHOLDS.SALARY_CAP - worst
    > CONSEQUENCE_CONSTANTS.SATISFACTION_THRESHOLDS.FORCED_LISTING);
});

test("mål uden eksplicit straf/bonus falder tilbage på en defineret standard", () => {
  assert.equal(computeMilestoneMissPenalty({}, 1), 6);
  assert.equal(computeMilestoneHitReward({}, 1), 6);
});

// ── Mandatet fra 1-års-planen ────────────────────────────────────────────────

test("1-års-planens mål overføres UÆNDRET - ingen genforhandling påtvinges", () => {
  const goals = [stageWinGoal, { type: "min_riders", target: 10 }];
  const mandate = planToMandate(
    { focus: "balanced", id: "board-1", negotiation_status: "completed" },
    goals,
    { confidence: 66 },
  );
  assert.deepEqual(mandate.goals, goals);
  assert.equal(mandate.focus, "balanced");
  assert.equal(mandate.status, "active");
  assert.equal(mandate.source.from_board_id, "board-1");
});

test("mandatet får tillids-trappens justeringer ved migrationen", () => {
  assert.equal(planToMandate({}, [], { confidence: 20 }).adjustments_allowed, 1);
  assert.equal(planToMandate({}, [], { confidence: 66 }).adjustments_allowed, 2);
  assert.equal(planToMandate({}, [], { confidence: 90 }).adjustments_allowed, 3);
});

test("mål-antal uden for 3-5 rapporteres i stedet for at blive stiltiende rettet", () => {
  assert.equal(planToMandate({}, [stageWinGoal], {}).goal_count_outside_range, true);
  assert.equal(planToMandate({}, new Array(4).fill(stageWinGoal), {}).goal_count_outside_range, false);
});

// ── Konsekvens-bånd ──────────────────────────────────────────────────────────

test("konsekvens-tærsklerne er UÆNDREDE - samme tal som boardConsequences", () => {
  const live = CONSEQUENCE_CONSTANTS.SATISFACTION_THRESHOLDS;
  const byLayer = Object.fromEntries(MANDATE_CONSEQUENCE_BANDS.map((b) => [b.layer, b.below]));
  assert.equal(byLayer[2], live.SALARY_CAP);
  assert.equal(byLayer[3], live.SIGNING_RESTRICTION);
  assert.equal(byLayer[4], live.FORCED_LISTING);
  assert.equal(byLayer[5], live.SPONSOR_PULLOUT);
  assert.equal(MANDATE_BONUS_OFFER_ABOVE, live.BONUS_OFFER);
});

test("konsekvens-lag aflæses korrekt af et tillidstal", () => {
  assert.deepEqual(consequenceLayersFor(80), []);
  assert.deepEqual(consequenceLayersFor(39), [2]);
  assert.deepEqual(consequenceLayersFor(29).sort(), [2, 3]);
  assert.deepEqual(consequenceLayersFor(9).sort(), [2, 3, 4, 5]);
  assert.equal(isBonusBand(76), true);
  assert.equal(isBonusBand(75), false, "lag 6 kræver STRENGT over 75, som i dag");
});
