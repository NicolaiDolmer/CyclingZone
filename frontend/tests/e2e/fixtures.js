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
  balance: 500000,
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
    contract_length: 2,
    contract_end_season: 4,
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
    // #1529: visningen viser nu CZ-evner — embeddet rider_derived_abilities flades
    // op på rytteren (flattenAbilities) i de migrerede sider. Sprinter-profil.
    rider_derived_abilities: {
      climbing: 52, time_trial: 60, flat: 78, tempo: 64, sprint: 84, acceleration: 80,
      punch: 70, endurance: 66, recovery: 68, durability: 71, descending: 62,
      cobblestone: 58, positioning: 74, aggression: 60, tactics: 67,
    },
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
    salary: 140000,
    contract_length: 3,
    contract_end_season: 4,
    prize_earnings_bonus: 0,
    is_u25: false,
    primary_type: "climber",
    secondary_type: "gc",
    team: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name },
    // #950: parkeret handel → /riders viser "på vej til holdskifte"-chip
    // (→ kommende holdnavn) under nuværende hold. Dækket af riders.png-snapshot.
    pending_team_id: TEST_TEAM.id,
    pending_team: { id: TEST_TEAM.id, name: TEST_TEAM.name },
    // #1529: klatrer-profil (modsat rider-1's sprinter).
    rider_derived_abilities: {
      climbing: 86, time_trial: 72, flat: 55, tempo: 70, sprint: 40, acceleration: 58,
      punch: 74, endurance: 82, recovery: 75, durability: 70, descending: 68,
      cobblestone: 50, positioning: 66, aggression: 64, tactics: 73,
    },
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
    // Egne ryttere = eksakt (lo == hi). #1543: andres = SKJULT indtil scoutet
    // (level 0 → { hidden: true }), så intet gratis lo–hi-spænd vises før et slot
    // er brugt — non-null, så den potentiale-gatede række stadig renderes.
    if (url.pathname.endsWith("/api/scouting/estimates") && request.method() === "POST") {
      let ids = [];
      try { ids = JSON.parse(request.postData() || "{}").riderIds || []; } catch { /* tom body */ }
      const estimates = {};
      for (const id of ids) {
        const rider = RIDERS.find(r => r.id === id);
        if (!rider) continue;
        estimates[id] = rider.team_id === TEST_TEAM.id
          ? { lo: 4.5, hi: 4.5, exact: true, level: 3 }
          : { hidden: true, level: 0 };
      }
      return json(route, { teamId: TEST_TEAM.id, maxLevel: 3, estimates });
    }

    if (request.method() !== "GET") return json(route, { ok: true });

    return json(route, apiResponse(url.pathname));
  });
}

// Tekst-elementer maskeres i pixel-snapshots så testen fanger LAYOUT-regressions
// (cards forsvinder, kolonner kollapser, billeder mangler) uden at fejle på copy-
// eller i18n-ændringer. Indhold valideres via expect-assertions + i18n-key-coverage,
// ikke pixel-diff. Forward-guard mod #412 i18n-snapshot-treadmill — se
// `.claude/learnings/2026-05-17-visual-snapshots-layout-only.md`.
export const TEXT_MASK_SELECTOR =
  "main :is(h1,h2,h3,h4,h5,h6,p,span,a,button,li,td,th,label,time,strong,em,dt,dd)";

export async function waitForStableSnapshotTarget(page) {
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });

  await page.waitForFunction(
    async ({ maskSelector }) => {
      const target = document.querySelector("main");
      if (!target) return false;

      const measure = () => {
        const rect = target.getBoundingClientRect();
        return [
          Math.round(rect.width),
          Math.round(rect.height),
          document.querySelectorAll(maskSelector).length,
        ].join(":");
      };

      let previous = measure();
      let stableFrames = 0;
      while (stableFrames < 4) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const next = measure();
        stableFrames = next === previous ? stableFrames + 1 : 0;
        previous = next;
      }

      return true;
    },
    { maskSelector: TEXT_MASK_SELECTOR },
    { timeout: 3000 }
  );
}

