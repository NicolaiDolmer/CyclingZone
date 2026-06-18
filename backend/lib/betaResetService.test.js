import test from "node:test";
import assert from "node:assert/strict";

import {
  cancelBetaMarket,
  resetBetaAchievements,
  resetBetaBalances,
  resetBetaBoardProfiles,
  resetBetaLoans,
  resetBetaRaceCalendar,
  resetBetaRiderHistory,
  resetBetaRosters,
  resetBetaSeasons,
  resetBetaWishlist,
  runFullBetaReset,
} from "./betaResetService.js";
import { FOUNDER_BADGE_KEY } from "./founderBadge.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// fkConstraints: [{ child, column, parent }] — modellerer NO ACTION/RESTRICT-FK'er.
// Når enforcement er slået til, blokerer en DELETE på `parent` (præcis som Postgres)
// hvis en overlevende row i `child` stadig peger på en slettet parent-row via `column`.
// Dermed FEJLER en reset-funktion der sletter parent FØR den nuller/sletter child —
// det er præcis FK-crash-klassen fra relaunch 18/6 (#1471).
function createBetaResetSupabase(initialState, fkConstraints = []) {
  const state = Object.fromEntries(
    Object.entries(initialState).map(([table, rows]) => [table, clone(rows)])
  );

  function ensureTable(table) {
    if (!state[table]) state[table] = [];
    return state[table];
  }

  // Returnér en Postgres-lignende fejl-besked hvis et NO ACTION-FK ville blokere delete.
  function noActionFkViolation(parent, deletedRows) {
    if (!fkConstraints.length || !deletedRows.length) return null;
    const deletedIds = new Set(deletedRows.map((row) => row.id));
    for (const fk of fkConstraints) {
      if (fk.parent !== parent) continue;
      const childRows = state[fk.child] || [];
      const stillReferencing = childRows.some(
        (row) => row[fk.column] != null && deletedIds.has(row[fk.column])
      );
      if (stillReferencing) {
        return `update or delete on table "${parent}" violates foreign key constraint `
          + `"${fk.child}_${fk.column}_fkey" on table "${fk.child}"`;
      }
    }
    return null;
  }

  function createQuery(table, action, payload = null) {
    const filters = [];

    function matches(row) {
      return filters.every((filter) => {
        if (filter.type === "eq") return row[filter.column] === filter.value;
        if (filter.type === "neq") return row[filter.column] !== filter.value;
        if (filter.type === "in") return filter.values.includes(row[filter.column]);
        if (filter.type === "not-is-null") return row[filter.column] !== null && row[filter.column] !== undefined;
        return true;
      });
    }

    function execute() {
      const rows = ensureTable(table);

      if (action === "select") {
        return Promise.resolve({ data: clone(rows.filter(matches)), error: null });
      }

      if (action === "update") {
        const updated = [];
        for (const row of rows) {
          if (matches(row)) {
            Object.assign(row, clone(payload));
            updated.push(row);
          }
        }
        return Promise.resolve({ data: clone(updated), error: null });
      }

      if (action === "delete") {
        const deleted = rows.filter(matches);
        const violation = noActionFkViolation(table, deleted);
        if (violation) {
          return Promise.resolve({ data: null, error: { message: violation } });
        }
        state[table] = rows.filter((row) => !matches(row));
        return Promise.resolve({ data: clone(deleted), error: null });
      }

      if (action === "insert") {
        const inserted = Array.isArray(payload) ? clone(payload) : [clone(payload)];
        state[table].push(...inserted);
        return Promise.resolve({ data: clone(inserted), error: null });
      }

      return Promise.resolve({ data: null, error: null });
    }

    const query = {
      eq(column, value) {
        filters.push({ type: "eq", column, value });
        return query;
      },
      neq(column, value) {
        filters.push({ type: "neq", column, value });
        return query;
      },
      in(column, values) {
        filters.push({ type: "in", column, values });
        return query;
      },
      not(column, operator, value) {
        if (operator === "is" && value === null) {
          filters.push({ type: "not-is-null", column });
        }
        return query;
      },
      select() {
        return query;
      },
      maybeSingle() {
        return execute().then((result) => ({ data: result.data[0] || null, error: result.error }));
      },
      single() {
        return execute().then((result) => ({ data: result.data[0] || null, error: result.error }));
      },
      then(resolve, reject) {
        return execute().then(resolve, reject);
      },
    };

    return query;
  }

  return {
    state,
    from(table) {
      ensureTable(table);
      return {
        select() {
          return createQuery(table, "select");
        },
        update(payload) {
          return createQuery(table, "update", payload);
        },
        delete() {
          return createQuery(table, "delete");
        },
        insert(payload) {
          return createQuery(table, "insert", payload);
        },
      };
    },
  };
}

