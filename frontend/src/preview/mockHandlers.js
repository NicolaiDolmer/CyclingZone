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
  SEED_LEAGUE_DIVISIONS,
  SEED_STAGE_PASSAGES,
  SEED_RACE_RESULTS,
  SEED_RACE_INCIDENTS,
  SEED_RACE_STAGE_MOMENTS,
  SEED_RIDER_PALMARES_RESULTS,
  SEED_TEAM_SEASON_STANDINGS,
  SEED_TEAM_HALL_OF_FAME,
  SEED_SEASON_STANDINGS,
  SEED_RIDER_RANKINGS,
  SEED_RIDER_RACE_DAYS,
  SEED_RACE_POINTS,
  SEED_DISTRIBUTION,
  SEED_BROWSE,
  SEED_SELECTION,
  SEED_STRATEGY,
  SEED_ACADEMY,
  SEED_ACADEMY_PNL,
  SEED_CALENDAR,
  SEED_DEVELOPMENT,
  SEED_PROJECTION,
  SEED_MANAGER_TRANSFERS,
  seedManagerAchievements,
  SEED_SEASON_HONOURS,
  SEED_GLOBAL_RANK,
  SEED_GLOBAL_RANK_WEEKLY,
  SEED_GLOBAL_RANK_SEASON_START,
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