// ── #1272 · Central waitForPageReady-util + per-route readiness-gates ─────────
// Rod-årsag bag snapshot-flakes (postmortems 2026-05-26 + 2026-05-28): generisk
// "heading synlig + main synlig" gate rammer race-vinduer på data-drevne sider —
// screenshot kan lande mid-render (loader stadig synlig, default-filter ikke sat,
// font/mask-target endnu ikke stabilt). waitForPageReady samler ALLE readiness-
// trin ét sted, så nye specs ikke skal genopfinde ad-hoc-waits:
//
//   1. Generisk surface-gate: heading synlig, <main> synlig, ingen VITE-fejl.
//   2. Route-specifik gate (ROUTE_READINESS) for data-drevne sider — venter på
//      den BRUGEROBSERVERBARE sluttilstand fixture-data forventer (loader væk,
//      data loaded, default-filter sat, tom-state synlig).
//   3. Snapshot-overflade-stabilisering (waitForStableSnapshotTarget): fonts.ready
//      + stabil main-geometri + stabil TEXT_MASK_SELECTOR element-count.
//
// Brug: kald waitForPageReady(page, spec) EFTER page.goto(spec.path), FØR
// toHaveScreenshot. `spec.heading` er påkrævet; `spec.ready` (funktion) eller
// `spec.route` (nøgle i ROUTE_READINESS) er valgfri route-specifikke gates.

// Per-route readiness-definitioner. Nøgle = route-path. Hver gate venter på den
// deterministiske mock-sluttilstand for netop den side. Tilføj en entry her når
// en ny data-drevet route adopteres af core-smoke — IKKE spredte inline-waits.
export const ROUTE_READINESS = {
  // #646 + #512: de 2 kendt-flaky routes. Auktioner (desktop + mobile) havde
  // 103k-pixel-diffs fordi snapshot kunne ramme før loader-væk / default-filter.
  "/auctions": async (page) => {
    // Loader væk.
    await expect(page.locator('[role="status"]')).toHaveCount(0);
    // Tab-data loaded ("Aktive (1)" afspejler den ene mockede auktion).
    await expect(page.getByRole("link", { name: /^(Aktive|Active) \(1\)$/ })).toBeVisible();
    // #1569: fladen defaulter nu til 'All'-fanen for nye spillere (tom "My
    // situation"), så de lander på de faktiske auktioner i stedet for en tom
    // fane. 'All (1)'-fanen er aktiv, og listens ene rytter er den endelige
    // render-tilstand (erstatter den gamle "not involved"-tom-state-gate).
    await expect(
      page.getByRole("button", { name: /^(Alle|All) \(1\)$/ })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Mikkel Hansen/ }).first()).toBeVisible();
  },
};

// Samlet readiness-entry. Erstatter den spredte sekvens
// (goto → heading → main → VITE-check → ad-hoc ready → waitForStableSnapshotTarget)
// med ét kald, så snapshot-overfladen er deterministisk inden toHaveScreenshot.
export async function waitForPageReady(page, spec) {
  // 1. Generisk surface-gate.
  if (spec.heading) {
    await expect(page.getByRole("heading", { name: spec.heading }).first()).toBeVisible();
  }
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("VITE_API_URL is not set");

  // 2. Route-specifik gate (inline spec.ready vinder over ROUTE_READINESS-nøglen).
  const routeGate = spec.ready ?? ROUTE_READINESS[spec.route ?? spec.path];
  if (routeGate) await routeGate(page);

  // 3. Snapshot-overflade-stabilisering.
  await waitForStableSnapshotTarget(page);
}

