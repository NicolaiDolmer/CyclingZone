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
import {
  MIN_RIDER_UCI_POINTS,
  RIDER_VALUE_FACTOR,
} from "./marketUtils.js";

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

const SALARY_RATE = 0.10;          // 10% of effective rider value = yearly salary
const INTEREST_RATE = 0.10;        // 10% interest on negative balance per season
const PROMOTION_SLOTS = 2;         // Top 2 promote
const RELEGATION_SLOTS = 2;        // Bottom 2 relegate
const MAX_DIVISION = 3;
const MIN_DIVISION = 1;
const SUPABASE_PAGE_SIZE = 1000;
const RIDER_VALUE_PATCH_CONCURRENCY = 25;

const DIVISION_BONUSES = {
  1: [300_000, 200_000, 100_000, 50_000],
  2: [150_000, 100_000, 50_000, 25_000],
  3: [75_000, 50_000, 25_000],
};

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

function throwIfSupabaseError(error, message) {
  if (error) {
    throw new Error(`${message}: ${error.message}`);
  }
}

export async function loadHumanSeasonEndTeams(supabaseClient) {
  const { data: teams, error: teamsError } = await supabaseClient
    .from("teams")
    .select("*")
    .eq("is_ai", false);
  throwIfSupabaseError(teamsError, "Could not load human teams for season end");

  const teamIds = (teams || []).map(team => team.id).filter(Boolean);
  if (teamIds.length === 0) return [];

  const [ridersRes, boardsRes] = await Promise.all([
    supabaseClient
      .from("riders")
      .select(`team_id, ${BOARD_IDENTITY_RIDER_SELECT}`)
      .in("team_id", teamIds),
    supabaseClient
      .from("board_profiles")
      .select("*")
      .in("team_id", teamIds),
  ]);
  throwIfSupabaseError(ridersRes.error, "Could not load riders for season end");
  throwIfSupabaseError(boardsRes.error, "Could not load board profiles for season end");

  const ridersByTeam = new Map();
  for (const rider of ridersRes.data || []) {
    if (!rider.team_id) continue;
    if (!ridersByTeam.has(rider.team_id)) ridersByTeam.set(rider.team_id, []);
    ridersByTeam.get(rider.team_id).push(rider);
  }

  const boardsByTeam = new Map();
  for (const board of boardsRes.data || []) {
    if (!board.team_id) continue;
    if (!boardsByTeam.has(board.team_id)) boardsByTeam.set(board.team_id, []);
    boardsByTeam.get(board.team_id).push(board);
  }

  return (teams || []).map(team => ({
    ...team,
    riders: ridersByTeam.get(team.id) || [],
    board_profiles: boardsByTeam.get(team.id) || [],
  }));
}

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
    const boards = team.board_profiles || [];
    const activeBoards = boards.filter(b => b.negotiation_status === "completed");
    const modifier = activeBoards.length > 0
      ? activeBoards.reduce((sum, b) => sum + (b.budget_modifier ?? 1.0), 0) / activeBoards.length
      : 1.0;
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

    // Ensure all three plan types exist
    const existingPlanTypes = new Set(boards.map(b => b.plan_type));
    for (const planType of ["5yr", "3yr", "1yr"]) {
      if (!existingPlanTypes.has(planType)) {
        await supabaseClient.from("board_profiles").insert(
          createInitialBoardProfile({
            teamId: team.id,
            seasonId,
            balance: team.balance ?? 0,
            sponsorIncome: team.sponsor_income ?? 100,
            focus: "balanced",
            planType,
            negotiationStatus: "pending",
          })
        );
      }
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

// ─── Division Bonuses ────────────────────────────────────────────────────────

export async function payDivisionBonuses(standings, seasonId, supabaseClient) {
  const { data: existingRows, error: existingError } = await supabaseClient
    .from("finance_transactions")
    .select("team_id")
    .eq("season_id", seasonId)
    .eq("type", "bonus");
  throwIfSupabaseError(existingError, "Could not check existing division bonuses");

  const alreadyPaid = new Set((existingRows || []).map(r => r.team_id));

  for (const standing of standings || []) {
    if (!standing.team_id || standing.team?.is_ai) continue;
    if (alreadyPaid.has(standing.team_id)) continue;
    const bonuses = DIVISION_BONUSES[standing.division];
    if (!bonuses) continue;
    const rank = standing.rank_in_division;
    if (!rank || rank > bonuses.length) continue;
    const amount = bonuses[rank - 1];
    if (!amount) continue;
    await creditTeam(
      standing.team_id,
      amount,
      "bonus",
      `Divisionsbonus — Division ${standing.division}, plads ${rank}`,
      seasonId,
      supabaseClient
    );
  }
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
  const { data: currentSeason, error: seasonError } = await supabaseClient
    .from("seasons").select("number").eq("id", seasonId).single();
  throwIfSupabaseError(seasonError, "Could not load season for season end");
  const currentSeasonNumber = currentSeason?.number ?? 1;

  // Get final standings
  const { data: standings, error: standingsError } = await supabaseClient
    .from("season_standings")
    .select("*, team:team_id(*)")
    .eq("season_id", seasonId)
    .order("total_points", { ascending: false });
  throwIfSupabaseError(standingsError, "Could not load season standings for season end");

  if (!standings?.length) {
    console.warn("  ⚠️  No standings found for season");
    return;
  }

  // Load finance/board inputs before any writes, so relationship drift cannot
  // trigger division movement and then skip the finance loop.
  const teams = await loadHumanSeasonEndTeams(supabaseClient);

  for (const team of teams || []) {
    await processTeamSeasonEnd(team, seasonId, standings, currentSeasonNumber, {
      ...deps,
      supabase: supabaseClient,
      now: notificationNow,
    });
  }

  // Pay division bonuses based on final standings
  await payDivisionBonuses(standings, seasonId, supabaseClient);

  // Process each division after finance/board side effects have succeeded.
  for (const division of [1, 2, 3]) {
    const divStandings = standings.filter(s => s.division === division);
    await processDivisionEnd(divStandings, division, seasonId, {
      supabase: supabaseClient,
      now: notificationNow,
    });
  }

  // Mark season as completed
  const { error: completeError } = await supabaseClient.from("seasons")
    .update({ status: "completed" })
    .eq("id", seasonId);
  throwIfSupabaseError(completeError, "Could not mark season completed");

  // Recalculate rider values and salaries based on last 3 completed seasons
  const updateRiderValuesFn = deps.updateRiderValues ?? updateRiderValues;
  await updateRiderValuesFn(supabaseClient);

  console.log("  ✅ Season end processing complete");
}

export async function repairSeasonEndFinanceAndBoard(seasonId, deps = {}) {
  console.log(`\n🛠️  Repairing season-end finance/board side effects: ${seasonId}`);
  const supabaseClient = deps.supabase ?? await getDefaultSupabaseClient();
  const notificationNow = deps.now ?? new Date();

  const { data: currentSeason, error: seasonError } = await supabaseClient
    .from("seasons")
    .select("id, number, status")
    .eq("id", seasonId)
    .single();
  throwIfSupabaseError(seasonError, "Could not load season for season-end repair");
  if (!currentSeason) throw new Error("Season not found");

  const { data: existingFinanceRows, error: existingFinanceError } = await supabaseClient
    .from("finance_transactions")
    .select("team_id, type")
    .eq("season_id", seasonId)
    .in("type", ["salary", "loan_interest", "interest", "emergency_loan"]);
  throwIfSupabaseError(existingFinanceError, "Could not check existing finance transactions");

  const { data: existingSnapshots, error: snapshotCountError } = await supabaseClient
    .from("board_plan_snapshots")
    .select("team_id, board_id")
    .eq("season_id", seasonId);
  throwIfSupabaseError(snapshotCountError, "Could not check existing board snapshots");

  const { data: standings, error: standingsError } = await supabaseClient
    .from("season_standings")
    .select("*, team:team_id(*)")
    .eq("season_id", seasonId)
    .order("total_points", { ascending: false });
  throwIfSupabaseError(standingsError, "Could not load season standings for season-end repair");
  if (!standings?.length) throw new Error("No standings found for season-end repair");

  const teams = await loadHumanSeasonEndTeams(supabaseClient);
  const existingSalaryTeams = new Set(
    (existingFinanceRows || []).filter(row => row.type === "salary").map(row => row.team_id)
  );
  const existingLoanInterestTeams = new Set(
    (existingFinanceRows || []).filter(row => row.type === "loan_interest").map(row => row.team_id)
  );
  const existingLegacyInterestTeams = new Set(
    (existingFinanceRows || []).filter(row => row.type === "interest").map(row => row.team_id)
  );
  const existingEmergencyLoanTeams = new Set(
    (existingFinanceRows || []).filter(row => row.type === "emergency_loan").map(row => row.team_id)
  );
  const existingSnapshotBoards = new Set(
    (existingSnapshots || []).map(row => row.board_id).filter(Boolean)
  );

  for (const team of teams) {
    const salaryAlreadyProcessed = existingSalaryTeams.has(team.id);
    const repairTeam = {
      ...team,
      riders: salaryAlreadyProcessed ? [] : team.riders,
      board_profiles: (team.board_profiles || []).filter(board => !existingSnapshotBoards.has(board.id)),
    };

    await processTeamSeasonEnd(repairTeam, seasonId, standings, currentSeason.number ?? 1, {
      ...deps,
      supabase: supabaseClient,
      now: notificationNow,
      processLoanInterest: async (teamId, repairSeasonId, client) => {
        if (existingLoanInterestTeams.has(teamId)) return [];
        const processLoanInterestFn = deps.processLoanInterest ?? processLoanInterest;
        return processLoanInterestFn(teamId, repairSeasonId, client);
      },
      createEmergencyLoan: async (teamId, amountNeeded, client, emergencySeasonId) => {
        if (existingEmergencyLoanTeams.has(teamId)) return null;
        const createEmergencyLoanFn = deps.createEmergencyLoan ?? createEmergencyLoan;
        return createEmergencyLoanFn(teamId, amountNeeded, client, emergencySeasonId);
      },
      skipNegativeBalanceInterest: salaryAlreadyProcessed || existingLegacyInterestTeams.has(team.id),
    });
  }

  console.log("  ✅ Season-end finance/board repair complete");
  return {
    teamsProcessed: teams.length,
    existingSalaryTransactions: existingSalaryTeams.size,
    existingBoardSnapshots: existingSnapshots?.length || 0,
    existingBoardSnapshotBoards: existingSnapshotBoards.size,
  };
}

export function buildSeasonEndPreviewRows({ teams = [], standings = [], loanData = [] } = {}) {
  return teams.map((team) => {
    const standing = standings.find(s => s.team_id === team.id);
    const riders = team.riders || [];
    const totalSalary = riders.reduce((sum, rider) => sum + (rider.salary || 0), 0);
    const teamLoans = loanData.filter(loan => loan.team_id === team.id);
    const totalInterest = teamLoans.reduce(
      (sum, loan) => sum + Math.round((loan.amount_remaining || 0) * (loan.interest_rate || 0)),
      0
    );
    const board = team.board_profiles?.[0] || null;
    const currentSatisfaction = board?.satisfaction ?? 50;

    let projectedSatisfaction = currentSatisfaction;
    let sponsorModifier = board?.budget_modifier ?? 1.0;
    let goalsMet = null;
    let goalsTotal = null;

    if (board && standing) {
      const planDuration = getPlanDuration(board.plan_type);
      const seasonsCompleted = (board.seasons_completed || 0) + 1;
      const projected = evaluateBoardSeason({
        board,
        standing,
        team: { ...team, riders },
        context: {
          isFinalSeason: seasonsCompleted >= planDuration,
          activeLoanCount: teamLoans.length,
          planStartSponsorIncome: board.plan_start_sponsor_income,
          currentSponsorIncome: team.sponsor_income,
          planDuration,
          seasonsCompleted,
          recentSnapshots: [],
          hasSeasonData: true,
          cumulativeStats: {
            stageWins: (board.cumulative_stage_wins || 0) + (standing.stage_wins || 0),
            gcWins: (board.cumulative_gc_wins || 0) + (standing.gc_wins || 0),
          },
        },
      });

      projectedSatisfaction = projected.newSatisfaction;
      sponsorModifier = projected.newModifier;
      goalsMet = projected.goalsMet;
      goalsTotal = projected.goals.length;
    }

    const divStandings = standings
      .filter(s => s.division === team.division)
      .sort((a, b) => (b.total_points || 0) - (a.total_points || 0));
    const rank = divStandings.findIndex(s => s.team_id === team.id) + 1;
    const balanceAfter = (team.balance || 0) - totalSalary;

    return {
      team_id: team.id,
      team_name: team.name,
      division: team.division,
      current_balance: team.balance || 0,
      salary_deduction: totalSalary,
      loan_interest: totalInterest,
      balance_after: balanceAfter,
      needs_emergency_loan: balanceAfter < 0,
      emergency_loan_amount: balanceAfter < 0 ? Math.abs(balanceAfter) : 0,
      current_board_satisfaction: currentSatisfaction,
      board_satisfaction: projectedSatisfaction,
      sponsor_modifier: sponsorModifier,
      next_season_sponsor: Math.round((team.sponsor_income || 0) * sponsorModifier),
      board_goals_met: goalsMet,
      board_goals_total: goalsTotal,
      total_points: standing?.total_points || 0,
      current_rank: rank || null,
    };
  });
}

async function processTeamSeasonEnd(team, seasonId, standings, currentSeasonNumber, deps = {}) {
  const supabaseClient = deps.supabase ?? await getDefaultSupabaseClient();
  const processLoanInterestFn = deps.processLoanInterest ?? processLoanInterest;
  const createEmergencyLoanFn = deps.createEmergencyLoan ?? createEmergencyLoan;
  const notificationDeps = { supabase: supabaseClient, now: deps.now };
  const teamStanding = standings.find(s => s.team_id === team.id);
  const boards = team.board_profiles || [];

  // 1. Tilskriv lånerenter
  await processLoanInterestFn(team.id, seasonId, supabaseClient);

  // 2. Deduct salaries — opret nødlån hvis holdet ikke kan betale
  const totalSalary = (team.riders || []).reduce((sum, r) => sum + (r.salary || 0), 0);

  if (totalSalary > 0) {
    const { data: freshTeam, error: freshTeamError } = await supabaseClient
      .from("teams").select("balance").eq("id", team.id).single();
    throwIfSupabaseError(freshTeamError, `Could not load balance for ${team.name}`);
    if (!freshTeam) throw new Error(`Could not load balance for ${team.name}`);
    const shortfall = totalSalary - freshTeam.balance;
    if (shortfall > 0) {
      console.log(`  ⚠️  ${team.name}: mangler ${shortfall} pts til løn — opretter nødlån`);
      await createEmergencyLoanFn(team.id, shortfall, supabaseClient, seasonId);
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
  const { data: postSalaryTeam, error: postSalaryTeamError } = await supabaseClient
    .from("teams").select("balance").eq("id", team.id).single();
  throwIfSupabaseError(postSalaryTeamError, `Could not load post-salary balance for ${team.name}`);
  if (!postSalaryTeam) throw new Error(`Could not load post-salary balance for ${team.name}`);

  if (!deps.skipNegativeBalanceInterest && postSalaryTeam.balance < 0) {
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

  // 4. Plan-aware board evaluation — evaluate all active plans
  for (const board of boards) {
    if (!board || !teamStanding) continue;
    const planDuration = getPlanDuration(board.plan_type);
    const seasonsCompleted = (board.seasons_completed || 0) + 1;
    const newCumulativeStageWins = (board.cumulative_stage_wins || 0) + (teamStanding.stage_wins || 0);
    const newCumulativeGcWins = (board.cumulative_gc_wins || 0) + (teamStanding.gc_wins || 0);
    const planIsComplete = seasonsCompleted >= planDuration;
    const isMidReview = !planIsComplete && seasonsCompleted === Math.floor(planDuration / 2);

    // Active loans count for no_outstanding_debt goal
    const { count: activeLoanCount, error: activeLoanCountError } = await supabaseClient.from("loans")
      .select("id", { count: "exact", head: true })
      .eq("team_id", team.id).eq("status", "active");
    throwIfSupabaseError(activeLoanCountError, `Could not count active loans for ${team.name}`);

    // Fresh team data for sponsor_growth evaluation
    const { data: freshTeamData, error: freshTeamDataError } = await supabaseClient.from("teams")
      .select("sponsor_income").eq("id", team.id).single();
    throwIfSupabaseError(freshTeamDataError, `Could not load sponsor income for ${team.name}`);

    const { data: recentSnapshots, error: recentSnapshotsError } = await supabaseClient
      .from("board_plan_snapshots")
      .select("goals_met, goals_total, satisfaction_delta")
      .eq("team_id", team.id)
      .order("created_at", { ascending: false })
      .limit(3);
    throwIfSupabaseError(recentSnapshotsError, `Could not load recent board snapshots for ${team.name}`);

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

    const { error: snapshotError } = await supabaseClient.from("board_plan_snapshots").insert({
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
    throwIfSupabaseError(snapshotError, `Could not insert board snapshot for ${team.name}`);

    if (planIsComplete) {
      // Plan expired — reset for re-negotiation
      const { error: boardUpdateError } = await supabaseClient.from("board_profiles").update({
        satisfaction: newSatisfaction,
        budget_modifier: newModifier,
        negotiation_status: "pending",
        seasons_completed: 0,
        cumulative_stage_wins: 0,
        cumulative_gc_wins: 0,
        updated_at: new Date().toISOString(),
      }).eq("id", board.id);
      throwIfSupabaseError(boardUpdateError, `Could not update completed board plan for ${team.name}`);

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
      const { error: boardUpdateError } = await supabaseClient.from("board_profiles").update({
        satisfaction: newSatisfaction,
        budget_modifier: newModifier,
        seasons_completed: seasonsCompleted,
        cumulative_stage_wins: newCumulativeStageWins,
        cumulative_gc_wins: newCumulativeGcWins,
        updated_at: new Date().toISOString(),
      }).eq("id", board.id);
      throwIfSupabaseError(boardUpdateError, `Could not update active board plan for ${team.name}`);

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

// ─── Rider Value & Salary Recalculation ──────────────────────────────────────

async function fetchAllRows(buildQuery, pageSize = SUPABASE_PAGE_SIZE) {
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw new Error(error.message);

    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

/**
 * Recalculates prize_earnings_bonus and salary for every rider at season end.
 *
 * prize_earnings_bonus = average of the rider's total prize earnings across
 * the last 1-3 completed seasons. Seasons with no prize money count as 0.
 *
 * salary = max(1, round((uci_points * 4000 + prize_earnings_bonus) * 0.10))
 */
export async function updateRiderValues(supabaseClient) {
  const { data: recentSeasons } = await supabaseClient
    .from("seasons")
    .select("id")
    .eq("status", "completed")
    .order("number", { ascending: false })
    .limit(3);

  const seasonIds = (recentSeasons || []).map(s => s.id);

  // Build per-rider per-season prize totals from race_results
  const riderSeasonEarnings = {};

  if (seasonIds.length > 0) {
    const races = await fetchAllRows(() => (
      supabaseClient
        .from("races")
        .select("id, season_id")
        .in("season_id", seasonIds)
    ));

    const raceIds = (races || []).map(r => r.id);

    if (raceIds.length > 0) {
      const raceSeasonMap = Object.fromEntries((races || []).map(r => [r.id, r.season_id]));

      const results = await fetchAllRows(() => (
        supabaseClient
          .from("race_results")
          .select("rider_id, race_id, prize_money")
          .in("race_id", raceIds)
          .gt("prize_money", 0)
      ));

      for (const row of results || []) {
        const sid = raceSeasonMap[row.race_id];
        if (!sid || !row.rider_id) continue;
        if (!riderSeasonEarnings[row.rider_id]) riderSeasonEarnings[row.rider_id] = {};
        riderSeasonEarnings[row.rider_id][sid] =
          (riderSeasonEarnings[row.rider_id][sid] || 0) + (row.prize_money || 0);
      }
    }
  }

  const allRiders = await fetchAllRows(() => (
    supabaseClient
      .from("riders")
      .select("id, uci_points")
  ));

  const updates = [];

  for (const rider of allRiders || []) {
    const seasonTotals = seasonIds.map(seasonId => riderSeasonEarnings[rider.id]?.[seasonId] || 0);
    const newBonus = seasonTotals.length > 0
      ? Math.round(seasonTotals.reduce((s, v) => s + v, 0) / seasonTotals.length)
      : 0;

    const basePrice = Math.max(MIN_RIDER_UCI_POINTS, rider.uci_points || 0) * RIDER_VALUE_FACTOR;
    const newSalary = Math.max(1, Math.round((basePrice + newBonus) * SALARY_RATE));

    updates.push({
      id: rider.id,
      prize_earnings_bonus: newBonus,
      salary: newSalary,
    });
  }

  for (let i = 0; i < updates.length; i += RIDER_VALUE_PATCH_CONCURRENCY) {
    const batch = updates.slice(i, i + RIDER_VALUE_PATCH_CONCURRENCY);
    await Promise.all(batch.map(async ({ id, ...payload }) => {
      const { error } = await supabaseClient
        .from("riders")
        .update(payload)
        .eq("id", id);
      if (error) throw new Error(error.message);
    }));
  }

  const ridersUpdated = allRiders?.length || 0;
  console.log(`  🏅 Rider values recalculated: ${ridersUpdated} ryttere opdateret`);
  return { ridersUpdated };
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
      if (!s.team?.is_ai) {
        promotions.push(s.team_id);
        const { error } = await client.from("teams")
          .update({ division: division - 1 })
          .eq("id", s.team_id);
        throwIfSupabaseError(error, `Could not promote team ${s.team_id}`);
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
      if (!s.team?.is_ai) {
        relegations.push(s.team_id);
        const { error } = await client.from("teams")
          .update({ division: division + 1 })
          .eq("id", s.team_id);
        throwIfSupabaseError(error, `Could not relegate team ${s.team_id}`);
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
  const { data: team, error: teamError } = await client
    .from("teams").select("balance").eq("id", teamId).single();
  throwIfSupabaseError(teamError, `Could not load team balance for credit ${teamId}`);
  if (!team) throw new Error(`Could not load team balance for credit ${teamId}`);
  const { error: updateError } = await client.from("teams")
    .update({ balance: team.balance + amount })
    .eq("id", teamId);
  throwIfSupabaseError(updateError, `Could not credit team ${teamId}`);
  const { error: insertError } = await client.from("finance_transactions").insert({
    team_id: teamId, type, amount, description, season_id: seasonId,
  });
  throwIfSupabaseError(insertError, `Could not insert credit transaction for ${teamId}`);
}

async function debitTeam(teamId, amount, type, description, seasonId, supabaseClient = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  const { data: team, error: teamError } = await client
    .from("teams").select("balance").eq("id", teamId).single();
  throwIfSupabaseError(teamError, `Could not load team balance for debit ${teamId}`);
  if (!team) throw new Error(`Could not load team balance for debit ${teamId}`);
  const { error: updateError } = await client.from("teams")
    .update({ balance: team.balance - amount })
    .eq("id", teamId);
  throwIfSupabaseError(updateError, `Could not debit team ${teamId}`);
  const { error: insertError } = await client.from("finance_transactions").insert({
    team_id: teamId, type, amount: -amount, description, season_id: seasonId,
  });
  throwIfSupabaseError(insertError, `Could not insert debit transaction for ${teamId}`);
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
