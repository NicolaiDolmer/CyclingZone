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

import {
  processLoanAgreementSeasonFees,
  processLoanInterest,
  createEmergencyLoan,
} from "./loanEngine.js";
import {
  BOARD_IDENTITY_RIDER_SELECT,
  createInitialBoardProfile,
  evaluateBoardSeason,
  getPlanDuration,
} from "./boardEngine.js";
import { notifyTeamOwner as notifyTeamOwnerShared } from "./notificationService.js";

let defaultSupabaseClientPromise;

async function getDefaultSupabaseClient() {
  if (!defaultSupabaseClientPromise) {
    defaultSupabaseClientPromise = import("@supabase/supabase-js").then(({ createClient }) => (
      createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    ));
  }

  return defaultSupabaseClientPromise;
}

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
 * - Charge recurring rider-loan fees for continuing agreements
 * - Initialize board profiles if missing
 * - Log starting transactions
 */
export async function processSeasonStart(seasonId, deps = {}) {
  console.log(`\n🏁 Processing season start: ${seasonId}`);
  const supabaseClient = deps.supabase ?? await getDefaultSupabaseClient();
  const processLoanAgreementSeasonFeesFn =
    deps.processLoanAgreementSeasonFees ?? processLoanAgreementSeasonFees;

  const { data: season } = await supabaseClient
    .from("seasons")
    .select("number")
    .eq("id", seasonId)
    .single();
  const seasonNumber = season?.number ?? null;

  const { data: teams } = await supabaseClient
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
    await creditTeam(
      team.id,
      sponsorPayout,
      "sponsor",
      `Sponsorindtægt — Sæson start (×${modifier.toFixed(2)})`,
      seasonId,
      supabaseClient
    );

    const chargedLoanFees = await processLoanAgreementSeasonFeesFn(
      team.id,
      seasonNumber,
      seasonId,
      supabaseClient
    );

    // Ensure board profile exists
    if (!board) {
      await supabaseClient.from("board_profiles").insert(
        createInitialBoardProfile({
          teamId: team.id,
          seasonId,
          balance: team.balance ?? 0,
          sponsorIncome: team.sponsor_income ?? 100,
          focus: "balanced",
          planType: "1yr",
          negotiationStatus: "pending",
        })
      );
    }

    const totalLoanFees = chargedLoanFees.reduce((sum, loan) => sum + (loan.loan_fee || 0), 0);
    results.push({ team: team.name, sponsor: sponsorPayout, recurring_loan_fees: totalLoanFees });
    console.log(
      `  ✅ ${team.name}: +${sponsorPayout} pts sponsor${
        totalLoanFees > 0 ? `, -${totalLoanFees} pts lejegebyrer` : ""
      }`
    );
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
export async function processSeasonEnd(seasonId, deps = {}) {
  console.log(`\n🏆 Processing season end: ${seasonId}`);
  const supabaseClient = deps.supabase ?? await getDefaultSupabaseClient();
  const notificationNow = deps.now ?? new Date();

  // Get current season number
  const { data: currentSeason } = await supabaseClient
    .from("seasons").select("number").eq("id", seasonId).single();
  const currentSeasonNumber = currentSeason?.number ?? 1;

  // Get final standings
  const { data: standings } = await supabaseClient
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
    await processDivisionEnd(divStandings, division, seasonId, {
      supabase: supabaseClient,
      now: notificationNow,
    });
  }

  // Process finances for all human teams
  const { data: teams } = await supabaseClient
    .from("teams")
    .select(`*, riders(${BOARD_IDENTITY_RIDER_SELECT}), board_profiles(*)`)
    .eq("is_ai", false);

  for (const team of teams || []) {
    await processTeamSeasonEnd(team, seasonId, standings, currentSeasonNumber, {
      ...deps,
      supabase: supabaseClient,
      now: notificationNow,
    });
  }

  // Mark season as completed
  await supabaseClient.from("seasons")
    .update({ status: "completed" })
    .eq("id", seasonId);

  console.log("  ✅ Season end processing complete");
}

