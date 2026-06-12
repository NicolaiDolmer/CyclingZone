import { expect } from "@playwright/test";

export const TEST_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "manager@cyclingzone.test",
  user_metadata: { team_name: "E2E Racing" },
  app_metadata: {},
  created_at: "2026-05-13T00:00:00.000Z",
};

export const TEST_TEAM = {
  id: "team-e2e",
  user_id: TEST_USER.id,
  name: "E2E Racing",
  manager_name: "Playwright Manager",
  division: 2,
  balance: 800000,
  sponsor_income: 240000,
  is_ai: false,
  is_test_account: true,
};

const RIVAL_TEAM = {
  id: "team-rival",
  user_id: "00000000-0000-4000-8000-000000000002",
  name: "Regression VC",
  manager_name: "Visual Tester",
  division: 2,
  balance: 760000,
  sponsor_income: 240000,
  is_ai: false,
  is_test_account: true,
};

const ACTIVE_SEASON = {
  id: "season-e2e",
  season_number: 1,
  name: "Sæson 1",
  status: "active",
  started_at: "2026-05-01T00:00:00.000Z",
  ended_at: null,
  race_days_completed: 0,
  race_days_total: 28,
};

const RIDERS = [
  {
    id: "rider-1",
    firstname: "Ada",
    lastname: "Pedersen",
    team_id: TEST_TEAM.id,
    nationality_code: "dk",
    birthdate: "2002-04-12",
    // #1101 cutover: market_value pinnet til samme tal som den gamle
    // uci-fallback rendrede (420×4000) — holder snapshots stabile.
    base_value: 1680000,
    market_value: 1680000,
    salary: 42000,
    prize_earnings_bonus: 0,
    is_u25: true,
    // #1162: potentiale er server-skjult (column privilege) — feltet findes ikke
    // i klient-payloads. Visningen kommer fra /api/scouting/estimates-mocket.
    stat_fl: 74,
    stat_bj: 68,
    stat_kb: 70,
    stat_bk: 72,
    stat_tt: 66,
    stat_prl: 64,
    stat_bro: 58,
    stat_sp: 76,
    stat_acc: 78,
    stat_ned: 71,
    stat_udh: 73,
    stat_mod: 69,
    stat_res: 67,
    stat_ftr: 75,
    primary_type: "sprinter",
    secondary_type: "leadout",
    team: { id: TEST_TEAM.id, name: TEST_TEAM.name },
  },
  {
    id: "rider-2",
    firstname: "Mikkel",
    lastname: "Hansen",
    team_id: RIVAL_TEAM.id,
    nationality_code: "dk",
    birthdate: "1997-09-03",
    base_value: 1400000,
    market_value: 1400000,
    salary: 35000,
    prize_earnings_bonus: 0,
    is_u25: false,
    primary_type: "climber",
    secondary_type: "gc",
    team: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name },
  },
];

// Roadmap-voting (#954): to godkendte items så /roadmap rendrer den DB-drevne
// votable liste i stedet for det statiske i18n-fallback.
export const ROADMAP_ITEMS = [
  {
    id: "rm-races-1",
    engine: "races",
    sort_order: 1,
    title_en: "A race engine built for stories.",
    title_da: "En løbsmotor bygget til historier.",
    approved: true,
    status: "active",
  },
  {
    id: "rm-market-1",
    engine: "market",
    sort_order: 1,
    title_en: "Deadline day drama.",
    title_da: "Deadlineday-drama.",
    approved: true,
    status: "active",
  },
];

const AUCTIONS = [
  {
    id: "auction-1",
    rider_id: "rider-2",
    seller_team_id: RIVAL_TEAM.id,
    current_bidder_id: null,
    starting_price: 50000,
    current_price: 50000,
    min_increment: 5000,
    calculated_end: "2026-05-20T12:00:00.000Z",
    status: "active",
    is_guaranteed_sale: false,
    rider: RIDERS[1],
    seller_team: RIVAL_TEAM,
    current_bidder: null,
  },
];

