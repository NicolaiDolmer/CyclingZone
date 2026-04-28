import { createInitialBoardProfile } from "./boardEngine.js";

export const DEFAULT_BETA_BALANCE = 800000;
export const DEFAULT_BETA_DIVISION = 3;
export const BOARD_PLAN_TYPES = ["5yr", "3yr", "1yr"];

const MARKET_RESET_STATUSES = {
  auctions: ["active", "extended"],
  transfer_listings: ["open", "negotiating"],
  transfer_offers: ["pending", "accepted", "countered", "awaiting_confirmation", "window_pending"],
  swap_offers: ["pending", "accepted", "countered", "awaiting_confirmation", "window_pending"],
  loan_agreements: ["pending", "active"],
};

function assertSupabase(supabase) {
  if (!supabase?.from) {
    throw new Error("Supabase client is required");
  }
}

function countRows(result) {
  return result?.data?.length ?? result?.count ?? 0;
}

function ensureOk(result) {
  if (result?.error) {
    throw new Error(result.error.message);
  }
  return result;
}

function managerTeamQuery(supabase, columns = "id, user_id, balance, sponsor_income") {
  return supabase
    .from("teams")
    .select(columns)
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false);
}

export async function getBetaManagerTeams(supabase) {
  assertSupabase(supabase);
  const result = ensureOk(await managerTeamQuery(supabase));
  return result.data || [];
}

export async function cancelBetaMarket(supabase) {
  assertSupabase(supabase);

  const [auctions, listings, offers, swaps, loans] = await Promise.all([
    supabase.from("auctions")
      .update({ status: "cancelled" })
      .in("status", MARKET_RESET_STATUSES.auctions)
      .select("id"),
    supabase.from("transfer_listings")
      .update({ status: "withdrawn" })
      .in("status", MARKET_RESET_STATUSES.transfer_listings)
      .select("id"),
    supabase.from("transfer_offers")
      .update({ status: "rejected" })
      .in("status", MARKET_RESET_STATUSES.transfer_offers)
      .select("id"),
    supabase.from("swap_offers")
      .update({ status: "rejected" })
      .in("status", MARKET_RESET_STATUSES.swap_offers)
      .select("id"),
    supabase.from("loan_agreements")
      .update({ status: "cancelled" })
      .in("status", MARKET_RESET_STATUSES.loan_agreements)
      .select("id"),
  ]);

  [auctions, listings, offers, swaps, loans].forEach(ensureOk);

  return {
    auctions: countRows(auctions),
    transfer_listings: countRows(listings),
    transfer_offers: countRows(offers),
    swap_offers: countRows(swaps),
    loan_agreements: countRows(loans),
  };
}

export async function resetBetaRosters(supabase) {
  const managerTeams = await getBetaManagerTeams(supabase);
  const teamIds = managerTeams.map((team) => team.id);
  if (teamIds.length === 0) {
    return { moved: 0, to_ai: 0, to_null: 0 };
  }

  const ridersResult = ensureOk(await supabase
    .from("riders")
    .select("id, ai_team_id")
    .in("team_id", teamIds));

  const riders = ridersResult.data || [];
  if (riders.length === 0) {
    return { moved: 0, to_ai: 0, to_null: 0 };
  }

  const withoutAi = riders.filter((rider) => !rider.ai_team_id).map((rider) => rider.id);
  const updates = riders
    .filter((rider) => rider.ai_team_id)
    .map((rider) => supabase
      .from("riders")
      .update({ team_id: rider.ai_team_id, pending_team_id: null })
      .eq("id", rider.id));

  if (withoutAi.length > 0) {
    updates.push(
      supabase
        .from("riders")
        .update({ team_id: null, pending_team_id: null })
        .in("id", withoutAi)
    );
  }

  (await Promise.all(updates)).forEach(ensureOk);

  return {
    moved: riders.length,
    to_ai: riders.length - withoutAi.length,
    to_null: withoutAi.length,
  };
}

export async function resetBetaBalances(supabase, { clearTransactions = false, balance = DEFAULT_BETA_BALANCE } = {}) {
  const managerTeams = await getBetaManagerTeams(supabase);
  const teamIds = managerTeams.map((team) => team.id);
  if (teamIds.length === 0) {
    return { reset: 0, clear_transactions: clearTransactions };
  }

  ensureOk(await supabase
    .from("teams")
    .update({ balance })
    .in("id", teamIds));

  if (clearTransactions) {
    ensureOk(await supabase
      .from("finance_transactions")
      .delete()
      .in("team_id", teamIds));
  }

  return { reset: teamIds.length, balance, clear_transactions: clearTransactions };
}

export async function resetBetaDivisions(supabase, { division = DEFAULT_BETA_DIVISION } = {}) {
  const managerTeams = await getBetaManagerTeams(supabase);
  const teamIds = managerTeams.map((team) => team.id);
  if (teamIds.length === 0) {
    return { reset: 0, division };
  }

  ensureOk(await supabase
    .from("teams")
    .update({ division })
    .in("id", teamIds));

  return { reset: teamIds.length, division };
}

