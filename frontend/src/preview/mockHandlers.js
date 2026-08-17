// Rene matchers — delt mellem Playwright-fixtures (frontend/tests/e2e/fixtures.js)
// OG runtime-preview-mocken (installPreviewMock.js). Ingen route/@playwright/test-
// referencer (CORS/fulfill bliver i fixtures.js). Datakilden er seedData.js, så
// begge konsumenter serverer præcis det samme.
import { previewPlannerBoard } from "./plannerMock.js";
import { raceHasReportableResults } from "../lib/raceResultVisibility.js";
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
  SEED_RACE_ENTRIES,
  SEED_STAGE_PROFILES,
  SEED_STAGE_SCHEDULE,
  SEED_LEAGUE_DIVISIONS,
  SEED_STAGE_PASSAGES,
  SEED_RACE_RESULTS,
  SEED_RACE_INCIDENTS,
  SEED_RACE_STAGE_MOMENTS,
  SEED_RIDER_CAREER_EVENTS,
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
  SEED_SCOUTING_REPORT,
  SEED_MANAGER_TRANSFERS,
  SEED_TRANSFER_HISTORY,
  seedManagerAchievements,
  SEED_SEASON_HONOURS,
  SEED_GLOBAL_RANK,
  SEED_GLOBAL_RANK_WEEKLY,
  SEED_GLOBAL_RANK_SEASON_START,
  COMPLETED_AUCTIONS,
  COMPLETED_AUCTION_BIDS,
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
    case "riders": {
      if (url.search.includes("pending_team_id=eq.")) return [];
      // #3667: en .eq("id", riderId)-forespørgsel (rytterprofilen) blev IKKE
      // filtreret — mocken faldt igennem til hele RIDERS, og restObject tog
      // [0]. Enhver /riders/<id> viste derfor rider-1, uanset id'et i URL'en.
      // Konsekvensen var falsk grønt: en spec der troede den så på en RIVAL-
      // rytter (fx "potentiale er skjult indtil du scouter ham") så i
      // virkeligheden på ens egen, og ville blive grøn selv hvis skjulningen
      // gik i stykker. Samme rod-årsag og samme rettelse som `teams` ovenfor.
      // Ukendt id → tom liste, så profilen rammer sin "ikke fundet"-gren i
      // stedet for tavst at vise en tilfældig anden rytter.
      const idEq = url.search.match(/[?&]id=eq\.([^&]+)/);
      if (idEq) {
        const id = decodeURIComponent(idEq[1]);
        return RIDERS.filter(rider => rider.id === id);
      }
      const idIn = decodeURIComponent(url.search).match(/[?&]id=in\.\(([^)]*)\)/);
      if (idIn) {
        const ids = new Set(idIn[1].split(",").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean));
        return RIDERS.filter(rider => ids.has(rider.id));
      }
      if (url.search.includes("team_id=eq.team-e2e")) {
        return RIDERS.filter(rider => rider.team_id === TEST_TEAM.id);
      }
      return RIDERS;
    }
    // #3666: mocken havde INGEN handler for denne tabel, så rytterprofilens
    // evner altid var tomme på preview ("Evner endnu ikke beregnet"). Det
    // betød at rating-pladen, ryttertype-radaren og Fysiologi-fanen aldrig
    // kunne ses på preview — netop de flader omlægningen ændrer, og netop den
    // fejlklasse der har bidt før (ejeren skal kunne teste FØR live).
    // Evnerne ligger allerede embeddet på RIDERS; her serveres de som den
    // selvstændige tabel siden faktisk forespørger.
    case "rider_derived_abilities": {
      const rows = RIDERS
        .filter((r) => r.rider_derived_abilities)
        .map((r) => ({ rider_id: r.id, formula_version: 2, ...r.rider_derived_abilities }));
      const idMatch = url.search.match(/rider_id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return rows.filter((row) => row.rider_id === id);
      }
      return rows;
    }
    case "auctions":
      // #3401: AuctionHistoryPage forespørger .eq("status","completed") —
      // AuctionsPage's aktive liste (.in("status",["active","extended"])) skal
      // IKKE se den afsluttede budkrig-fixture (ville forstyrre core-smoke's
      // "Aktive (1)"-readiness-gate for /auctions).
      if (url.search.includes("status=eq.completed")) return COMPLETED_AUCTIONS;
      return AUCTIONS;
    case "auction_bids": {
      // #3401: post-hammerslag-reveal. loadBidStats (AuctionHistoryPage) bruger
      // .in("auction_id", [...]) for aggregat-tal; openBidWar bruger
      // .eq("auction_id", id) for den fulde historik med holdnavne. auction_bids
      // er den eneste kilde — auction_proxy_bids (loftet) forbliver tom herunder,
      // ligesom i prod-RLS (kun ejer-teamet kan læse egne proxy-rækker).
      const eqMatch = url.search.match(/auction_id=eq\.([^&]+)/);
      if (eqMatch) {
        const id = decodeURIComponent(eqMatch[1]);
        return COMPLETED_AUCTION_BIDS.filter(b => b.auction_id === id);
      }
      const inMatch = decodeURIComponent(url.search).match(/auction_id=in\.\(([^)]*)\)/);
      if (inMatch) {
        const ids = new Set(inMatch[1].split(",").map(s => s.trim().replace(/^"|"$/g, "")));
        return COMPLETED_AUCTION_BIDS.filter(b => ids.has(b.auction_id));
      }
      return [];
    }
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
      // #3333: Resultat-hubben henter nu status=completed ELLER igangværende
      // etapeløb (.or("status.eq.completed,stages_completed.gt.0")) — status
      // alene er IKKE en pålidelig "afsluttet"-markør (raceResultVisibility.js).
      // Matcher den nye .or(...)-formede query-streng (postgrest lægger den i et
      // uafkodet or=(…)-param, derfor decodeURIComponent). Falder tilbage til det
      // gamle rene status=eq.completed-mønster hvis en fremtidig kalder bruger det.
      const decodedSearch = decodeURIComponent(url.search);
      if (decodedSearch.includes("or=(status.eq.completed") && decodedSearch.includes("stages_completed.gt.0")) {
        return SEED_RACES.filter(raceHasReportableResults);
      }
      if (url.search.includes("status=eq.completed")) {
        return SEED_RACES.filter(r => r.status === "completed");
      }
      return SEED_RACES;
    }
    // #3751 — Dashboardets "Kommende løb"-kort filtrerer nu på holdets egne
    // race_entries (filterTeamEnteredRaces). team_id=eq er den eneste form
    // Dashboard bruger (ét hold ad gangen); ubetinget spørgsmål falder tilbage
    // til hele seedet, samme mønster som "races" ovenfor.
    case "race_entries": {
      const teamIdMatch = url.search.match(/team_id=eq\.([^&]+)/);
      if (teamIdMatch) {
        const teamId = decodeURIComponent(teamIdMatch[1]);
        return SEED_RACE_ENTRIES.filter(e => e.team_id === teamId);
      }
      return SEED_RACE_ENTRIES;
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
    // #3398 (Maiden Win Engine): rider_career_events — TRE forbrugere af samme
    // tabel (dashboard/MaidenWinMomentCard: team_id=eq.<id>, RaceDetailPage:
    // race_id=eq.<id>, RiderPalmaresTab: rider_id=eq.<id>). Tjekkes i den
    // rækkefølge query-strengen realistisk kan indeholde dem.
    case "rider_career_events": {
      const teamMatch = url.search.match(/team_id=eq\.([^&]+)/);
      if (teamMatch) {
        const id = decodeURIComponent(teamMatch[1]);
        return SEED_RIDER_CAREER_EVENTS.filter(e => e.team_id === id);
      }
      const raceMatch = url.search.match(/race_id=eq\.([^&]+)/);
      if (raceMatch) {
        const id = decodeURIComponent(raceMatch[1]);
        return SEED_RIDER_CAREER_EVENTS.filter(e => e.race_id === id);
      }
      const riderMatch = url.search.match(/rider_id=eq\.([^&]+)/);
      if (riderMatch) {
        const id = decodeURIComponent(riderMatch[1]);
        return SEED_RIDER_CAREER_EVENTS.filter(e => e.rider_id === id);
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

// #3199 — forum-seed til preview/Playwright. Pinned ejer-opslag med poll +
// almindelige spiller-opslag, samme shape som backend/lib/forum.js serverer.
const FORUM_AUTHOR_OWNER = { username: "dolmer", team_name: null };
const FORUM_POSTS = [
  {
    id: "forum-pinned-1",
    seq: 4,
    created_at: "2026-08-05T09:00:00Z",
    category: "feedback_ideas",
    title: "Which feature should we build next?",
    excerpt: "Vote below. I read everything in here, so add a reply if your favourite is missing.",
    body: "Vote below. I read everything in here, so add a reply if your favourite is missing.",
    is_pinned: true,
    reply_count: 2,
    last_reply_at: "2026-08-06T07:20:00Z",
    has_poll: true,
    author: FORUM_AUTHOR_OWNER,
  },
  {
    id: "forum-post-2",
    seq: 3,
    created_at: "2026-08-05T18:45:00Z",
    category: "general",
    title: "Anyone else saving their sprinters for Deadline Day?",
    excerpt: "My squad is thin on climbers, but the auction prices this week are brutal.",
    body: "My squad is thin on climbers, but the auction prices this week are brutal. How are you all planning the last week of the transfer window?",
    is_pinned: false,
    reply_count: 3,
    last_reply_at: "2026-08-06T06:10:00Z",
    has_poll: false,
    author: { username: "peloton_pete", team_name: "Thunder Cycling" },
  },
  {
    id: "forum-post-3",
    seq: 2,
    created_at: "2026-08-04T14:30:00Z",
    category: "feedback_ideas",
    title: "Idea: show rival tactics after the race",
    excerpt: "It would help new managers learn if we could see what tactics the podium teams used.",
    body: "It would help new managers learn if we could see what tactics the podium teams used once a race is finished.",
    is_pinned: false,
    reply_count: 1,
    last_reply_at: "2026-08-05T08:00:00Z",
    has_poll: false,
    author: { username: "sofie_r", team_name: "Nordjysk CC" },
  },
  {
    id: "forum-post-4",
    seq: 1,
    created_at: "2026-08-03T10:15:00Z",
    category: "general",
    title: "Welcome new managers from the open beta wave",
    excerpt: "Say hi and tell us where your club is from.",
    body: "Say hi and tell us where your club is from.",
    is_pinned: false,
    reply_count: 0,
    last_reply_at: null,
    has_poll: false,
    author: { username: "e2e", team_name: "E2E Racing" },
  },
];

export function forumPostDetail(postId) {
  const post = FORUM_POSTS.find((p) => p.id === postId) || FORUM_POSTS[0];
  return {
    post: { ...post, is_mine: post.author.username === "e2e" },
    replies: post.id !== "forum-post-4" ? [
      {
        id: `${post.id}-r1`,
        seq: 1,
        created_at: "2026-08-05T21:05:00Z",
        body: "Great initiative. My vote went to race replays, the finale deserves it.",
        author: { username: "peloton_pete", team_name: "Thunder Cycling" },
        is_mine: false,
      },
      {
        id: `${post.id}-r2`,
        seq: 2,
        created_at: "2026-08-06T07:20:00Z",
        body: "Agreed, and thanks for asking us directly in the game instead of only on Discord.",
        author: { username: "sofie_r", team_name: "Nordjysk CC" },
        is_mine: false,
      },
    ] : [],
    poll: post.has_poll ? {
      total_votes: 23,
      my_option_id: null,
      options: [
        { id: "opt-1", idx: 0, label: "Race replays", votes: 11 },
        { id: "opt-2", idx: 1, label: "Team chemistry", votes: 7 },
        { id: "opt-3", idx: 2, label: "Historical stats hub", votes: 5 },
      ],
    } : null,
  };
}

// `search` er valgfri (default "") så eksisterende kaldesteder — Playwright-
// fixtures og de øvrige preview-ruter — er uændrede. Kun ruter der faktisk
// filtrerer server-side (feedback-indbakken) læser den.
export function apiResponse(pathname, search = "") {
  // Før de generiske endsWith-grene: managerprofilen bærer et id i pathen.
  const managerMatch = pathname.match(/\/api\/managers\/([^/]+)$/);
  if (managerMatch) return managerProfile(decodeURIComponent(managerMatch[1]));

  // #3199: forum-liste + tråd-detalje.
  const forumPostMatch = pathname.match(/\/api\/forum\/posts\/([^/]+)$/);
  if (forumPostMatch) return forumPostDetail(decodeURIComponent(forumPostMatch[1]));
  if (pathname.endsWith("/api/forum/posts")) {
    const category = new URLSearchParams(search).get("category");
    const visible = FORUM_POSTS.filter((p) => !category || p.category === category);
    return {
      pinned: visible.filter((p) => p.is_pinned),
      items: visible.filter((p) => !p.is_pinned),
      next_cursor: null,
      limit: 25,
    };
  }

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

  // #3621: payloaden matcher nu computeFinanceForecast's faktiske felter. Den
  // gamle mock brugte navne endpointet aldrig har returneret (sponsor_income,
  // salary_cost, prize_estimate), så FinanceForecastCard rendrede en tom
  // pladsholder i hver række og faldt tilbage til sponsorDetail.fallback.
  // Prognose-kortet kunne altså slet ikke gennemklikkes på preview.
  // Tallene er sammenhængende med preview-holdet: division 2 (upkeep
  // 140.000), ingen lån, og samme kontrakt som /api/sponsor/contract nedenfor
  // (Vesna Robotics, garanteret base 180.000, start sæson 2). Preview-sæsonen
  // er nr. 1, så prognosen gælder sæson 2, og næste sæsons sponsor er her den
  // samme som den nuværende.
  if (pathname.endsWith("/api/me/finance-forecast")) {
    const forecast = {
      projected_sponsor: 180000,
      projected_prize: 210000,
      projected_salary: -180000,
      projected_loan_interest: 0,
      projected_upkeep: -140000,
      projected_facility_upkeep: 0,
      projected_staff_salary: 0,
      projected_academy_drift: 0,
      projected_net: 70000,
      confidence_low: 28000,
      confidence_high: 112000,
      risk_tier: "green",
      warnings: [],
      inputs: {
        sponsor_base: 180000,
        sponsor_variable: 0,
        sponsor_mode: "contract",
        sponsor_gross: 180000,
        sponsor_breakdown: {
          mode: "contract",
          season_number: 2,
          base: 180000,
          variable: 0,
          gross_sponsor: 180000,
          capped: false,
          per_race_day_rate: 450,
          sponsor_name: "Vesna Robotics",
        },
        board_modifier: 1.0,
        pullout_factor: 1.0,
        prize_basis: "rolling_avg",
        current_season_number: 1,
        target_season_number: 2,
      },
    };
    return {
      ...forecast,
      season_number: 2,
      is_estimate: false,
      estimate_basis: "actual_state",
      starting_balance: 500000,
      ending_balance: 570000,
      forecasts: [
        {
          ...forecast,
          season_number: 2,
          is_estimate: false,
          estimate_basis: "actual_state",
          starting_balance: 500000,
          ending_balance: 570000,
        },
      ],
      summary: {
        from_season: 2,
        to_season: 2,
        total_net: 70000,
        ending_balance: 570000,
        worst_risk_tier: "green",
      },
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

  // #2400: teamets egen transferhistorik (TeamTransferHistoryTab). Skal ligge
  // FØR de generiske /api/transfers*-grene nedenfor (disjunkt sti, men holder
  // rækkefølgen eksplicit robust hvis stien ændrer sig).
  if (pathname.match(/\/api\/teams\/[^/]+\/transfer-history$/)) return SEED_TRANSFER_HISTORY;
  if (pathname.endsWith("/api/online-count")) return { count: 1 };
  if (pathname.endsWith("/api/notifications")) return [];
  // #2884: skal ligge FØR /api/auctions — endsWith("/api/auctions") ville ellers
  // ikke fange den, men rækkefølgen holder de to adskilte hvis stien ændrer sig.
  // Spejler prod-vinduet (08-24) så sluttidspunkt-vælgeren kan testes på preview.
  if (pathname.endsWith("/api/auctions/window")) {
    return {
      weekday_open_hour: 8, weekday_close_hour: 24,
      weekend_open_hour: 8, weekend_close_hour: 24,
      min_hours: 1, max_hours: 48, timezone: "Europe/Copenhagen",
    };
  }
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

  // #3334: Scouting-fanens rapport — provenance (navngiven scout + tier) +
  // loft-bånd. Tjekkes FØR /scouting (disjunkt endsWith, samme mønster som
  // projection/development ovenfor).
  //
  // #3667: rapporten var id-blind og gav SEED_SCOUTING_REPORT (own: true, fuldt
  // bånd) for ENHVER rytter — også rivaler. Det kunne ikke ses før rytter-id-
  // filteret i restRows blev rettet i samme PR, fordi hver /riders/<id> alligevel
  // landede på ens egen rytter. Nu hvor en rival faktisk kan naas, skal mocken
  // spejle #1543: en uscoutet fremmed rytter får { hidden: true } og INTET
  // potentiale — ellers ville en spec kunne bevise det modsatte af prod.
  if (pathname.endsWith("/scouting-report")) {
    const idMatch = pathname.match(/\/api\/riders\/([^/]+)\/scouting-report$/);
    const rider = idMatch ? RIDERS.find(r => r.id === decodeURIComponent(idMatch[1])) : null;
    if (rider && rider.team_id !== TEST_TEAM.id) {
      return { hidden: true, level: 0, maxLevel: SEED_SCOUTING_REPORT.maxLevel, own: false };
    }
    return SEED_SCOUTING_REPORT;
  }

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
