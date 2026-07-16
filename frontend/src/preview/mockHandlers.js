// Rene matchers — delt mellem Playwright-fixtures (frontend/tests/e2e/fixtures.js)
// OG runtime-preview-mocken (installPreviewMock.js). Ingen route/@playwright/test-
// referencer (CORS/fulfill bliver i fixtures.js). Datakilden er seedData.js, så
// begge konsumenter serverer præcis det samme.
import { previewPlannerBoard } from "./plannerMock.js";
import {
  TEST_USER,
  TEST_TEAM,
  RIVAL_TEAM,
  ACTIVE_SEASON,
  RIDERS,
  POOL_RACES,
  ROADMAP_ITEMS,
  AUCTIONS,
  SEED_RACES,
  SEED_STAGE_PROFILES,
  SEED_STAGE_SCHEDULE,
  SEED_RACE_RESULTS,
  SEED_RACE_INCIDENTS,
  SEED_RIDER_PALMARES_RESULTS,
  SEED_DISTRIBUTION,
  SEED_BROWSE,
  SEED_SELECTION,
  SEED_STRATEGY,
  SEED_ACADEMY,
  SEED_ACADEMY_PNL,
  SEED_CALENDAR,
  SEED_DEVELOPMENT,
  SEED_PROJECTION,
} from "./seedData.js";

// Tager Accept-strengen direkte (ikke et Playwright-request). PostgREST signalerer
// "returnér ét objekt frem for et array" via Accept: application/vnd.pgrst.object+json
// (supabase-js .single()/.maybeSingle()).
export function wantsObject(accept = "") {
  return (accept || "").includes("vnd.pgrst.object");
}

export function parseTable(requestUrl) {
  const url = new URL(requestUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1];
}

export function restRows(table, requestUrl = "") {
  const url = new URL(requestUrl);
  switch (table) {
    case "users":
      return [{ id: TEST_USER.id, role: "manager", username: "Playwright Manager", login_streak: 3 }];
    case "teams":
      return [TEST_TEAM, RIVAL_TEAM];
    case "riders":
      if (url.search.includes("pending_team_id=eq.")) return [];
      if (url.search.includes("team_id=eq.team-e2e")) {
        return RIDERS.filter(rider => rider.team_id === TEST_TEAM.id);
      }
      return RIDERS;
    case "auctions":
      return AUCTIONS;
    case "roadmap_items":
      return ROADMAP_ITEMS;
    case "races": {
      // Per-pulje tæller-query (#1829) → puljens løb (uændret, holder dashboard-
      // snapshots stabile). id=eq.<id> → ét seed-løb (RaceDetailPage .single()).
      // Alle andre races-queries → hele race-hub-seedet (strategi/dashboard-lister).
      if (url.search.includes("league_division_id=eq")) {
        // #1906: Dashboards "næste løb"-liste joiner nu pool_race OG filtrerer på
        // puljen — den skal stadig se det fulde seed (SEED_RACES er alle i testholdets
        // pulje). Kun den rene tæller-query (#1829, selecter kun stages/status, intet
        // pool_race-join) får de minimale POOL_RACES-rows.
        if (url.search.includes("pool_race")) return SEED_RACES;
        return POOL_RACES;
      }
      const idMatch = url.search.match(/id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return SEED_RACES.filter(r => r.id === id);
      }
      return SEED_RACES;
    }
    case "race_stage_profiles": {
      const idMatch = url.search.match(/race_id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return SEED_STAGE_PROFILES.filter(p => p.race_id === id);
      }
      return SEED_STAGE_PROFILES;
    }
    case "race_stage_schedule": {
      const idMatch = url.search.match(/race_id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return SEED_STAGE_SCHEDULE.filter(s => s.race_id === id);
      }
      return SEED_STAGE_SCHEDULE;
    }
    case "race_results": {
      // Den race-scopede query (RaceDetailPage: race_id=eq.<id>) får seed-resultater.
      const idMatch = url.search.match(/race_id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return SEED_RACE_RESULTS.filter(r => r.race_id === id);
      }
      // #1997 S1: rytter-scopede query (RiderStatsPage.fetchAllRiderSeasonRows →
      // Resultater-/Palmarès-fanen: rider_id=eq.<id>) får palmarès-seedet
      // (race:-embed-shape). KUN rider-1 (Ada Pedersen) har seedede resultater —
      // andre ryttere ser den tilsigtede tomme tilstand.
      const riderMatch = url.search.match(/rider_id=eq\.([^&]+)/);
      if (riderMatch) {
        const id = decodeURIComponent(riderMatch[1]);
        return id === "rider-1" ? SEED_RIDER_PALMARES_RESULTS : [];
      }
      // Alle andre race_results-queries (dashboard/standings/season-aggregater) →
      // tom, præcis som før → uændrede core-smoke-snapshots.
      return [];
    }
    // S4 (#1176): race_incidents (styrt/mekanisk defekt/DNF). Scoped på race_id
    // som race_results ovenfor; tabellen er ny (endnu ikke migreret i prod ved
    // denne slices merge) — mocken viser derfor kun seed for det race_id vi
    // faktisk har uheld på (race-done-2), alt andet degraderer til [] (samme
    // graceful-degradation som RaceDetailPage's egen forespørgsel).
    case "race_incidents": {
      const idMatch = url.search.match(/race_id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return SEED_RACE_INCIDENTS.filter(i => i.race_id === id);
      }
      return [];
    }
    case "auction_proxy_bids":
    case "finance_transactions":
    case "notifications":
    case "player_events":
    case "rider_watchlist":
    case "roadmap_votes":
    case "season_standings":
      return [];
    case "seasons":
      return [ACTIVE_SEASON];
    case "transfer_windows":
      return [{ id: "window-e2e", status: "open" }];
    default:
      return [];
  }
}