function createInitialState() {
  return {
    teams: [
      { id: "team-1", user_id: "user-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, division: 1, balance: 12, sponsor_income: 240000 },
      { id: "team-ai", user_id: null, is_ai: true, is_bank: false, is_frozen: false, is_test_account: false, division: 1, balance: 999, sponsor_income: 0 },
      { id: "team-bank", user_id: null, is_ai: false, is_bank: true, is_frozen: false, is_test_account: false, division: 1, balance: 999, sponsor_income: 0 },
      { id: "team-frozen", user_id: "user-frozen", is_ai: false, is_bank: false, is_frozen: true, is_test_account: false, division: 1, balance: 999, sponsor_income: 0 },
    ],
    riders: [
      { id: "rider-ai", team_id: "team-1", ai_team_id: "team-ai", pending_team_id: "team-2" },
      { id: "rider-free", team_id: "team-1", ai_team_id: null, pending_team_id: "team-2" },
      { id: "rider-ai-owned", team_id: "team-ai", ai_team_id: "team-ai", pending_team_id: null },
      // BUG 1 (#1481): parkeret indkommende handel — rytteren står stadig fysisk på
      // sælgeren (AI-holdet), men er købt af manager-holdet via pending_team_id.
      // team_id ligger uden for manager-sættet, så team_id-filteret fanger den ikke.
      { id: "rider-incoming", team_id: "team-ai", ai_team_id: "team-ai", pending_team_id: "team-1" },
      // Negativ kontrol: parkeret handel der peger på et ikke-manager-hold (team-2) —
      // dens pending_team_id må IKKE røres af reset.
      { id: "rider-incoming-nonmanager", team_id: "team-ai", ai_team_id: "team-ai", pending_team_id: "team-2" },
    ],
    auctions: [{ id: "auction-1", status: "active" }],
    transfer_listings: [{ id: "listing-1", status: "open" }],
    transfer_offers: [{ id: "transfer-1", status: "window_pending" }],
    swap_offers: [{ id: "swap-1", status: "accepted" }],
    loan_agreements: [{ id: "loan-1", status: "active" }],
    finance_transactions: [
      { id: "tx-1", team_id: "team-1", season_id: "season-1" },
      { id: "tx-ai", team_id: "team-ai", season_id: "season-1" },
    ],
    seasons: [{ id: "season-1", status: "active", number: 1 }],
    races: [{ id: "race-1" }],
    pending_race_results: [{ id: "pending-1" }],
    race_results: [{ id: "result-1" }],
    season_standings: [{ id: "standing-1" }],
    users: [{ id: "user-1", xp: 200, level: 3 }, { id: "user-frozen", xp: 200, level: 3 }],
    xp_log: [{ id: "xp-1", user_id: "user-1" }, { id: "xp-frozen", user_id: "user-frozen" }],
    achievements: [{ id: "achievement-1" }, { id: "founder_badge" }],
    manager_achievements: [
      { id: "ma-1", user_id: "user-1", achievement_id: "auction_first_win" },
      { id: "ma-founder", user_id: "user-1", achievement_id: "founder_badge" },
      { id: "ma-frozen", user_id: "user-frozen", achievement_id: "auction_first_win" },
    ],
    board_profiles: [
      {
        id: "board-1",
        team_id: "team-1",
        plan_type: "1yr",
        satisfaction: 12,
        budget_modifier: 0.8,
        seasons_completed: 2,
        cumulative_stage_wins: 4,
        cumulative_gc_wins: 1,
      },
    ],
    board_plan_snapshots: [{ id: "snap-1", team_id: "team-1" }, { id: "snap-ai", team_id: "team-ai" }],
    board_request_log: [{ id: "request-1", team_id: "team-1" }, { id: "request-ai", team_id: "team-ai" }],
    academy_intake: [
      { id: "intake-1", team_id: "team-1", rider_id: "rider-free", season_id: "season-1", status: "offered" },
      { id: "intake-ai", team_id: "team-ai", rider_id: "rider-ai-owned", season_id: "season-1", status: "offered" },
    ],
  };
}

test("cancelBetaMarket cancels every non-terminal market artifact, including accepted swaps", async () => {
  const supabase = createBetaResetSupabase(createInitialState());

  const result = await cancelBetaMarket(supabase);

  assert.deepEqual(result, {
    auctions: 1,
    transfer_listings: 1,
    transfer_offers: 1,
    swap_offers: 1,
    loan_agreements: 1,
  });
  assert.equal(supabase.state.swap_offers[0].status, "rejected");
});

test("resetBetaRosters returns manager riders to ai_team_id or free agency and clears pending_team_id", async () => {
  const supabase = createBetaResetSupabase(createInitialState());

  const result = await resetBetaRosters(supabase);

  // moved/to_ai/to_null tæller kun ryttere der FYSISK står på et manager-hold (team-1):
  // rider-ai + rider-free. rider-incoming* står på team-ai → tælles ikke i moved.
  assert.equal(result.moved, 2);
  assert.equal(result.to_ai, 1);
  assert.equal(result.to_null, 1);
  assert.equal(supabase.state.riders.find((rider) => rider.id === "rider-ai").team_id, "team-ai");
  assert.equal(supabase.state.riders.find((rider) => rider.id === "rider-ai").pending_team_id, null);
  assert.equal(supabase.state.riders.find((rider) => rider.id === "rider-free").team_id, null);
});

test("resetBetaRosters clears pending_team_id for incoming transfers parked on a manager team (BUG 1, #1481)", async () => {
  const supabase = createBetaResetSupabase(createInitialState());

  const result = await resetBetaRosters(supabase);

  // pending_cleared dækker ALLE ryttere hvis pending_team_id peger på et manager-hold:
  // rider-ai + rider-free (team_id=team-1, pending→team-2? nej — peger på team-2, ikke manager)
  // Manager-team i fixturen = team-1. pending→team-1: kun rider-incoming.
  // rider-ai/rider-free får pending nullet via team_id-stien (de står på team-1).
  const incoming = supabase.state.riders.find((rider) => rider.id === "rider-incoming");
  assert.equal(incoming.pending_team_id, null, "indkommende handel på manager-hold skal nulstilles");
  assert.equal(incoming.team_id, "team-ai", "rytterens fysiske team_id (sælger) skal IKKE flyttes");
  assert.equal(result.pending_cleared, 1, "kun rider-incoming peger på et manager-hold via pending_team_id");

  // Negativ kontrol: handel der peger på ikke-manager-hold (team-2) bevares.
  const nonManager = supabase.state.riders.find((rider) => rider.id === "rider-incoming-nonmanager");
  assert.equal(nonManager.pending_team_id, "team-2", "handel mod ikke-manager-hold må ikke røres");

  // 0 hængende pending-transfers mod manager-hold efter reset.
  const stillPendingToManager = supabase.state.riders.filter((rider) => rider.pending_team_id === "team-1");
  assert.equal(stillPendingToManager.length, 0);
});

test("resetBetaBalances touches only active manager teams and can clear only their finance rows", async () => {
  const supabase = createBetaResetSupabase(createInitialState());

  const result = await resetBetaBalances(supabase, { clearTransactions: true });

  assert.equal(result.reset, 1);
  assert.equal(supabase.state.teams.find((team) => team.id === "team-1").balance, 800000);
  assert.equal(supabase.state.teams.find((team) => team.id === "team-ai").balance, 999);
  assert.deepEqual(supabase.state.finance_transactions.map((row) => row.id), ["tx-ai"]);
});

test("resetBetaBoardProfiles deletes all manager board data and creates one baseline row per team (S-02a)", async () => {
  const supabase = createBetaResetSupabase(createInitialState());

  const result = await resetBetaBoardProfiles(supabase);

  // S-02a: full reset — eksisterende rows slettes, 1 baseline-row oprettes pr. manager-team.
  assert.equal(result.deleted, 1);
  assert.equal(result.created, 1);
  assert.equal(result.snapshots_deleted, 1);
  assert.equal(result.requests_deleted, 1);

  // Kun 1 manager-team i fixture → 1 baseline-row (gamle "board-1" er slettet).
  assert.equal(supabase.state.board_profiles.length, 1);
  const baseline = supabase.state.board_profiles[0];
  assert.equal(baseline.team_id, "team-1");
  assert.equal(baseline.plan_type, "baseline");
  assert.equal(baseline.is_baseline, true);
  assert.equal(baseline.budget_modifier, 1);
  assert.equal(baseline.satisfaction, 50);
  assert.deepEqual(baseline.current_goals, []);

  // AI-team's snapshot må ikke røres.
  assert.deepEqual(supabase.state.board_plan_snapshots.map((row) => row.id), ["snap-ai"]);
});

test("resetBetaRiderHistory wipes alle 6 historik-tabeller men bevarer rider_watchlist + riders + teams (#104)", async () => {
  const initialState = createInitialState();
  initialState.auction_bids = [
    { id: "bid-1", auction_id: "auction-1", team_id: "team-1", amount: 50000 },
    { id: "bid-2", auction_id: "auction-1", team_id: "team-ai", amount: 60000 },
  ];
  // Ekstra rows for at sikre alle statuses ryddes (ikke kun "active"/"accepted")
  initialState.auctions.push({ id: "auction-2", status: "completed" });
  initialState.transfer_offers.push({ id: "transfer-2", status: "rejected" });
  initialState.loan_agreements.push({ id: "loan-2", status: "completed" });
  initialState.loan_agreements.push({ id: "loan-3", status: "buyout" });
  // Kritisk fixture: ønskelister må ALDRIG røres af denne reset
  initialState.rider_watchlist = [
    { id: "wl-1", user_id: "user-1", rider_id: "rider-ai", note: "Stjerne" },
    { id: "wl-2", user_id: "user-1", rider_id: "rider-free", note: null },
  ];

  const supabase = createBetaResetSupabase(initialState);
  const result = await resetBetaRiderHistory(supabase);

  assert.deepEqual(result, {
    auction_bids: 2,
    auctions: 2,
    transfer_offers: 2,
    transfer_listings: 1,
    swap_offers: 1,
    loan_agreements: 3,
  });

  // Alle 6 historik-tabeller skal være tomme efter reset
  assert.deepEqual(supabase.state.auctions, []);
  assert.deepEqual(supabase.state.auction_bids, []);
  assert.deepEqual(supabase.state.transfer_listings, []);
  assert.deepEqual(supabase.state.transfer_offers, []);
  assert.deepEqual(supabase.state.swap_offers, []);
  assert.deepEqual(supabase.state.loan_agreements, []);

  // KRITISK: rider-history rører IKKE ønskelister (det gør resetBetaWishlist separat),
  // ryttere, hold og økonomi bevares
  assert.equal(supabase.state.rider_watchlist.length, 2, "rider-history må ikke røre ønskelister");
  assert.equal(supabase.state.riders.length, 5, "ryttere bevares");
  assert.equal(supabase.state.teams.length, 4, "hold bevares");
  assert.equal(supabase.state.finance_transactions.length, 2, "finance-historik bevares");
  assert.equal(supabase.state.seasons.length, 1, "sæson bevares");
});

test("resetBetaSeasons nuller finance_transactions.season_id for ALLE hold (også AI/bank) før delete", async () => {
  // Regression: FK finance_transactions.season_id -> seasons har ON DELETE NO ACTION,
  // så AI/bank-rows blokerede DELETE FROM seasons indtil 2026-05-05-fix.
  const supabase = createBetaResetSupabase(createInitialState());

  const result = await resetBetaSeasons(supabase);

  assert.equal(result.seasons, 1);
  assert.deepEqual(supabase.state.seasons, []);
  // Begge transactions (manager + AI) skal have season_id = null efter reset
  for (const tx of supabase.state.finance_transactions) {
    assert.equal(tx.season_id, null, `tx ${tx.id} har stadig season_id sat`);
  }
});

test("resetBetaSeasons sletter academy_intake før season-delete (NOT NULL FK, #1308)", async () => {
  // Regression: academy_intake.season_id -> seasons har ingen ON DELETE-klausul, så kuld-rows
  // blokerede DELETE FROM seasons efter academy-intake havde kørt. Fundet i relaunch-rehearsal 18/6
  // (founder-survival-sub-testen kører en betaReset EFTER intake-kuld var oprettet).
  const supabase = createBetaResetSupabase(createInitialState());
  assert.equal(supabase.state.academy_intake.length, 2, "precondition: kuld findes");

  const result = await resetBetaSeasons(supabase);

  assert.equal(result.seasons, 1);
  assert.deepEqual(supabase.state.seasons, [], "sæsoner slettet");
  assert.deepEqual(supabase.state.academy_intake, [], "academy_intake ryddet før season-delete");
});

test("runFullBetaReset completes the full test reset suite without touching AI or frozen manager data", async () => {
  const initialState = createInitialState();
  // #1481: ønskeliste + parkeret indkommende handel skal begge ryddes af full-reset.
  initialState.rider_watchlist = [
    { id: "wl-1", user_id: "user-1", rider_id: "rider-ai" },
    { id: "wl-frozen", user_id: "user-frozen", rider_id: "rider-ai" },
  ];
  const supabase = createBetaResetSupabase(initialState);

  const result = await runFullBetaReset(supabase, { clearTransactions: true, resetMode: "test" });

  assert.equal(result.reset_mode, "test");
  assert.equal(result.divisions.reset, 1);
  assert.equal(result.race_calendar.races, 1);
  assert.equal(result.seasons.seasons, 1);
  assert.equal(result.manager_progress.users, 1);
  assert.equal(result.achievements.manager_achievements, 1);
  assert.ok(result.rider_history, "rider_history skal være med i full-reset");
  // #1481: nye felter i summary.
  assert.equal(result.wishlist.rider_watchlist, 1, "manager-ønskeliste ryddet i full-reset");
  assert.equal(result.rosters.pending_cleared, 1, "indkommende manager-handel ryddet i full-reset");
  assert.deepEqual(supabase.state.auctions, []);
  assert.deepEqual(supabase.state.loan_agreements, []);
  assert.equal(supabase.state.teams.find((team) => team.id === "team-1").division, 3);
  assert.equal(supabase.state.teams.find((team) => team.id === "team-frozen").division, 1);
  assert.equal(supabase.state.users.find((user) => user.id === "user-1").level, 1);
  assert.equal(supabase.state.users.find((user) => user.id === "user-frozen").level, 3);
  assert.deepEqual(supabase.state.races, []);
  assert.deepEqual(supabase.state.seasons, []);
  // founder_badge overlever (ma-founder); ma-1 slettet; frozen-bruger urørt.
  assert.deepEqual(supabase.state.manager_achievements.map((row) => row.id).sort(), ["ma-founder", "ma-frozen"]);
  // #1481: 0 hængende manager-ønskelister + 0 hængende indkommende handler mod manager.
  assert.deepEqual(supabase.state.rider_watchlist.map((row) => row.id), ["wl-frozen"], "kun frozen-bruger ønskeliste tilbage");
  assert.equal(supabase.state.riders.filter((r) => r.pending_team_id === "team-1").length, 0);
});

test("resetBetaAchievements sletter alle manager-achievements UNDTAGEN founder_badge", async () => {
  const supabase = createBetaResetSupabase(createInitialState());

  const result = await resetBetaAchievements(supabase);

  // user-1 er eneste beta-manager (frozen ekskluderet): ma-1 slettes, ma-founder overlever.
  assert.equal(result.manager_achievements, 1);
  assert.deepEqual(supabase.state.manager_achievements.map((row) => row.id).sort(), ["ma-founder", "ma-frozen"]);
  assert.equal(FOUNDER_BADGE_KEY, "founder_badge");
});

test("resetBetaWishlist sletter manager-brugeres rider_watchlist men ikke AI/frozen/ingen-bruger-rows (BUG 2, #1481)", async () => {
  const initialState = createInitialState();
  initialState.rider_watchlist = [
    { id: "wl-1", user_id: "user-1", rider_id: "rider-ai" },        // manager → slettes
    { id: "wl-2", user_id: "user-1", rider_id: "rider-free" },      // manager → slettes
    { id: "wl-frozen", user_id: "user-frozen", rider_id: "rider-ai" }, // frozen-manager ekskluderet → bevares
    { id: "wl-none", user_id: null, rider_id: "rider-ai" },         // ingen bruger → bevares
  ];
  const supabase = createBetaResetSupabase(initialState);

  const result = await resetBetaWishlist(supabase);

  // Kun user-1 er aktiv beta-manager (frozen ekskluderet i managerTeamQuery).
  assert.equal(result.rider_watchlist, 2);
  assert.deepEqual(
    supabase.state.rider_watchlist.map((row) => row.id).sort(),
    ["wl-frozen", "wl-none"],
    "kun manager-brugeres ønskelister slettes",
  );
});

// --- Forward-guard: NO ACTION FK-crashes i beta-reset (#1471, relaunch 18/6) -------------
//
// Den oprindelige relaunch-apply crashede fordi reset slettede en parent-row (loans/races/
// seasons) mens en finance_transactions/board_profiles/academy-row stadig pegede på den via
// en ON DELETE NO ACTION-FK. Mock'en herunder håndhæver netop de FK'er, så enhver fremtidig
// ændring der genindfører parent-delete-FØR-child-håndtering fejler her i stedet for midt i
// en uigenkaldelig prod-apply. Sættet spejler de FK'er FK-auditen fandt 18/6.
const RESET_NO_ACTION_FKS = [
  { child: "finance_transactions", column: "related_loan_id", parent: "loans" },
  { child: "finance_transactions", column: "race_id", parent: "races" },
  { child: "finance_transactions", column: "season_id", parent: "seasons" },
  { child: "board_profiles", column: "season_id", parent: "seasons" },
  { child: "board_profiles", column: "season_start_anchor_season_id", parent: "seasons" },
  { child: "board_plan_snapshots", column: "season_id", parent: "seasons" },
  { child: "academy_intake", column: "season_id", parent: "seasons" },
  { child: "academy_graduation", column: "season_id", parent: "seasons" },
];

// Udvider createInitialState med faktiske child→parent-referencer, så NO ACTION-FK'erne
// faktisk er "armerede" (uden referencer ville en parent-delete aldrig blokere).
function createLinkedState() {
  const state = createInitialState();
  state.loans = [
    { id: "loan-team1", team_id: "team-1" },
    { id: "loan-ai", team_id: "team-ai" },
  ];
  state.finance_transactions = [
    { id: "tx-1", team_id: "team-1", season_id: "season-1", race_id: "race-1", related_loan_id: "loan-team1" },
    { id: "tx-ai", team_id: "team-ai", season_id: "season-1", race_id: "race-1", related_loan_id: "loan-ai" },
  ];
  state.board_profiles = [
    { id: "board-1", team_id: "team-1", season_id: "season-1", season_start_anchor_season_id: "season-1", plan_type: "1yr" },
  ];
  state.board_plan_snapshots = [{ id: "snap-1", team_id: "team-1", season_id: "season-1" }];
  state.academy_intake = [
    { id: "intake-1", team_id: "team-1", rider_id: "rider-free", season_id: "season-1", status: "offered" },
  ];
  // Latent 18/6: 0 rækker i prod nu, men FK'en er der — én row her armerer guarden.
  state.academy_graduation = [{ id: "grad-1", team_id: "team-1", rider_id: "rider-free", season_id: "season-1" }];
  return state;
}

test("resetBetaLoans nuller finance_transactions.related_loan_id FØR loans slettes (NO ACTION FK, #1471)", async () => {
  const supabase = createBetaResetSupabase(createLinkedState(), RESET_NO_ACTION_FKS);

  // Må IKKE kaste: en delete-før-null ville udløse FK-violation i mock'en (som i prod 18/6).
  const result = await resetBetaLoans(supabase);

  assert.equal(result.loans, 1, "kun manager-loan slettes (AI-loan urørt)");
  assert.deepEqual(supabase.state.loans.map((row) => row.id), ["loan-ai"]);
  // Manager-rytterens fin_tx skal være afkoblet fra den slettede loan.
  const tx1 = supabase.state.finance_transactions.find((row) => row.id === "tx-1");
  assert.equal(tx1.related_loan_id, null, "related_loan_id nullet før loan-delete");
});

test("resetBetaRaceCalendar nuller finance_transactions.race_id FØR races slettes (NO ACTION FK, #1471)", async () => {
  const supabase = createBetaResetSupabase(createLinkedState(), RESET_NO_ACTION_FKS);

  const result = await resetBetaRaceCalendar(supabase);

  assert.equal(result.races, 1);
  assert.deepEqual(supabase.state.races, []);
  // ALLE fin_tx (også AI/bank) skal være afkoblet fra races før delete.
  for (const tx of supabase.state.finance_transactions) {
    assert.equal(tx.race_id, null, `tx ${tx.id} har stadig race_id sat`);
  }
});

test("resetBetaSeasons håndterer ALLE NO ACTION season-FK'er (board-anchor + academy_graduation) før delete (#1471)", async () => {
  const supabase = createBetaResetSupabase(createLinkedState(), RESET_NO_ACTION_FKS);
  // Preconditions: alle fire latente FK-stier er armerede.
  assert.equal(supabase.state.academy_graduation.length, 1, "precondition: graduation-row findes");
  assert.equal(supabase.state.board_profiles[0].season_start_anchor_season_id, "season-1");

  const result = await resetBetaSeasons(supabase);

  assert.equal(result.seasons, 1);
  assert.deepEqual(supabase.state.seasons, [], "sæsoner slettet uden FK-crash");
  // board_profiles.season_id + anchor nullet (board_profiles selv bevares til baseline-reset).
  assert.equal(supabase.state.board_profiles[0].season_id, null);
  assert.equal(supabase.state.board_profiles[0].season_start_anchor_season_id, null);
  // finance_transactions.season_id nullet for alle hold.
  for (const tx of supabase.state.finance_transactions) {
    assert.equal(tx.season_id, null, `tx ${tx.id} har stadig season_id sat`);
  }
  // academy_graduation + academy_intake + board_plan_snapshots slettet før season-delete.
  assert.deepEqual(supabase.state.academy_graduation, [], "academy_graduation ryddet før season-delete");
  assert.deepEqual(supabase.state.academy_intake, [], "academy_intake ryddet før season-delete");
  assert.deepEqual(supabase.state.board_plan_snapshots, [], "board_plan_snapshots ryddet før season-delete");
});