// ── #1076 · Genbrugelig non-baseline board-fixture ────────────────────────────
// Standard-fixturen (apiResponse ovenfor) er baseline-fase → kun observations-
// banneret rendres. Det interaktive board (plan-faner, medlems-grid, DNA,
// konsekvenser, bonus-tilbud, wizard) kræver en non-baseline /api/board/status-
// payload. Denne builder leverer en komplet payload med aktiv 5-årsplan +
// medlemmer + DNA; override felter efter behov (fx active_consequences,
// bonus_offer, auto_accept, plans). Bruges af board-*.spec.js.
export function makeBoardStatus(overrides = {}) {
  return {
    is_baseline_phase: false,
    setup_next_plan_type: null,
    plans: {
      "5yr": {
        board: {
          satisfaction: 72,
          focus: "balanced",
          current_goals: [
            { type: "stage_wins_total", target: 3, label: "Win 3 stages", importance: "required" },
            { type: "relative_rank", target: 5, label: "Top 5 in division" },
          ],
        },
        plan_duration: 5,
        seasons_remaining: 3,
        seasons_completed: 2,
        plan_progress_pct: 40,
        cumulative_stats: { stage_wins: 1, gc_wins: 0 },
        snapshots: [
          { id: "snap-1", season_number: 1, season_within_plan: 1, division_rank: 4, stage_wins: 1, gc_wins: 0, goals_met: 1, goals_total: 2, satisfaction_delta: 5 },
        ],
        is_expired: false,
        renew_locked: false,
        outlook: { goal_evaluations: [{ status: "on_track", actual: 1, target: 3 }, { status: "watch" }] },
        request_status: null,
        request_options: [],
      },
      "3yr": null,
      "1yr": null,
    },
    team: TEST_TEAM,
    riders: RIDERS.filter(rider => rider.team_id === TEST_TEAM.id),
    standing: { division_rank: 3, division_manager_count: 18 },
    identity_profile: {
      primary_specialization_label: "Climbers",
      competitive_tier_label: "Contender",
      summary: "A climbing-focused outfit.",
      squad_limits: { max: 30 },
      star_profile: { label: "One star", star_rider_count: 1 },
    },
    auto_accept: null,
    active_loans_count: 0,
    team_members: [
      {
        archetype_key: "sponsoraten", selection_kind: "identity", alignment_score: 8, is_chairman: true,
        label: "Sponsoraten", emoji: "💰",
        short_description: "Vogter sponsorforhold og økonomisk disciplin",
        long_description: "En lang karakterbeskrivelse af formanden.",
      },
      {
        archetype_key: "talentspejderen", selection_kind: "identity", alignment_score: 6, is_chairman: false,
        label: "Talentspejderen", emoji: "🔭",
        short_description: "Tror på langsigtet ungdomsudvikling",
        long_description: "",
      },
      {
        archetype_key: "gc_elsker", selection_kind: "wildcard", alignment_score: 4, is_chairman: false,
        label: "GC-elsker", emoji: "⛰️",
        short_description: "Tre uger eller intet, Tour er alt",
        long_description: "",
      },
    ],
    active_consequences: [],
    bonus_offer: null,
    team_dna: {
      key: "skandinavisk_udvikling",
      emoji: "🌱",
      label: "Skandinavisk udviklingshold",
      short_description: "Ungdom, balance og nordisk arv",
      long_description: "Klubben bygger på unge ryttere og nordiske værdier.",
      goal_weighting: { u25_development_delta: 1.4, min_national_riders: 1.2, signature_rider: 0.8 },
    },
    dna_suggestions: [],
    ...overrides,
  };
}

// Registrér en override for /api/board/status OVEN PÅ installNetworkMocks
// (senest registrerede route vinder i Playwright). `status` kan være et objekt
// eller en funktion — funktion gør det muligt at mutere payload mellem fetches
// (fx bonus-accept → refetch uden bonus_offer).
export async function installBoardStatusMock(page, status) {
  await page.route("**/api/board/status**", route => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    if (request.method() !== "GET") return route.fallback();
    return json(route, typeof status === "function" ? status() : status);
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
