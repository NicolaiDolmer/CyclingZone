// Rene matchers — delt mellem Playwright-fixtures (frontend/tests/e2e/fixtures.js)
// OG runtime-preview-mocken (installPreviewMock.js). Ingen route/@playwright/test-
// referencer (CORS/fulfill bliver i fixtures.js). Datakilden er seedData.js, så
// begge konsumenter serverer præcis det samme.
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
  SEED_DISTRIBUTION,
  SEED_STRATEGY,
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
      if (url.search.includes("league_division_id=eq")) return POOL_RACES;
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
      // KUN den race-scopede query (RaceDetailPage: race_id=eq.<id>) får seed-
      // resultater. Alle andre race_results-queries (dashboard/standings/season-
      // aggregater) → tom, præcis som før → uændrede core-smoke-snapshots.
      const idMatch = url.search.match(/race_id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return SEED_RACE_RESULTS.filter(r => r.race_id === id);
      }
      return [];
    }
    case "auction_proxy_bids":
    case "finance_transactions":
    case "loan_agreements":
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
      loan_offers: [],
      counts: { transfer_offers: 0, swap_offers: 0, loan_offers: 0, total: 0 },
    };
  }

  if (pathname.endsWith("/api/transfer-window")) {
    return { open: true, status: "open" };
  }

  if (pathname.endsWith("/api/online-count")) return { count: 1 };
  if (pathname.endsWith("/api/notifications")) return [];
  if (pathname.endsWith("/api/auctions")) return AUCTIONS;
  if (pathname.endsWith("/api/transfers")) return [];
  if (pathname.endsWith("/api/transfers/my-offers")) {
    return { sent: [], received: [], archivedSent: [], archivedReceived: [] };
  }
  if (pathname.endsWith("/api/transfers/swaps")) return { sent: [], received: [] };
  if (pathname.endsWith("/api/loans")) return { lending: [], borrowing: [] };
  if (pathname.endsWith("/api/me/onboarding-progress")) {
    return { steps: [], completed_steps: [], completion_pct: 0 };
  }
  if (pathname.endsWith("/api/me/discord-status")) return { enabled: false, connected: false };
  if (pathname.endsWith("/api/deadline-day/status")) return { active: false };
  // Backend returnerer et ARRAY af events (api.js: res.json(events.slice(0, 20))).
  // Objekt-shape ({ items: [] }) crasher DeadlineDayTicker (events.map) når DD er aktiv (#778-probe).
  if (pathname.endsWith("/api/deadline-day/ticker")) return [];
  if (pathname.endsWith("/api/race-pool")) return [];
  // Race-hub (#prelive-harness, A2): board-aggregat + strategi-flade.
  if (pathname.endsWith("/api/races/distribution")) return SEED_DISTRIBUTION;
  if (pathname.endsWith("/api/races/strategy")) return SEED_STRATEGY;
  if (pathname.endsWith("/api/scouting/me")) {
    return { slots: { total: 3, used: 0, remaining: 3 }, maxLevel: 3, levels: {}, teamId: TEST_TEAM.id };
  }

  if (pathname.endsWith("/api/academy/me")) {
    return {
      enabled: true,
      slots: { used: 2, max: 8 },
      roster: [
        {
          id: "acad-r1",
          firstname: "Jonas",
          lastname: "Svensson",
          birthdate: "2008-03-15",
          nationality_code: "se",
          team_id: TEST_TEAM.id,
          is_academy: true,
          salary: 12000,
          contract_length: 2,
          contract_end_season: 3,
        },
        {
          id: "acad-r2",
          firstname: "Luca",
          lastname: "Morel",
          birthdate: "2007-11-22",
          nationality_code: "fr",
          team_id: TEST_TEAM.id,
          is_academy: true,
          salary: 10000,
          contract_length: 2,
          contract_end_season: 3,
        },
      ],
      intake: [
        {
          intakeId: "intake-1",
          riderId: "prospect-1",
          is_serious: true,
          status: "offered",
          created_at: "2026-06-13T10:00:00.000Z",
          rider: {
            id: "prospect-1",
            firstname: "Emil",
            lastname: "Kristiansen",
            birthdate: "2009-06-05",
            nationality_code: "dk",
            base_value: 200000,
            market_value: 200000,
            prize_earnings_bonus: 0,
            team_id: null,
          },
          potentialEstimate: { lo: 3.5, hi: 5.0, exact: false, scoutLevel: 1 },
        },
        {
          intakeId: "intake-2",
          riderId: "prospect-2",
          is_serious: false,
          status: "offered",
          created_at: "2026-06-13T10:00:00.000Z",
          rider: {
            id: "prospect-2",
            firstname: "Axel",
            lastname: "Bergström",
            birthdate: "2010-02-18",
            nationality_code: "se",
            base_value: 150000,
            market_value: 150000,
            prize_earnings_bonus: 0,
            team_id: null,
          },
          potentialEstimate: { lo: 2.0, hi: 4.0, exact: false, scoutLevel: 0 },
        },
        {
          intakeId: "intake-3",
          riderId: "prospect-3",
          is_serious: false,
          status: "offered",
          created_at: "2026-06-13T10:00:00.000Z",
          rider: {
            id: "prospect-3",
            firstname: "Marco",
            lastname: "De Luca",
            birthdate: "2008-09-30",
            nationality_code: "it",
            base_value: 180000,
            market_value: 180000,
            prize_earnings_bonus: 0,
            team_id: null,
          },
          potentialEstimate: { lo: 3.0, hi: 3.0, exact: true, scoutLevel: 3 },
        },
      ],
      freeAgents: [
        {
          id: "fa-1",
          firstname: "Noah",
          lastname: "Berg",
          nationality_code: "no",
          birthdate: "2007-04-12",
          market_value: 95000,
        },
        {
          id: "fa-2",
          firstname: "Lukas",
          lastname: "Meyer",
          nationality_code: "de",
          birthdate: "2009-11-03",
          market_value: 72000,
        },
      ],
    };
  }

  return {};
}
