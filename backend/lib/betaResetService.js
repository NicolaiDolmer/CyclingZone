import { createBaselineProfile } from "./boardEngine.js";
import { DEFAULT_SPONSOR_INCOME } from "./economyEngine.js";
import { FOUNDER_BADGE_KEY } from "./founderBadge.js";

export const DEFAULT_BETA_BALANCE = 800000;
export const DEFAULT_BETA_DIVISION = 3;

// --- FK-forward-guard-manifest (#1471 relaunch 18/6 · #1464 forward-guard-spor) ----------
//
// RESET_DELETE_TARGETS: de tabeller hvor beta-reset SLETTER rækker (ikke kun update'er).
// En FK med ON DELETE NO ACTION/RESTRICT der peger på en af disse blokerer reset-deleten
// medmindre child-referencen nulles/slettes FØRST — det var præcis crash-klassen 18/6.
// scripts/audit-reset-fk-coverage.js krydstjekker det live prod-skema mod denne liste +
// BLOCKING_FK_BASELINE og fejler CI hvis en NY uhåndteret blocking-FK dukker op.
// Hold denne liste i sync med delete()-kaldene nedenfor.
export const RESET_DELETE_TARGETS = Object.freeze([
  // rytter-/markeds-historik (resetBetaRiderHistory / resetBetaTransferArchive)
  "auction_bids", "auctions", "transfer_offers", "transfer_listings", "swap_offers", "loan_agreements",
  // økonomi (resetBetaLoans / resetBetaBalances)
  "loans", "finance_transactions",
  // notifikationer (resetBetaNotifications)
  "notifications",
  // løbskalender + children (resetBetaRaceCalendar)
  "pending_race_results", "race_results", "season_standings", "races",
  // sæsoner + children (resetBetaSeasons)
  "board_plan_snapshots", "academy_intake", "academy_graduation", "seasons",
  // bestyrelse (resetBetaBoardProfiles)
  "board_request_log", "team_board_members", "board_consequences", "board_profiles",
  // manager-progression (resetBetaManagerProgress / resetBetaAchievements)
  "xp_log", "manager_achievements",
]);

// BLOCKING_FK_BASELINE: hver NO ACTION/RESTRICT-FK der peger på en RESET_DELETE_TARGET og
// som reset BEVIDST neutraliserer før parent-delete. `strategy` dokumenterer hvordan:
//   - "null-before-delete": child-kolonnen nulles før parenten slettes
//   - "delete-child-first": child-rækkerne slettes før parenten (child er selv en target)
// Markér en entry `unhandled: true` hvis FK'en kendes men IKKE er håndteret (kendt gap →
// auditen holder den rød). Format matcher RPC audit_foreign_keys()-rækkerne. Når auditen
// finder en NY blocking-FK: håndtér child-referencen i den relevante resetBeta*-funktion
// FØR parent-delete, og tilføj så en entry her (kør `npm run audit:reset-fk` mod prod for
// den paste-klare linje). Aldrig auto-bless — registrering skal være bevidst.
export const BLOCKING_FK_BASELINE = Object.freeze([
  { child: "finance_transactions", column: "related_loan_id", parent: "loans", strategy: "null-before-delete", handled_by: "resetBetaLoans" },
  { child: "finance_transactions", column: "race_id", parent: "races", strategy: "null-before-delete", handled_by: "resetBetaRaceCalendar" },
  { child: "finance_transactions", column: "season_id", parent: "seasons", strategy: "null-before-delete", handled_by: "resetBetaSeasons" },
  { child: "board_profiles", column: "season_id", parent: "seasons", strategy: "null-before-delete", handled_by: "resetBetaSeasons" },
  { child: "board_profiles", column: "season_start_anchor_season_id", parent: "seasons", strategy: "null-before-delete", handled_by: "resetBetaSeasons" },
  { child: "board_plan_snapshots", column: "season_id", parent: "seasons", strategy: "delete-child-first", handled_by: "resetBetaSeasons" },
  { child: "academy_intake", column: "season_id", parent: "seasons", strategy: "delete-child-first", handled_by: "resetBetaSeasons" },
  { child: "academy_graduation", column: "season_id", parent: "seasons", strategy: "delete-child-first", handled_by: "resetBetaSeasons" },
]);
// NB: board_profiles.tradeoff_active_until_season_id -> seasons står som NO ACTION i de
// statiske dumps (schema.sql/supabase_setup.sql) men er SET NULL i prod (2026-05-05-board-
// tradeoff-pivot.sql; 18/6-prod-auditen flagede den IKKE selvom den medtog tomme NO ACTION-
// FK'er som academy_graduation). Den er derfor bevidst UDELADT — den live-audit adjudicerer
// mod prod-skemaet. Tilføj IKKE en entry her ud fra dump-filerne.