async function processTeamSeasonEnd(team, seasonId, standings, currentSeasonNumber, deps = {}) {
  const supabaseClient = deps.supabase ?? await getDefaultSupabaseClient();
  const processLoanInterestFn = deps.processLoanInterest ?? processLoanInterest;
  const createEmergencyLoanFn = deps.createEmergencyLoan ?? createEmergencyLoan;
  const notificationDeps = { supabase: supabaseClient, now: deps.now };
  const teamStanding = standings.find(s => s.team_id === team.id);
  const board = team.board_profiles?.[0];

  // 1. Tilskriv lånerenter
  await processLoanInterestFn(team.id, seasonId, supabaseClient);

  // 2. Deduct salaries — opret nødlån hvis holdet ikke kan betale
  const totalSalary = (team.riders || []).reduce((sum, r) => sum + (r.salary || 0), 0);

  if (totalSalary > 0) {
    const { data: freshTeam } = await supabaseClient
      .from("teams").select("balance").eq("id", team.id).single();
    const shortfall = totalSalary - freshTeam.balance;
    if (shortfall > 0) {
      console.log(`  ⚠️  ${team.name}: mangler ${shortfall} pts til løn — opretter nødlån`);
      await createEmergencyLoanFn(team.id, shortfall, supabaseClient);
    }
    await debitTeam(
      team.id,
      totalSalary,
      "salary",
      `Sæsonlønninger — ${team.riders.length} ryttere`,
      seasonId,
      supabaseClient
    );
  }

  // 3. Opkræv renter på resterende negativ balance (legacy-sikkerhedsnet)
  const { data: postSalaryTeam } = await supabaseClient
    .from("teams").select("balance").eq("id", team.id).single();

  if (postSalaryTeam.balance < 0) {
    const interest = Math.round(Math.abs(postSalaryTeam.balance) * INTEREST_RATE);
    await debitTeam(
      team.id,
      interest,
      "interest",
      `Renter på gæld (10% af ${Math.abs(postSalaryTeam.balance).toLocaleString()} pts)`,
      seasonId,
      supabaseClient
    );
    console.log(`  💸 ${team.name}: -${interest} pts interest on negative balance`);
  }

  // 4. Plan-aware board evaluation
  if (board && teamStanding) {
    const planDuration = getPlanDuration(board.plan_type);
    const seasonsCompleted = (board.seasons_completed || 0) + 1;
    const newCumulativeStageWins = (board.cumulative_stage_wins || 0) + (teamStanding.stage_wins || 0);
    const newCumulativeGcWins = (board.cumulative_gc_wins || 0) + (teamStanding.gc_wins || 0);
    const planIsComplete = seasonsCompleted >= planDuration;
    const isMidReview = !planIsComplete && seasonsCompleted === Math.floor(planDuration / 2);

    // Active loans count for no_outstanding_debt goal
    const { count: activeLoanCount } = await supabaseClient.from("loans")
      .select("id", { count: "exact", head: true })
      .eq("team_id", team.id).eq("status", "active");

    // Fresh team data for sponsor_growth evaluation
    const { data: freshTeamData } = await supabaseClient.from("teams")
      .select("sponsor_income").eq("id", team.id).single();

    const { data: recentSnapshots } = await supabaseClient
      .from("board_plan_snapshots")
      .select("goals_met, goals_total, satisfaction_delta")
      .eq("team_id", team.id)
      .order("created_at", { ascending: false })
      .limit(3);

    const context = {
      isFinalSeason: planIsComplete,
      activeLoanCount: activeLoanCount || 0,
      planStartSponsorIncome: board.plan_start_sponsor_income,
      currentSponsorIncome: freshTeamData?.sponsor_income ?? team.sponsor_income,
      planDuration,
      seasonsCompleted,
      recentSnapshots: recentSnapshots || [],
      hasSeasonData: true,
      cumulativeStats: {
        stageWins: newCumulativeStageWins,
        gcWins: newCumulativeGcWins,
      },
    };

    const {
      goals,
      feedback,
      goalsMet,
      newModifier,
      newSatisfaction,
      scoreBreakdown,
    } = evaluateBoardSeason({
      board,
      standing: teamStanding,
      team,
      context,
    });

    await supabaseClient.from("board_plan_snapshots").insert({
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
      await supabaseClient.from("board_profiles").update({
        satisfaction: newSatisfaction,
        budget_modifier: newModifier,
        negotiation_status: "pending",
        seasons_completed: 0,
        cumulative_stage_wins: 0,
        cumulative_gc_wins: 0,
        updated_at: new Date().toISOString(),
      }).eq("id", board.id);

      const planLabel = { "1yr": "1-årsplan", "3yr": "3-årsplan", "5yr": "5-årsplan" }[board.plan_type] || "plan";
      await notifyManager(
        team.id,
        "board_update",
        "Bestyrelsesplan udløbet",
        `${feedback.headline}. ${feedback.summary} Tilfredshed: ${newSatisfaction}%. Forhandl en ny plan med bestyrelsen.`,
        notificationDeps
      );
    } else {
      // Plan still running — update cumulative stats, keep goals
      await supabaseClient.from("board_profiles").update({
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
        await notifyManager(
          team.id,
          "board_update",
          "Halvvejsevaluering",
          `Halvvejsevaluering: ${midMsg} ${feedback.summary} Tilfredshed: ${newSatisfaction}%.`,
          notificationDeps
        );
      } else {
        const planLabel = { "1yr": "1-årsplan", "3yr": "3-årsplan", "5yr": "5-årsplan" }[board.plan_type] || "plan";
        const delta = newSatisfaction - board.satisfaction;
        await notifyManager(
          team.id,
          "board_update",
          "Sæsonrapport",
          `Sæson ${seasonsCompleted}/${planDuration} af din ${planLabel} afsluttet. ${feedback.summary} Tilfredshed: ${newSatisfaction}% (${delta >= 0 ? "+" : ""}${delta}).`,
          notificationDeps
        );
      }
    }

    console.log(
      `  📊 ${team.name}: satisfaction ${board.satisfaction}% → ${newSatisfaction}% `
      + `(season ${seasonsCompleted}/${planDuration}, score ${Math.round((scoreBreakdown.adjusted_overall_score || 0) * 100)}%)`
    );
  }

  console.log(`  💰 ${team.name}: -${totalSalary} pts salary`);
}

async function processDivisionEnd(standings, division, seasonId, deps = {}) {
  const client = deps.supabase ?? await getDefaultSupabaseClient();
  const notificationDeps = { supabase: client, now: deps.now };
  if (standings.length < PROMOTION_SLOTS + RELEGATION_SLOTS) return;

  const promotions = [];
  const relegations = [];

  // Promotion (top teams from div 2 and 3)
  if (division > MIN_DIVISION) {
    const promoted = standings.slice(0, PROMOTION_SLOTS);
    for (const s of promoted) {
      if (!s.team.is_ai) {
        promotions.push(s.team_id);
        await client.from("teams")
          .update({ division: division - 1 })
          .eq("id", s.team_id);
        await notifyManager(
          s.team_id,
          "board_update",
          "Oprykket! 🎉",
          `Tillykke! Dit hold rykker op til Division ${division - 1}`,
          notificationDeps
        );
      }
    }
  }

  // Relegation (bottom teams from div 1 and 2)
  if (division < MAX_DIVISION) {
    const relegated = standings.slice(-RELEGATION_SLOTS);
    for (const s of relegated) {
      if (!s.team.is_ai) {
        relegations.push(s.team_id);
        await client.from("teams")
          .update({ division: division + 1 })
          .eq("id", s.team_id);
        await notifyManager(
          s.team_id,
          "board_update",
          "Nedrykning",
          `Dit hold rykker ned til Division ${division + 1}`,
          notificationDeps
        );
      }
    }
  }

  if (promotions.length || relegations.length) {
    console.log(`  📈 Div ${division}: ${promotions.length} promoted, ${relegations.length} relegated`);
  }
}

// ─── Standing Updates ─────────────────────────────────────────────────────────

/**
 * Recalculate the full season standings from stored race results.
 * This keeps standings idempotent even when results are approved in batches.
 */
export async function updateStandings(seasonId, raceId = null, deps = {}) {
  const supabaseClient = deps.supabase ?? await getDefaultSupabaseClient();
  const [{ data: teams, error: teamsError }, { data: races, error: racesError }] = await Promise.all([
    supabaseClient.from("teams").select("id, division"),
    supabaseClient.from("races").select("id").eq("season_id", seasonId),
  ]);

  if (teamsError) throw new Error(teamsError.message);
  if (racesError) throw new Error(racesError.message);

  const teamStats = {};
  for (const team of teams || []) {
    teamStats[team.id] = {
      division: team.division || 3,
      points: 0,
      stage_wins: 0,
      gc_wins: 0,
      races_completed: new Set(),
    };
  }

  const raceIds = (races || []).map(race => race.id);
  if (raceIds.length > 0) {
    const { data: results, error: resultsError } = await supabaseClient
      .from("race_results")
      .select("race_id, team_id, result_type, rank, points_earned, rider:rider_id(team_id)")
      .in("race_id", raceIds);
    if (resultsError) throw new Error(resultsError.message);

    for (const result of results || []) {
      const teamId = result.team_id || result.rider?.team_id;
      if (!teamId) continue;

      if (!teamStats[teamId]) {
        teamStats[teamId] = {
          division: 3,
          points: 0,
          stage_wins: 0,
          gc_wins: 0,
          races_completed: new Set(),
        };
      }

      teamStats[teamId].points += result.points_earned || 0;
      if (result.race_id) teamStats[teamId].races_completed.add(result.race_id);
      if (result.result_type === "stage" && result.rank === 1) teamStats[teamId].stage_wins++;
      if (result.result_type === "gc" && result.rank === 1) teamStats[teamId].gc_wins++;
    }
  }

  const rankByTeamId = new Map();
  const divisions = [...new Set(Object.values(teamStats).map(stats => stats.division || 3))];
  for (const division of divisions) {
    const rankedTeams = Object.entries(teamStats)
      .filter(([, stats]) => (stats.division || 3) === division)
      .sort(([, left], [, right]) => {
        if ((right.points || 0) !== (left.points || 0)) {
          return (right.points || 0) - (left.points || 0);
        }

        return 0;
      });

    rankedTeams.forEach(([teamId], index) => {
      rankByTeamId.set(teamId, index + 1);
    });
  }

  const timestamp = new Date().toISOString();
  const rows = Object.entries(teamStats).map(([teamId, stats]) => ({
    season_id: seasonId,
    team_id: teamId,
    division: stats.division,
    rank_in_division: rankByTeamId.get(teamId) || null,
    total_points: stats.points,
    stage_wins: stats.stage_wins,
    gc_wins: stats.gc_wins,
    races_completed: stats.races_completed.size,
    updated_at: timestamp,
  }));

  const { error: upsertError } = await supabaseClient
    .from("season_standings")
    .upsert(rows, { onConflict: "season_id,team_id" });
  if (upsertError) throw new Error(upsertError.message);

  console.log(`  📊 Standings recalculated for ${rows.length} teams${raceId ? ` after race ${raceId}` : ""}`);

  return {
    rowsUpdated: rows.length,
    teamsWithPoints: rows.filter(row => row.total_points > 0).length,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function creditTeam(teamId, amount, type, description, seasonId, supabaseClient = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  const { data: team } = await client
    .from("teams").select("balance").eq("id", teamId).single();
  await client.from("teams")
    .update({ balance: team.balance + amount })
    .eq("id", teamId);
  await client.from("finance_transactions").insert({
    team_id: teamId, type, amount, description, season_id: seasonId,
  });
}

async function debitTeam(teamId, amount, type, description, seasonId, supabaseClient = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  const { data: team } = await client
    .from("teams").select("balance").eq("id", teamId).single();
  await client.from("teams")
    .update({ balance: team.balance - amount })
    .eq("id", teamId);
  await client.from("finance_transactions").insert({
    team_id: teamId, type, amount: -amount, description, season_id: seasonId,
  });
}

async function notifyManager(teamId, type, title, message, deps = {}) {
  const client = deps.supabase ?? await getDefaultSupabaseClient();
  await notifyTeamOwnerShared({
    supabase: client,
    teamId,
    type,
    title,
    message,
    now: deps.now,
  });
}
