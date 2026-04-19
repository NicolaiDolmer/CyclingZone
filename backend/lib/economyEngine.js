/**
 * Cycling Zone Manager — Economy Engine
 * =====================================
 * Handles all financial processing:
 *   - Season start: pay out sponsor income
 *   - Season end: deduct salaries, charge interest on debt,
 *                 evaluate board satisfaction, update divisions
 *   - Prize money distribution (called after race import)
 *   - Board satisfaction recalculation
 *   - Multi-year plan lifecycle (1yr/3yr/5yr)
 */

import { createClient } from "@supabase/supabase-js";
import { processLoanInterest, createEmergencyLoan } from "./loanEngine.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─── Constants ────────────────────────────────────────────────────────────────

const SALARY_RATE = 0.10;          // 10% of rider price = yearly salary
const INTEREST_RATE = 0.10;        // 10% interest on negative balance per season
const PROMOTION_SLOTS = 2;         // Top 2 promote
const RELEGATION_SLOTS = 2;        // Bottom 2 relegate
const MAX_DIVISION = 3;
const MIN_DIVISION = 1;

// Board satisfaction thresholds
const SATISFACTION_RANGES = {
  sponsor_bonus: {
    high: { threshold: 80, modifier: 1.20 },   // +20% sponsor income
    mid:  { threshold: 50, modifier: 1.00 },   // Normal
    low:  { threshold: 0,  modifier: 0.80 },   // -20% sponsor income
  },
};

// Division requirements (min riders)
const DIVISION_MIN_RIDERS = {
  1: 20,
  2: 15,
  3: 8,
};

// ─── Season Start Processing ──────────────────────────────────────────────────

/**
 * Process season start for all active teams:
 * - Pay out sponsor income (modified by board satisfaction)
 * - Initialize board profiles if missing
 * - Log starting transactions
 */
export async function processSeasonStart(seasonId) {
  console.log(`\n🏁 Processing season start: ${seasonId}`);

  const { data: teams } = await supabase
    .from("teams")
    .select("*, board_profiles(*)")
    .eq("is_ai", false)
    .eq("is_frozen", false);

  const results = [];

  for (const team of teams || []) {
    const board = team.board_profiles?.[0];
    const modifier = board?.budget_modifier ?? 1.0;
    const sponsorBase = team.sponsor_income || 100;
    const sponsorPayout = Math.round(sponsorBase * modifier);

    // Pay sponsor income
    await creditTeam(team.id, sponsorPayout, "sponsor",
      `Sponsorindtægt — Sæson start (×${modifier.toFixed(2)})`, seasonId);

    // Ensure board profile exists
    if (!board) {
      await supabase.from("board_profiles").insert({
        team_id: team.id,
        plan_type: "1yr",
        focus: "balanced",
        satisfaction: 50,
        budget_modifier: 1.0,
        season_id: seasonId,
        current_goals: JSON.stringify(generateBoardGoals("balanced", "1yr")),
      });
    }

    results.push({ team: team.name, sponsor: sponsorPayout });
    console.log(`  ✅ ${team.name}: +${sponsorPayout} pts sponsor`);
  }

  return results;
}

// ─── Season End Processing ────────────────────────────────────────────────────

/**
 * Full season-end processing:
 * 1. Deduct rider salaries
 * 2. Charge interest on debt
 * 3. Evaluate board satisfaction
 * 4. Update divisions (promotion/relegation)
 * 5. Update sponsor income for next season
 */
function getPlanDurationFromType(planType) {
  return { "1yr": 1, "3yr": 3, "5yr": 5 }[planType] ?? 1;
}

export async function processSeasonEnd(seasonId) {
  console.log(`\n🏆 Processing season end: ${seasonId}`);

  // Get current season number
  const { data: currentSeason } = await supabase
    .from("seasons").select("number").eq("id", seasonId).single();
  const currentSeasonNumber = currentSeason?.number ?? 1;

  // Get final standings
  const { data: standings } = await supabase
    .from("season_standings")
    .select("*, team:team_id(*)")
    .eq("season_id", seasonId)
    .order("total_points", { ascending: false });

  if (!standings?.length) {
    console.warn("  ⚠️  No standings found for season");
    return;
  }

  // Process each division
  for (const division of [1, 2, 3]) {
    const divStandings = standings.filter(s => s.division === division);
    await processDivisionEnd(divStandings, division, seasonId);
  }

  // Process finances for all human teams
  const { data: teams } = await supabase
    .from("teams")
    .select(`*, riders(id, salary), board_profiles(*)`)
    .eq("is_ai", false);

  for (const team of teams || []) {
    await processTeamSeasonEnd(team, seasonId, standings, currentSeasonNumber);
  }

  // Mark season as completed
  await supabase.from("seasons")
    .update({ status: "completed" })
    .eq("id", seasonId);

  console.log("  ✅ Season end processing complete");
}