export async function resetBetaBoardProfiles(supabase) {
  const managerTeams = await getBetaManagerTeams(supabase);
  const teamIds = managerTeams.map((team) => team.id);
  if (teamIds.length === 0) {
    return { reset: 0, created: 0, snapshots_deleted: 0, requests_deleted: 0 };
  }

  const [activeSeasonResult, existingResult] = await Promise.all([
    supabase.from("seasons").select("id, number").eq("status", "active").maybeSingle(),
    supabase.from("board_profiles").select("id, team_id, plan_type").in("team_id", teamIds),
  ]);
  ensureOk(activeSeasonResult);
  ensureOk(existingResult);

  const activeSeasonId = activeSeasonResult.data?.id ?? null;
  const existingRows = existingResult.data || [];
  const existingByTeam = new Map();
  for (const row of existingRows) {
    if (!existingByTeam.has(row.team_id)) existingByTeam.set(row.team_id, new Set());
    existingByTeam.get(row.team_id).add(row.plan_type);
  }

  const teamById = new Map(managerTeams.map((team) => [team.id, team]));
  const updates = existingRows.map((row) => {
    const team = teamById.get(row.team_id) || {};
    return supabase.from("board_profiles").update({
      ...createInitialBoardProfile({
        teamId: row.team_id,
        seasonId: activeSeasonId,
        balance: team.balance ?? 0,
        sponsorIncome: team.sponsor_income ?? 100,
        planType: row.plan_type || "1yr",
      }),
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
  });

  const missingRows = [];
  for (const team of managerTeams) {
    const existingPlanTypes = existingByTeam.get(team.id) || new Set();
    for (const planType of BOARD_PLAN_TYPES) {
      if (!existingPlanTypes.has(planType)) {
        missingRows.push(createInitialBoardProfile({
          teamId: team.id,
          seasonId: activeSeasonId,
          balance: team.balance ?? 0,
          sponsorIncome: team.sponsor_income ?? 100,
          planType,
        }));
      }
    }
  }

  const [snapshotsDeleted, requestsDeleted, ...updateResults] = await Promise.all([
    supabase.from("board_plan_snapshots").delete().in("team_id", teamIds).select("id"),
    supabase.from("board_request_log").delete().in("team_id", teamIds).select("id"),
    ...updates,
  ]);

  [snapshotsDeleted, requestsDeleted, ...updateResults].forEach(ensureOk);

  if (missingRows.length > 0) {
    ensureOk(await supabase.from("board_profiles").insert(missingRows).select("id"));
  }

  return {
    reset: existingRows.length,
    created: missingRows.length,
    snapshots_deleted: countRows(snapshotsDeleted),
    requests_deleted: countRows(requestsDeleted),
  };
}

export async function resetBetaRaceCalendar(supabase) {
  assertSupabase(supabase);

  const [pending, results, standings] = await Promise.all([
    supabase.from("pending_race_results").delete().not("id", "is", null).select("id"),
    supabase.from("race_results").delete().not("id", "is", null).select("id"),
    supabase.from("season_standings").delete().not("id", "is", null).select("id"),
  ]);
  [pending, results, standings].forEach(ensureOk);

  const races = ensureOk(await supabase.from("races").delete().not("id", "is", null).select("id"));

  return {
    pending_race_results: countRows(pending),
    race_results: countRows(results),
    season_standings: countRows(standings),
    races: countRows(races),
  };
}

export async function resetBetaSeasons(supabase) {
  assertSupabase(supabase);
  const seasons = ensureOk(await supabase.from("seasons").delete().not("id", "is", null).select("id"));
  return { seasons: countRows(seasons) };
}

export async function resetBetaManagerProgress(supabase) {
  const managerTeams = await getBetaManagerTeams(supabase);
  const userIds = [...new Set(managerTeams.map((team) => team.user_id).filter(Boolean))];
  if (userIds.length === 0) {
    return { users: 0, xp_log: 0 };
  }

  const [users, xpLog] = await Promise.all([
    supabase.from("users").update({ xp: 0, level: 1 }).in("id", userIds).select("id"),
    supabase.from("xp_log").delete().in("user_id", userIds).select("id"),
  ]);
  [users, xpLog].forEach(ensureOk);

  return { users: countRows(users), xp_log: countRows(xpLog) };
}

export async function resetBetaAchievements(supabase) {
  const managerTeams = await getBetaManagerTeams(supabase);
  const userIds = [...new Set(managerTeams.map((team) => team.user_id).filter(Boolean))];
  if (userIds.length === 0) {
    return { manager_achievements: 0 };
  }

  const achievements = ensureOk(await supabase
    .from("manager_achievements")
    .delete()
    .in("user_id", userIds)
    .select("id"));

  return { manager_achievements: countRows(achievements) };
}

export async function runFullBetaReset(supabase, options = {}) {
  const resetMode = options.resetMode || "test";

  const cancelled = await cancelBetaMarket(supabase);
  const rosters = await resetBetaRosters(supabase);
  const balances = await resetBetaBalances(supabase, {
    clearTransactions: Boolean(options.clearTransactions),
  });
  const divisions = await resetBetaDivisions(supabase);
  const race_calendar = await resetBetaRaceCalendar(supabase);
  const seasons = await resetBetaSeasons(supabase);
  const board_profiles = await resetBetaBoardProfiles(supabase);
  const manager_progress = await resetBetaManagerProgress(supabase);
  const achievements = await resetBetaAchievements(supabase);

  return {
    reset_mode: resetMode,
    cancelled,
    rosters,
    balances,
    divisions,
    board_profiles,
    race_calendar,
    seasons,
    manager_progress,
    achievements,
  };
}
