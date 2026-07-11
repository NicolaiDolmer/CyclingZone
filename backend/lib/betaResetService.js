import { createBaselineProfile } from "./boardEngine.js";
import { DEFAULT_SPONSOR_INCOME } from "./economyEngine.js";
import { FOUNDER_BADGE_KEY } from "./founderBadge.js";
import { MANAGER_ENTRY_DIVISION } from "./economyConstants.js";

export const DEFAULT_BETA_BALANCE = 500000; // #1717: sænket 800000 → 500000 (matcher INITIAL_BALANCE)

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
  // træningshistorik (resetBetaTrainingHistory · #1716)
  "training_day_runs",
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
  // #2301: loans.season_id (nødlåns-idempotens pr. sæson) — nulles i resetBetaSeasons
  // fordi resetBetaLoans kun rammer beta-manager-teams' loans.
  { child: "loans", column: "season_id", parent: "seasons", strategy: "null-before-delete", handled_by: "resetBetaSeasons" },
  { child: "loans", column: "last_interest_season_id", parent: "seasons", strategy: "null-before-delete", handled_by: "resetBetaSeasons" },
  { child: "scout_assignments", column: "season_id", parent: "seasons", strategy: "null-before-delete", handled_by: "resetBetaSeasons" },
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
    return { moved: 0, to_ai: 0, to_null: 0, pending_cleared: 0 };
  }

  const ridersResult = ensureOk(await supabase
    .from("riders")
    .select("id, ai_team_id")
    .in("team_id", teamIds));

  const riders = ridersResult.data || [];

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
        // #2264: nulstil is_academy ved frigivelse til fri agent — en akademi-
        // rytter uden hold er ulovlig tilstand (markedet viser den, auktion afviser).
        .update({ team_id: null, pending_team_id: null, is_academy: false })
        .in("id", withoutAi)
    );
  }

  // BUG 1 (#1481): Nuller team_id-baserede rosters fanger IKKE parkerede indkommende
  // handler. "Betal nu, registrér ved vindue-åbning"-floweet (#19) sætter
  // riders.pending_team_id = køber-hold men beholder team_id på SÆLGEREN (ofte
  // AI-hold/bank), så rytteren ligger uden for manager-team_id-sættet ovenfor og
  // dens pending_team_id ville overleve reset/relaunch. Nul derfor ALLE
  // pending_team_id der peger på et manager-hold, uafhængigt af rytterens nuværende
  // team_id. cancelBetaMarket flipper kun offer-statuses og rører aldrig riders.
  const pendingCleared = ensureOk(await supabase
    .from("riders")
    .update({ pending_team_id: null })
    .in("pending_team_id", teamIds)
    .select("id"));

  (await Promise.all(updates)).forEach(ensureOk);

  return {
    moved: riders.length,
    to_ai: riders.length - withoutAi.length,
    to_null: withoutAi.length,
    pending_cleared: countRows(pendingCleared),
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

// #1608 Task 6 / #1688 (ejer-besluttet 22/6) · pulje-spredende reset-allokering.
// Forever-relaunch-politik: ægte managere kommer ind i MANAGER_ENTRY_DIVISION (=3),
// IKKE i den strukturelle bund (tier 4). Hvert ægte-manager-hold placeres i den p.t.
// mindst-fyldte entry-pulje (league_divisions med tier = MANAGER_ENTRY_DIVISION), så
// puljerne fyldes jævnt (mindst-fyldte-først) — kritisk for race-levedygtighed (et tomt
// felt kan ikke afvikle løb). Blød cap: puljer må vokse forbi POOL_TARGET_SIZE hvis alle
// er fulde (vi lander altid i mindst-fyldte). Sætter BÅDE teams.division = tier (3) OG
// teams.league_division_id = pulje-id. Div 4 forbliver tom headroom (ingen AI-fyld uden
// managere), aktiveres ved skala. Ingen NULL league_division_id på manager-hold efter
// kørsel (medmindre puljerne mangler — pre-migration-fallback).
//
// AI-fyld-generering håndteres separat (generateAndAllocateAiTeams, #1688). Denne
// funktion placerer kun EKSISTERENDE ægte-manager-hold.
export async function allocateLeaguePools(supabase) {
  const managerTeams = await getBetaManagerTeams(supabase);
  if (managerTeams.length === 0) {
    return { allocated: 0, pools: 0 };
  }

  const poolsResult = ensureOk(await supabase
    .from("league_divisions")
    .select("id")
    .eq("tier", MANAGER_ENTRY_DIVISION));
  const entryPools = poolsResult.data || [];

  if (entryPools.length === 0) {
    // Pre-migration-fallback: ingen puljer at sprede på. Flyt holdene til entry-divisionen
    // så tier-keyet økonomi er korrekt; pulje-referencen efter-allokeres når puljerne findes.
    const teamIds = managerTeams.map((team) => team.id);
    ensureOk(await supabase.from("teams").update({ division: MANAGER_ENTRY_DIVISION }).in("id", teamIds));
    return { allocated: teamIds.length, pools: 0, poolless: true };
  }

  // Mindst-fyldte-først greedy: hold telleren pr. pulje opdateret undervejs, så holdene
  // spredes jævnt (ikke alle i pulje 0). Deterministisk: laveste pulje-id ved lige fyldning.
  const counts = new Map(entryPools.map((pool) => [pool.id, 0]));

  const pickLeastFilledPool = () => {
    let chosenId = entryPools[0].id;
    let chosenCount = counts.get(chosenId);
    for (const pool of entryPools) {
      const count = counts.get(pool.id);
      if (count < chosenCount) {
        chosenId = pool.id;
        chosenCount = count;
      }
    }
    return chosenId;
  };

  for (const team of managerTeams) {
    const poolId = pickLeastFilledPool();
    counts.set(poolId, counts.get(poolId) + 1);
    ensureOk(await supabase
      .from("teams")
      .update({ division: MANAGER_ENTRY_DIVISION, league_division_id: poolId })
      .eq("id", team.id));
  }

  return { allocated: managerTeams.length, pools: entryPools.length };
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
// Bevarer riders, teams, balancer, sæsoner, race-resultater m.m.
// rider_watchlist (ønskelister) ryddes separat af resetBetaWishlist (#1481) — IKKE her.
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

// BUG 2 (#1481): rider_watchlist (ønskelister) blev bevidst aldrig nulstillet, så
// hver manager beholdt sin gamle ønskeliste på tværs af reset/relaunch. Efter en
// relaunch peger de rows på pensionerede legacy-ryttere (retireLegacyRiders). Tabellen
// er per-bruger (user_id, rider_id) → scopes via manager-user_ids, præcis som
// resetBetaNotifications, så AI/ingen-bruger-rows ikke berøres.
export async function resetBetaWishlist(supabase) {
  assertSupabase(supabase);
  const managerTeams = await getBetaManagerTeams(supabase);
  const userIds = [...new Set(managerTeams.map((team) => team.user_id).filter(Boolean))];
  if (userIds.length === 0) return { rider_watchlist: 0 };

  const watchlist = ensureOk(await supabase
    .from("rider_watchlist")
    .delete()
    .in("user_id", userIds)
    .select("id"));

  return { rider_watchlist: countRows(watchlist) };
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
  // loans.season_id (#2301): nullable NO ACTION FK til seasons (nødlåns-idempotens pr.
  // sæson). resetBetaLoans sletter kun beta-manager-teams' loans, så null resterende
  // referencer her (samme mønster som finance_transactions.season_id) før sæson-delete.
  ensureOk(await supabase.from("loans").update({ season_id: null }).not("season_id", "is", null));
  // loans.last_interest_season_id (#2333/rente-påløb): nullable NO ACTION FK til seasons —
  // samme mønster som loans.season_id ovenfor; fanget af FK-audit 11/7.
  ensureOk(await supabase.from("loans").update({ last_interest_season_id: null }).not("last_interest_season_id", "is", null));
  // scout_assignments: nullable NO ACTION FK til seasons (scout Fase 3, 10/7) — null før
  // sæson-delete, ellers blokerer opgaver med sæson-stempel DELETE FROM seasons.
  ensureOk(await supabase.from("scout_assignments").update({ season_id: null }).not("season_id", "is", null));
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

// #1716 · Sletter ALL daglig-trænings-historik (training_day_runs) så gamle
// træningsrapporter ikke overlever en relaunch. Tabellen er per-hold (team_id) med
// ON DELETE CASCADE; vi sletter alle rækker (også AI) for ren tavle — samme stil som
// resetBetaRaceCalendar/resetBetaRiderHistory.
export async function resetBetaTrainingHistory(supabase) {
  assertSupabase(supabase);

  const trainingRuns = ensureOk(await supabase
    .from("training_day_runs")
    .delete()
    .not("id", "is", null)
    .select("id"));

  return { training_day_runs: countRows(trainingRuns) };
}

export async function runFullBetaReset(supabase, options = {}) {
  const resetMode = options.resetMode || "test";

  const cancelled = await cancelBetaMarket(supabase);
  const rider_history = await resetBetaRiderHistory(supabase);
  const transfer_archive = await resetBetaTransferArchive(supabase);
  const loans = await resetBetaLoans(supabase);
  const notifications = await resetBetaNotifications(supabase);
  const wishlist = await resetBetaWishlist(supabase);
  const rosters = await resetBetaRosters(supabase);
  const balances = await resetBetaBalances(supabase, {
    clearTransactions: Boolean(options.clearTransactions),
  });
  // #1608 Task 6: pulje-spredende allokering (tier 4 + div-4-puljer) erstatter den flade
  // resetBetaDivisions-bulk-update. Behold nøglen `divisions` i summary for bagudkompat.
  const divisions = await allocateLeaguePools(supabase);
  const race_calendar = await resetBetaRaceCalendar(supabase);
  const seasons = await resetBetaSeasons(supabase);
  const board_profiles = await resetBetaBoardProfiles(supabase);
  const manager_progress = await resetBetaManagerProgress(supabase);
  const achievements = await resetBetaAchievements(supabase);
  const training_history = await resetBetaTrainingHistory(supabase);

  return {
    reset_mode: resetMode,
    cancelled,
    rider_history,
    transfer_archive,
    loans,
    notifications,
    wishlist,
    rosters,
    balances,
    divisions,
    board_profiles,
    race_calendar,
    seasons,
    manager_progress,
    achievements,
    training_history,
  };
}