async function processTeamSeasonEnd(team, seasonId, standings, currentSeasonNumber) {
  const teamStanding = standings.find(s => s.team_id === team.id);
  const board = team.board_profiles?.[0];

  // 1. Tilskriv lånerenter
  await processLoanInterest(team.id, seasonId);

  // 2. Deduct salaries — opret nødlån hvis holdet ikke kan betale
  const totalSalary = (team.riders || []).reduce((sum, r) => sum + (r.salary || 0), 0);

  if (totalSalary > 0) {
    const { data: freshTeam } = await supabase
      .from("teams").select("balance").eq("id", team.id).single();
    const shortfall = totalSalary - freshTeam.balance;
    if (shortfall > 0) {
      console.log(`  ⚠️  ${team.name}: mangler ${shortfall} pts til løn — opretter nødlån`);
      await createEmergencyLoan(team.id, shortfall);
    }
    await debitTeam(team.id, totalSalary, "salary",
      `Sæsonlønninger — ${team.riders.length} ryttere`, seasonId);
  }

  // 3. Opkræv renter på resterende negativ balance (legacy-sikkerhedsnet)
  const { data: postSalaryTeam } = await supabase
    .from("teams").select("balance").eq("id", team.id).single();

  if (postSalaryTeam.balance < 0) {
    const interest = Math.round(Math.abs(postSalaryTeam.balance) * INTEREST_RATE);
    await debitTeam(team.id, interest, "interest",
      `Renter på gæld (10% af ${Math.abs(postSalaryTeam.balance).toLocaleString()} pts)`, seasonId);
    console.log(`  💸 ${team.name}: -${interest} pts interest on negative balance`);
  }

  // 4. Plan-aware board evaluation
  if (board && teamStanding) {
    const planDuration = getPlanDurationFromType(board.plan_type);
    const seasonsCompleted = (board.seasons_completed || 0) + 1;
    const newCumulativeStageWins = (board.cumulative_stage_wins || 0) + (teamStanding.stage_wins || 0);
    const newCumulativeGcWins = (board.cumulative_gc_wins || 0) + (teamStanding.gc_wins || 0);
    const planIsComplete = seasonsCompleted >= planDuration;
    const isMidReview = !planIsComplete && seasonsCompleted === Math.floor(planDuration / 2);

    // Active loans count for no_outstanding_debt goal
    const { count: activeLoanCount } = await supabase.from("loans")
      .select("id", { count: "exact", head: true })
      .eq("team_id", team.id).eq("status", "active");

    // Fresh team data for sponsor_growth evaluation
    const { data: freshTeamData } = await supabase.from("teams")
      .select("sponsor_income").eq("id", team.id).single();

    const context = {
      isFinalSeason: planIsComplete,
      activeLoanCount: activeLoanCount || 0,
      planStartSponsorIncome: board.plan_start_sponsor_income,
      currentSponsorIncome: freshTeamData?.sponsor_income ?? team.sponsor_income,
    };

    let newSatisfaction = calculateBoardSatisfaction(board, teamStanding, team, context);

    // Apply cumulative goal bonuses/penalties only at plan end
    if (planIsComplete) {
      const goals = typeof board.current_goals === "string"
        ? JSON.parse(board.current_goals) : (board.current_goals || []);
      for (const goal of goals) {
        if (!goal.cumulative) continue;
        let achieved = false;
        if (goal.type === "stage_wins") achieved = newCumulativeStageWins >= goal.target;
        if (goal.type === "gc_wins") achieved = newCumulativeGcWins >= goal.target;
        if (achieved) newSatisfaction += (goal.satisfaction_bonus || 10);
        else newSatisfaction -= (goal.satisfaction_penalty || 5);
      }
      newSatisfaction = Math.max(0, Math.min(100, newSatisfaction));
    }

    const newModifier = satisfactionToModifier(newSatisfaction);

    // Insert season snapshot
    const goals = typeof board.current_goals === "string"
      ? JSON.parse(board.current_goals) : (board.current_goals || []);
    const goalsMet = countGoalsMet(goals, teamStanding, team, context);

    await supabase.from("board_plan_snapshots").insert({
      team_id: team.id,
      board_id: board.id,
      season_id: seasonId,
      season_number: currentSeasonNumber,
      season_within_plan: seasonsCompleted,
      stage_wins: teamStanding.stage_wins || 0,
      gc_wins: teamStanding.gc_wins || 0,
      division_rank: teamStanding.rank_in_division || null,
      satisfaction_delta: newSatisfaction - board.satisfaction,
      goals_met: goalsMet,
      goals_total: goals.length,
    });

    if (planIsComplete) {
      // Plan expired — reset for re-negotiation
      await supabase.from("board_profiles").update({
        satisfaction: newSatisfaction,
        budget_modifier: newModifier,
        negotiation_status: "pending",
        seasons_completed: 0,
        cumulative_stage_wins: 0,
        cumulative_gc_wins: 0,
        updated_at: new Date().toISOString(),
      }).eq("id", board.id);

      const planLabel = { "1yr": "1-årsplan", "3yr": "3-årsplan", "5yr": "5-årsplan" }[board.plan_type] || "plan";
      await notifyManager(team.id, "board_update",
        "Bestyrelsesplan udløbet",
        `Din ${planLabel} er afsluttet. Tilfredshed: ${newSatisfaction}%. Forhandl en ny plan med bestyrelsen.`);
    } else {
      // Plan still running — update cumulative stats, keep goals
      await supabase.from("board_profiles").update({
        satisfaction: newSatisfaction,
        budget_modifier: newModifier,
        seasons_completed: seasonsCompleted,
        cumulative_stage_wins: newCumulativeStageWins,
        cumulative_gc_wins: newCumulativeGcWins,
        updated_at: new Date().toISOString(),
      }).eq("id", board.id);

      if (isMidReview) {
        const midMsg = newSatisfaction >= 60
          ? "Bestyrelsen er tilfreds med din fremgang."
          : newSatisfaction >= 40
          ? "Bestyrelsen er moderat tilfreds med din fremgang."
          : "Bestyrelsen er bekymret for fremgangen i din plan.";
        await notifyManager(team.id, "board_update",
          "Halvvejsevaluering",
          `Halvvejsevaluering: ${midMsg} Tilfredshed: ${newSatisfaction}%.`);
      } else {
        const planLabel = { "1yr": "1-årsplan", "3yr": "3-årsplan", "5yr": "5-årsplan" }[board.plan_type] || "plan";
        const delta = newSatisfaction - board.satisfaction;
        await notifyManager(team.id, "board_update",
          "Sæsonrapport",
          `Sæson ${seasonsCompleted}/${planDuration} af din ${planLabel} afsluttet. Tilfredshed: ${newSatisfaction}% (${delta >= 0 ? "+" : ""}${delta}).`);
      }
    }

    console.log(`  📊 ${team.name}: satisfaction ${board.satisfaction}% → ${newSatisfaction}% (season ${seasonsCompleted}/${planDuration})`);
  }

  console.log(`  💰 ${team.name}: -${totalSalary} pts salary`);
}

