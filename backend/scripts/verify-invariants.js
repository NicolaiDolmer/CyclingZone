// Zero external dependencies — bruger kun Node built-ins og Supabase REST API.
// Kræver Node 18+ (built-in fetch). Loades env fra backend/.env med mindre --env angives.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkCalendarOverlapInvariants } from "../lib/calendarOverlapInvariant.js";
import { TIER_OVERLAP_CAP } from "../lib/calendarTierCaps.js";
import { evaluateActiveSeasonInvariant } from "../lib/activeSeasonInvariant.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENV = path.resolve(SCRIPT_DIR, "../.env");

// #1614/#838: ét fælles roster-loft (30) for alle divisioner — matcher håndhævelsen i marketUtils.MARKET_SQUAD_LIMITS.
const SQUAD_MAX = { 1: 30, 2: 30, 3: 30 };
const DEBT_CEILING = { 1: 1_200_000, 2: 900_000, 3: 600_000 };

const KNOWN_TX_TYPES = new Set([
  "sponsor", "prize", "salary", "transfer_in", "transfer_out",
  "interest", "bonus", "starting_budget",
  "loan_received", "loan_repayment", "loan_interest",
  "emergency_loan", "admin_adjustment",
]);

const KNOWN_NOTIF_TYPES = new Set([
  "bid_received", "bid_placed", "auction_won", "auction_lost", "auction_outbid",
  "transfer_offer_received", "transfer_offer_accepted", "transfer_offer_rejected",
  "transfer_counter", "transfer_offer_withdrawn", "transfer_interest",
  "new_race", "race_results_imported", "season_started", "season_ended",
  "board_update", "board_critical", "salary_paid", "sponsor_paid",
  "watchlist_rider_listed", "watchlist_rider_auction",
  "loan_created", "emergency_loan", "loan_paid_off",
  "deadline_day_warning", "auction_cancelled", "squad_enforced",
]);

function parseArgs(argv) {
  const args = { envPath: DEFAULT_ENV, format: "text" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--env" && argv[i + 1]) {
      args.envPath = path.resolve(argv[i + 1]);
      i++;
    } else if (argv[i] === "--json") {
      args.format = "json";
    }
  }
  return args;
}