const MARKET_RESET_STATUSES = {
  auctions: ["active", "extended"],
  transfer_listings: ["open", "negotiating"],
  transfer_offers: ["pending", "accepted", "countered", "awaiting_confirmation", "window_pending"],
  swap_offers: ["pending", "accepted", "countered", "awaiting_confirmation", "window_pending"],
  loan_agreements: ["pending", "active", "window_pending", "buyout_pending"],
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
    .eq("is_frozen", false)
    .eq("is_test_account", false);
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

// S-02a · Beta-reset opretter ÉN baseline-row pr. team (sæson 1 = observation),
// ikke 3 plan-rows som før v1.40-arkitekturen brugte. Eksisterende rows slettes
// helt — Q-batch 1A Q6 godkendte full reset af alle managers' board-data.
//
// S-02c · Beta-reset clearer også team_board_members (5 medlemmer pr. team),
// nulstiller teams.consecutive_low_satisfaction_expirations counter og
// teams.season_1_identity_basis (S-02b) — alt re-genereres ved næste sæson-1-slut.
export async function resetBetaBoardProfiles(supabase) {
  const managerTeams = await getBetaManagerTeams(supabase);
  const teamIds = managerTeams.map((team) => team.id);
  if (teamIds.length === 0) {
    return {
      deleted: 0,
      created: 0,
      snapshots_deleted: 0,
      requests_deleted: 0,
      board_members_deleted: 0,
      consequences_deleted: 0,
    };
  }

  const activeSeasonResult = await supabase
    .from("seasons")
    .select("id, number")
    .eq("status", "active")
    .maybeSingle();
  ensureOk(activeSeasonResult);
  const activeSeasonId = activeSeasonResult.data?.id ?? null;

  // Snapshots, request-log, board-members og konsekvens-events skal slettes før
  // board_profiles (FK constraints). board_consequences har source_board_id med
  // ON DELETE SET NULL, men vi rydder rows fuldstændigt for ren tavle.
  const [snapshotsDeleted, requestsDeleted, boardMembersDeleted, consequencesDeleted] = await Promise.all([
    supabase.from("board_plan_snapshots").delete().in("team_id", teamIds).select("id"),
    supabase.from("board_request_log").delete().in("team_id", teamIds).select("id"),
    supabase.from("team_board_members").delete().in("team_id", teamIds).select("id"),
    supabase.from("board_consequences").delete().in("team_id", teamIds).select("id"),
  ]);
  [snapshotsDeleted, requestsDeleted, boardMembersDeleted, consequencesDeleted].forEach(ensureOk);

  // S-02c · Nulstil per-team counter + identity_basis så næste sæson 1 starter fra ren tavle.
  // S-02f · Nulstil også team_dna_key + team_dna_chosen_at — manageren skal vælge DNA
  // igen ved næste sæson-2-onboarding.
  ensureOk(await supabase
    .from("teams")
    .update({
      consecutive_low_satisfaction_expirations: 0,
      season_1_identity_basis: null,
      team_dna_key: null,
      team_dna_chosen_at: null,
    })
    .in("id", teamIds));

  // Slet alle eksisterende board_profiles for managers (planer + evt. baseline).
  const existingDeleted = await supabase
    .from("board_profiles")
    .delete()
    .in("team_id", teamIds)
    .select("id");
  ensureOk(existingDeleted);

  // Opret én baseline-row pr. team — sæson 1 = observation, ingen mål.
  const baselineRows = managerTeams.map((team) => createBaselineProfile({
    teamId: team.id,
    seasonId: activeSeasonId,
    balance: team.balance ?? 0,
    sponsorIncome: team.sponsor_income ?? DEFAULT_SPONSOR_INCOME,
  }));

  if (baselineRows.length > 0) {
    ensureOk(await supabase.from("board_profiles").insert(baselineRows).select("id"));
  }

  return {
    deleted: countRows(existingDeleted),
    created: baselineRows.length,
    snapshots_deleted: countRows(snapshotsDeleted),
    requests_deleted: countRows(requestsDeleted),
    board_members_deleted: countRows(boardMembersDeleted),
    consequences_deleted: countRows(consequencesDeleted),
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

  // finance_transactions.race_id: NO ACTION FK til races — null for alle hold (også
  // AI/bank), ellers blokerer FK-constraint races-delete (FK-audit, relaunch 18/6).
  ensureOk(await supabase.from("finance_transactions").update({ race_id: null }).not("race_id", "is", null));

  const races = ensureOk(await supabase.from("races").delete().not("id", "is", null).select("id"));

  // prize_earnings_bonus er koblet til løbsresultater — nulstil for alle ryttere
  ensureOk(await supabase.from("riders").update({ prize_earnings_bonus: 0 }).not("id", "is", null));

  return {
    pending_race_results: countRows(pending),
    race_results: countRows(results),
    season_standings: countRows(standings),
    races: countRows(races),
  };
}

export async function resetBetaTransferArchive(supabase) {
  assertSupabase(supabase);
  const managerTeams = await getBetaManagerTeams(supabase);
  const teamIds = managerTeams.map((team) => team.id);
  if (teamIds.length === 0) return { transfer_listings: 0, transfer_offers: 0, swap_offers: 0 };

  // Slet transfer_offers hvor manager er køber (på AI-listings der ikke slettes via CASCADE)
  const buyerOffers = ensureOk(await supabase
    .from("transfer_offers")
    .delete()
    .in("buyer_team_id", teamIds)
    .select("id"));

  // Slet transfer_listings for manager-hold (ON DELETE CASCADE fjerner tilhørende offers)
  const listings = ensureOk(await supabase
    .from("transfer_listings")
    .delete()
    .in("seller_team_id", teamIds)
    .select("id"));

  // Slet swap_offers for manager-hold (begge sider)
  const [swaps1, swaps2] = await Promise.all([
    supabase.from("swap_offers").delete().in("proposing_team_id", teamIds).select("id"),
    supabase.from("swap_offers").delete().in("receiving_team_id", teamIds).select("id"),
  ]);
  [swaps1, swaps2].forEach(ensureOk);

  return {
    transfer_listings: countRows(listings),
    transfer_offers: countRows(buyerOffers),
    swap_offers: countRows(swaps1) + countRows(swaps2),
  };
}

// #104 · Sletter ALL public-facing rytter-historik (auctions, transfers, swaps, leje-aftaler)
// så spillet kan starte fra ren tavle uden alpha-støj på rytter-profiler.
// Bevarer rider_watchlist, riders, teams, balancer, sæsoner, race-resultater m.m.
// Sletter child-tabeller før parent-tabeller for at få korrekte counts (i stedet for
// at lade ON DELETE CASCADE wipe dem stille).
export async function resetBetaRiderHistory(supabase) {
  assertSupabase(supabase);

  const auctionBids = ensureOk(await supabase.from("auction_bids").delete().not("id", "is", null).select("id"));
  const auctions = ensureOk(await supabase.from("auctions").delete().not("id", "is", null).select("id"));
  const transferOffers = ensureOk(await supabase.from("transfer_offers").delete().not("id", "is", null).select("id"));
  const transferListings = ensureOk(await supabase.from("transfer_listings").delete().not("id", "is", null).select("id"));
  const swapOffers = ensureOk(await supabase.from("swap_offers").delete().not("id", "is", null).select("id"));
  const loanAgreements = ensureOk(await supabase.from("loan_agreements").delete().not("id", "is", null).select("id"));

  return {
    auction_bids: countRows(auctionBids),
    auctions: countRows(auctions),
    transfer_offers: countRows(transferOffers),
    transfer_listings: countRows(transferListings),
    swap_offers: countRows(swapOffers),
    loan_agreements: countRows(loanAgreements),
  };
}

export async function resetBetaLoans(supabase) {
  assertSupabase(supabase);
  const managerTeams = await getBetaManagerTeams(supabase);
  const teamIds = managerTeams.map((team) => team.id);
  if (teamIds.length === 0) return { loans: 0 };

  // finance_transactions.related_loan_id: NO ACTION FK til loans — null referencerne
  // for de loans der slettes FØR delete, ellers blokerer FK-constraint loan-delete
  // (fundet i relaunch 18/6 + FK-audit). Beta-teams fin_tx slettes alligevel i
  // resetBetaBalances(clearTransactions), men FK blokerer på delete-tidspunktet her.
  const loanRows = ensureOk(await supabase.from("loans").select("id").in("team_id", teamIds));
  const loanIds = (loanRows.data || []).map((row) => row.id);
  if (loanIds.length > 0) {
    ensureOk(await supabase
      .from("finance_transactions")
      .update({ related_loan_id: null })
      .in("related_loan_id", loanIds));
  }

  const loans = ensureOk(await supabase
    .from("loans")
    .delete()
    .in("team_id", teamIds)
    .select("id"));

  return { loans: countRows(loans) };
}

export async function resetBetaNotifications(supabase) {
  assertSupabase(supabase);
  const managerTeams = await getBetaManagerTeams(supabase);
  const userIds = [...new Set(managerTeams.map((team) => team.user_id).filter(Boolean))];
  if (userIds.length === 0) return { notifications: 0 };

  const notifications = ensureOk(await supabase
    .from("notifications")
    .delete()
    .in("user_id", userIds)
    .select("id"));

  return { notifications: countRows(notifications) };
}

export async function resetBetaSeasons(supabase) {
  assertSupabase(supabase);
  // board_plan_snapshots: NOT NULL FK til seasons — skal slettes før sæsoner
  ensureOk(await supabase.from("board_plan_snapshots").delete().not("id", "is", null));
  // academy_intake + academy_graduation: NO ACTION FK til seasons (#1308/#932) — kuld
  // og gradueringer hører til den sæson der nu wipes og kan ikke nulles, så slet dem før
  // sæson-delete. Uden dette fejler enhver beta-reset efter academy har kørt (rehearsal
  // 18/6 fangede academy_intake; FK-audit 18/6 tilføjede academy_graduation).
  ensureOk(await supabase.from("academy_intake").delete().not("id", "is", null));
  ensureOk(await supabase.from("academy_graduation").delete().not("id", "is", null));
  // board_profiles: TO nullable NO ACTION FK til seasons (season_id + season_start_anchor_
  // season_id) — null BEGGE, ellers blokerer anchor-FK sæson-delete (FK-audit 18/6).
  ensureOk(await supabase.from("board_profiles").update({ season_id: null }).not("id", "is", null));
  ensureOk(await supabase.from("board_profiles").update({ season_start_anchor_season_id: null }).not("season_start_anchor_season_id", "is", null));
  // finance_transactions: nullable FK til seasons med ON DELETE NO ACTION — null det ud
  // for alle hold (også AI/bank), ellers blokerer FK-constraint sæson-delete.
  ensureOk(await supabase.from("finance_transactions").update({ season_id: null }).not("season_id", "is", null));
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
    .neq("achievement_id", FOUNDER_BADGE_KEY)   // founder_badge overlever alle resets (#1103)
    .select("id"));

  return { manager_achievements: countRows(achievements) };
}

export async function runFullBetaReset(supabase, options = {}) {
  const resetMode = options.resetMode || "test";

  const cancelled = await cancelBetaMarket(supabase);
  const rider_history = await resetBetaRiderHistory(supabase);
  const transfer_archive = await resetBetaTransferArchive(supabase);
  const loans = await resetBetaLoans(supabase);
  const notifications = await resetBetaNotifications(supabase);
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
    rider_history,
    transfer_archive,
    loans,
    notifications,
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