function countGoalsMet(goals, standing, team, context) {
  if (!goals?.length) return 0;
  return goals.filter(g => {
    if (g.cumulative) return false; // Cumulative counted separately at plan end
    const result = evaluateGoal(g, standing, team, context);
    return result === true;
  }).length;
}

async function processDivisionEnd(standings, division, seasonId) {
  if (standings.length < PROMOTION_SLOTS + RELEGATION_SLOTS) return;

  const promotions = [];
  const relegations = [];

  // Promotion (top teams from div 2 and 3)
  if (division > MIN_DIVISION) {
    const promoted = standings.slice(0, PROMOTION_SLOTS);
    for (const s of promoted) {
      if (!s.team.is_ai) {
        promotions.push(s.team_id);
        await supabase.from("teams")
          .update({ division: division - 1 })
          .eq("id", s.team_id);
        await notifyManager(s.team_id, "board_update",
          "Oprykket! 🎉",
          `Tillykke! Dit hold rykker op til Division ${division - 1}`);
      }
    }
  }

  // Relegation (bottom teams from div 1 and 2)
  if (division < MAX_DIVISION) {
    const relegated = standings.slice(-RELEGATION_SLOTS);
    for (const s of relegated) {
      if (!s.team.is_ai) {
        relegations.push(s.team_id);
        await supabase.from("teams")
          .update({ division: division + 1 })
          .eq("id", s.team_id);
        await notifyManager(s.team_id, "board_update",
          "Nedrykning",
          `Dit hold rykker ned til Division ${division + 1}`);
      }
    }
  }

  if (promotions.length || relegations.length) {
    console.log(`  📈 Div ${division}: ${promotions.length} promoted, ${relegations.length} relegated`);
  }
}

// ─── Board Satisfaction System ────────────────────────────────────────────────