export function restObject(table, requestUrl = "") {
  switch (table) {
    case "users":
      return { id: TEST_USER.id, role: "manager", username: "Playwright Manager", login_streak: 3 };
    case "teams":
      return TEST_TEAM;
    case "seasons":
      return ACTIVE_SEASON;
    case "transfer_windows":
      return { id: "window-e2e", status: "open" };
    default:
      return restRows(table, requestUrl)[0] || {};
  }
}

export function apiResponse(pathname) {
  if (pathname.endsWith("/api/board/status")) {
    return {
      is_baseline_phase: true,
      setup_next_plan_type: null,
      plans: { "5yr": null, "3yr": null, "1yr": null },
      team: TEST_TEAM,
      riders: RIDERS.filter(rider => rider.team_id === TEST_TEAM.id),
      standing: null,
      identity_profile: null,
      auto_accept: null,
      active_loans_count: 0,
      team_members: [],
      active_consequences: [],
      bonus_offer: null,
      team_dna: null,
      dna_suggestions: [],
    };
  }

  if (pathname.endsWith("/api/me/finance-forecast")) {
    return {
      projected_net: 148000,
      projected_balance: 948000,
      risk_tier: "healthy",
      sponsor_income: 240000,
      salary_cost: 42000,
      loan_interest_due: 0,
      prize_estimate: 0,
      warnings: [],
    };
  }

  if (pathname.endsWith("/api/finance/loans")) {
    return {
      loans: [],
      config: [
        { loan_type: "short", principal_amount: 100000, interest_rate: 0.05, term_seasons: 1 },
        { loan_type: "long", principal_amount: 250000, interest_rate: 0.08, term_seasons: 3 },
      ],
      debt_ceiling: 900000,
      total_debt: 0,
    };
  }

  if (pathname.endsWith("/api/inbox/pending")) {
    return {
      transfer_offers: [],
      swap_offers: [],
      counts: { transfer_offers: 0, swap_offers: 0, total: 0 },
    };
  }

  if (pathname.endsWith("/api/online-count")) return { count: 1 };
  if (pathname.endsWith("/api/notifications")) return [];
  if (pathname.endsWith("/api/auctions")) return AUCTIONS;
  if (pathname.endsWith("/api/transfers")) return [];
  if (pathname.endsWith("/api/transfers/my-offers")) {
    return { sent: [], received: [], archivedSent: [], archivedReceived: [] };
  }
  if (pathname.endsWith("/api/transfers/swaps")) return { sent: [], received: [] };
  if (pathname.endsWith("/api/me/onboarding-progress")) {
    return { steps: [], completed_steps: [], completion_pct: 0 };
  }
  // Fake sequential placeholder ID (not a secret; Discord client IDs are public) so the preview shows the connected DM-settings state.
  if (pathname.endsWith("/api/me/discord-status")) return { discord_id: "123456789012345678", dm_enabled: true, dm_prefs: { board_update: false }, bot_configured: true }; // gitleaks:allow
  if (pathname.endsWith("/api/race-pool")) return [];
  // Race-hub (#prelive-harness, A2): board-aggregat + strategi-flade.
  // S6 (#1835): read-only "andre divisioner"-browse. Tjekkes FØR distribution (mere
  // specifik path) — selvom endsWith ikke ville krydse, holder rækkefølgen den tydelig.
  if (pathname.endsWith("/api/races/calendar")) return SEED_CALENDAR;
  if (pathname.endsWith("/api/races/distribution/browse")) return SEED_BROWSE;
  if (pathname.endsWith("/api/races/distribution")) return SEED_DISTRIBUTION;
  if (pathname.endsWith("/api/races/strategy")) return SEED_STRATEGY;
  // S5: udtagelses-panel (RaceSelectionPanel + HunterExplainer). /api/races/:id/selection.
  if (/\/api\/races\/[^/]+\/selection$/.test(pathname)) return SEED_SELECTION;
  if (pathname.endsWith("/api/scouting/me")) {
    return { slots: { total: 3, used: 0, remaining: 3 }, maxLevel: 3, levels: {}, teamId: TEST_TEAM.id };
  }

  if (pathname.endsWith("/api/academy/me")) return SEED_ACADEMY;
  if (pathname.endsWith("/api/academy/pnl")) return SEED_ACADEMY_PNL;

  // #2466 "How your team did" — resultat-push for holdets seneste finaliserede
  // løb. Afledt af seed-løbet race-done-2 (Giro di Preview): Ada Pedersen nr. 2 i
  // GC + etapesejr på etape 1. recap-rækkerne er seedets stage-2-rækker 1:1, så
  // buildRaceRecap fortæller det samme i preview som i prod (soloWin + teamWon +
  // abandon/notableCrash fra SEED_RACE_INCIDENTS).
  if (pathname.endsWith("/api/dashboard/my-latest-result")) {
    const finalRows = SEED_RACE_RESULTS.filter(
      (r) => r.race_id === "race-done-2" && r.stage_number === 2
    );
    return {
      race: { id: "race-done-2", name: "Giro di Preview", race_type: "stage_race", stages: 2, last_import: "2026-06-30T15:00:00.000Z" },
      placements: [
        { rider_id: RIDERS[0].id, firstname: "Ada", lastname: "Pedersen", rider_name: "Ada Pedersen", nationality_code: "dk", rank: 2, finish_time: "+0:22", points_earned: 40 },
      ],
      stage_wins: 1,
      totals: { points: 80, prize_money: 194000 },
      recap: {
        results: finalRows,
        incidents: SEED_RACE_INCIDENTS.filter((i) => i.race_id === "race-done-2"),
      },
    };
  }

  // S5 Season Planner: statisk board til read-only smoke (mutationer i preview går
  // gennem den stateful plannerMock, ikke her).
  if (pathname.endsWith("/api/peak-plans/board")) return previewPlannerBoard();

  // #2100 Udvikling-fane: registreret kurve + fuzzy loft-projektion. Projektion-ruten
  // tjekkes FØR /development (endsWith er disjunkt, men rækkefølgen holder intentionen klar).
  if (pathname.endsWith("/development-projection")) return SEED_PROJECTION;
  if (pathname.endsWith("/development")) return SEED_DEVELOPMENT;

  return {};
}