// WebKit håndhæver CORS strikst — echo origin + allow credentials, så Supabase-js
// fetch (credentials: "include") accepterer mock-responses. Chromium er mere lempelig
// og kører grønt selv uden disse headers, men WebKit blokerer.
export function corsHeaders(request) {
  const origin = request.headers().origin || "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, prefer, range, accept-profile, content-profile",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "access-control-expose-headers": "Content-Range",
  };
}

export function json(route, data, status = 200) {
  const count = Array.isArray(data) ? data.length : data ? 1 : 0;
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      ...corsHeaders(route.request()),
      "Content-Range": `0-${Math.max(count - 1, 0)}/${count}`,
    },
    body: JSON.stringify(data),
  });
}

function wantsObject(request) {
  return (request.headers().accept || "").includes("vnd.pgrst.object");
}

function parseTable(requestUrl) {
  const url = new URL(requestUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1];
}

function restRows(table, requestUrl = "") {
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
    case "auction_proxy_bids":
    case "finance_transactions":
    case "loan_agreements":
    case "notifications":
    case "player_events":
    case "race_results":
    case "races":
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

function restObject(table, requestUrl = "") {
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

function apiResponse(pathname) {
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
  if (pathname.endsWith("/api/scouting/me")) {
    return { slots: { total: 3, used: 0, remaining: 3 }, maxLevel: 3, levels: {}, teamId: TEST_TEAM.id };
  }

  return {};
}

export async function installNetworkMocks(page) {
  await page.route("**/auth/v1/token?**", route => json(route, {
    access_token: "e2e-access-token",
    token_type: "bearer",
    expires_in: 3600,
    refresh_token: "e2e-refresh-token",
    user: TEST_USER,
  }));

  await page.route("**/auth/v1/user**", route => json(route, TEST_USER));

  await page.route("**/rest/v1/**", route => {
    const request = route.request();
    const table = parseTable(request.url());

    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method())) {
      return json(route, wantsObject(request) ? {} : []);
    }

    return json(route, wantsObject(request) ? restObject(table, request.url()) : restRows(table, request.url()));
  });

  await page.route("**/api/**", route => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });

    // #1162: viewer-maskerede potentiale-estimater (POST, batched fra useScouting).
    // Egne ryttere = eksakt (lo == hi), andres = usikkert interval.
    if (url.pathname.endsWith("/api/scouting/estimates") && request.method() === "POST") {
      let ids = [];
      try { ids = JSON.parse(request.postData() || "{}").riderIds || []; } catch { /* tom body */ }
      const estimates = {};
      for (const id of ids) {
        const rider = RIDERS.find(r => r.id === id);
        if (!rider) continue;
        estimates[id] = rider.team_id === TEST_TEAM.id
          ? { lo: 4.5, hi: 4.5, exact: true, level: 3 }
          : { lo: 3.5, hi: 5, exact: false, level: 0 };
      }
      return json(route, { teamId: TEST_TEAM.id, maxLevel: 3, estimates });
    }

    if (request.method() !== "GET") return json(route, { ok: true });

    return json(route, apiResponse(url.pathname));
  });
}

export async function login(page) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Cycling Zone" })).toBeVisible();
  await page.getByPlaceholder("din@email.dk").fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: "Log ind" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function stabilizePage(page) {
  await page.addInitScript(() => {
    // Lock Playwright til DA-locale så fixturens hardcoded danske
    // placeholders/button-navne matcher. Uden dette ville i18n-detection
    // falde tilbage til navigator.language → EN (fallbackLng) → fixture
    // ville lede efter "din@email.dk" mens UI rendered "you@email.com".
    window.localStorage.setItem("cz_lang", "da");

    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1,
      necessary: true,
      analytics: false,
      marketing: false,
      email_marketing: false,
      updated_at: "2026-05-13T00:00:00.000Z",
    }));

    const css = `
      *, *::before, *::after {
        animation-duration: 0.001s !important;
        animation-iteration-count: 1 !important;
        caret-color: transparent !important;
        transition-duration: 0s !important;
      }
    `;
    const inject = () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", inject, { once: true });
    } else {
      inject();
    }
  });
}