/**
 * Calculate new board satisfaction based on season performance.
 * Returns 0-100 integer.
 */
export function calculateBoardSatisfaction(board, standing, team, context = {}) {
  let score = board.satisfaction;
  const goals = typeof board.current_goals === "string"
    ? JSON.parse(board.current_goals) : (board.current_goals || []);

  for (const goal of goals) {
    const result = evaluateGoal(goal, standing, team, context);
    if (result === null) continue; // Deferred goal — skip this season
    if (result) {
      score += goal.satisfaction_bonus || 10;
    } else {
      score -= goal.satisfaction_penalty || 5;
    }
  }

  // Division performance bonus/penalty
  const rank = standing.rank_in_division || 5;
  if (rank <= 2) score += 15;
  else if (rank <= 4) score += 5;
  else if (rank >= 7) score -= 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function evaluateGoal(goal, standing, team, context = {}) {
  const { isFinalSeason = true, activeLoanCount = 0, planStartSponsorIncome, currentSponsorIncome } = context;

  switch (goal.type) {
    case "top_n_finish":
      return (standing.rank_in_division || 99) <= goal.target;
    case "stage_wins":
      if (goal.cumulative) return null; // Applied at plan end via cumulative counters
      return (standing.stage_wins || 0) >= goal.target;
    case "gc_wins":
      if (goal.cumulative) return null;
      return (standing.gc_wins || 0) >= goal.target;
    case "min_u25_riders":
      return (team.riders || []).filter(r => r.is_u25).length >= goal.target;
    case "min_riders":
      return (team.riders || []).length >= goal.target;
    case "no_outstanding_debt":
      if (!isFinalSeason) return null; // Only evaluated at plan end for multi-year
      return activeLoanCount === 0;
    case "sponsor_growth":
      if (!isFinalSeason) return null;
      if (!planStartSponsorIncome || planStartSponsorIncome === 0) return null;
      return ((currentSponsorIncome - planStartSponsorIncome) / planStartSponsorIncome * 100) >= goal.target;
    default:
      return false;
  }
}

export function satisfactionToModifier(satisfaction) {
  if (satisfaction >= 80) return 1.20;
  if (satisfaction >= 60) return 1.10;
  if (satisfaction >= 40) return 1.00;
  if (satisfaction >= 20) return 0.90;
  return 0.80;
}

/**
 * Generate board goals based on focus and plan type.
 * Returns array of goal objects.
 */
export function generateBoardGoals(focus, planType) {
  const planDuration = getPlanDurationFromType(planType);
  const isMultiYear = planDuration > 1;
  const planModifier = { "1yr": 1.0, "3yr": 0.8, "5yr": 0.6 };
  const mod = planModifier[planType] || 1.0;

  const stageWinsTarget = isMultiYear ? Math.round(1 * planDuration * 0.8) : 1;
  const gcWinsTarget = isMultiYear ? Math.max(1, Math.round(planDuration * 0.6)) : 1;
  const balancedStageTarget = isMultiYear ? Math.round(2 * planDuration * 0.7) : 2;

  const baseGoals = {
    youth_development: [
      { type: "min_u25_riders", target: 5, label: "Min. 5 U25-ryttere på holdet",
        satisfaction_bonus: 15, satisfaction_penalty: 10 },
      { type: "top_n_finish", target: 5,
        label: isMultiYear ? "Top 5 i divisionen ved planens afslutning" : "Top 5 i divisionen",
        satisfaction_bonus: 10, satisfaction_penalty: 5 },
      { type: "stage_wins", target: stageWinsTarget,
        label: isMultiYear ? `Mindst ${stageWinsTarget} etapesejre over planperioden` : "Mindst 1 etapesejr",
        cumulative: isMultiYear, satisfaction_bonus: 20, satisfaction_penalty: 0 },
      { type: "no_outstanding_debt", target: 0,
        label: "Ingen udestående gæld ved sæsonslut",
        satisfaction_bonus: 12, satisfaction_penalty: 8 },
    ],
    star_signing: [
      { type: "top_n_finish", target: 3,
        label: isMultiYear ? "Top 3 i divisionen ved planens afslutning" : "Top 3 i divisionen",
        satisfaction_bonus: 20, satisfaction_penalty: 15 },
      { type: "gc_wins", target: gcWinsTarget,
        label: isMultiYear ? `Mindst ${gcWinsTarget} samlede sejre over planperioden` : "Mindst 1 samlet sejr",
        cumulative: isMultiYear, satisfaction_bonus: 25, satisfaction_penalty: 10 },
      { type: "min_riders", target: 20, label: "Hold på min. 20 ryttere",
        satisfaction_bonus: 5, satisfaction_penalty: 10 },
      { type: "sponsor_growth", target: isMultiYear ? planDuration * 5 : 10,
        label: isMultiYear
          ? `Sponsor-indkomst vokset med ${planDuration * 5}% over planperioden`
          : "Sponsor-indkomst vokset med 10%",
        satisfaction_bonus: 15, satisfaction_penalty: 10 },
    ],
    balanced: [
      { type: "top_n_finish", target: 4,
        label: isMultiYear ? "Top 4 i divisionen ved planens afslutning" : "Top 4 i divisionen",
        satisfaction_bonus: 15, satisfaction_penalty: 8 },
      { type: "min_riders", target: 15, label: "Hold på min. 15 ryttere",
        satisfaction_bonus: 5, satisfaction_penalty: 10 },
      { type: "stage_wins", target: balancedStageTarget,
        label: isMultiYear ? `Mindst ${balancedStageTarget} etapesejre over planperioden` : "Mindst 2 etapesejre",
        cumulative: isMultiYear, satisfaction_bonus: 10, satisfaction_penalty: 5 },
      { type: "no_outstanding_debt", target: 0,
        label: "Ingen udestående gæld ved sæsonslut",
        satisfaction_bonus: 12, satisfaction_penalty: 8 },
    ],
  };

  const goals = baseGoals[focus] || baseGoals.balanced;
  return goals.map(g => ({
    ...g,
    satisfaction_penalty: Math.round(g.satisfaction_penalty * mod),
  }));
}

// ─── Standing Updates ─────────────────────────────────────────────────────────

/**
 * Update season standings after a race result import.
 * Called automatically after processRaceResults.
 */
export async function updateStandings(seasonId, raceId) {
  // Get all GC and stage results for this race
  const { data: results } = await supabase
    .from("race_results")
    .select("team_id, result_type, rank, points_earned, prize_money")
    .eq("race_id", raceId);

  if (!results?.length) return;

  // Aggregate points by team
  const teamPoints = {};
  for (const r of results) {
    if (!r.team_id) continue;
    if (!teamPoints[r.team_id]) {
      teamPoints[r.team_id] = { points: 0, stage_wins: 0, gc_wins: 0 };
    }
    teamPoints[r.team_id].points += r.points_earned || 0;
    if (r.result_type === "stage" && r.rank === 1) teamPoints[r.team_id].stage_wins++;
    if (r.result_type === "gc" && r.rank === 1) teamPoints[r.team_id].gc_wins++;
  }

  // Upsert standings
  for (const [teamId, stats] of Object.entries(teamPoints)) {
    const { data: existing } = await supabase
      .from("season_standings")
      .select("*")
      .eq("season_id", seasonId)
      .eq("team_id", teamId)
      .single();

    if (existing) {
      await supabase.from("season_standings").update({
        total_points: existing.total_points + stats.points,
        stage_wins: existing.stage_wins + stats.stage_wins,
        gc_wins: existing.gc_wins + stats.gc_wins,
        races_completed: existing.races_completed + 1,
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      // Get team division
      const { data: team } = await supabase
        .from("teams").select("division").eq("id", teamId).single();

      await supabase.from("season_standings").insert({
        season_id: seasonId,
        team_id: teamId,
        division: team?.division || 3,
        total_points: stats.points,
        stage_wins: stats.stage_wins,
        gc_wins: stats.gc_wins,
        races_completed: 1,
      });
    }
  }

  console.log(`  📊 Standings updated for ${Object.keys(teamPoints).length} teams`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function creditTeam(teamId, amount, type, description, seasonId) {
  const { data: team } = await supabase
    .from("teams").select("balance").eq("id", teamId).single();
  await supabase.from("teams")
    .update({ balance: team.balance + amount })
    .eq("id", teamId);
  await supabase.from("finance_transactions").insert({
    team_id: teamId, type, amount, description, season_id: seasonId,
  });
}

async function debitTeam(teamId, amount, type, description, seasonId) {
  const { data: team } = await supabase
    .from("teams").select("balance").eq("id", teamId).single();
  await supabase.from("teams")
    .update({ balance: team.balance - amount })
    .eq("id", teamId);
  await supabase.from("finance_transactions").insert({
    team_id: teamId, type, amount: -amount, description, season_id: seasonId,
  });
}

async function notifyManager(teamId, type, title, message) {
  const { data: team } = await supabase
    .from("teams").select("user_id").eq("id", teamId).single();
  if (team?.user_id) {
    await supabase.from("notifications").insert({
      user_id: team.user_id, type, title, message,
    });
  }
}
