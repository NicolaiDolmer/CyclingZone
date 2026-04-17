/**
 * Cycling Zone Manager — Economy Engine
 * =====================================
 * Handles all financial processing:
 *   - Season start: pay out sponsor income
 *   - Season end: deduct salaries, charge interest on debt,
 *                 evaluate board satisfaction, update divisions
 *   - Prize money distribution (called after race import)
 *   - Board satisfaction recalculation
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
export async function processSeasonEnd(seasonId) {
  console.log(`\n🏆 Processing season end: ${seasonId}`);

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
    await processTeamSeasonEnd(team, seasonId, standings);
  }

  // Mark season as completed
  await supabase.from("seasons")
    .update({ status: "completed" })
    .eq("id", seasonId);

  console.log("  ✅ Season end processing complete");
}

async function processTeamSeasonEnd(team, seasonId, standings) {
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

  // 4. Evaluate board satisfaction — sæt negotiation_status pending til næste sæson
  if (board && teamStanding) {
    const newSatisfaction = calculateBoardSatisfaction(board, teamStanding, team);
    const newModifier = satisfactionToModifier(newSatisfaction);
    const newGoals = generateBoardGoals(board.focus, board.plan_type);

    await supabase.from("board_profiles").update({
      satisfaction: newSatisfaction,
      budget_modifier: newModifier,
      current_goals: JSON.stringify(newGoals),
      negotiation_status: "pending",
    }).eq("id", board.id);

    await notifyManager(team.id, "board_update",
      "Bestyrelsens årsrapport",
      `Tilfredshed: ${newSatisfaction}% — Sponsor modifier: ×${newModifier.toFixed(2)}. Forhandl nye mål på Bestyrelses-siden.`);

    console.log(`  📊 ${team.name}: satisfaction ${board.satisfaction}% → ${newSatisfaction}%`);
  }

  console.log(`  💰 ${team.name}: -${totalSalary} pts salary`);
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
export function calculateBoardSatisfaction(board, standing, team) {
  let score = board.satisfaction; // Start from current
  const goals = board.current_goals || [];

  for (const goal of goals) {
    const achieved = evaluateGoal(goal, standing, team);
    if (achieved) {
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

function evaluateGoal(goal, standing, team) {
  switch (goal.type) {
    case "top_n_finish":
      return (standing.rank_in_division || 99) <= goal.target;
    case "stage_wins":
      return (standing.stage_wins || 0) >= goal.target;
    case "min_u25_riders":
      return (team.riders || []).filter(r => r.is_u25).length >= goal.target;
    case "min_riders":
      return (team.riders || []).length >= goal.target;
    case "gc_wins":
      return (standing.gc_wins || 0) >= goal.target;
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
  const baseGoals = {
    youth_development: [
      { type: "min_u25_riders", target: 5, label: "Min. 5 U25-ryttere på holdet",
        satisfaction_bonus: 15, satisfaction_penalty: 10 },
      { type: "top_n_finish", target: 5, label: "Top 5 i divisionen",
        satisfaction_bonus: 10, satisfaction_penalty: 5 },
      { type: "stage_wins", target: 1, label: "Mindst 1 etapesejr med U25 rytter",
        satisfaction_bonus: 20, satisfaction_penalty: 0 },
    ],
    star_signing: [
      { type: "top_n_finish", target: 3, label: "Top 3 i divisionen",
        satisfaction_bonus: 20, satisfaction_penalty: 15 },
      { type: "gc_wins", target: 1, label: "Mindst 1 samlet sejr",
        satisfaction_bonus: 25, satisfaction_penalty: 10 },
      { type: "min_riders", target: 20, label: "Hold på min. 20 ryttere",
        satisfaction_bonus: 5, satisfaction_penalty: 10 },
    ],
    balanced: [
      { type: "top_n_finish", target: 4, label: "Top 4 i divisionen",
        satisfaction_bonus: 15, satisfaction_penalty: 8 },
      { type: "min_riders", target: 15, label: "Hold på min. 15 ryttere",
        satisfaction_bonus: 5, satisfaction_penalty: 10 },
      { type: "stage_wins", target: 2, label: "Mindst 2 etapesejre",
        satisfaction_bonus: 10, satisfaction_penalty: 5 },
    ],
  };

  // Long-term plan modifier
  const planModifier = {
    "1yr": 1.0,
    "3yr": 0.8,   // More forgiving short-term
    "5yr": 0.6,   // Most forgiving short-term
  };

  const goals = baseGoals[focus] || baseGoals.balanced;
  return goals.map(g => ({
    ...g,
    satisfaction_penalty: Math.round(g.satisfaction_penalty * (planModifier[planType] || 1)),
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