// #2863: PostgREST-RPC'er er POST mod /rest/v1/rpc/<navn>. Både preview-mocken
// og Playwright-fixturen svarede før med `{}`/`[]` på ENHVER POST mod /rest/v1,
// hvilket betød at en RPC-drevet flade var usynlig på preview. Returnerer null
// for alt der ikke er en rpc-sti, så kaldere kan falde tilbage til den gamle
// mutations-adfærd uændret.
export function parseRpc(requestUrl) {
  const url = new URL(requestUrl);
  const match = url.pathname.match(/\/rest\/v1\/rpc\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

// undefined = "denne RPC har ingen mock" → kalderen falder tilbage til sin
// eksisterende POST-adfærd. Kun RPC'er der driver en synlig flade seedes her.
export function rpcResponse(name) {
  switch (name) {
    // #2863 sæsonens kåringer på /seasons.
    case "get_season_honours":
      return SEED_SEASON_HONOURS;
    // #3190: løbsdage pr. rytter — Mit Holds Stats-fane.
    case "get_rider_race_days":
      return SEED_RIDER_RACE_DAYS;
    default:
      return undefined;
  }
}

export function restRows(table, requestUrl = "") {
  const url = new URL(requestUrl);
  switch (table) {
    case "users":
      return [{ id: TEST_USER.id, role: "manager", username: "Playwright Manager", login_streak: 3 }];
    case "teams": {
      // #3197: en .eq("user_id", ...).maybeSingle()/.single()-forespørgsel (fx
      // "min egen pulje") skal få NETOP ét hold tilbage. Uden dette filter
      // returnerede mocken altid BEGGE testhold, og postgrest-js's klient-side
      // "forventede 1 række"-tjek kastede en PGRST116-fejl (2 rækker) — .data
      // endte tavst null, og ethvert "egen kontekst"-default (division/pulje)
      // faldt tilbage til "ingen tilknytning" på preview/e2e.
      const idMatch = url.search.match(/user_id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return [TEST_TEAM, RIVAL_TEAM].filter(t => t.user_id === id);
      }
      return [TEST_TEAM, RIVAL_TEAM];
    }
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
      // Ankret på ? eller & med vilje: et uankret /id=eq\./ matcher også inde i
      // "season_id=eq.…", så hubbens sæson-scopede query (#3102 etape 2) blev
      // læst som et opslag på ét løb med sæsonens id og gav tom liste.
      const idMatch = url.search.match(/[?&]id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return SEED_RACES.filter(r => r.id === id);
      }
      // #3102 etape 2: Resultat-hubben henter kun de AFSLUTTEDE løb
      // (status=eq.completed). Uden filteret her ville hubben også vise det
      // kommende og det igangværende løb, som i prod aldrig ville nå frem.
      if (url.search.includes("status=eq.completed")) {
        return SEED_RACES.filter(r => r.status === "completed");
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
      // #3197: Resultat-hubbens "seneste"-kort henter afviklingsdatoen for FLERE
      // løb i ét kald (race_id=in.(a,b,c)), samme mønster som race_results ovenfor.
      const inMatch = decodeURIComponent(url.search).match(/race_id=in\.\(([^)]*)\)/);
      if (inMatch) {
        const ids = new Set(inMatch[1].split(",").map(s => s.trim().replace(/^"|"$/g, "")));
        return SEED_STAGE_SCHEDULE.filter(s => ids.has(s.race_id));
      }
      return SEED_STAGE_SCHEDULE;
    }
    // #3197: Resultat-/Standings-/Kalender-fladens sæson/division/pulje-vælgere.
    case "league_divisions":
      return SEED_LEAGUE_DIVISIONS;
    // Sub-4 (#2448): KOM/mellemsprint/mål-passager. Samme race_id=eq-scoping som
    // race_stage_profiles ovenfor — RaceDetailPage henter med .eq("race_id", raceId)
    // (RaceDetailPage.jsx:254-264) og filtrerer selv videre på stage_number/
    // waypoint_kind/waypoint_index (raceStagePassages.js).
    case "race_stage_passages": {
      const idMatch = url.search.match(/race_id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return SEED_STAGE_PASSAGES.filter(p => p.race_id === id);
      }
      return SEED_STAGE_PASSAGES;
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
      // #3102 etape 2: Resultat-hubben henter podiet for FLERE løb i ét kald
      // (race_id=in.(a,b,c) + rank≤3). Uden denne gren faldt den igennem til []
      // nedenfor, så hvert løbskort viste "ingen klassement" på preview.
      // supabase-js URL-koder parenteserne i in.(…), så matchet sker mod den
      // dekodede søgestreng — ikke url.search som den står.
      const inMatch = decodeURIComponent(url.search).match(/race_id=in\.\(([^)]*)\)/);
      if (inMatch) {
        const ids = new Set(
          inMatch[1].split(",").map(s => s.trim().replace(/^"|"$/g, ""))
        );
        const maxRank = Number(url.search.match(/rank=lte\.(\d+)/)?.[1] ?? Infinity);
        return SEED_RACE_RESULTS.filter(r => ids.has(r.race_id) && (r.rank ?? 0) <= maxRank);
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
    // S6 (#2355): race_stage_moments (why-rapport + story-tags). Samme scoping/
    // graceful-degradation-mønster som race_incidents ovenfor.
    case "race_stage_moments": {
      const idMatch = url.search.match(/race_id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return SEED_RACE_STAGE_MOMENTS.filter(m => m.race_id === id);
      }
      return [];
    }
    // #1997 holdside-slice: team-scopet query (TeamPalmaresTab: team_id=eq.<id>)
    // får sæson-historik-seedet. KUN TEST_TEAM har seedede standings — andre
    // hold (fx RIVAL_TEAM) ser den tilsigtede tomme tilstand.
    case "season_standings": {
      const idMatch = url.search.match(/team_id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return id === TEST_TEAM.id ? SEED_TEAM_SEASON_STANDINGS : [];
      }
      // #3102 etape 2: den sæson-scopede query (Resultat-hubbens tophold-boks).
      // Lå før i default-grenen og gav [], så boksen aldrig kunne ses på preview.
      if (url.search.includes("season_id=eq.")) return SEED_SEASON_STANDINGS;
      return [];
    }
    // #3102 etape 2: rider_rankings_mv (hubbens topscorere + RiderRankingsPage).
    case "rider_rankings_mv":
      return SEED_RIDER_RANKINGS;
    // #2792/#3193: global_rank_mv — matview'et filtrerer AI-hold fra (se
    // seedData.js-kommentaren), så preview'et spejler den faktiske post-fix
    // kontrakt. team_id-scopet for GlobalRankWidget/TeamProfilePage
    // (.eq("team_id", id).maybeSingle()); uscopet for GlobalRankPage
    // (.select("*").order("global_rank")).
    case "global_rank_mv": {
      const idMatch = url.search.match(/team_id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return SEED_GLOBAL_RANK.filter(r => r.team_id === id);
      }
      return SEED_GLOBAL_RANK;
    }
    case "global_rank_weekly_snapshot": {
      const idMatch = url.search.match(/team_id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return SEED_GLOBAL_RANK_WEEKLY.filter(r => r.team_id === id);
      }
      return SEED_GLOBAL_RANK_WEEKLY;
    }
    case "global_rank_season_start_snapshot":
      return SEED_GLOBAL_RANK_SEASON_START;
    // #3102 etape 2: pointtabellen bag Point & præmier-fanen.
    case "race_points":
      return SEED_RACE_POINTS;
    case "hall_of_fame": {
      const idMatch = url.search.match(/team_id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return id === TEST_TEAM.id ? SEED_TEAM_HALL_OF_FAME : [];
      }
      return SEED_TEAM_HALL_OF_FAME;
    }
    case "auction_proxy_bids":
    case "finance_transactions":
    case "notifications":
    case "player_events":
    case "rider_watchlist":
    case "roadmap_votes":
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

// #2917 · GET /api/managers/:teamId — manglede helt, så ManagerProfilePage kollapsede
// til sin fejl-tilstand på preview og kunne ikke klik-testes før noget gik live.
// Kontrakten spejler routes/api.js: team/user/riders/season_history/achievements/
// transfer_activity, med redigerede hemmeligheder (#1666) og progress (#1008).
//
// Rival-holdet er bevidst uden oplåste achievements — det er den eneste vej til at
// se tomtilstanden på "Senest låst op" uden at rode i data.
export function managerProfile(teamId) {
  const isRival = teamId === RIVAL_TEAM.id;
  const team = isRival ? RIVAL_TEAM : TEST_TEAM;
  return {
    team: { id: team.id, name: team.name, division: team.division },
    user: {
      id: team.user_id,
      username: team.manager_name,
      last_seen: isRival ? "2026-07-24T19:00:00.000Z" : "2026-07-25T20:55:00.000Z",
      login_streak: isRival ? 1 : 9,
      is_online: !isRival,
    },
    riders: RIDERS.filter((rider) => rider.team_id === team.id),
    season_history: SEED_TEAM_SEASON_STANDINGS.filter((row) => row.team_id === team.id),
    achievements: seedManagerAchievements({ unlocked: !isRival }),
    transfer_activity: isRival ? [] : SEED_MANAGER_TRANSFERS,
  };
}

// `search` er valgfri (default "") så eksisterende kaldesteder — Playwright-
// fixtures og de øvrige preview-ruter — er uændrede. Kun ruter der faktisk
// filtrerer server-side (feedback-indbakken) læser den.
export function apiResponse(pathname, search = "") {
  // Før de generiske endsWith-grene: managerprofilen bærer et id i pathen.
  const managerMatch = pathname.match(/\/api\/managers\/([^/]+)$/);
  if (managerMatch) return managerProfile(decodeURIComponent(managerMatch[1]));

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

  // Finance → Sponsor-fanen (SponsorContractPanel + SponsorIncomeBreakdown).
  // "results"-arketypen med BEGGE bonusklausuler + et loft, og 3 løbsdage
  // (> 2 = trigger "Vis alle N løb"), så ejer-gennemklik viser ALLE elementer:
  // fast base, flere løbsdags-rækker, bonus-split (kombineret win+podium-
  // transaktion demonstrerer den proportionale opdeling), loft-linjen og
  // den fulde bund-forklaring.
  if (pathname.endsWith("/api/sponsor/contract")) {
    const contract = {
      id: "sponsor-preview-1",
      team_id: TEST_TEAM.id,
      sponsor_name: "Vesna Robotics",
      guaranteed_base: 180000,
      per_race_day_rate: 450,
      length_seasons: 2,
      start_season: 2,
      expires_after_season: 3,
      status: "active",
      variant: "results",
      bonus_clauses: [
        { type: "stage_win", amount: 8000 },
        { type: "podium", amount: 3500 },
        { type: "results_cap", amount: 50000 },
      ],
      results_bonus_paid: 15000,
      created_at: "2026-07-01T08:00:00.000Z",
    };
    return {
      contract,
      earnings: { base: 180000, signing: 5000, raceDays: 3150, results: 15000, objective: 0, total: 203150 },
      season: {
        number: 2,
        transactions: [
          { id: "tx-base", type: "sponsor", amount: 180000, description: "Sponsor season base", metadata: null, createdAt: "2026-07-01T08:00:00.000Z", raceId: null, raceName: null },
          { id: "tx-signing", type: "sponsor_signing_bonus", amount: 5000, description: "Sponsor — signing bonus (Vesna Robotics)", metadata: { code: "tx.sponsor.signingBonus", params: { sponsorName: "Vesna Robotics" } }, createdAt: "2026-07-01T08:00:01.000Z", raceId: null, raceName: null },
          { id: "tx-rd-1", type: "sponsor_race_day", amount: 1350, description: "Sponsor — race-day income", metadata: null, createdAt: "2026-07-10T18:00:00.000Z", raceId: "wp-1", raceName: "Tour de Preview" },
          { id: "tx-rd-2", type: "sponsor_race_day", amount: 1350, description: "Sponsor — race-day income", metadata: null, createdAt: "2026-07-20T18:00:00.000Z", raceId: "wp-2", raceName: "Giro di Preview" },
          { id: "tx-rd-3", type: "sponsor_race_day", amount: 450, description: "Sponsor — race-day income", metadata: null, createdAt: "2026-07-25T18:00:00.000Z", raceId: "wp-3", raceName: "Omloop Preview" },
          { id: "tx-bonus-1", type: "sponsor_result_bonus", amount: 11500, description: "Sponsor — result bonus (1 wins, 1 podiums)", metadata: { code: "tx.sponsor.resultBonus", params: { wins: 1, podiums: 1 } }, createdAt: "2026-07-25T18:05:00.000Z", raceId: "wp-3", raceName: "Omloop Preview" },
          { id: "tx-bonus-2", type: "sponsor_result_bonus", amount: 3500, description: "Sponsor — result bonus (0 wins, 1 podiums)", metadata: { code: "tx.sponsor.resultBonus", params: { wins: 0, podiums: 1 } }, createdAt: "2026-07-20T18:05:00.000Z", raceId: "wp-2", raceName: "Giro di Preview" },
        ],
      },
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
  // NB: i preview-interceptoren (installPreviewMock) fanges /api/me/onboarding-
  // progress + /api/training/me af #2819-blokken FØR denne linje, så onboarding-
  // kortet har rigtige trin og /training har en roster at vise touren på. Denne
  // tomme variant rammes kun af Playwright-fixtures, hvor kortet bevidst forbliver
  // skjult så dashboard-snapshots ikke ændrer sig (samme lagdeling som scouting
  // nedenfor). Formen her er historisk og læses ikke af nogen komponent.
  if (pathname.endsWith("/api/me/onboarding-progress")) {
    return { steps: [], completed_steps: [], completion_pct: 0 };
  }
  // Fake sequential placeholder ID (not a secret; Discord client IDs are public) so the preview shows the connected DM-settings state.
  if (pathname.endsWith("/api/me/discord-status")) return { discord_id: "123456789012345678", dm_enabled: true, dm_prefs: { board_update: false }, bot_configured: true }; // gitleaks:allow
  // #3102 etape 3: verdens-kataloget bor i Resultat-hubbens Arkiv-fane nu.
  // Returnerede før en tom liste med forkert shape ({pool, summary} forventes)
  // → fladen så død ud på preview. Lille men ægte pulje, så ejer-gennemklik
  // viser klasse-summering + filter + tabellen.
  if (pathname.endsWith("/api/race-pool")) {
    return {
      pool: [
        { id: "wp-1", name: "Tour de Preview", race_class: "TourFrance", race_type: "stage_race", stages: 3 },
        { id: "wp-2", name: "Giro di Preview", race_class: "GiroVuelta", race_type: "stage_race", stages: 3 },
        { id: "wp-3", name: "Omloop Preview", race_class: "ProSeries", race_type: "single", stages: 1 },
        { id: "wp-4", name: "Critérium Preview", race_class: "ProSeries", race_type: "single", stages: 1 },
        { id: "wp-5", name: "Klassiker Preview", race_class: "Class1", race_type: "single", stages: 1 },
      ],
      summary: {
        TourFrance: { count: 1, raceDays: 3 },
        GiroVuelta: { count: 1, raceDays: 3 },
        ProSeries: { count: 2, raceDays: 2 },
        Class1: { count: 1, raceDays: 1 },
      },
    };
  }
  // Race-hub (#prelive-harness, A2): board-aggregat + strategi-flade.
  // S6 (#1835): read-only "andre divisioner"-browse. Tjekkes FØR distribution (mere
  // specifik path) — selvom endsWith ikke ville krydse, holder rækkefølgen den tydelig.
  if (pathname.endsWith("/api/races/calendar")) return SEED_CALENDAR;
  if (pathname.endsWith("/api/races/distribution/browse")) return SEED_BROWSE;
  if (pathname.endsWith("/api/races/distribution")) return SEED_DISTRIBUTION;
  if (pathname.endsWith("/api/races/strategy")) return SEED_STRATEGY;
  // S5: udtagelses-panel (RaceSelectionPanel + HunterExplainer). /api/races/:id/selection.
  if (/\/api\/races\/[^/]+\/selection$/.test(pathname)) return SEED_SELECTION;
  // NB: i preview-interceptoren (installPreviewMock) fanges /api/scouting/me af
  // scoutingMock.js FØR denne blok (med scoutSystemEnabled: true, så Scouting-
  // centralen kan klikkes igennem). Denne variant — uden flag — rammes kun af
  // Playwright-fixtures (fixtures.js kalder apiResponse direkte), hvor centralen
  // bevidst forbliver gated så nav-snapshots ikke ændrer sig.
  if (pathname.endsWith("/api/scouting/me")) {
    // BEVIDST uden scoutSystemEnabled her (jf. kommentaren ovenfor): live preview
    // får flaget fra scoutingMock.js; fixtures forbliver gated (nav-snapshots).
    return { slots: { total: 3, used: 0, remaining: 3 }, maxLevel: 3, levels: {}, teamId: TEST_TEAM.id };
  }
  // #2644 del 2: Scouting-centralens state — spejder, aktive/afsluttede opgaver,
  // kapacitet, jobConfig (priser/varigheder til MissionForm). Tom kø som default;
  // dækker targeting-valg-kortenes visning + form-submit-flow i preview.
  if (pathname.endsWith("/api/scouting/central")) {
    return {
      scout: { overall: 40, roleSkills: { evaluation: 40, reach: 40 }, isDefault: true },
      active: [],
      completed: [],
      capacity: 1,
      jobConfig: { targetEtaMinutes: 30, targetCostPerLevel: 1000, missionDays: 2, missionCost: 6000 },
    };
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
    // #2886: sæson-historik + akkumulerede totaler. Afledt af seedet (ikke
    // hardkodet), så preview og prod svarer på samme regnestykke: point/præmie
    // = SUM over ALLE holdets rækker i løbet, best_rank = bedste rytter-rang i
    // gc/stage. Seedet har kun to gennemførte løb, så "Vis alle N"-knappen
    // (>5 tidligere løb) ses først i prod. Det viste løb filtreres fra, præcis
    // som backend gør.
    const seasonRaces = SEED_RACES
      .filter((ra) => ra.status === "completed")
      .map((ra) => {
        const mine = SEED_RACE_RESULTS.filter(
          (r) => r.race_id === ra.id && r.team_id === TEST_TEAM.id
        );
        const ranked = mine
          .filter((r) => r.rider_id && r.rank != null && ["gc", "stage"].includes(r.result_type))
          .map((r) => r.rank);
        return {
          race_id: ra.id,
          name: ra.name,
          race_type: ra.race_type,
          stages: ra.stages,
          best_rank: ranked.length ? Math.min(...ranked) : null,
          points: mine.reduce((s, r) => s + (r.points_earned || 0), 0),
          prize_money: mine.reduce((s, r) => s + (r.prize_money || 0), 0),
        };
      })
      .filter((r) => r.points > 0 || r.prize_money > 0);
    return {
      // seen:false — #2593 (del 2): matcher det ægte endpoints kontrakt (server-side
      // seen-flag i samme payload). false lader preview'ens "Nyt"-badge vises som
      // forventet ved gennemklik; POST /seen rammer den generiske "ok:true"-mock.
      race: { id: "race-done-2", name: "Giro di Preview", race_type: "stage_race", stages: 2, last_import: "2026-06-30T15:00:00.000Z", seen: false },
      placements: [
        { rider_id: RIDERS[0].id, firstname: "Ada", lastname: "Pedersen", rider_name: "Ada Pedersen", nationality_code: "dk", rank: 2, finish_time: "+0:22", points_earned: 40 },
      ],
      stage_wins: 1,
      totals: { points: 80, prize_money: 194000 },
      history: seasonRaces.filter((r) => r.race_id !== "race-done-2"),
      season_totals: {
        points: seasonRaces.reduce((s, r) => s + r.points, 0),
        prize_money: seasonRaces.reduce((s, r) => s + r.prize_money, 0),
        races: seasonRaces.length,
      },
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

  // #2842 admin-feedback-indbakke. Uden en seed her ville fladen stå tom på
  // preview, og ejeren kunne ikke se den før den var live (det har bidt før).
  // Indholdet er OPDIGTET — ægte indsendelser er fritekst fra spillere og hører
  // ikke til i et committed seed.
  if (pathname.endsWith("/api/admin/feedback")) return feedbackInboxResponse(search);

  return {};
}

// Filtrerer på status/kategori som den ægte route gør, så preview-fladen ikke
// viser "Nye 1" ved siden af tre rækker.
function feedbackInboxResponse(search) {
  const params = new URLSearchParams(search || "");
  const status = params.get("status");
  const category = params.get("category");
  const items = SEED_FEEDBACK_INBOX.items.filter(
    (i) => (!status || i.status === status) && (!category || i.category === category)
  );
  return { ...SEED_FEEDBACK_INBOX, items };
}

// Bevidst kun ét "svaret"-eksempel, så både den ubesvarede og den besvarede
// tilstand er synlig i preview uden at man skal skifte filter.
const SEED_FEEDBACK_INBOX = {
  items: [
    {
      id: "fb-3", seq: 3, created_at: "2026-07-25T18:42:00.000Z",
      category: "bug", status: "new",
      message: "The transfer summary says cash payment positive means I receive money, but my balance went down after I accepted an offer. Either the label is backwards or the payment is.",
      page_path: "/transfers", viewport: "1440x900",
      reply_message: null, replied_at: null,
      user: { id: "u-3", username: "Bergfahrer", email: "bergfahrer@example.com" },
      team: { id: "team-3", name: "Alpenwerk Pro" },
    },
    {
      id: "fb-2", seq: 2, created_at: "2026-07-24T09:15:00.000Z",
      category: "idea", status: "in_progress",
      message: "Would love to be able to compare two riders side by side before bidding. Right now I have to open two tabs and flip between them during the auction.",
      page_path: "/auctions", viewport: "390x844",
      reply_message: null, replied_at: null,
      user: { id: "u-2", username: "Domestique", email: "domestique@example.com" },
      team: { id: "team-2", name: "Nordkap Cycling" },
    },
    {
      id: "fb-1", seq: 1, created_at: "2026-07-22T20:03:00.000Z",
      category: "feedback", status: "closed",
      message: "Really enjoying the season calendar. One thing: the race list does not make it obvious which races my riders are already entered in.",
      page_path: "/races", viewport: "1280x800",
      reply_message: "Good catch. Entered races now show a jersey marker in the race list, shipping with this week's patch.",
      replied_at: "2026-07-23T07:30:00.000Z",
      user: { id: "u-1", username: "Rouleur", email: "rouleur@example.com" },
      team: null,
    },
  ],
  next_cursor: null,
  limit: 25,
  counts: { new: 1, in_progress: 1, closed: 1, total: 3 },
};