function loadEnv(envPath) {
  let content;
  try { content = readFileSync(envPath, "utf8"); } catch { return; }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

// #2974: `orderBy` er IKKE valgfri pynt. Uden en eksplicit, unik sortering
// garanterer PostgREST/Postgres ikke samme rækkefølge mellem to Range-requests:
// den samme række kan dukke op på to sider mens en anden helt udebliver. For alle
// tabeller > PAGE rækker gør det resultatet upålideligt — og for en DUPLIKAT-
// invariant er det fatalt. Målt mod prod 26/7 rapporterede den usorterede udgave
// 118.365 falske dubletter i race_results (ægte antal: 0), og squad_within_max
// talte 11 hold over loftet hvor SQL sagde 14. Sortér altid på en unik nøgle.
async function fetchAll(baseUrl, apiKey, table, select, filters = {}, orderBy = "id") {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const url = new URL(`${baseUrl}/rest/v1/${table}`);
    url.searchParams.set("select", select);
    url.searchParams.set("order", `${orderBy}.asc`);
    for (const [k, v] of Object.entries(filters)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        Range: `${from}-${from + PAGE - 1}`,
        Prefer: "count=exact",
      },
    });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} — ${await res.text()}`);
    const data = await res.json();
    rows.push(...data);
    const contentRange = res.headers.get("content-range");
    if (!contentRange || data.length < PAGE) break;
    const total = Number(contentRange.split("/")[1]);
    if (isNaN(total) || from + PAGE >= total) break;
  }
  return rows;
}

function check(ok, detail, violations = []) {
  return { ok, detail, ...(violations.length ? { violations } : {}) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv(args.envPath);

  const baseUrl = process.env.SUPABASE_URL;
  const apiKey = process.env.SUPABASE_SERVICE_KEY;
  if (!baseUrl || !apiKey) throw new Error("Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY");

  const fetch_ = (table, select, filters, orderBy) => fetchAll(baseUrl, apiKey, table, select, filters, orderBy);

  const [teams, riders, activeRiders, derivedRows, activeAuctions, openListings, openSwaps, financeRows, notifRows, activeLoans, raceResultRows, activeSeasons, leagueDivisions] = await Promise.all([
    fetch_("teams", "id,division,is_ai,is_frozen,is_bank"),
    fetch_("riders", "id,team_id,is_academy,is_retired"),
    // #1673: aktive (ikke-retired) ryttere + deres derive-laget, til invariant-check.
    fetch_("riders", "id,base_value,archetype_draw,primary_type,secondary_type", { is_retired: "is.false" }),
    // rider_derived_abilities har ingen `id`-kolonne — rider_id er den unikke nøgle.
    fetch_("rider_derived_abilities", "rider_id", undefined, "rider_id"),
    fetch_("auctions", "id,rider_id,status", { status: "in.(active,extended)" }),
    fetch_("transfer_listings", "id,rider_id,status", { status: "eq.open" }),
    fetch_("swap_offers", "id,offered_rider_id,status", { status: "in.(pending,countered,awaiting_confirmation)" }),
    fetch_("finance_transactions", "type"),
    fetch_("notifications", "type"),
    fetch_("loans", "team_id,amount_remaining,loan_type", { status: "eq.active" }),
    // #2974/#2898: hele race_results til duplikat-invarianten nedenfor.
    fetch_("race_results", "race_id,stage_number,rider_id,result_type,rank,points_earned"),
    // #4161: kalender-akse + overlap-cap pr. pulje for den AKTIVE saeson.
    fetch_("seasons", "id,number,status,start_date", { status: "eq.active" }),
    fetch_("league_divisions", "id,tier,label"),
  ]);

  const humanTeams = teams.filter(t => !t.is_ai && !t.is_frozen && !t.is_bank);
  const humanTeamIds = new Set(humanTeams.map(t => t.id));
  const divisionOf = new Map(humanTeams.map(t => [t.id, t.division]));

  // Check 1: Ingen rytter med to samtidige aktive auktioner
  const auctionCount = new Map();
  for (const a of activeAuctions) {
    auctionCount.set(a.rider_id, (auctionCount.get(a.rider_id) || 0) + 1);
  }
  const doubleAuctions = [...auctionCount.entries()]
    .filter(([, n]) => n > 1)
    .map(([riderId, n]) => ({ riderId, count: n }));

  // Check 2: Trupstørrelse overskrider ikke max for divisionen (tæller kun human teams)
  const squadSize = new Map();
  for (const r of riders) {
    if (r.team_id && humanTeamIds.has(r.team_id)) {
      squadSize.set(r.team_id, (squadSize.get(r.team_id) || 0) + 1);
    }
  }
  const oversized = [];
  for (const [teamId, count] of squadSize.entries()) {
    const div = divisionOf.get(teamId);
    const max = SQUAD_MAX[div];
    if (max !== undefined && count > max) oversized.push({ teamId, division: div, count, max });
  }

  // Check 3: Finance transaction types er alle kendte
  const unknownTxTypes = [...new Set(financeRows.map(r => r.type))]
    .filter(t => !KNOWN_TX_TYPES.has(t));

  // Check 4: Notification types er alle kendte
  const unknownNotifTypes = [...new Set(notifRows.map(r => r.type))]
    .filter(t => !KNOWN_NOTIF_TYPES.has(t));

  // Check 5: Aktiv finance-gæld overskrider ikke divisionsloft
  const debtByTeam = new Map();
  for (const loan of activeLoans) {
    if (humanTeamIds.has(loan.team_id)) {
      debtByTeam.set(loan.team_id, (debtByTeam.get(loan.team_id) || 0) + Number(loan.amount_remaining));
    }
  }
  const debtBreaches = [];
  for (const [teamId, debt] of debtByTeam.entries()) {
    const div = divisionOf.get(teamId);
    const ceiling = DEBT_CEILING[div];
    if (ceiling !== undefined && debt > ceiling) debtBreaches.push({ teamId, division: div, debt, ceiling });
  }

  // Check 6: Ingen rytter er i både aktiv auktion og åben transferliste
  const activeAuctionRiders = new Set(activeAuctions.map(a => a.rider_id));
  const openListingRiders = new Set(openListings.map(l => l.rider_id));
  const doubleMarket = [...activeAuctionRiders]
    .filter(id => openListingRiders.has(id))
    .map(riderId => ({ riderId }));

  // Check 7 (#1089): Ingen rytter er i både aktiv auktion og TILBUDT i et åbent
  // swap-tilbud. Ryttere der blot er ØNSKET i andres swap-tilbud er tilladt
  // (auktions-start blokeres bevidst ikke af indkommende swap-forslag).
  const offeredSwapRiders = new Set(openSwaps.map(s => s.offered_rider_id));
  const doubleSwapMarket = [...activeAuctionRiders]
    .filter(id => offeredSwapRiders.has(id))
    .map(riderId => ({ riderId }));

  // Check 8 (#1673): Ingen aktiv (ikke-retired) rytter må mangle sit derive-lag.
  // En strandet rytter har enten ingen rider_derived_abilities-række ELLER base_value
  // IS NULL → serve-laget (api.js embed) returnerer null → blanke stats i UI. Rod-
  // årsagen var en partiel derive-batch der fejlede tavst (se postmortem 2026-06-21).
  // Bemærk: detaljer cap'es til de første 50 så --json ikke eksploderer ved et stort
  // efterslæb; `count` rapporterer det fulde antal.
  const derivedRiderIds = new Set(derivedRows.map(d => d.rider_id));
  const strandedRiders = [];
  for (const r of activeRiders) {
    const missingDerived = !derivedRiderIds.has(r.id);
    const missingValue = r.base_value == null;
    if (missingDerived || missingValue) {
      strandedRiders.push({ riderId: r.id, missingDerived, missingValue });
    }
  }

  // Check 8b (#3593): Rytterens IDENTITET skal være fuldt forankret i anlægget.
  //
  // `resolveRiderTypes` tager primæren fra `archetype_draw`, men falder tilbage til
  // klassifikatoren for sekundæren når anlægget ikke bærer en — og sekundæren former
  // loftet direkte (youthRoleFactor 0,82 mod 0,45). En rytter uden sekundært anlæg får
  // derfor sin sekundære type udpeget på ny hver gang lofterne genberegnes, og de to
  // skrivestier (backfillCores' `draw.secondary || null` mod dailyTrainingEngine's
  // `riders.secondary_type`) er samtidig uenige om hvilken sekundær der gælder.
  //
  // Hvorfor invarianten står HER og ikke kun som en migration: bestanden blev renset
  // 11/8, men KILDEN er ikke lukket — `fictionalRiderGenerator` skriver fortsat
  // `secondary: null` for voksen-genererede ryttere (AI-hold, startholds-trupper),
  // og det lukkes først af #3634. Uden denne tæller vokser tallet igen usynligt,
  // præcis som det gjorde første gang. Går den fra 0, er #3634 blevet aktuel.
  const unanchoredIdentity = activeRiders
    .filter(r => !r.archetype_draw?.primary || !r.archetype_draw?.secondary)
    .map(r => ({
      riderId: r.id,
      missingPrimary: !r.archetype_draw?.primary,
      missingSecondary: !r.archetype_draw?.secondary,
    }));

  // Check 9 (#2264): Ingen aktiv fri agent må stå med is_academy=true. En akademi-
  // rytter uden hold er ulovlig tilstand: den vises i markedets "All riders", men
  // auktions-start afvises (rider_is_academy) — spillere ser en forvirrende fejl.
  // Opstod da et lukket snyd-holds akademi-ryttere blev frigivet uden flag-nulstilling.
  const orphanedAcademyFreeAgents = riders
    .filter(r => !r.team_id && r.is_academy && !r.is_retired)
    .map(r => ({ riderId: r.id }));

  // Check 10 (#2974/#2898): Ingen dublerede race_results.
  //
  // Rodårsagen: persist-laget bruger et idempotent delete-then-insert. supabase-js
  // KASTER ikke — fejler deletet tavst (fx statement timeout under samtidige
  // etaper), kører insertet alligevel og lægger de nye rækker OVEN PÅ de gamle.
  // Konsekvens: dublerede points_earned og DOBBELT prize_money (prizePayoutEngine
  // betaler pr. point-række). Direkte spillervendt: forkerte stillinger og penge
  // udbetalt to gange. #2974 tilføjede fejltjek på kaldestederne; DENNE invariant
  // er detektionen der fanger det hvis mønstret alligevel slipper igennem.
  //
  // Nøgle: (race_id, stage_number, result_type, rider_id) — én rytter kan ikke
  // optræde to gange i samme klassement på samme etape. Det er præcis den form
  // en dublet fra et fejlet delete tager.
  //
  // rider_id IS NULL er UDELADT — og det er ikke kosmetik. Målt mod prod 26/7 er
  // 43.288 af 487.377 rækker rytterløse: hold-klassementerne (`team`, `team_day`)
  // har per design ingen rytter, og historiske PCM-importer efterlod rækker hvor
  // rytteren ikke kunne matches. Grupperer man dem med, samler SQL/Map alle
  // NULL-rytter-rækker i ét løb i ÉN nøgle og rapporterer 2.336 "dubletter" på
  // 410 løb — rent støj. Med filteret: 0 dubletter i prod.
  const raceResultKeyCount = new Map();
  for (const r of raceResultRows) {
    if (r.rider_id == null) continue;
    const key = `${r.race_id}|${r.stage_number}|${r.result_type}|${r.rider_id}`;
    raceResultKeyCount.set(key, (raceResultKeyCount.get(key) || 0) + 1);
  }
  const duplicateRaceResults = [];
  for (const [key, n] of raceResultKeyCount.entries()) {
    if (n <= 1) continue;
    const [raceId, stageNumber, resultType, riderId] = key.split("|");
    duplicateRaceResults.push({ raceId, stageNumber: Number(stageNumber), resultType, riderId, rows: n });
  }
  const duplicateRaces = new Set(duplicateRaceResults.map(d => d.raceId));

  // Check 11 (#2898): Samme rang tildelt to gange i samme klassement på samme
  // etape. Fanger den variant hvor dubletten IKKE er rytter-identisk (fx en
  // genafvikling med et ændret felt oven på et fejlet delete). NULL-rang er
  // udeladt: ikke-scorende rækker bærer rank=null i massevis og er ikke dubletter.
  const rankKeyCount = new Map();
  for (const r of raceResultRows) {
    if (r.rank == null) continue;
    const key = `${r.race_id}|${r.stage_number}|${r.result_type}|${r.rank}`;
    rankKeyCount.set(key, (rankKeyCount.get(key) || 0) + 1);
  }
  const duplicateRanks = [];
  for (const [key, n] of rankKeyCount.entries()) {
    if (n <= 1) continue;
    const [raceId, stageNumber, resultType, rank] = key.split("|");
    duplicateRanks.push({ raceId, stageNumber: Number(stageNumber), resultType, rank: Number(rank), rows: n });
  }

  // ---- #4161: kalender-akse + overlap-cap pr. pulje (aktiv saeson) ----
  // `game_day` er den IN-GAME dag der binder en rytter (raceBinding.js), IKKE kalenderdagen.
  // Pakkeren lae­gger K = ceil(density / cap) hele game_days ind i hver kalenderdag, saa
  // `density` etaper kan afvikles uden at nogen game_day bryder overlap-cap'en. Bliver den
  // akse skrevet som en ren dato-offset (som #4155-reparationen gjorde), kollapser K til 1
  // og cap'en brydes i alle divisioner paa én gang — uden at noget andet raaber op.
  const activeSeason = activeSeasons[0] ?? null;
  const divisionById = new Map(leagueDivisions.map((d) => [d.id, d]));
  const calendarOverlapViolations = [];
  const calendarStageRepeatViolations = [];
  const calendarCollapsedPools = [];
  const calendarMonumentSharedDays = [];
  let calendarPoolsChecked = 0;
  if (activeSeason) {
    const seasonRaces = await fetch_("races", "id,league_division_id,season_id,name,race_class", { season_id: `eq.${activeSeason.id}` });
    const raceIds = new Set(seasonRaces.map((r) => r.id));
    const divisionOfRace = new Map(seasonRaces.map((r) => [r.id, r.league_division_id]));
    const nameOfRace = new Map(seasonRaces.map((r) => [r.id, r.name]));
    // #4075: monumentet skal have sin in-game-dag for sig selv (ejer-låst 21/8).
    const monumentRaceIds = new Set(seasonRaces.filter((r) => r.race_class === "Monuments").map((r) => r.id));
    const allStageRows = await fetch_("race_stage_schedule", "race_id,stage_number,scheduled_at,game_day", undefined, "race_id");

    const rowsByPool = new Map();
    for (const row of allStageRows) {
      if (!raceIds.has(row.race_id)) continue;
      const pool = divisionOfRace.get(row.race_id);
      if (pool == null) continue;
      if (!rowsByPool.has(pool)) rowsByPool.set(pool, []);
      rowsByPool.get(pool).push(row);
    }

    for (const [poolId, rows] of rowsByPool.entries()) {
      const div = divisionById.get(poolId);
      const tier = div?.tier ?? null;
      if (tier == null) continue;
      calendarPoolsChecked += 1;
      const r = checkCalendarOverlapInvariants({ scheduleRows: rows, tier, monumentRaceIds });
      const label = div?.label ?? `pulje ${poolId}`;
      for (const v of r.overlapViolations) {
        calendarOverlapViolations.push({
          pool: label, tier, game_day: v.game_day, races: v.races, cap: v.cap,
          race_names: v.race_ids.map((id) => nameOfRace.get(id) ?? id),
        });
      }
      for (const v of r.stageRepeatViolations) {
        calendarStageRepeatViolations.push({
          pool: label, tier, race: nameOfRace.get(v.race_id) ?? v.race_id,
          game_day: v.game_day, stages_same_day: v.stages, stage_numbers: v.stage_numbers,
        });
      }
      for (const v of r.monumentSharedDayViolations) {
        calendarMonumentSharedDays.push({
          pool: label, tier, game_day: v.game_day,
          monumenter: v.monument_race_ids.map((id) => nameOfRace.get(id) ?? id),
          modloeb: v.other_race_ids.map((id) => nameOfRace.get(id) ?? id),
        });
      }
      if (r.axisLooksCollapsed) {
        calendarCollapsedPools.push({
          pool: label, tier, game_days: r.gameDayCount, kalenderdage: r.realDayCount,
          mindst_game_days_pr_kalenderdag: r.minGameDaysPerCalendarDay,
        });
      }
    }
  }

  const checks = {
    no_double_active_auctions: check(
      doubleAuctions.length === 0,
      doubleAuctions.length === 0
        ? `OK — ${activeAuctions.length} aktive auktioner`
        : `${doubleAuctions.length} rytter(e) har 2+ aktive auktioner`,
      doubleAuctions
    ),
    squad_within_max: check(
      oversized.length === 0,
      oversized.length === 0
        ? `OK — ${humanTeams.length} hold kontrolleret`
        : `${oversized.length} hold overskrider max-trupgrænse`,
      oversized
    ),
    finance_types_known: check(
      unknownTxTypes.length === 0,
      unknownTxTypes.length === 0
        ? `OK — ${KNOWN_TX_TYPES.size} kendte typer`
        : `Ukendte typer: ${unknownTxTypes.join(", ")}`,
      unknownTxTypes.map(t => ({ type: t }))
    ),
    notification_types_known: check(
      unknownNotifTypes.length === 0,
      unknownNotifTypes.length === 0
        ? `OK — ${KNOWN_NOTIF_TYPES.size} kendte typer`
        : `Ukendte typer: ${unknownNotifTypes.join(", ")}`,
      unknownNotifTypes.map(t => ({ type: t }))
    ),
    debt_within_ceiling: check(
      debtBreaches.length === 0,
      debtBreaches.length === 0
        ? `OK — ${debtByTeam.size} hold med aktive lån kontrolleret`
        : `${debtBreaches.length} hold overskrider gældsloft`,
      debtBreaches
    ),
    no_double_market_listing: check(
      doubleMarket.length === 0,
      doubleMarket.length === 0
        ? `OK — ${activeAuctions.length} auktioner, ${openListings.length} transferlistinger`
        : `${doubleMarket.length} rytter(e) er i både aktiv auktion og åben transferliste`,
      doubleMarket
    ),
    no_auction_swap_overlap: check(
      doubleSwapMarket.length === 0,
      doubleSwapMarket.length === 0
        ? `OK — ${activeAuctions.length} auktioner, ${openSwaps.length} åbne swap-tilbud`
        : `${doubleSwapMarket.length} rytter(e) er i både aktiv auktion og tilbudt i åbent swap-tilbud`,
      doubleSwapMarket
    ),
    no_orphaned_academy_free_agents: check(
      orphanedAcademyFreeAgents.length === 0,
      orphanedAcademyFreeAgents.length === 0
        ? "OK — ingen frie agenter med is_academy=true"
        : `${orphanedAcademyFreeAgents.length} fri(e) agent(er) står med is_academy=true (ulovlig tilstand, #2264)`,
      orphanedAcademyFreeAgents.slice(0, 50)
    ),
    riders_have_derived_abilities: check(
      strandedRiders.length === 0,
      strandedRiders.length === 0
        ? `OK — ${activeRiders.length} aktive ryttere har derive + base_value`
        : `${strandedRiders.length} aktiv(e) rytter(e) mangler derive (rider_derived_abilities-række eller base_value)`,
      strandedRiders.slice(0, 50)
    ),
    riders_identity_anchored: check(
      unanchoredIdentity.length === 0,
      unanchoredIdentity.length === 0
        ? `OK — alle ${activeRiders.length} aktive ryttere har både primært og sekundært anlæg`
        : `${unanchoredIdentity.length} aktiv(e) rytter(e) mangler et forankret anlæg — sekundæren (0,82 af loft-formningen) udpeges af klassifikatoren og kan drifte (#3593; kilden lukkes af #3634)`,
      unanchoredIdentity.slice(0, 50)
    ),
    no_duplicate_race_results: check(
      duplicateRaceResults.length === 0,
      duplicateRaceResults.length === 0
        ? `OK — ${raceResultKeyCount.size} rytter-nøgler af ${raceResultRows.length} race_results-rækker, ingen dubletter`
        : `${duplicateRaceResults.length} dubleret(e) race_results-nøgle(r) fordelt på ${duplicateRaces.size} løb — dublerede point/præmier (#2974/#2898)`,
      duplicateRaceResults.slice(0, 50)
    ),
    no_duplicate_race_result_ranks: check(
      duplicateRanks.length === 0,
      duplicateRanks.length === 0
        ? "OK — ingen rang tildelt to gange i samme klassement"
        : `${duplicateRanks.length} rang(e) tildelt 2+ gange i samme (løb, etape, klassement) (#2898)`,
      duplicateRanks.slice(0, 50)
    ),
    // #4229 — SKAL stå før kalender-invarianterne herunder. De fire svarer alle
    // "OK — ingen aktiv sæson at kontrollere" når der ingen aktiv sæson er, så
    // hele suiten blev grøn præcis når spillet var mest i stykker (25/8: fire
    // timer uden aktiv sæson, alder/rangliste/træning/akademi nede for alle).
    // Denne er den der råber op i stedet.
    exactly_one_active_season: (() => {
      const r = evaluateActiveSeasonInvariant(activeSeasons);
      return check(r.ok, r.detail, r.violations);
    })(),
    calendar_overlap_within_tier_cap: check(
      calendarOverlapViolations.length === 0,
      !activeSeason
        ? "OK — ingen aktiv sæson at kontrollere"
        : calendarOverlapViolations.length === 0
          ? `OK — ${calendarPoolsChecked} pulje(r) holder TIER_OVERLAP_CAP (${JSON.stringify(TIER_OVERLAP_CAP)})`
          : `${calendarOverlapViolations.length} in-game-dag(e) har FLERE samtidige løb end divisionens ejer-låste cap (#4161)`,
      calendarOverlapViolations.slice(0, 50)
    ),
    calendar_one_stage_per_race_per_game_day: check(
      calendarStageRepeatViolations.length === 0,
      !activeSeason
        ? "OK — ingen aktiv sæson at kontrollere"
        : calendarStageRepeatViolations.length === 0
          ? `OK — hver etape har sin egen in-game-dag i alle ${calendarPoolsChecked} pulje(r)`
          : `${calendarStageRepeatViolations.length} løb kører 2+ etaper på SAMME in-game-dag — pakker-kontrakten er 1 etape = 1 game-dag (#4161)`,
      calendarStageRepeatViolations.slice(0, 50)
    ),
    calendar_monument_exclusive_game_day: check(
      calendarMonumentSharedDays.length === 0,
      !activeSeason
        ? "OK — ingen aktiv sæson at kontrollere"
        : calendarMonumentSharedDays.length === 0
          ? `OK — hvert monument har sin in-game-dag for sig selv i alle ${calendarPoolsChecked} pulje(r)`
          : `${calendarMonumentSharedDays.length} monument-løbsdag(e) deles med andre løb — et monument skal have dagen for sig selv (#4075/#4176)`,
      calendarMonumentSharedDays.slice(0, 50)
    ),
    calendar_game_day_axis_not_collapsed: check(
      calendarCollapsedPools.length === 0,
      !activeSeason
        ? "OK — ingen aktiv sæson at kontrollere"
        : calendarCollapsedPools.length === 0
          ? "OK — in-game-aksen er bredere end kalenderen i alle puljer hvor K > 1"
          : `${calendarCollapsedPools.length} pulje(r) har game_day skrevet som ren dato-offset — K er kollapset til 1 (#4161)`,
      calendarCollapsedPools.slice(0, 50)
    ),
  };

  const failed = Object.entries(checks).filter(([, c]) => !c.ok);

  if (args.format === "json") {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), checks }, null, 2));
  } else {
    console.log(`\nverify-invariants — ${new Date().toISOString()}\n`);
    for (const [name, c] of Object.entries(checks)) {
      console.log(`  ${c.ok ? "[ok]  " : "[FEJL]"} ${name}: ${c.detail}`);
    }
    if (failed.length) {
      console.log(`\n${failed.length} invariant(er) brudt. Kør med --json for detaljer.\n`);
    } else {
      console.log("\nAlle invarianter holder.\n");
    }
  }

  if (failed.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(`[fatal] ${err.message}`);
  process.exitCode = 1;
});
