// Framework-neutral seed-data. Eneste kilde — importeres af BÅDE Playwright-
// fixtures (frontend/tests/e2e/fixtures.js) OG runtime-preview-mocken
// (installPreviewMock.js). Ingen @playwright/test-import her, så modulet kan
// køre i Node (node --test) og i browseren (Vite preview-bundle).

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
  league_division_id: 2,
  balance: 500000,
  sponsor_income: 240000,
  is_ai: false,
  is_test_account: true,
};

// #1829: puljens løb til den per-pulje løbsdage-tæller på dashboardet. Returneres KUN
// for den rene tæller-query (league_division_id=eq UDEN pool_race-join). Dashboards
// "næste løb"-liste joiner pool_race og får SEED_RACES (#1906), så den nu — korrekt —
// viser holdets kommende løb i stedet for en tom tabel.
// vk-movement-signals: id + game_day_start tilføjet (samme query, 2 ekstra
// kolonner) — driver findLastCompletedRaceDay(). "pool-race-done-2" har det højeste
// game_day_start blandt completed-løb og er derfor "sidste løbsdag" (se
// SEED_TEAM_RACE_POINTS_MV nedenfor for de holdpoint der knytter sig til den).
export const POOL_RACES = [
  { id: "pool-race-done-1", status: "completed", stages: 1, stages_completed: 1, league_division_id: 2, game_day_start: 2 },
  { id: "pool-race-done-2", status: "completed", stages: 1, stages_completed: 1, league_division_id: 2, game_day_start: 9 },
  { id: "pool-race-sched-1", status: "scheduled", stages: 7, stages_completed: 2, league_division_id: 2, game_day_start: 15 },
  { id: "pool-race-sched-2", status: "scheduled", stages: 1, stages_completed: 0, league_division_id: 2, game_day_start: 20 },
  { id: "pool-race-sched-3", status: "scheduled", stages: 1, stages_completed: 0, league_division_id: 2, game_day_start: 22 },
];

export const RIVAL_TEAM = {
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

export const ACTIVE_SEASON = {
  id: "season-e2e",
  season_number: 1,
  // #2863: `number` er kolonnenavnet i seasons-tabellen; `season_number` er den
  // form embeds andre steder i seedet bruger. Uden `number` rendrede /seasons
  // sin overskrift som "Season " med et tomt tal på enhver preview.
  number: 1,
  name: "Sæson 1",
  status: "active",
  started_at: "2026-05-01T00:00:00.000Z",
  // #3709 trin 1: `start_date` er DATE-kolonnen useTrainingHistory filtrerer
  // sæsonens træningsdage på. Uden den kunne trænings-kvitteringen aldrig vise
  // sæsonens point på preview — den ville stå i sin afventende tilstand.
  start_date: "2026-05-01",
  ended_at: null,
  race_days_completed: 0,
  race_days_total: 28,
};

export const RIDERS = [
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
    // #2849 bølge 6: var "leadout" — en type der blev FJERNET fra modellen
    // (backend/lib/riderTypes.js: 8 typer, leadout foldet ind i sprinter/rouleur).
    // Fixturen beskrev derfor en umulig rytter, og riderTypes-namespacet har ingen
    // nøgle for den, så mobil-ryttertabellen rendrede den rå nøgle "types.leadout".
    secondary_type: "rouleur",
    team: { id: TEST_TEAM.id, name: TEST_TEAM.name },
    // #1529: visningen viser nu CZ-evner — embeddet rider_derived_abilities flades
    // op på rytteren (flattenAbilities) i de migrerede sider. Sprinter-profil.
    //
    // #3666 (ejer-besluttet 14/8): evnerne er sænket fra 52-84 til 19-31. De gamle
    // tal var skrevet dengang normaliseringen strakte alt mod to populations-ankre
    // og gjorde denne rytter til en 99'er. På den absolutte skala svarer de samme
    // evner til rating 79 — omkring 99,9-percentilen af 8.747 ryttere, hvor
    // medianen er 13 og p90 er 29. Preview viste derfor ejeren en rytter ingen
    // spiller nogensinde møder: otte stopfyldte bjælker på radarens 0-40-akse og
    // et loft-bånd der lå helt uden for den. Nu er hun rating 29 — stadig blandt
    // spillets stærkeste, men et tal fladerne kan tegne. Markedsværdien er
    // BEVIDST urørt: `auction-startprice-typo-guard.spec.js` vogter ciffer-drop
    // på præcis 1.680.000, og den vagt er mere værd end en pænere seed-økonomi.
    rider_derived_abilities: {
      climbing: 19, time_trial: 22, flat: 29, tempo: 23, sprint: 31, acceleration: 29,
      punch: 26, endurance: 24, recovery: 25, durability: 26, descending: 23,
      cobblestone: 21, positioning: 27, aggression: 22, tactics: 25,
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
    // #3666: sænket af samme grund som rider-1 — rating 26 i stedet for 79. Han er
    // 29 år og dermed tæt på peak, så hans luft til loftet er bevidst mindre end
    // Adas: 26 mod et potentiale på 32, hvor hun har 29 mod 45.
    rider_derived_abilities: {
      climbing: 28, time_trial: 24, flat: 18, tempo: 23, sprint: 13, acceleration: 19,
      punch: 24, endurance: 27, recovery: 25, durability: 23, descending: 22,
      cobblestone: 16, positioning: 22, aggression: 21, tactics: 24,
    },
  },
];

// ── Evne-lofter: SERVER-SANDHED, må ALDRIG serveres til klienten ────────────
//
// #3666: seedet havde ingen lofter overhovedet, så hverken potentiel rating
// (#2454), loft-båndet på Scouting-fanen eller Udvikling-fanens loft-zone kunne
// vises ægte på preview — netop de flader landing 1 ændrer mest.
//
// De ligger BEVIDST uden for `rider_derived_abilities`, ikke inde i den. Rå
// `ability_caps` findes aldrig i klienten (#1162): de er invertérbare til det
// server-skjulte potentiale, og frontendens `ABILITY_SELECT` henter kun de 15
// evne-nøgler. Lå de på rytter-rækken, ville mocken servere klienten noget
// produktionen aldrig sender — en preview-flade kunne se ud til at virke på et
// felt der ikke findes i drift. Alt hvad klienten må se er de MASKEREDE bånd,
// som endpoint-seedene nedenfor bærer.
//
// Tallene: Adas sprinter-potentiale lander på 45, tæt på prod-medianen for
// potentiel rating (44 målt 13/8); Mikkels klatrer-potentiale på 32, lavere
// fordi han er 29 år og dermed nær peak. Luften er størst på signatur-evnerne,
// som rolle-faktoren i `riderProgression` gør den i drift.
export const SEED_ABILITY_CAPS = Object.freeze({
  "rider-1": Object.freeze({
    climbing: 25, time_trial: 28, flat: 45, tempo: 29, sprint: 47, acceleration: 45,
    punch: 32, endurance: 30, recovery: 31, durability: 45, descending: 29,
    cobblestone: 27, positioning: 41, aggression: 28, tactics: 31,
  }),
  "rider-2": Object.freeze({
    climbing: 38, time_trial: 28, flat: 22, tempo: 28, sprint: 17, acceleration: 23,
    punch: 26, endurance: 32, recovery: 29, durability: 27, descending: 24,
    cobblestone: 20, positioning: 26, aggression: 25, tactics: 28,
  }),
});

// #2454 preview-seed: POST /api/scouting/estimates. Ét sted, delt af BEGGE
// mock-konsumenter (Playwright-fixturen og runtime-preview-mocken) — de havde
// hver sin kopi, og kun den ene ville have fået rating-båndet.
//
// `prog` er rytterens egen rolles PROGNOSE-bånd i RATING-point (#3746: hvor han
// realistisk lander med træning, ikke et loft), og det er BEVIDST de samme tal
// som SEED_SCOUTING_REPORT's primærrolle-række: en rytter må ikke vise ét bånd
// i tabellen og et andet på sin Scouting-fane. Konsistens-testen håndhæver det.
// `ceil` er en ALIAS af `prog` (samme tal) for ældre klient-cache, se
// backend/routes/api.js. Rivalen er uscoutet og får `hidden` — intet bånd,
// ingen rolle, ingen lækage (#1543).
export const SEED_SCOUT_ESTIMATES = Object.freeze({
  "rider-1": Object.freeze({
    lo: 4.5, hi: 5, level: 3, role: "sprinter", now: 29,
    prog: Object.freeze({ lo: 40, hi: 48 }),
    ceil: Object.freeze({ lo: 40, hi: 48 }),
    loft: 93,
    // #4039: Ada er ung (under PEAK_AGE) - hendes loft-visning er IKKE dæmpet.
    pastPeak: false,
  }),
  "rider-2": Object.freeze({ hidden: true, level: 0 }),
});

// Overgangs-panelet (trin 7, #3746/#3803, ejer-design 18/8) — samme form som
// GET /api/development/transition. Loft før-tallene svarer til det gamle
// potentiale-baserede loft-bånd (midtpunkt), loft nu til det flade rolle-tag,
// så panelet på preview fortæller præcis den historie backfillen skriver:
// lofterne HÆVES for de fleste, prognosen er ny information ved siden af.
export const SEED_DEV_TRANSITION = Object.freeze({
  active: true,
  capturedAt: "2026-08-19T05:00:00.000Z",
  up: 1,
  down: 0,
  total: 1,
  rows: Object.freeze([
    Object.freeze({
      riderId: "rider-1", name: "Ada Pedersen", rating: 29,
      loftFoer: 74, loftNu: 93, prog: Object.freeze({ lo: 40, hi: 48 }),
    }),
  ]),
});

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

export const AUCTIONS = [
  {
    id: "auction-1",
    rider_id: "rider-2",
    seller_team_id: RIVAL_TEAM.id,
    current_bidder_id: null,
    starting_price: 50000,
    current_price: 50000,
    min_increment: 5000,
    // #3110: relativ til "nu" i stedet for en fastfrosset kalenderdato — en
    // frosset fortids-dato bliver af isAuctionTimeExpired (auctionLogic.js)
    // korrekt læst som udløbet, uanset hvornår testen kører, og blokerer så
    // byd-knappen i core-smoke's "ingen blanke skærme"-snapshot af /auctions.
    calculated_end: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    status: "active",
    is_guaranteed_sale: false,
    rider: RIDERS[1],
    seller_team: RIVAL_TEAM,
    current_bidder: null,
  },
];

// #3401: post-hammerslag-reveal — én AFSLUTTET auktion til AuctionHistoryPage
// (status=eq.completed-queryen, se mockHandlers.js restRows("auctions")) + dens
// fulde bud-historik (auction_bids). Egen fiktiv rider + tredje "rival"-hold
// (ikke RIVAL_TEAM) så fixturen ikke forurener de eksisterende active-auktion-
// eller rider-ejerskabs-antagelser andre specs bygger på.
const BIDWAR_RIDER = {
  id: "rider-bidwar",
  firstname: "Théo",
  lastname: "Journal",
  birthdate: "2000-02-18",
  market_value: 380000,
  salary: 38000,
  is_u25: true,
  nationality_code: "fr",
  team_id: TEST_TEAM.id,
};

export const BIDWAR_RIVAL_TEAM = { id: "team-bidwar-rival", name: "Northwind Cycling" };

export const COMPLETED_AUCTIONS = [
  {
    id: "auction-completed-1",
    rider_id: BIDWAR_RIDER.id,
    seller_team_id: null,
    current_bidder_id: TEST_TEAM.id,
    current_price: 340000,
    actual_end: "2026-08-04T18:12:00.000Z",
    status: "completed",
    is_guaranteed_sale: false,
    rider: BIDWAR_RIDER,
    seller: null,
    winner: { id: TEST_TEAM.id, name: TEST_TEAM.name },
  },
];

export const COMPLETED_AUCTION_BIDS = [
  { id: "bidwar-1", auction_id: "auction-completed-1", team_id: BIDWAR_RIVAL_TEAM.id, amount: 260000, bid_time: "2026-08-04T17:40:00.000Z", team: BIDWAR_RIVAL_TEAM },
  { id: "bidwar-2", auction_id: "auction-completed-1", team_id: TEST_TEAM.id, amount: 280000, bid_time: "2026-08-04T17:52:00.000Z", team: TEST_TEAM },
  { id: "bidwar-3", auction_id: "auction-completed-1", team_id: BIDWAR_RIVAL_TEAM.id, amount: 310000, bid_time: "2026-08-04T18:05:00.000Z", team: BIDWAR_RIVAL_TEAM },
  { id: "bidwar-4", auction_id: "auction-completed-1", team_id: TEST_TEAM.id, amount: 340000, bid_time: "2026-08-04T18:12:00.000Z", team: TEST_TEAM },
];

// #3401: taber-notifikation-fixturen til NotificationsPage — én "auction_lost"
// med den nye {titleCode,messageCode}-metadata (renderBackendMessage), så
// skærmbilledet af den ægte lokaliserede tekst kan tages deterministisk.
export const SEED_NOTIFICATIONS = [
  {
    id: "notif-bidwar-lost",
    user_id: TEST_USER.id,
    type: "auction_lost",
    title: "You lost the bidding war",
    message: "Northwind Cycling snatched Théo Journal for 340,000 CZ$, 12,000 CZ$ over your top bid of 328,000 CZ$.",
    related_id: "auction-completed-2",
    is_read: false,
    created_at: "2026-08-05T09:14:00.000Z",
    metadata: {
      riderId: "rider-bidwar",
      titleCode: "notif.auctionLostToRival.title",
      titleParams: {},
      messageCode: "notif.auctionLostToRival.message",
      messageParams: {
        winnerName: "Northwind Cycling",
        rider: "Théo Journal",
        price: 340000,
        overBid: 12000,
        yourMax: 328000,
      },
    },
  },
];

// ── Race-hub seed (#prelive-harness, A2) ─────────────────────────────────────
// Realistisk løbs-data så /races/:id + board + strategi rendrer ægte indhold på en
// Vercel-preview. Dækker hele livscyklussen: 1 kommende stage-race, 1 "I gang"
// (0 < stages_completed < stages), 2 kørte. Konsumeres via mockHandlers.restRows
// ("races"/"race_stage_profiles"/"race_stage_schedule"/"race_results") + apiResponse.

// races-tabellen. Embeds (season:season_id, pool_race:pool_race_id) flades på
// rytte-objektet — RaceDetailPage læser race.season + race.pool_race.
export const SEED_RACES = [
  { id: "race-up-1", season_id: ACTIVE_SEASON.id, name: "Tour de Preview", race_type: "stage_race", race_class: "TourFrance", stages: 4, stages_completed: 0, status: "scheduled", edition_year: 2026, league_division_id: TEST_TEAM.league_division_id, season: { id: ACTIVE_SEASON.id, number: ACTIVE_SEASON.season_number }, pool_race: { date_text: "12 Jul" } },
  { id: "race-live-1", season_id: ACTIVE_SEASON.id, name: "Settimana Preview", race_type: "stage_race", race_class: "ProSeries", stages: 5, stages_completed: 2, status: "scheduled", edition_year: 2026, league_division_id: TEST_TEAM.league_division_id, season: { id: ACTIVE_SEASON.id, number: ACTIVE_SEASON.season_number }, pool_race: { date_text: "20 Jun" } },
  { id: "race-done-1", season_id: ACTIVE_SEASON.id, name: "Omloop Preview", race_type: "single", race_class: "Monuments", stages: 1, stages_completed: 1, status: "completed", edition_year: 2026, league_division_id: TEST_TEAM.league_division_id, season: { id: ACTIVE_SEASON.id, number: ACTIVE_SEASON.season_number }, pool_race: { date_text: "01 Mar" } },
  { id: "race-done-2", season_id: ACTIVE_SEASON.id, name: "Giro di Preview", race_type: "stage_race", race_class: "GiroVuelta", stages: 2, stages_completed: 2, status: "completed", edition_year: 2026, league_division_id: TEST_TEAM.league_division_id, season: { id: ACTIVE_SEASON.id, number: ACTIVE_SEASON.season_number }, pool_race: { date_text: "10 May" } },
];

// #3751 — race_entries for TEST_TEAM (etableret hold). Dashboardets "Kommende
// løb"-kort filtrerer nu displayedRaces på holdets EGNE entries
// (filterTeamEnteredRaces, lib/upcomingRaces.js) — uden disse rækker ville
// preview-mocken vise et etableret hold som om det ikke var tilmeldt NOGET
// løb (default: return [] i mockHandlers.js), hvilket ikke matcher prod.
// Alle 4 SEED_RACES-id'er med, INKL. de afsluttede (race-done-1/2): mockens
// "races"-handler filtrerer (bevidst, se #1906-kommentaren ovenfor) ikke
// status=completed fra som den ægte Dashboard-query gør, så uden entries her
// ville filteret fjerne dem fra "Kommende løb" og ændre kortets række-antal —
// et layout-skred i dashboard.png-snapshottet, ikke en reel #3751-adfærd.
// Samme "etableret hold ER tilmeldt ALT" som accept-kriteriet kræver uændret
// visning for.
export const SEED_RACE_ENTRIES = [
  { race_id: "race-up-1", rider_id: RIDERS[0].id, team_id: TEST_TEAM.id, is_auto_filled: false, race_role: "leader" },
  { race_id: "race-live-1", rider_id: RIDERS[0].id, team_id: TEST_TEAM.id, is_auto_filled: false, race_role: "leader" },
  { race_id: "race-done-1", rider_id: RIDERS[0].id, team_id: TEST_TEAM.id, is_auto_filled: false, race_role: "leader" },
  { race_id: "race-done-2", rider_id: RIDERS[0].id, team_id: TEST_TEAM.id, is_auto_filled: false, race_role: "leader" },
];

// race_stage_profiles — ≥1 pr. etape. demand_vector summerer til [0.97, 1.03].
// Sub-4 (#2448): rutefelter (distance_km/elevation_gain_m/climbs/sprints/sectors)
// tilføjet så en Vercel-preview kan klikkes igennem UDEN en migreret prod-DB
// (ejer-krav: "ejeren skal kunne klikke fladen igennem på en preview FØR merge",
// #1834-erfaringen "for ringe" da ruledata manglede). elevation_gain_m er ALTID
// >= summen af climbGainM(climb) for etapens stigninger + et rimeligt beløb
// ikke-kategoriseret terræn — samme BASE_ELEVATION-tabel som
// backend/lib/raceRouteGenerator.js (flat 200, rolling 500, mountain 900,
// high_mountain 1100, cobbles 400, itt 80) — ellers bisektionen i
// stageRouteProfile.buildProfileSeries lander på 0 og bølgeterrænet forsvinder.
export const SEED_STAGE_PROFILES = [
  // race-up-1 "Tour de Preview" (kommende, 4 etaper): flad spurt m. mellemsprint
  // (st1), bjergetape med nedkørsel til mål — "valley" + "technical"-chips (st2),
  // bjergetape med målgang på toppen — "summit"-chip (st3), kort enkeltstart (st4).
  { race_id: "race-up-1", stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint",
    distance_km: 190, elevation_gain_m: 268,
    climbs: [{ name: "Côte de Beauregard", category: "4", crest_km: 172, length_km: 1.5, avg_gradient: 4.5, summit_finish: false }],
    sprints: [{ name: "Intermediate Sprint", km: 108, kind: "intermediate" }, { name: "Finish", km: 190, kind: "finish" }],
    sectors: [], demand_vector: { sprint: 0.61, acceleration: 0.15, positioning: 0.08, flat: 0.06, endurance: 0.02, randomness: 0.08 } },
  { race_id: "race-up-1", stage_number: 2, profile_type: "mountain", finale_type: "descent",
    distance_km: 180, elevation_gain_m: 2621,
    climbs: [
      { name: "Col de El Cordal", category: "3", crest_km: 78, length_km: 5, avg_gradient: 4.9, summit_finish: false },
      { name: "Côte de Covadonga", category: "3", crest_km: 111, length_km: 5.9, avg_gradient: 6.1, summit_finish: false },
      { name: "Col de Portet", category: "1", crest_km: 162, length_km: 15.5, avg_gradient: 7.2, summit_finish: false }],
    sprints: [{ name: "Intermediate Sprint", km: 77, kind: "intermediate" }, { name: "Finish", km: 180, kind: "finish" }],
    sectors: [], demand_vector: { climbing: 0.5, endurance: 0.2, tempo: 0.15, recovery: 0.1, randomness: 0.05 } },
  { race_id: "race-up-1", stage_number: 3, profile_type: "high_mountain", finale_type: "long_climb",
    distance_km: 170, elevation_gain_m: 5286,
    climbs: [
      { name: "Col de la Colombière", category: "1", crest_km: 66, length_km: 14.2, avg_gradient: 6.6, summit_finish: false },
      { name: "Col du Granier", category: "1", crest_km: 89, length_km: 12.2, avg_gradient: 7.1, summit_finish: false },
      { name: "Côte de Saint-Roch", category: "1", crest_km: 113, length_km: 13.7, avg_gradient: 8.2, summit_finish: false },
      { name: "Mont Aubisque", category: "HC", crest_km: 170, length_km: 14, avg_gradient: 9, summit_finish: true }],
    sprints: [{ name: "Finish", km: 170, kind: "finish" }],
    sectors: [], demand_vector: { punch: 0.45, climbing: 0.25, endurance: 0.15, positioning: 0.1, randomness: 0.05 } },
  { race_id: "race-up-1", stage_number: 4, profile_type: "itt", finale_type: "solo_tt",
    distance_km: 7, elevation_gain_m: 90,
    climbs: [], sprints: [{ name: "Finish", km: 7, kind: "finish" }], sectors: [],
    demand_vector: { time_trial: 0.65, endurance: 0.2, positioning: 0.1, randomness: 0.05 } },

  // race-live-1 "Settimana Preview" (i gang) — rullende etape m. én cat 3-stigning.
  { race_id: "race-live-1", stage_number: 3, profile_type: "rolling", finale_type: "reduced_sprint",
    distance_km: 170, elevation_gain_m: 679,
    climbs: [{ name: "Salita di Pratomagno", category: "3", crest_km: 130, length_km: 3.2, avg_gradient: 5.6, summit_finish: false }],
    sprints: [{ name: "Intermediate Sprint", km: 80, kind: "intermediate" }, { name: "Finish", km: 170, kind: "finish" }],
    sectors: [], demand_vector: { sprint: 0.4, endurance: 0.3, punch: 0.15, positioning: 0.1, randomness: 0.05 } },

  // race-done-1 "Omloop Preview" (kørt endagsløb) — brostensetape, 5 sektorer.
  { race_id: "race-done-1", stage_number: 1, profile_type: "cobbles", finale_type: "breakaway",
    distance_km: 165, elevation_gain_m: 420,
    climbs: [],
    sprints: [{ name: "Intermediate Sprint", km: 60, kind: "intermediate" }, { name: "Finish", km: 165, kind: "finish" }],
    sectors: [
      { kind: "cobbles", name: "Kruisberg", start_km: 75, length_km: 1.8 },
      { kind: "cobbles", name: "Haaghoek", start_km: 85, length_km: 2.2 },
      { kind: "cobbles", name: "Holleweg", start_km: 97, length_km: 2.0 },
      { kind: "cobbles", name: "Paddestraat", start_km: 110, length_km: 2.6 },
      { kind: "cobbles", name: "Kemmelstraat", start_km: 122, length_km: 2.4 },
    ],
    demand_vector: { cobblestone: 0.4, endurance: 0.25, punch: 0.15, positioning: 0.1, randomness: 0.1 } },

  // race-done-2 "Giro di Preview" (kørt etapeløb, 2 etaper) — st2 har
  // summit_finish:true, så "RESULT"-tilstanden kan verificeres på en
  // målgang-på-toppen-waypoint (se SEED_STAGE_PASSAGES).
  { race_id: "race-done-2", stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint",
    distance_km: 180, elevation_gain_m: 276,
    climbs: [{ name: "Cima di Crostis", category: "4", crest_km: 150, length_km: 1.8, avg_gradient: 4.2, summit_finish: false }],
    sprints: [{ name: "Intermediate Sprint", km: 95, kind: "intermediate" }, { name: "Finish", km: 180, kind: "finish" }],
    sectors: [], demand_vector: { sprint: 0.58, acceleration: 0.17, positioning: 0.1, flat: 0.07, endurance: 0.03, randomness: 0.05 } },
  { race_id: "race-done-2", stage_number: 2, profile_type: "mountain", finale_type: "summit_finish",
    distance_km: 140, elevation_gain_m: 2790,
    climbs: [
      { name: "Passo di San Pellegrino", category: "3", crest_km: 45, length_km: 5.2, avg_gradient: 5.5, summit_finish: false },
      { name: "Salita di Bondone", category: "2", crest_km: 95, length_km: 8.5, avg_gradient: 6.8, summit_finish: false },
      { name: "Passo di Fedaia", category: "1", crest_km: 140, length_km: 13.5, avg_gradient: 7.6, summit_finish: true }],
    sprints: [{ name: "Intermediate Sprint", km: 70, kind: "intermediate" }, { name: "Finish", km: 140, kind: "finish" }],
    sectors: [], demand_vector: { climbing: 0.55, endurance: 0.22, tempo: 0.13, recovery: 0.05, randomness: 0.05 } },
];

// race_stage_schedule — scheduled_at pr. etape (driver next-start-countdown).
// #3197: race-done-1/race-done-2 (de KØRTE løb) fik tilføjet rækker her, så
// Resultat-hubbens "seneste"-kort kan vise den rigtige afviklingsdato (erstatter
// pool_race.date_text) på preview/e2e — de havde ingen schedule-rækker før,
// fordi kun countdown-brugen (kommende/igangværende løb) havde brug for dem.
export const SEED_STAGE_SCHEDULE = [
  { race_id: "race-up-1", stage_number: 1, scheduled_at: "2026-07-12T13:00:00.000Z" },
  { race_id: "race-up-1", stage_number: 2, scheduled_at: "2026-07-13T13:00:00.000Z" },
  { race_id: "race-up-1", stage_number: 3, scheduled_at: "2026-07-14T13:00:00.000Z" },
  { race_id: "race-up-1", stage_number: 4, scheduled_at: "2026-07-15T13:00:00.000Z" },
  { race_id: "race-live-1", stage_number: 3, scheduled_at: "2026-06-25T13:00:00.000Z" },
  { race_id: "race-done-1", stage_number: 1, scheduled_at: "2026-03-01T13:00:00.000Z" },
  { race_id: "race-done-2", stage_number: 1, scheduled_at: "2026-05-09T13:00:00.000Z" },
  { race_id: "race-done-2", stage_number: 2, scheduled_at: "2026-05-10T13:00:00.000Z" },
];

// league_divisions — tier/pulje-referencedata til Resultat-hubbens (#3197),
// StandingsPage's og CalendarPage's sæson/division/pulje-vælgere. Samme
// id/tier/pool_index-nøgler som SEED_CALENDAR's divisions-træ herunder, så
// begge flader viser identiske puljer på preview. TEST_TEAM.league_division_id
// (2) = "Division 2 — A", MED en søsterpulje "Division 2 — B" i samme tier —
// bevidst, så pulje-vælgeren (kun vist når en tier har >1 pulje) kan
// klik-testes for holdets egen division.
export const SEED_LEAGUE_DIVISIONS = [
  { id: 1, tier: 1, pool_index: 0, label: "Division 1" },
  { id: 2, tier: 2, pool_index: 0, label: "Division 2 — A" },
  { id: 3, tier: 2, pool_index: 1, label: "Division 2 — B" },
  { id: 4, tier: 3, pool_index: 0, label: "Division 3 — A" },
  { id: 5, tier: 3, pool_index: 1, label: "Division 3 — B" },
];

// race_results — stage- + gc-rækker for de KØRTE løb. RaceDetailPage filtrerer
// result_type ("stage"/"gc"/"points"/"mountain") + højeste stage_number = endeligt klassement.
export const SEED_RACE_RESULTS = [
  // race-done-1 (endags-monument) — stage = endelig.
  { id: "res-d1-s1-1", race_id: "race-done-1", stage_number: 1, result_type: "stage", rank: 1, rider_id: RIDERS[0].id, rider_name: "Ada Pedersen", team_id: TEST_TEAM.id, team_name: TEST_TEAM.name, finish_time: "+0:00", points_earned: 25, prize_money: 100000, in_breakaway: true, breakaway_caught: false, rider: { id: RIDERS[0].id, firstname: "Ada", lastname: "Pedersen", nationality_code: "dk", team: { id: TEST_TEAM.id, name: TEST_TEAM.name } } },
  { id: "res-d1-s1-2", race_id: "race-done-1", stage_number: 1, result_type: "stage", rank: 2, rider_id: RIDERS[1].id, rider_name: "Mikkel Hansen", team_id: RIVAL_TEAM.id, team_name: RIVAL_TEAM.name, finish_time: "+0:14", points_earned: 20, prize_money: 60000, in_breakaway: false, breakaway_caught: false, rider: { id: RIDERS[1].id, firstname: "Mikkel", lastname: "Hansen", nationality_code: "dk", team: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name } } },
  // race-done-2 (2-etape stage-race) — stage 2 + samlet GC.
  { id: "res-d2-s1-1", race_id: "race-done-2", stage_number: 1, result_type: "stage", rank: 1, rider_id: RIDERS[0].id, rider_name: "Ada Pedersen", team_id: TEST_TEAM.id, team_name: TEST_TEAM.name, finish_time: "+0:00", points_earned: 25, prize_money: 80000, in_breakaway: false, breakaway_caught: false, rider: { id: RIDERS[0].id, firstname: "Ada", lastname: "Pedersen", nationality_code: "dk", team: { id: TEST_TEAM.id, name: TEST_TEAM.name } } },
  { id: "res-d2-s2-1", race_id: "race-done-2", stage_number: 2, result_type: "stage", rank: 1, rider_id: RIDERS[1].id, rider_name: "Mikkel Hansen", team_id: RIVAL_TEAM.id, team_name: RIVAL_TEAM.name, finish_time: "+0:00", points_earned: 25, prize_money: 80000, in_breakaway: false, breakaway_caught: false, rider: { id: RIDERS[1].id, firstname: "Mikkel", lastname: "Hansen", nationality_code: "dk", team: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name } } },
  { id: "res-d2-gc-1", race_id: "race-done-2", stage_number: 2, result_type: "gc", rank: 1, rider_id: RIDERS[1].id, rider_name: "Mikkel Hansen", team_id: RIVAL_TEAM.id, team_name: RIVAL_TEAM.name, finish_time: "+0:00", points_earned: 50, prize_money: 120000, in_breakaway: false, breakaway_caught: false, rider: { id: RIDERS[1].id, firstname: "Mikkel", lastname: "Hansen", nationality_code: "dk", team: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name } } },
  { id: "res-d2-gc-2", race_id: "race-done-2", stage_number: 2, result_type: "gc", rank: 2, rider_id: RIDERS[0].id, rider_name: "Ada Pedersen", team_id: TEST_TEAM.id, team_name: TEST_TEAM.name, finish_time: "+0:22", points_earned: 40, prize_money: 90000, in_breakaway: false, breakaway_caught: false, rider: { id: RIDERS[0].id, firstname: "Ada", lastname: "Pedersen", nationality_code: "dk", team: { id: TEST_TEAM.id, name: TEST_TEAM.name } } },
  // #1485 Holdklassement-rækker — faithful ift. prod: rider_id/rider_name/team_name=null,
  // finish_time=null; KUN team_id + det direkte team:team_id-join driver visningen.
  { id: "res-d1-team-1", race_id: "race-done-1", stage_number: 1, result_type: "team", rank: 1, rider_id: null, rider_name: null, team_id: TEST_TEAM.id, team_name: null, finish_time: null, points_earned: 20, prize_money: 40000, in_breakaway: false, breakaway_caught: false, rider: null, team: { id: TEST_TEAM.id, name: TEST_TEAM.name } },
  { id: "res-d1-team-2", race_id: "race-done-1", stage_number: 1, result_type: "team", rank: 2, rider_id: null, rider_name: null, team_id: RIVAL_TEAM.id, team_name: null, finish_time: null, points_earned: 15, prize_money: 24000, in_breakaway: false, breakaway_caught: false, rider: null, team: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name } },
  { id: "res-d2-team-1", race_id: "race-done-2", stage_number: 2, result_type: "team", rank: 1, rider_id: null, rider_name: null, team_id: RIVAL_TEAM.id, team_name: null, finish_time: null, points_earned: 20, prize_money: 40000, in_breakaway: false, breakaway_caught: false, rider: null, team: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name } },
  { id: "res-d2-team-2", race_id: "race-done-2", stage_number: 2, result_type: "team", rank: 2, rider_id: null, rider_name: null, team_id: TEST_TEAM.id, team_name: null, finish_time: null, points_earned: 15, prize_money: 24000, in_breakaway: false, breakaway_caught: false, rider: null, team: { id: TEST_TEAM.id, name: TEST_TEAM.name } },
  // #3333 — race-live-1 (Settimana Preview, igangværende, 2/5 etaper): 'leader'-
  // rækker for seneste kørte etape (2), samme resultat_type som motoren skriver
  // undervejs (raceLiveStandings.js/#2081) — status forbliver 'scheduled', kun
  // stages_completed markerer fremdriften. Uden disse rækker viser Resultat-
  // hubbens kort "ingen klassement" for et løb der reelt har en løbende stilling.
  { id: "res-live1-leader-1", race_id: "race-live-1", stage_number: 2, result_type: "leader", rank: 1, rider_id: RIDERS[0].id, rider_name: "Ada Pedersen", team_id: TEST_TEAM.id, team_name: TEST_TEAM.name, finish_time: "+0:00", points_earned: 20, prize_money: 0, in_breakaway: false, breakaway_caught: false, rider: { id: RIDERS[0].id, firstname: "Ada", lastname: "Pedersen", nationality_code: "dk", team: { id: TEST_TEAM.id, name: TEST_TEAM.name } } },
  { id: "res-live1-leader-2", race_id: "race-live-1", stage_number: 2, result_type: "leader", rank: 2, rider_id: RIDERS[1].id, rider_name: "Mikkel Hansen", team_id: RIVAL_TEAM.id, team_name: RIVAL_TEAM.name, finish_time: "+0:18", points_earned: 0, prize_money: 0, in_breakaway: false, breakaway_caught: false, rider: { id: RIDERS[1].id, firstname: "Mikkel", lastname: "Hansen", nationality_code: "dk", team: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name } } },
];

// race_stage_passages — Sub-4 (#2448) preview-seed: KOM/mellemsprint/mål-
// passager for de KØRTE etaper, så et klik på et waypoint på grafen viser
// "RESULT" i stedet for "AT STAKE" (StageWaypointReadout →
// passageResultsForWaypoint). waypoint_index er positionen i etapens RÅ
// climbs[]/mellemsprint-liste (matcher stageRouteProfile.waypointsFor), IKKE en
// km-sorteret position — se raceStagePassages.js. rider_id/rider_name/team_id
// er de samme to ryttere som SEED_RACE_RESULTS (RiderLink skal pege på en rytter
// der faktisk findes i preview). Løb uden rækker her (fx race-up-1, ikke kørt
// endnu) viser fortsat "AT STAKE" — det er den korrekte tilstand før en etape
// er kørt, ikke en fejl.
export const SEED_STAGE_PASSAGES = [
  // race-done-2 st2 (Giro di Preview, summit finish) — alle 3 KOM'er +
  // mellemsprintet + målet, så hele "RESULT"-flowet kan verificeres i preview.
  // Mikkel Hansen (RIVAL_TEAM) vinder etapen (matcher res-d2-s2-1) og tager
  // hver eneste passage; Ada Pedersen (TEST_TEAM) er 2. hver gang.
  { race_id: "race-done-2", stage_number: 2, waypoint_kind: "kom", waypoint_index: 0, waypoint_name: "Passo di San Pellegrino", waypoint_km: 45, climb_category: "3", rider_id: RIDERS[1].id, rider_name: "Mikkel Hansen", team_id: RIVAL_TEAM.id, passage_rank: 1, points: 2, bonus_seconds: 0 },
  { race_id: "race-done-2", stage_number: 2, waypoint_kind: "kom", waypoint_index: 0, waypoint_name: "Passo di San Pellegrino", waypoint_km: 45, climb_category: "3", rider_id: RIDERS[0].id, rider_name: "Ada Pedersen", team_id: TEST_TEAM.id, passage_rank: 2, points: 1, bonus_seconds: 0 },
  { race_id: "race-done-2", stage_number: 2, waypoint_kind: "kom", waypoint_index: 1, waypoint_name: "Salita di Bondone", waypoint_km: 95, climb_category: "2", rider_id: RIDERS[1].id, rider_name: "Mikkel Hansen", team_id: RIVAL_TEAM.id, passage_rank: 1, points: 5, bonus_seconds: 0 },
  { race_id: "race-done-2", stage_number: 2, waypoint_kind: "kom", waypoint_index: 1, waypoint_name: "Salita di Bondone", waypoint_km: 95, climb_category: "2", rider_id: RIDERS[0].id, rider_name: "Ada Pedersen", team_id: TEST_TEAM.id, passage_rank: 2, points: 3, bonus_seconds: 0 },
  // Fedaia er summit-finish på cat 1 → dobbelt KOM-point (komPointsForClimb).
  { race_id: "race-done-2", stage_number: 2, waypoint_kind: "kom", waypoint_index: 2, waypoint_name: "Passo di Fedaia", waypoint_km: 140, climb_category: "1", rider_id: RIDERS[1].id, rider_name: "Mikkel Hansen", team_id: RIVAL_TEAM.id, passage_rank: 1, points: 20, bonus_seconds: 0 },
  { race_id: "race-done-2", stage_number: 2, waypoint_kind: "kom", waypoint_index: 2, waypoint_name: "Passo di Fedaia", waypoint_km: 140, climb_category: "1", rider_id: RIDERS[0].id, rider_name: "Ada Pedersen", team_id: TEST_TEAM.id, passage_rank: 2, points: 16, bonus_seconds: 0 },
  { race_id: "race-done-2", stage_number: 2, waypoint_kind: "sprint", waypoint_index: 0, waypoint_name: "Intermediate Sprint", waypoint_km: 70, climb_category: null, rider_id: RIDERS[1].id, rider_name: "Mikkel Hansen", team_id: RIVAL_TEAM.id, passage_rank: 1, points: 20, bonus_seconds: 3 },
  { race_id: "race-done-2", stage_number: 2, waypoint_kind: "sprint", waypoint_index: 0, waypoint_name: "Intermediate Sprint", waypoint_km: 70, climb_category: null, rider_id: RIDERS[0].id, rider_name: "Ada Pedersen", team_id: TEST_TEAM.id, passage_rank: 2, points: 17, bonus_seconds: 2 },
  // Målet ligger på toppen af Fedaia (summit finish) — samme km som kom-index 2.
  { race_id: "race-done-2", stage_number: 2, waypoint_kind: "finish", waypoint_index: 0, waypoint_name: "Finish", waypoint_km: 140, climb_category: null, rider_id: RIDERS[1].id, rider_name: "Mikkel Hansen", team_id: RIVAL_TEAM.id, passage_rank: 1, points: 20, bonus_seconds: 10 },
  { race_id: "race-done-2", stage_number: 2, waypoint_kind: "finish", waypoint_index: 0, waypoint_name: "Finish", waypoint_km: 140, climb_category: null, rider_id: RIDERS[0].id, rider_name: "Ada Pedersen", team_id: TEST_TEAM.id, passage_rank: 2, points: 17, bonus_seconds: 6 },

  // race-done-1 st1 (Omloop Preview, endagsløb) — mellemsprint + mål (ingen
  // KOM'er: etapen har ingen climbs). Rækkefølgen matcher SEED_RACE_RESULTS
  // (Ada Pedersen vandt, in_breakaway:true).
  { race_id: "race-done-1", stage_number: 1, waypoint_kind: "sprint", waypoint_index: 0, waypoint_name: "Intermediate Sprint", waypoint_km: 60, climb_category: null, rider_id: RIDERS[0].id, rider_name: "Ada Pedersen", team_id: TEST_TEAM.id, passage_rank: 1, points: 20, bonus_seconds: 3 },
  { race_id: "race-done-1", stage_number: 1, waypoint_kind: "sprint", waypoint_index: 0, waypoint_name: "Intermediate Sprint", waypoint_km: 60, climb_category: null, rider_id: RIDERS[1].id, rider_name: "Mikkel Hansen", team_id: RIVAL_TEAM.id, passage_rank: 2, points: 17, bonus_seconds: 2 },
  { race_id: "race-done-1", stage_number: 1, waypoint_kind: "finish", waypoint_index: 0, waypoint_name: "Finish", waypoint_km: 165, climb_category: null, rider_id: RIDERS[0].id, rider_name: "Ada Pedersen", team_id: TEST_TEAM.id, passage_rank: 1, points: 50, bonus_seconds: 10 },
  { race_id: "race-done-1", stage_number: 1, waypoint_kind: "finish", waypoint_index: 0, waypoint_name: "Finish", waypoint_km: 165, climb_category: null, rider_id: RIDERS[1].id, rider_name: "Mikkel Hansen", team_id: RIVAL_TEAM.id, passage_rank: 2, points: 30, bonus_seconds: 6 },
];

// S4 (#1176): race_incidents preview-seed for race-done-2 — én DNF på etape 1
// (styrt) + ét meningsfuldt tab (mekanisk defekt) for GC-vinderen på etape 2, så
// recap-momenterne (abandon/notableCrash) og den kompakte DNF-sektion begge har
// noget at vise i preview uden en ægte DB. Fiktiv rytter (ikke i RIDERS) for
// abandon'et — matcher motorens virkelighed: en udgået rytter er ikke nødvendigvis
// en vi allerede har seedet resultater for.
export const SEED_RACE_INCIDENTS = [
  { id: "inc-d2-1", race_id: "race-done-2", stage_number: 1, rider_id: "rider-99", kind: "crash", outcome: "abandon", time_loss_seconds: null, rider: { id: "rider-99", firstname: "Tobias", lastname: "Krogh" } },
  { id: "inc-d2-2", race_id: "race-done-2", stage_number: 2, rider_id: RIDERS[1].id, kind: "mechanical", outcome: "time_loss", time_loss_seconds: 134, rider: { id: RIDERS[1].id, firstname: "Mikkel", lastname: "Hansen" } },
];

// S6 (#2355): race_stage_moments preview-seed for race-done-2 — dækker BÅDE
// "beats" (gc_takeover + final_gc → WhyPanel på etape-fanen og "samlet") OG
// story-tags (tag_outsider_win/tag_jour_sans på Ada → badges i resultat-
// tabellen; tag_crash_ruined på den fiktive rider-99 der allerede har en
// incident-seed ovenfor — han optræder ikke i nogen resultat-række, så tagget
// forbliver usynligt i UI'et, samme graceful-degradation som DnfSection).
//
// D3 2026-08-04 (#3115 + #2356): sprint_win (st1) + solo_win (st2) tilføjet —
// UDEN et vindermoment falder RaceReportPanel (raceReport.js) tilbage til v1
// (buildRaceReport → null), så de to var nødvendige for at v2-rapporten rent
// faktisk kan skærmbilledes. tag_aggression_no_cost/tag_saved_effort/
// tag_gave_everything demonstrerer de to nye moment-typer.
export const SEED_RACE_STAGE_MOMENTS = [
  { id: "mom-d2-s1-1", race_id: "race-done-2", stage_number: 1, moment_key: "team_day", params: { teamId: TEST_TEAM.id, count: 2 }, significance: 45, rider_ids: [], team_ids: [TEST_TEAM.id] },
  { id: "mom-d2-s1-2", race_id: "race-done-2", stage_number: 1, moment_key: "tag_outsider_win", params: { riderId: RIDERS[0].id }, significance: 30, rider_ids: [RIDERS[0].id], team_ids: [] },
  { id: "mom-d2-s1-3", race_id: "race-done-2", stage_number: 1, moment_key: "sprint_win", params: { riderId: RIDERS[0].id, gapSeconds: 1 }, significance: 50, rider_ids: [RIDERS[0].id], team_ids: [TEST_TEAM.id] },
  { id: "mom-d2-s1-4", race_id: "race-done-2", stage_number: 1, moment_key: "tag_aggression_no_cost", params: { riderId: RIDERS[1].id }, significance: 30, rider_ids: [RIDERS[1].id], team_ids: [] },
  { id: "mom-d2-s2-1", race_id: "race-done-2", stage_number: 2, moment_key: "gc_takeover", params: { riderId: RIDERS[1].id, previousLeaderId: RIDERS[0].id }, significance: 80, rider_ids: [RIDERS[1].id, RIDERS[0].id], team_ids: [] },
  { id: "mom-d2-s2-2", race_id: "race-done-2", stage_number: 2, moment_key: "final_gc", params: { riderIds: [RIDERS[1].id, RIDERS[0].id] }, significance: 90, rider_ids: [RIDERS[1].id, RIDERS[0].id], team_ids: [] },
  { id: "mom-d2-s2-3", race_id: "race-done-2", stage_number: 2, moment_key: "tag_crash_ruined", params: { riderId: "rider-99", kind: "crash", outcome: "abandon" }, significance: 30, rider_ids: ["rider-99"], team_ids: [] },
  { id: "mom-d2-s2-4", race_id: "race-done-2", stage_number: 2, moment_key: "tag_jour_sans", params: { riderId: RIDERS[0].id }, significance: 30, rider_ids: [RIDERS[0].id], team_ids: [] },
  { id: "mom-d2-s2-5", race_id: "race-done-2", stage_number: 2, moment_key: "solo_win", params: { riderId: RIDERS[1].id, gapSeconds: 45 }, significance: 55, rider_ids: [RIDERS[1].id], team_ids: [RIVAL_TEAM.id] },
  { id: "mom-d2-s2-6", race_id: "race-done-2", stage_number: 2, moment_key: "tag_gave_everything", params: { riderId: RIDERS[1].id }, significance: 30, rider_ids: [RIDERS[1].id], team_ids: [] },
  { id: "mom-d2-s2-7", race_id: "race-done-2", stage_number: 2, moment_key: "tag_saved_effort", params: { riderId: RIDERS[0].id }, significance: 30, rider_ids: [RIDERS[0].id], team_ids: [] },
  // #3336: helper_work-forklaret favorit-nedtur på Mikkel (stage 2) — demonstrerer
  // at tag_favorite_collapse's badge-tooltip nu viser DEN FAKTISKE årsag
  // (ikke altid jour_sans-teksten som Adas tag_jour_sans ovenfor).
  { id: "mom-d2-s2-8", race_id: "race-done-2", stage_number: 2, moment_key: "favorite_off_day", params: { riderId: RIDERS[1].id, rank: 22, reason: "helper_work" }, significance: 65, rider_ids: [RIDERS[1].id], team_ids: [] },
  { id: "mom-d2-s2-9", race_id: "race-done-2", stage_number: 2, moment_key: "tag_favorite_collapse", params: { riderId: RIDERS[1].id, rank: 22, reason: "helper_work" }, significance: 30, rider_ids: [RIDERS[1].id], team_ids: [] },
];

// #3398 (Maiden Win Engine) — rider_career_events preview-seed. Ada Pedersen
// (RIDERS[0], TEST_TEAM) vandt race-done-1 (Omloop Preview, in_breakaway) — her
// maiden win, så MaidenWinMomentCard (dashboard), CareerFirstMomentRow-blokken
// på RaceDetailPage (race-done-1) og RiderPalmaresTab's career-firsts-liste alle
// har noget at vise uden en migreret prod-DB. club_milestone_win på race-done-2
// giver kortet en ANDEN event_type at rendere (variation i preview-skærmbillederne).
// age er hardcodet (ageForSeason(Ada.birthdate="2002-04-12", season 1) = 24) —
// preview-seed duplikerer bevidst IKKE backend-beregningen.
export const SEED_RIDER_CAREER_EVENTS = [
  {
    id: "cfe-1", event_type: "maiden_win", rider_id: RIDERS[0].id, team_id: TEST_TEAM.id,
    rider_name: "Ada Pedersen", team_name: TEST_TEAM.name, race_id: "race-done-1", season_number: 1,
    params: { raceName: "Omloop Preview", resultType: "stage", stageNumber: 1, age: 24 },
    significance: 90, occurred_at: "2026-03-01T16:00:00.000Z",
  },
  {
    id: "cfe-2", event_type: "club_milestone_win", rider_id: RIDERS[0].id, team_id: TEST_TEAM.id,
    rider_name: "Ada Pedersen", team_name: TEST_TEAM.name, race_id: "race-done-2", season_number: 1,
    params: { raceName: "Giro di Preview", resultType: "stage", stageNumber: 1, age: 24, milestoneCount: 25 },
    significance: 70, occurred_at: "2026-05-09T16:00:00.000Z",
  },
];

// #1997 S1 — Palmarès-fanens rytter-scopede race_results (rider_id=eq.<id>-query,
// RiderStatsPage.fetchAllRiderSeasonRows). Egen shape (race:-embed, IKKE rider:-embed
// som SEED_RACE_RESULTS ovenfor bruges til RaceDetailPage) — ingen delt lookup mod
// SEED_RACES, embeds er inlinede pr. række ligesom resten af denne fil.
//
// Dækker: GC-sejr + etapesejr + point-trøje + leder-dag (stage_race), en endagssejr,
// og en 3.-plads for et TIDLIGERE hold (team_name = RIVAL_TEAM) samme sæson — viser
// #1993-holdsnapshottet (holdet KAN skifte mellem resultater i samme sæson).
export const SEED_RIDER_PALMARES_RESULTS = [
  {
    rank: 1, prize_money: 15000, points_earned: 220, result_type: "gc", stage_number: 3, team_name: TEST_TEAM.name,
    race: { id: "race-palmares-gc", name: "Vuelta a Preview", race_type: "stage_race", race_class: "ProSeries", stages: 3, status: "completed", scheduled_for: "2026-06-05T14:00:00.000Z", season: { number: ACTIVE_SEASON.season_number }, pool: { terrain_archetype: "mountain_tour" } },
  },
  {
    rank: 1, prize_money: 3000, points_earned: 40, result_type: "stage", stage_number: 2, team_name: TEST_TEAM.name,
    race: { id: "race-palmares-gc", name: "Vuelta a Preview", race_type: "stage_race", race_class: "ProSeries", stages: 3, status: "completed", scheduled_for: "2026-06-05T14:00:00.000Z", season: { number: ACTIVE_SEASON.season_number }, pool: { terrain_archetype: "mountain_tour" } },
  },
  {
    rank: 1, prize_money: 2000, points_earned: 60, result_type: "points", stage_number: 3, team_name: TEST_TEAM.name,
    race: { id: "race-palmares-gc", name: "Vuelta a Preview", race_type: "stage_race", race_class: "ProSeries", stages: 3, status: "completed", scheduled_for: "2026-06-05T14:00:00.000Z", season: { number: ACTIVE_SEASON.season_number }, pool: { terrain_archetype: "mountain_tour" } },
  },
  {
    rank: 1, prize_money: 200, points_earned: 5, result_type: "leader", stage_number: 2, team_name: TEST_TEAM.name,
    race: { id: "race-palmares-gc", name: "Vuelta a Preview", race_type: "stage_race", race_class: "ProSeries", stages: 3, status: "completed", scheduled_for: "2026-06-05T14:00:00.000Z", season: { number: ACTIVE_SEASON.season_number }, pool: { terrain_archetype: "mountain_tour" } },
  },
  {
    rank: 1, prize_money: 4000, points_earned: 45, result_type: "gc", stage_number: 1, team_name: TEST_TEAM.name,
    race: { id: "race-palmares-oneday", name: "Trofeo Preview", race_type: "single", race_class: "Class1", stages: 1, status: "completed", scheduled_for: "2026-06-20T14:00:00.000Z", season: { number: ACTIVE_SEASON.season_number }, pool: { terrain_archetype: "puncheur" } },
  },
  {
    rank: 3, prize_money: 800, points_earned: 18, result_type: "gc", stage_number: 1, team_name: RIVAL_TEAM.name,
    race: { id: "race-palmares-podium", name: "Coppa Preview", race_type: "single", race_class: "Class2", stages: 1, status: "completed", scheduled_for: "2026-05-10T14:00:00.000Z", season: { number: ACTIVE_SEASON.season_number }, pool: { terrain_archetype: "hilly_classic" } },
  },
];

// #1997 holdside-slice: season_standings + hall_of_fame seed til Palmarès-fanens
// preview-screenshots (TeamProfilePage). 3 sæsoner — S1 (division 3), S2
// forfremmet til division 2, S3 (aktiv, uændret division) — så UI'en viser et
// konkret forfremmelses-eksempel. hall_of_fame er tom i ægte prod pr. 16/7
// (fyldes først ved sæson-transition, jf. audit-feature-liveness.js); én seed-
// post her så æresliste-blokken ikke KUN vises i sin tomme tilstand i preview.
// Rækkefølge: aktiv sæson FØRST — mocken implementerer ikke ægte .order(), så
// TeamProfilePage's "Sæsonresultater"-boks (.limit(1).single()) tager index[0].
// TeamPalmaresTab sorterer selv via buildSeasonHistory, så rækkefølgen her er
// ligegyldig for Palmarès-fanen.
export const SEED_TEAM_SEASON_STANDINGS = [
  { id: "standing-e2e-3", team_id: TEST_TEAM.id, division: 2, rank_in_division: 3, total_points: 4200, races_completed: 10, stage_wins: 2, gc_wins: 0, season: { number: 3, status: "active" }, pool: { label: "2A" } },
  { id: "standing-e2e-2", team_id: TEST_TEAM.id, division: 2, rank_in_division: 1, total_points: 11250, races_completed: 24, stage_wins: 7, gc_wins: 3, season: { number: 2, status: "completed" }, pool: { label: "2A" } },
  { id: "standing-e2e-1", team_id: TEST_TEAM.id, division: 3, rank_in_division: 2, total_points: 8400, races_completed: 22, stage_wins: 4, gc_wins: 1, season: { number: 1, status: "completed" }, pool: { label: "3B" } },
];

export const SEED_TEAM_HALL_OF_FAME = [
  { id: "hof-e2e-1", team_id: TEST_TEAM.id, category: "most_points_season", value: 11250, season_number: 2 },
];

// ── Resultat-hub-seed (#3102 etape 2) ────────────────────────────────────────
// /resultater var utestbar på preview: season_standings svarede kun på den
// team_id-scopede palmarès-query, rider_rankings_mv og race_points havde slet
// ingen handler, så hubben stod tom uanset hvad man klikkede på. Samme fælde som
// StrategyPage i etape 1.

// season_standings scopet på sæsonen (hubbens tophold-boks). AI-holdet er med
// med vilje: hubben filtrerer is_ai fra, og filteret skal kunne ses virke.
// #3197: league_division_id (2 = "Division 2 — A", TEST_TEAM's egen pulje) med
// på team-joinet, så Resultat-hubbens Tophold-boks kan pulje-filtreres på
// preview/e2e ligesom den ægte season_standings-query.
// vk-movement-signals: "team-ai-preview"s total_points er tættere på
// TEST_TEAM end før (var 4990) — mere realistisk enkelt-løbsdags-afstand.
// NB: Dashboardets EGEN "teams"-query (restRows case "teams" nedenfor) er
// hardcodet til KUN [TEST_TEAM, RIVAL_TEAM] uanset filter — "team-ai-preview"
// vises derfor ALDRIG på dashboardets "My division standings"-modul (kun på
// /resultater, som læser season_standings direkte). Rank-klatringen kan derfor
// ikke demonstreres i preview med kun 2 hold (se dashboardMovementSignals.test.js
// for den unit-testede klatre-sag); "+86" holdpoint-deltaet vises fortsat.
export const SEED_SEASON_STANDINGS = [
  { id: "hub-standing-1", season_id: ACTIVE_SEASON.id, team_id: RIVAL_TEAM.id, total_points: 6120, stage_wins: 4, gc_wins: 2, team: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name, is_ai: false, division: 2, league_division_id: 2 } },
  { id: "hub-standing-2", season_id: ACTIVE_SEASON.id, team_id: TEST_TEAM.id, total_points: 5480, stage_wins: 3, gc_wins: 1, team: { id: TEST_TEAM.id, name: TEST_TEAM.name, is_ai: false, division: 2, league_division_id: 2 } },
  { id: "hub-standing-3", season_id: ACTIVE_SEASON.id, team_id: "team-ai-preview", total_points: 5450, stage_wins: 2, gc_wins: 0, team: { id: "team-ai-preview", name: "Preview AI Cycling", is_ai: true, division: 2, league_division_id: 2 } },
];

// vk-movement-signals — team_race_points_mv: hold-point PR. LØB, samme
// tabel StandingsPage's progressions-graf allerede læser. "pool-race-done-2"
// (POOL_RACES ovenfor) er puljens seneste AFSLUTTEDE løbsdag: TEST_TEAM's 86
// point den dag matcher opgavens "+86"-eksempel og driver dashboardets
// holdpoint-delta-badge. "pool-race-done-1" er en TIDLIGERE løbsdag og
// påvirker ikke beregningen (kun sidste dag tæller) — med for realisme/
// season-total-troværdighed.
export const SEED_TEAM_RACE_POINTS_MV = [
  { season_id: ACTIVE_SEASON.id, team_id: TEST_TEAM.id, race_id: "pool-race-done-2", race_name: "Giro di Preview", race_points: 86 },
  { season_id: ACTIVE_SEASON.id, team_id: RIVAL_TEAM.id, race_id: "pool-race-done-2", race_name: "Giro di Preview", race_points: 10 },
  { season_id: ACTIVE_SEASON.id, team_id: "team-ai-preview", race_id: "pool-race-done-2", race_name: "Giro di Preview", race_points: 10 },
  { season_id: ACTIVE_SEASON.id, team_id: TEST_TEAM.id, race_id: "pool-race-done-1", race_name: "Omloop Preview", race_points: 20 },
  { season_id: ACTIVE_SEASON.id, team_id: RIVAL_TEAM.id, race_id: "pool-race-done-1", race_name: "Omloop Preview", race_points: 15 },
  { season_id: ACTIVE_SEASON.id, team_id: "team-ai-preview", race_id: "pool-race-done-1", race_name: "Omloop Preview", race_points: 25 },
];

// ── Global Rank-seed (#2792/#3193) ───────────────────────────────────────────
// global_rank_mv — bevidst UDEN "team-ai-preview" (AI-holdet fra
// SEED_SEASON_STANDINGS ovenfor): efter #2792 filtrerer selve matview'et
// AI-hold fra (is_ai=false i base-CTE'ens WHERE), så preview-seedet spejler
// den faktiske post-fix kontrakt — Global Rank-siden skal ALDRIG kunne vise
// et AI-hold, uanset hvad andre flader (fx /resultater) gør.
export const SEED_GLOBAL_RANK = [
  { team_id: "team-leader-preview", name: "Étoile du Léman", division: 1, banked_points: 8200, season_points: 1950, global_points: 10150, active_recent: true, is_rookie: false, global_rank: 1 },
  { team_id: RIVAL_TEAM.id, name: RIVAL_TEAM.name, division: RIVAL_TEAM.division, banked_points: 6120, season_points: 1480, global_points: 7600, active_recent: true, is_rookie: false, global_rank: 2 },
  { team_id: TEST_TEAM.id, name: TEST_TEAM.name, division: TEST_TEAM.division, banked_points: 4980, season_points: 1230, global_points: 6210, active_recent: true, is_rookie: false, global_rank: 3 },
  { team_id: "team-rookie-preview", name: "Nordkyst CK", division: 3, banked_points: 0, season_points: 2890, global_points: 2890, active_recent: true, is_rookie: true, global_rank: 4 },
];

// Ugentligt bevægelses-snapshot — giver ▲/▼-pilene på siden noget at vise.
export const SEED_GLOBAL_RANK_WEEKLY = [
  { team_id: "team-leader-preview", global_rank: 2 },
  { team_id: RIVAL_TEAM.id, global_rank: 3 },
  { team_id: TEST_TEAM.id, global_rank: 3 },
];

// Sæson-start-snapshot — "Climbers of the season"-panelet.
export const SEED_GLOBAL_RANK_SEASON_START = [
  { team_id: "team-leader-preview", global_rank: 3 },
  { team_id: RIVAL_TEAM.id, global_rank: 4 },
  { team_id: TEST_TEAM.id, global_rank: 5 },
  { team_id: "team-rookie-preview", global_rank: 4 },
];

// rider_rankings_mv — matview'en hubben og RiderRankingsPage læser top-5 fra.
// rider_id peger på seedede ryttere, så display-joinet mod riders faktisk finder
// dem (ellers filtreres rækken væk som "pensioneret siden matview-refresh").
export const SEED_RIDER_RANKINGS = [
  { season_id: ACTIVE_SEASON.id, rider_id: "rider-1", points: 1840, stage_wins: 3, gc_wins: 1, prize_earned: 245000 },
  { season_id: ACTIVE_SEASON.id, rider_id: "rider-2", points: 1610, stage_wins: 2, gc_wins: 1, prize_earned: 198000 },
];

// #3190: løbsdage pr. rytter (get_rider_race_days RPC) — Mit Holds Stats-fane.
// Kun rider-1 (TEST_TEAM) er relevant på preview/e2e; rider-2 tilføjet for paritet.
export const SEED_RIDER_RACE_DAYS = [
  { rider_id: "rider-1", race_days: 18 },
  { rider_id: "rider-2", race_days: 14 },
];

// race_points — pointtabellen bag Point & præmier-fanen. Ikke hele prod-tabellen:
// tre klasser × de klassementer fanen faktisk grupperer på, så både klasse-
// skifteren, per-dag-trøjekortene og præmieformlen kan klikkes igennem.
export const SEED_RACE_POINTS = [
  { race_class: "TourFrance", result_type: "Klassement", rank: 1, points: 1300 },
  { race_class: "TourFrance", result_type: "Klassement", rank: 2, points: 900 },
  { race_class: "TourFrance", result_type: "Klassement", rank: 3, points: 700 },
  { race_class: "TourFrance", result_type: "Etapeplacering", rank: 1, points: 210 },
  { race_class: "TourFrance", result_type: "Etapeplacering", rank: 2, points: 160 },
  { race_class: "TourFrance", result_type: "Pointtroje", rank: 1, points: 400 },
  { race_class: "TourFrance", result_type: "Forertroje", rank: 1, points: 60 },
  { race_class: "Monuments", result_type: "Klassiker", rank: 1, points: 800 },
  { race_class: "Monuments", result_type: "Klassiker", rank: 2, points: 600 },
  { race_class: "Monuments", result_type: "KlassikerHold", rank: 1, points: 120 },
  // #3718: prod HAR trøje-rækker for Monuments (Pointtroje/Bjergtroje/Ungdomstroje) — de bruges
  // af klasse-tabellen på Point & præmier-fanen. Fixturen manglede dem, og netop derfor kunne
  // hverken preview eller e2e se at "forventet pulje" talte trøjer med på et endagsløb der
  // aldrig uddeler dem. Rækkerne hører til her; præmieformlen skal ignorere dem for `single`.
  { race_class: "Monuments", result_type: "Pointtroje", rank: 1, points: 80 },
  { race_class: "Monuments", result_type: "Bjergtroje", rank: 1, points: 80 },
  { race_class: "Monuments", result_type: "Ungdomstroje", rank: 1, points: 40 },
  { race_class: "Class2", result_type: "Klassiker", rank: 1, points: 40 },
  { race_class: "Class2", result_type: "Klassiker", rank: 2, points: 30 },
];

// #2917 · GET /api/managers/:teamId — managerprofilen havde INGEN mock-handler, så
// hele siden var utestbar på preview. Titler/beskrivelser matcher prods
// achievements-tabel (frontend oversætter dem via locales/*/achievements.json når
// nøglen findes; DB-værdien er fallback — præcis som i prod).
//
// Sammensætningen er valgt så begge tilstande kan ses: TEST_TEAM har et realistisk
// miks af oplåste, låste, låste-hemmelige og igangværende (progress), mens
// RIVAL_TEAM har nul oplåste og derfor viser tomtilstanden på "Senest låst op".
const MANAGER_ACHIEVEMENT_DEFS = [
  ["auction_first_bid", "auktioner", "Første bud", "Afgiv dit første bud på en auktion.", false],
  ["auction_first_win", "auktioner", "Første sejr", "Vind din første auktion.", false],
  ["auction_5_wins", "auktioner", "5 auktioner vundet", "Vind 5 auktioner i alt.", false],
  ["auction_25_wins", "auktioner", "25 auktioner vundet", "Vind 25 auktioner i alt.", false],
  ["auction_sniper", "auktioner", "Sniper", "Vind en auktion med minimumsbud.", false],
  ["transfer_first", "transfers", "Første handel", "Gennemfør din første transfer.", false],
  ["transfer_5", "transfers", "5 transfers", "Gennemfør 5 transfers i alt.", false],
  ["transfer_bargain", "transfers", "The Steal", "Buy a rider for less than half his value.", true],
  ["team_15_riders", "hold", "Voksende hold", "Hav 15 ryttere på dit hold samtidig.", false],
  ["team_youth", "hold", "Ungdomshold", "Hav mindst 50% U25-ryttere på dit hold.", false],
  ["team_star", "hold", "Star team", "Have a star rider on your team: a rider valued at 8,000,000 CZ$ or more.", false],
  ["team_5_achievements", "hold", "Trofæskab", "Lås op for 5 achievements.", false],
  ["team_promotion", "hold", "Oprykket!", "Ryk op i en højere division.", false],
  ["team_relegation", "hold", "Nedrykning", "Ryk ned i en lavere division.", false],
  ["team_survived", "hold", "Overlevede", "Undgå nedrykning i en sæson hvor du var i farezonerne.", true],
  ["founder_badge", "sæson", "Founding Manager", "Here from the opening season. Permanent. Survives every reset.", false],
  ["season_first_result", "sæson", "Første resultat", "Få dit første løbsresultat registreret.", false],
  ["season_top10", "sæson", "Top 10", "Slut en sæson i top 10 i din division.", false],
  ["season_top5", "sæson", "Top 5", "Slut en sæson i top 5 i din division.", false],
  ["season_top3", "sæson", "Podium", "Slut en sæson i top 3 i din division.", false],
  ["season_winner", "sæson", "Divisionsvinder", "Vind din division i en sæson.", false],
  ["season_div1_winner", "sæson", "Mester", "Vind Division 1.", false],
  ["season_3_top3", "sæson", "Konstant", "Slut i top 3 tre sæsoner i træk.", true],
  ["season_2_seasons", "sæson", "2 sæsoner overlevet", "Gennemfør 2 sæsoner.", false],
  ["season_grand_tour_rider", "sæson", "Grand Tour Hold", "Hav en rytter der deltager i en Grand Tour.", false],
  ["secret_streak_7", "hemmelig", "Ugentlig", "Log ind 7 dage i træk.", true],
  ["secret_watchlist_50", "hemmelig", "Spejder", "Tilføj 50 ryttere til din ønskeliste.", true],
];

// Oplåste for TEST_TEAM, med spredte tidsstempler så "Senest låst op" sorterer synligt.
const MANAGER_UNLOCKED_AT = {
  auction_first_bid: "2026-06-23T09:12:00.000Z",
  auction_first_win: "2026-06-24T18:40:00.000Z",
  auction_5_wins: "2026-07-02T20:05:00.000Z",
  auction_sniper: "2026-07-05T19:31:00.000Z",
  transfer_first: "2026-06-28T11:20:00.000Z",
  transfer_bargain: "2026-07-09T14:02:00.000Z",
  team_15_riders: "2026-06-23T09:45:00.000Z",
  team_youth: "2026-06-30T08:15:00.000Z",
  team_5_achievements: "2026-07-02T20:05:00.000Z",
  founder_badge: "2026-06-22T12:00:00.000Z",
  season_first_result: "2026-06-25T21:10:00.000Z",
  // De nye sæson-achievements (#2917) — tildelt ved sæsonskiftet, samme tidsstempel.
  season_top10: "2026-07-26T17:30:00.000Z",
  season_top5: "2026-07-26T17:30:00.000Z",
  season_top3: "2026-07-26T17:30:00.000Z",
  season_winner: "2026-07-26T17:30:00.000Z",
  team_promotion: "2026-07-26T17:30:00.000Z",
  secret_streak_7: "2026-07-01T07:05:00.000Z",
};

// Progress mod næste mål for låste, ikke-hemmelige tæller-achievements (#1008).
const MANAGER_PROGRESS = {
  auction_25_wins: { current: 9, target: 25 },
  transfer_5: { current: 2, target: 5 },
  season_2_seasons: { current: 1, target: 2 },
};

export function seedManagerAchievements({ unlocked = true } = {}) {
  return MANAGER_ACHIEVEMENT_DEFS.map(([id, category, title, description, isSecret], index) => {
    const unlockedAt = unlocked ? MANAGER_UNLOCKED_AT[id] || null : null;
    const isUnlocked = Boolean(unlockedAt);
    // Backend redigerer titel/beskrivelse væk for LÅSTE hemmeligheder (#1666) —
    // mocken skal gøre præcis det samme, ellers tester preview en anden kontrakt.
    const hideSecret = !isUnlocked && isSecret;
    return {
      id,
      category,
      title: hideSecret ? null : title,
      description: hideSecret ? null : description,
      is_secret: isSecret,
      sort_order: index,
      unlocked: isUnlocked,
      unlocked_at: unlockedAt,
      progress: !isUnlocked && !isSecret ? MANAGER_PROGRESS[id] || null : null,
    };
  });
}

export const SEED_MANAGER_TRANSFERS = [
  {
    id: "tx-e2e-1",
    offer_amount: 640000,
    created_at: "2026-07-09T14:02:00.000Z",
    rider: { id: "rider-3", firstname: "Sofie", lastname: "Lund" },
    buyer_team: { id: TEST_TEAM.id, name: TEST_TEAM.name },
    seller_team: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name },
  },
  {
    id: "tx-e2e-2",
    offer_amount: 415000,
    created_at: "2026-06-28T11:20:00.000Z",
    rider: { id: "rider-4", firstname: "Jonas", lastname: "Brandt" },
    buyer_team: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name },
    seller_team: { id: TEST_TEAM.id, name: TEST_TEAM.name },
  },
];

// GET /api/teams/:id/transfer-history — #2400: holder BÅDE en faktisk handel
// og en no_sale-auktion, så toggle'en (TeamTransferHistoryTab, filterTransferHistoryNoSale)
// har noget reelt at skjule/vise på preview. Samme event-shape som backendens
// buildTeamTransferHistory (backend/lib/teamTransferHistory.js).
export const SEED_TRANSFER_HISTORY = [
  {
    id: "auction:tx-e2e-1",
    type: "auction",
    direction: "out",
    cash_flow: "in",
    date: "2026-07-09T14:02:00.000Z",
    rider: { id: "rider-3", firstname: "Sofie", lastname: "Lund" },
    counterparty: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name, is_ai: false },
    amount: 640000,
    no_sale: false,
    is_guaranteed_sale: false,
    season_number: ACTIVE_SEASON.season_number,
  },
  // #2400: en gennemført auktion uden bud — dette er events der ELLER ville
  // fylde historikken med "intet skete". Skjules som default via toggle'en.
  {
    id: "auction:tx-e2e-2",
    type: "auction",
    direction: "out",
    cash_flow: null,
    date: "2026-07-15T09:30:00.000Z",
    rider: { id: "rider-4", firstname: "Jonas", lastname: "Brandt" },
    counterparty: null,
    amount: null,
    no_sale: true,
    is_guaranteed_sale: false,
    season_number: ACTIVE_SEASON.season_number,
  },
  {
    id: "transfer:tx-e2e-3",
    type: "transfer",
    direction: "in",
    cash_flow: "out",
    date: "2026-06-28T11:20:00.000Z",
    rider: { id: "rider-5", firstname: "Emil", lastname: "Kjær" },
    counterparty: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name, is_ai: false },
    amount: 415000,
    status: "accepted",
    season_number: ACTIVE_SEASON.season_number,
  },
];

// GET /api/riders/:id/history — #3708: rytterens egen offentlige historik
// (RiderHistoryTab). Samme event-shape som backendens buildRiderHistory
// (backend/lib/riderHistory.js). Holder BÅDE en no_sale-auktion (skal
// filtreres helt fra, se lib/riderHistoryTable.js) og en garanteret AI-salg
// uden buyer (buyer: null, no_sale: false → "AI team", ikke "Unknown"), så
// begge #3708-rettelser har noget reelt at bevise på preview/e2e.
export const SEED_RIDER_HISTORY = [
  {
    type: "auction",
    date: "2026-07-20T18:00:00.000Z",
    price: 210000,
    seller: { id: TEST_TEAM.id, name: TEST_TEAM.name, is_ai: false },
    buyer: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name },
    no_sale: false,
    is_ai_sale: false,
    is_guaranteed_sale: false,
  },
  // Gennemført auktion uden bud — må IKKE optræde i den rendrede historik.
  {
    type: "auction",
    date: "2026-07-05T09:00:00.000Z",
    price: null,
    seller: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name, is_ai: false },
    buyer: null,
    no_sale: true,
    is_ai_sale: false,
    is_guaranteed_sale: false,
  },
  // Garanteret AI-salg: current_bidder_id (buyer) er tomt, men no_sale er
  // false — det ER et salg, bare uden en menneske-modpart.
  {
    type: "auction",
    date: "2026-06-28T12:00:00.000Z",
    price: 95000,
    seller: { id: TEST_TEAM.id, name: TEST_TEAM.name, is_ai: false },
    buyer: null,
    no_sale: false,
    is_ai_sale: false,
    is_guaranteed_sale: true,
  },
  {
    type: "transfer",
    date: "2026-06-15T10:00:00.000Z",
    price: 150000,
    seller: { id: TEST_TEAM.id, name: TEST_TEAM.name },
    buyer: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name },
  },
];

// GET /api/races/distribution — board-aggregat. ≥1 tids-overlap-kolonne (begge
// kolonner deler bindingWindow → bindingMap binder en rytter væk fra den anden).
// roster = column[0].riders (RaceHubBoard: roster = columns[0]?.riders).
const SEED_BOARD_ROSTER = RIDERS.filter((r) => r.team_id === TEST_TEAM.id).map((r, i) => ({
  // `name` er wire-formatet fra buildRiderRows (fornavn+efternavn joinet server-side)
  // — kolonne-rækker, pulje-chips og #3102-overlayet læser alle det felt.
  id: r.id, name: [r.firstname, r.lastname].filter(Boolean).join(" "),
  firstname: r.firstname, lastname: r.lastname,
  primary_type: r.primary_type, secondary_type: r.secondary_type, nationality_code: r.nationality_code,
  // S5: suitability + aggression + kondition så RoleCards/FitBar/jæger-chip har data i preview.
  // #3115 Gap 1b: tactics stigende (modsat aggression) så RiderFitInsight-preview
  // dækker alle tre bånd (poor/average/strong) på tværs af truppen.
  suitability: 78 - i * 9, aggression: 72 - i * 6, tactics: 28 + i * 7, form: 60 - i * 3, fatigue: 12 + i * 7,
}));
export const SEED_DISTRIBUTION = {
  enabled: true,
  season: { id: ACTIVE_SEASON.id, number: ACTIVE_SEASON.season_number },
  currentDay: 12,
  focusDay: 12,
  columns: [
    {
      id: "race-up-1", name: "Tour de Preview", race_class: "TourFrance", race_type: "stage_race",
      // Etapeløb gd 12-14 (bindingWindow = in-game-dag-span, samme shape som API'en).
      stages: 3, stages_completed: 0, status: "scheduled",
      // #4187: window = raceTimeWindow(ms), samme form som API'en - loebskortet viser datoer.
      window: { start: Date.parse("2026-08-31T09:00:00Z"), end: Date.parse("2026-09-02T13:00:00Z") },
      bindingWindow: { start: 12, end: 14 },
      game_day: 12, game_day_end: 14, // #2195: synligt "Race days 12-14"-mærke
      // S5: fladt løb → jæger-chip = høj udbruds-chance.
      primaryProfileType: "flat", primaryFinaleType: null,
      size: { min: 6, max: 8 }, riders: SEED_BOARD_ROSTER,
      selection: { rider_ids: [RIDERS[0].id], captain_id: RIDERS[0].id, sprint_captain_id: null, hunter_id: null, is_auto_filled: false },
      withdrawn: false, lineup_locked: false,
      counts: { selected: 1, target: 8 },
      // #3102 PR 2: formplan-overlay — Ada topper netop her (stjerne-linjen på kortet).
      peakRiderIds: [RIDERS[0].id],
      paybackRiders: [],
    },
    {
      // In-game-dag-overlap med race-up-1 (gd 12 ⊂ 12-14) → én-rytter/ét-løb-binding.
      id: "race-overlap-1", name: "Critérium Preview", race_class: "ProSeries", race_type: "single",
      stages: 1, stages_completed: 0, status: "scheduled",
      window: { start: Date.parse("2026-08-31T11:00:00Z"), end: Date.parse("2026-08-31T11:00:00Z") },
      bindingWindow: { start: 12, end: 12 },
      game_day: 12, game_day_end: 12, // in-game-dag 12 → ægte overlap med race-up-1
      // S5: bjerg-løb med summit-finale → jæger-chip = lav udbruds-chance (favoritterne afgør).
      primaryProfileType: "high_mountain", primaryFinaleType: "long_climb",
      size: { min: 6, max: 7 }, riders: SEED_BOARD_ROSTER,
      selection: { rider_ids: [], captain_id: null, sprint_captain_id: null, hunter_id: null, is_auto_filled: false },
      withdrawn: false, lineup_locked: false,
      counts: { selected: 0, target: 7 },
      peakRiderIds: [],
      paybackRiders: [],
    },
    {
      // Kronologi-rebuild: samme IRL-dag, men in-game-dag 15 (efter race-up-1's span) → binder
      // IKKE race-up-1's ryttere. En rytter i Tour de Preview KAN derfor også stilles her.
      id: "race-free-1", name: "Klassiker Preview", race_class: "ProSeries", race_type: "single",
      stages: 1, stages_completed: 0, status: "scheduled",
      window: { start: Date.parse("2026-08-31T15:00:00Z"), end: Date.parse("2026-08-31T15:00:00Z") },
      bindingWindow: { start: 15, end: 15 },
      game_day: 15, game_day_end: 15, // samme IRL-dag, in-game-dag 15 → kompatibel med race-up-1
      primaryProfileType: "cobbles", primaryFinaleType: null,
      size: { min: 6, max: 7 }, riders: SEED_BOARD_ROSTER,
      selection: { rider_ids: [], captain_id: null, sprint_captain_id: null, hunter_id: null, is_auto_filled: false },
      withdrawn: false, lineup_locked: false,
      counts: { selected: 0, target: 7 },
      // #3102 PR 2: Ada betaler payback her (varsel-linjen på kortet) — hendes
      // peak-vindue om Tour de Preview (gd 12-14) sluttede dagen før dette løb.
      // Rytteren SKAL være i SEED_BOARD_ROSTER: kortet slår navnet op i kolonnens
      // riders og skjuler ukendte id'er, præcis som prod gør ved en solgt rytter.
      peakRiderIds: [],
      paybackRiders: [{ riderId: RIDERS[0].id, daysAfterPeak: 1 }],
    },
  ],
  // bindingMap (server): rider_id → kolonne-løb rytteren er i som overlapper et andet (game-dag).
  bindingMap: { [RIDERS[0].id]: ["race-up-1"] },
  // #3102 PR 2 / #2772: payback-dybde i formpoint (mock-spejling af motorens tal,
  // jf. plannerMock.js) + sæson-belastning pr. rytter til pulje-chips'ene.
  //
  // #4245: `seasonLoadByRider` herunder er et FÆRDIGT wire-svar, hårdkodet. Preview
  // kalder derfor ikke raceDaysByRace/seasonLoadByRider, og Race Hub-chippen kan
  // ikke demonstrere løbsdage-mod-etaper her. Den flade der KAN demonstrere det er
  // formplanens chip: plannerMock.js' r-alpine har 6 etaper på 5 løbsdage, og
  // riderSeasonLoad regnes klient-side dér. Ændrer du tallene herunder, så husk at
  // de er e2e-synlige (snapshots).
  paybackFormPoints: -14,
  seasonLoadByRider: Object.fromEntries(
    SEED_BOARD_ROSTER.map((r, i) => [r.id, { races: 2 + (i % 3), raceDays: 3 + i * 2 }]),
  ),
  timeline: {
    totalDays: 28,
    currentDay: 12,
    days: [
      { day: 10, dateText: "10 Jul" },
      { day: 11, dateText: "11 Jul" },
      { day: 12, dateText: "12 Jul" },
      { day: 13, dateText: "13 Jul" },
      { day: 14, dateText: "14 Jul" },
    ],
  },
};

// GET /api/races/distribution/browse — read-only "andre divisioner" (S6, #1835).
// PCS-style bruttotrupper: KUN {firstname,lastname,nationality_code} pr. rytter (ingen
// roller/form/træthed/egnethed). Ét synligt løb (to hold) + ét låst løb (uden for
// 7-dages-vinduet). Pulje-vælger: tier 1 (1 pulje) + tier 2 (2 puljer); egen = pulje 2.
const PREVIEW_SQUAD_RIVAL = [
  { id: "pb-r1", firstname: "Lars", lastname: "Aerts", nationality_code: "be" },
  { id: "pb-r2", firstname: "Tom", lastname: "Garnier", nationality_code: "fr" },
  { id: "pb-r3", firstname: "Pieter", lastname: "Janssen", nationality_code: "nl" },
  { id: "pb-r4", firstname: "Mads", lastname: "Holt", nationality_code: "dk" },
  { id: "pb-r5", firstname: "Nuno", lastname: "Costa", nationality_code: "pt" },
  { id: "pb-r6", firstname: "Karl", lastname: "Brandt", nationality_code: "de" },
];
const PREVIEW_SQUAD_OWN = [
  { id: "pb-o1", firstname: "Ada", lastname: "Pedersen", nationality_code: "dk" },
  { id: "pb-o2", firstname: "Mikkel", lastname: "Hansen", nationality_code: "dk" },
  { id: "pb-o3", firstname: "Sven", lastname: "Vossen", nationality_code: "nl" },
  { id: "pb-o4", firstname: "Remi", lastname: "Laurent", nationality_code: "fr" },
  { id: "pb-o5", firstname: "Otto", lastname: "Keller", nationality_code: "de" },
  { id: "pb-o6", firstname: "Iván", lastname: "Mbeki", nationality_code: "za" },
];
export const SEED_BROWSE = {
  enabled: true,
  season: { id: ACTIVE_SEASON.id, number: ACTIVE_SEASON.season_number },
  pools: [
    { id: 1, tier: 1, pool_index: 0, label: "Pool A" },
    { id: 2, tier: 2, pool_index: 0, label: "Pool A" },
    { id: 3, tier: 2, pool_index: 1, label: "Pool B" },
  ],
  pool: { id: 2, tier: 2, pool_index: 0, label: "Pool A" },
  ownPoolId: 2,
  currentDay: 12,
  focusDay: 12,
  horizonDays: 7,
  timeline: {
    totalDays: 28,
    currentDay: 12,
    days: [
      { day: 10, dateText: "10 Jul", hasMyRace: false },
      { day: 11, dateText: "11 Jul", hasMyRace: false },
      { day: 12, dateText: "12 Jul", hasMyRace: true },
      { day: 13, dateText: "13 Jul", hasMyRace: false },
      { day: 14, dateText: "14 Jul", hasMyRace: false },
    ],
  },
  columns: [
    {
      id: "race-up-1", name: "Tour de Preview", race_class: "ProSeries", race_type: "single",
      stages: 1, stages_completed: 0, status: "scheduled", window: { start: Date.parse("2026-08-31T17:00:00Z"), end: Date.parse("2026-08-31T17:00:00Z") },
      primaryProfileType: "flat", visible: true, daysUntilStart: 2, opensInDays: 0,
      teamCount: 2,
      teams: [
        { team: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name }, riders: PREVIEW_SQUAD_RIVAL },
        { team: { id: TEST_TEAM.id, name: TEST_TEAM.name }, riders: PREVIEW_SQUAD_OWN },
      ],
    },
    {
      id: "race-locked-1", name: "GP des Préviews", race_class: "Class1", race_type: "single",
      stages: 1, stages_completed: 0, status: "scheduled", window: { start: Date.parse("2026-09-06T11:00:00Z"), end: Date.parse("2026-09-06T11:00:00Z") },
      primaryProfileType: "hilly", visible: false, daysUntilStart: 11, opensInDays: 4,
      teamCount: 0, teams: [],
    },
  ],
};

// GET /api/races/:raceId/selection — udtagelses-panelet (RaceSelectionPanel).
// S5: riders bærer aggression så HunterExplainer kan rangere jæger-kandidater; én
// rytter forud-valgt som hunter så jæger-chippen + kandidat-listen er synlig i preview.
export const SEED_SELECTION = {
  enabled: true,
  race: { id: "race-up-1", status: "scheduled" },
  size: { min: 6, max: 8 },
  availableCount: 8,
  riders: SEED_BOARD_ROSTER.map((r, i) => ({
    id: r.id,
    name: `${r.firstname} ${r.lastname}`,
    primaryType: r.primary_type ?? null,
    secondaryType: r.secondary_type ?? null,
    suitability: r.suitability,
    stageSuitability: null,
    aggression: r.aggression,
    tactics: r.tactics,
    form: r.form,
    fatigue: r.fatigue,
    injured: i === SEED_BOARD_ROSTER.length - 1,
  })),
  selection: SEED_BOARD_ROSTER.length
    ? {
        rider_ids: SEED_BOARD_ROSTER.slice(0, Math.min(6, SEED_BOARD_ROSTER.length)).map((r) => r.id),
        captain_id: SEED_BOARD_ROSTER[0].id,
        sprint_captain_id: SEED_BOARD_ROSTER[1]?.id ?? null,
        hunter_id: SEED_BOARD_ROSTER[2]?.id ?? null,
        is_auto_filled: false,
      }
    : null,
};

// GET /api/races/strategy — holdets strategi + roster + kommende mål-løb.
// Modelleret på api.js res.json (~L1935): roster[{id,name,primaryType,secondaryType,
// suitabilities}], a_chain, captain_priorities, role_rules, target_race_ids, upcoming.
export const SEED_STRATEGY = {
  enabled: true,
  roster: RIDERS.filter((r) => r.team_id === TEST_TEAM.id).map((r) => ({
    id: r.id, name: `${r.firstname} ${r.lastname}`,
    primaryType: r.primary_type ?? null, secondaryType: r.secondary_type ?? null,
    suitabilities: { flat: 82, hills: 64, mountains: 41, cobbles: 55, time_trial: 60 },
  })),
  a_chain: [RIDERS[0].id],
  // #3102: buckets + rangordnede LISTER — samme form som backend leverer
  // (raceStrategy.js / raceStrategy.test.js) og som CaptainBoard læser via
  // TERRAIN_BUCKETS. Fixturen stod med skalar-id'er og de gamle bucket-navne
  // (hills/mountains/time_trial), så preview-mocken crashede StrategyPage på
  // list.map — dvs. ejeren kunne ikke teste strategisiden på preview.
  captain_priorities: { flat: [RIDERS[0].id], hilly: [RIDERS[0].id], mountain: [], cobbles: [RIDERS[0].id], itt: [] },
  role_rules: [
    { rider_id: RIDERS[0].id, bucket: "flat", role: "captain" },
  ],
  target_race_ids: ["race-up-1"],
  upcoming: [
    { id: "race-up-1", name: "Tour de Preview", race_class: "TourFrance", status: "scheduled", stages: 3, stages_completed: 0, bucket: "flat", is_target: true },
    { id: "race-live-1", name: "Settimana Preview", race_class: "ProSeries", status: "scheduled", stages: 5, stages_completed: 2, bucket: "hills", is_target: false },
  ],
};

// #2796: intake-tilbud udløber 7 dage efter created_at, og kortet viser nu
// nedtællingen. Med en fast dato i seed'et ville preview altid vise "udløbet",
// så tilbuds-datoerne er relative til nu: ét friskt, ét midt i, ét der brænder
// (så begge badge-toner — neutral og "haster" — er synlige i preview).
const daysAgoIso = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
const expiryFor = (createdIso) => new Date(new Date(createdIso).getTime() + 7 * 86_400_000).toISOString();
const INTAKE_CREATED = { fresh: daysAgoIso(1), mid: daysAgoIso(3), urgent: daysAgoIso(6) };

// GET /api/academy/me — eneste kilde for academy-payloaden. Konsumeres af
// mockHandlers.apiResponse("/api/academy/me") (return SEED_ACADEMY) → academy-
// specs afhænger af præcis denne form (3 intakes, 2 roster-ryttere).
export const SEED_ACADEMY = {
  enabled: true,
  slots: { used: 2, max: 8 },
  // #932 S7: senior-cap-tæller til promote/demote-confirm-dialogerne.
  seniorCount: 18,
  seniorMax: 30,
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
      base_value: 180000,
      market_value: 180000,
      prize_earnings_bonus: 0,
      // #2796: type-kolonnen + promote-dialogens løn-projektion.
      primary_type: "climber",
      secondary_type: "gc",
      current_production_value: 74000,
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
      base_value: 150000,
      market_value: 150000,
      prize_earnings_bonus: 0,
      primary_type: "sprinter",
      secondary_type: null,
      current_production_value: 61000,
    },
  ],
  // #2796: gradueringskortene bærer nu type/værdi/løn, så promovér/sælg/slip
  // ikke er et blindt valg. Seed'et har én pending graduate, så sektionen kan
  // ses i preview (den var før usynlig — payloaden havde ingen).
  graduations: [
    {
      riderId: "acad-r3",
      name: "Tobias Lindqvist",
      age: 21,
      deadline: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      nationality_code: "no",
      primary_type: "brostensrytter",
      secondary_type: "rouleur",
      salary: 18000,
      market_value: 240000,
    },
  ],
  intake: [
    {
      intakeId: "intake-1",
      riderId: "prospect-1",
      is_serious: true,
      status: "offered",
      created_at: INTAKE_CREATED.fresh,
      expiresAt: expiryFor(INTAKE_CREATED.fresh),
      signingFee: 50000, // 25% af market_value (ACADEMY.SIGNING_FEE_RATE)
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
        primary_type: "puncheur",
        secondary_type: "climber",
      },
      potentialEstimate: { lo: 3.5, hi: 5.0, exact: false, scoutLevel: 1 },
    },
    {
      intakeId: "intake-2",
      riderId: "prospect-2",
      is_serious: false,
      status: "offered",
      created_at: INTAKE_CREATED.mid,
      expiresAt: expiryFor(INTAKE_CREATED.mid),
      signingFee: 37500,
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
        primary_type: "tt",
        secondary_type: "rouleur",
      },
      potentialEstimate: { lo: 2.0, hi: 4.0, exact: false, scoutLevel: 0 },
    },
    {
      intakeId: "intake-3",
      riderId: "prospect-3",
      is_serious: false,
      status: "offered",
      created_at: INTAKE_CREATED.urgent,
      expiresAt: expiryFor(INTAKE_CREATED.urgent),
      signingFee: 45000,
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
        primary_type: "baroudeur",
        secondary_type: null,
      },
      potentialEstimate: { lo: 3.0, hi: 3.0, exact: true, scoutLevel: 3 },
    },
  ],
};

// GET /api/academy/pnl — akademi-regnskabet (#2485, addendum V3). Konsumeres af
// mockHandlers.apiResponse("/api/academy/pnl") (return SEED_ACADEMY_PNL). Viser
// et hold med to realiserede graduate-salg (én med præmie, én solgt til listepris)
// oveni den løbende drift/signing-historik, så begge kort + salgs-tabellen er
// synlige i preview uden en live backend.
export const SEED_ACADEMY_PNL = {
  enabled: true,
  current: { slotsUsed: 2, slotsMax: 8, payroll: 22000 },
  cumulative: {
    driftPaid: 25000,
    signingFeesPaid: 18000,
    salesProceeds: 220000,
    valueCreation: 35000,
    salesCount: 2,
    netCashFlow: 220000 - 25000 - 18000,
  },
  sales: [
    {
      riderId: "acad-r3-sold",
      riderName: "Théo Dubois",
      soldAt: "2026-07-02T15:30:00.000Z",
      price: 140000,
      listedValue: 105000,
      premium: 35000,
    },
    {
      riderId: "acad-r4-sold",
      riderName: "Mateo Rossi",
      soldAt: "2026-06-01T09:00:00.000Z",
      price: 80000,
      listedValue: 80000,
      premium: 0,
    },
  ],
};

// Race-kalender-seed (#in-game-race-calendar). Matcher GET /api/races/calendar's
// response-shape: { season, ownPoolId, entries[], days[], divisions[] }. Datoer ligger
// i en fast måned (juli 2026) så preview/E2E er deterministisk uafhængigt af "i dag".
// Holdet (TEST_TEAM) er i pulje 2 (Division 2 — A) → de entries får isMine=true.
function calEntry(o) {
  return {
    raceClass: "ProSeries",
    status: "scheduled",
    poolIndex: 0,
    gameDayEnd: o.gameDayStart,
    terrainStages: [o.terrain],
    entered: !!o.isMine,
    leaderSet: false,
    ...o,
  };
}

// #4102: to sæsoner i seedet, så SeasonPicker'en (Season 1 nuværende / Season 2
// kommende) faktisk har noget at vise på preview. availableSeasons driver
// picker'en; SEED_CALENDAR_S2 nedenfor er "next season, read-only" med samme
// løb forskudt +60 dage og ingen udtagelser endnu (ny sæson, intet valgt).
const AVAILABLE_SEASONS_PREVIEW = [
  { id: ACTIVE_SEASON.id, number: ACTIVE_SEASON.season_number, status: "active" },
  { id: "season-e2e-2", number: ACTIVE_SEASON.season_number + 1, status: "upcoming" },
];

function shiftIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const SEED_CALENDAR = {
  season: { id: ACTIVE_SEASON.id, number: ACTIVE_SEASON.season_number, raceDaysTotal: 60, raceDaysCompleted: 14 },
  availableSeasons: AVAILABLE_SEASONS_PREVIEW,
  ownPoolId: TEST_TEAM.league_division_id,
  divisions: [
    { division: 1, pools: [{ id: 1, label: "Division 1", poolIndex: 0 }] },
    { division: 2, pools: [{ id: 2, label: "Division 2 — A", poolIndex: 0 }, { id: 3, label: "Division 2 — B", poolIndex: 1 }] },
    { division: 3, pools: [{ id: 4, label: "Division 3 — A", poolIndex: 0 }, { id: 5, label: "Division 3 — B", poolIndex: 1 }] },
  ],
  days: [
    { gameDay: 12, date: "2026-07-02" }, { gameDay: 14, date: "2026-07-04" },
    { gameDay: 17, date: "2026-07-07" }, { gameDay: 20, date: "2026-07-10" },
    { gameDay: 22, date: "2026-07-12" }, { gameDay: 26, date: "2026-07-16" },
    { gameDay: 30, date: "2026-07-20" },
  ],
  entries: [
    // Holdets egne løb (Division 2 — A) — fremhævet, guld-accent.
    calEntry({ id: "cal-1", name: "Grand Prix de Namur", raceType: "single", stages: 1, division: 2, poolId: 2, poolLabel: "Division 2 — A", gameDayStart: 12, date: "2026-07-02", terrain: "sprint", isMine: true, leaderSet: true }),
    calEntry({ id: "cal-2", name: "Tour des Hauts Plateaux", raceType: "stage_race", stages: 8, division: 2, poolId: 2, poolLabel: "Division 2 — A", gameDayStart: 14, gameDayEnd: 17, date: "2026-07-04", terrain: "mountain", terrainStages: ["mountain", "mountain", "hilly"], isMine: true, leaderSet: true, raceClass: "WorldTour" }),
    calEntry({ id: "cal-3", name: "Giro Veneto", raceType: "single", stages: 1, division: 2, poolId: 2, poolLabel: "Division 2 — A", gameDayStart: 20, date: "2026-07-10", terrain: "hilly", isMine: true, leaderSet: false }),
    calEntry({ id: "cal-4", name: "Klasika Bizkaia", raceType: "single", stages: 1, division: 2, poolId: 2, poolLabel: "Division 2 — A", gameDayStart: 22, date: "2026-07-12", terrain: "itt", isMine: true, leaderSet: true }),
    calEntry({ id: "cal-4b", name: "Chrono des Nations", raceType: "single", stages: 1, division: 2, poolId: 2, poolLabel: "Division 2 — A", gameDayStart: 20, date: "2026-07-10", terrain: "ttt", isMine: true, leaderSet: false }),
    // #2605: brosten-løb — verificerer at kalenderen viser det egne brosten-ikon (var
    // tidligere umuligt at skelne fra en flad sprint-etape).
    calEntry({ id: "cal-11", name: "E3 Saxo Classic", raceType: "single", stages: 1, division: 2, poolId: 2, poolLabel: "Division 2 — A", gameDayStart: 17, date: "2026-07-07", terrain: "cobbles", isMine: true, leaderSet: false }),
    calEntry({ id: "cal-5", name: "Vuelta a Burgos", raceType: "stage_race", stages: 5, division: 2, poolId: 2, poolLabel: "Division 2 — A", gameDayStart: 26, gameDayEnd: 30, date: "2026-07-16", terrain: "mountain", terrainStages: ["mountain", "mountain", "sprint", "hilly", "mountain"], isMine: true, leaderSet: false, raceClass: "ProSeries" }),
    // Andre divisioner — dæmpet/grå.
    calEntry({ id: "cal-6", name: "Grand Prix de Namur", raceType: "single", stages: 1, division: 1, poolId: 1, poolLabel: "Division 1", gameDayStart: 12, date: "2026-07-02", terrain: "sprint", isMine: false }),
    calEntry({ id: "cal-7", name: "Grand Prix de Namur", raceType: "single", stages: 1, division: 3, poolId: 4, poolLabel: "Division 3 — A", gameDayStart: 12, date: "2026-07-02", terrain: "sprint", isMine: false }),
    calEntry({ id: "cal-8", name: "Tour des Hauts Plateaux", raceType: "stage_race", stages: 8, division: 1, poolId: 1, poolLabel: "Division 1", gameDayStart: 14, gameDayEnd: 17, date: "2026-07-04", terrain: "mountain", isMine: false }),
    calEntry({ id: "cal-9", name: "Giro Veneto", raceType: "single", stages: 1, division: 3, poolId: 5, poolLabel: "Division 3 — B", gameDayStart: 20, date: "2026-07-10", terrain: "hilly", isMine: false }),
    calEntry({ id: "cal-10", name: "Klasika Bizkaia", raceType: "single", stages: 1, division: 1, poolId: 1, poolLabel: "Division 1", gameDayStart: 22, date: "2026-07-12", terrain: "itt", isMine: false }),
    // #2756 — Division 2 — B (pool 3) had NO entries at all before, so the pool
    // selector had nothing to prove itself against: switching from "Division 2 — A"
    // to "— B" looked identical to "no filter". This one race lets a test/screenshot
    // show a group's calendar actually differing from its sibling group's.
    calEntry({ id: "cal-12", name: "Roue Tourangelle", raceType: "single", stages: 1, division: 2, poolId: 3, poolLabel: "Division 2 — B", gameDayStart: 12, date: "2026-07-02", terrain: "sprint", isMine: false }),
    // #2756 — a 5-race day in a division/pool nobody's own team plays in, so the
    // "+N more" overflow (>4 shown) and the day-detail expand have real coverage.
    // Division 3 — A only, so this is invisible on the "mine"/"Alle hold" tabs'
    // existing pixel-snapshot (own division is 2) — it only shows once a player
    // scouts Division 3 — A specifically.
    calEntry({ id: "cal-13", name: "Roc d'Azur", raceType: "single", stages: 1, division: 3, poolId: 4, poolLabel: "Division 3 — A", gameDayStart: 28, date: "2026-07-23", terrain: "sprint", isMine: false }),
    calEntry({ id: "cal-14", name: "Tro-Bro Léon", raceType: "single", stages: 1, division: 3, poolId: 4, poolLabel: "Division 3 — A", gameDayStart: 28, date: "2026-07-23", terrain: "cobbles", isMine: false }),
    calEntry({ id: "cal-15", name: "Faun-Ardèche Classic", raceType: "single", stages: 1, division: 3, poolId: 4, poolLabel: "Division 3 — A", gameDayStart: 28, date: "2026-07-23", terrain: "hilly", isMine: false }),
    calEntry({ id: "cal-16", name: "Japan Cup", raceType: "single", stages: 1, division: 3, poolId: 4, poolLabel: "Division 3 — A", gameDayStart: 28, date: "2026-07-23", terrain: "mountain", isMine: false }),
    calEntry({ id: "cal-17", name: "Coppa Bernocchi", raceType: "single", stages: 1, division: 3, poolId: 4, poolLabel: "Division 3 — A", gameDayStart: 28, date: "2026-07-23", terrain: "itt", isMine: false }),
  ],
};

// #4102: "Season 2 (upcoming)" via ?season_number=2 — samme løb som SEED_CALENDAR,
// forskudt +60 dage, ingen udtagelser (entered:false) og gameDay nulstillet (næste
// sæsons egen dagsakse), så Season-visningens read-only-tilstand kan screenshottes.
export const SEED_CALENDAR_S2 = {
  ...SEED_CALENDAR,
  season: { id: "season-e2e-2", number: ACTIVE_SEASON.season_number + 1, raceDaysTotal: 60, raceDaysCompleted: 0 },
  entries: SEED_CALENDAR.entries.map((e) => ({
    ...e,
    date: shiftIso(e.date, 60),
    stageSchedule: undefined,
    entered: false,
    leaderSet: false,
  })),
};

// #1441 A3 — start-tilstand for Klub-preview (mid-game D2-hold). Muteres af clubMock.
// #3489: staffSlots er nu et fast 2-langt array (slot 1, slot 2) i stedet for ét
// `staff`-felt — spejler backend/lib/facilityConstants.js' MAX_STAFF_SLOTS_PER_ROLE.
// Training seedes MED begge slots besat, så ejeren kan se/klikke den nye
// "2 samtidige staff i samme rolle"-tilstand uden selv at ansætte først.
export const SEED_CLUB = {
  facilities: {
    training: { tier: 2, staffSlots: [{ name: "Sofie Lindqvist", tier: 2 }, { name: "Bjarne Holmqvist", tier: 3 }] },
    scouting: { tier: 1, staffSlots: [null, null] },
    medical: { tier: 0, staffSlots: [null, null] },
    academy: { tier: 3, staffSlots: [{ name: "Aldo Terranova", tier: 1 }, null] },
    commercial: { tier: 0, staffSlots: [null, null] },
  },
};

// #2100 preview-seed: Udvikling-fanen med loft-projektion. En udviklende ung sprinter
// + det maskerede loft-bånd + fuzzy projektion.
//
// #3666: serien SLUTTER nu præcis på rytterens nuværende evner. Før gjorde den
// ikke: historikken endte på evner der gav rating 50, mens rytteren selv står på
// 79 — samme rytter, samme rolle, to tal. På den gamle skala var forskellen
// gemt af normaliseringen; på den nye stod heroen og grafens sidste punkt og
// modsagde hinanden på skærmen. Historien er den samme (en sprinter der vokser
// på sprint/acceleration/fladt mens resten står stille), kun endepunktet er
// bundet til sandheden. `seedData.consistency.test.js` håndhæver bindingen.
export const SEED_DEVELOPMENT = [
  { snapshot_date: "2026-03-01", season_number: 6, source: "baseline", abilities: { climbing: 19, time_trial: 22, flat: 25, tempo: 23, sprint: 23, acceleration: 21, punch: 26, endurance: 24, recovery: 25, durability: 26, descending: 23, cobblestone: 21, positioning: 27, aggression: 22, tactics: 25 } },
  { snapshot_date: "2026-04-01", season_number: 6, source: "daily_training", abilities: { climbing: 19, time_trial: 22, flat: 26, tempo: 23, sprint: 25, acceleration: 23, punch: 26, endurance: 24, recovery: 25, durability: 26, descending: 23, cobblestone: 21, positioning: 27, aggression: 22, tactics: 25 } },
  { snapshot_date: "2026-05-01", season_number: 6, source: "daily_training", abilities: { climbing: 19, time_trial: 22, flat: 27, tempo: 23, sprint: 27, acceleration: 25, punch: 26, endurance: 24, recovery: 25, durability: 26, descending: 23, cobblestone: 21, positioning: 27, aggression: 22, tactics: 25 } },
  { snapshot_date: "2026-06-01", season_number: 6, source: "daily_training", abilities: { climbing: 19, time_trial: 22, flat: 28, tempo: 23, sprint: 29, acceleration: 27, punch: 26, endurance: 24, recovery: 25, durability: 26, descending: 23, cobblestone: 21, positioning: 27, aggression: 22, tactics: 25 } },
  { snapshot_date: "2026-07-01", season_number: 6, source: "daily_training", abilities: { climbing: 19, time_trial: 22, flat: 29, tempo: 23, sprint: 31, acceleration: 29, punch: 26, endurance: 24, recovery: 25, durability: 26, descending: 23, cobblestone: 21, positioning: 27, aggression: 22, tactics: 25 } },
];

// #3666: tallene er REGNET med den ægte model ud fra seed-rytterens NUVÆRENDE
// evner + de nye `ability_caps` — først displayRecipes.ratingForRole, så
// buildTypeCeilingBands med seed-spejderen (overall 61, level 3), og til sidst
// projectCeilingBand/ceilingTiming fra developmentProjection.
//
// Rettet igen 14/8: første forsøg regnede fra historikkens SIDSTE SNAPSHOT i
// stedet for rytterens egne evner, og gav derfor now:50 mens heroen viste 79 —
// samme rytter, samme rolle, to tal på samme side. Kilden er nu rytteren selv,
// og `seedData.consistency.test.js` fejler hvis de to nogensinde skilles igen.
export const SEED_PROJECTION = {
  level: 3, maxLevel: 3, own: true, capsMissing: false,
  primaryKey: "sprinter", now: 29, ceil: { lo: 40, hi: 48 },
  band: [
    { season: 0, lo: 29, hi: 29 }, { season: 1, lo: 29, hi: 33 }, { season: 2, lo: 30, hi: 37 },
    { season: 3, lo: 31, hi: 38 }, { season: 4, lo: 31, hi: 39 }, { season: 5, lo: 32, hi: 40 },
    { season: 6, lo: 29, hi: 39 },
  ],
  timing: { seasons: { lo: 5, hi: null }, ageAt: { lo: 29, hi: null } },
  pastPeak: false,
};

// #3334 preview-seed: GET /api/riders/:id/scouting-report — samme sprinter-profil
// som SEED_PROJECTION, plus rapport-provenance (navngiven chefscout, tier 2) så
// feature'en er synlig på preview uden en hyret spejder i SEED_CLUB (der er
// bevidst stadig default-spejder, #1441 A3).
//
// #3666: kalibreringen er VÆK, og `types` er genereret ved at køre seed-rytterens
// NUVÆRENDE evner + `ability_caps` gennem den ÆGTE kæde — displayRecipes.
// ratingForRole på begge, derefter buildTypeCeilingBands med seed-spejderen
// (overall 61) på level 3. Preview viser dermed præcis hvad produktion ville
// returnere for denne profil, ikke plausible tal.
//
// Rækkefølgen er `RIDER_TYPE_KEYS`, ikke sorteret efter rating: kortet vælger
// selv sin visning, og et forsorteret seed ville skjule om det gør det rigtigt.
// `verdict` og `precision` er ligeledes regnet med de ægte funktioner
// (buildVerdict med de rekalibrerede tærskler 2/3/8, scoutPrecisionInfo mod det
// relative gulv). Dommen er `monitor`, ikke `keep_and_develop`: rytteren står 5
// point fra sit loft-midtpunkt, og det ligger over GAP_MONITOR (3) men under
// GAP_HIGH_UPSIDE (8). Det er tærsklerne der taler, ikke et valg her.
export const SEED_SCOUTING_REPORT = {
  level: 3, maxLevel: 3, own: true, capsMissing: false,
  primaryKey: "sprinter",
  stars: { lo: 4.5, hi: 5 },
  // #3746: progLo/progHi er prognose-båndets navn; ceilLo/ceilHi er en alias
  // (samme tal) for ældre klient-cache, se backend/routes/api.js.
  // `loft` (overgangs-designet, ejer 18/8): rollens loft pr. visnings-rolle —
  // tallene her er beregnet med den ÆGTE roleCeilRating/buildCapsForRider for
  // en 24-årig sprinter/rouleur (ikke håndopfundne), så preview matcher drift.
  types: [
    { key: "sprinter", now: 29, progLo: 40, progHi: 48, ceilLo: 40, ceilHi: 48, loft: 93 },
    { key: "tt", now: 23, progLo: 28, progHi: 37, ceilLo: 28, ceilHi: 37, loft: 65 },
    { key: "climber", now: 22, progLo: 26, progHi: 35, ceilLo: 26, ceilHi: 35, loft: 50 },
    { key: "puncheur", now: 25, progLo: 28, progHi: 36, ceilLo: 28, ceilHi: 36, loft: 61 },
    { key: "brostensrytter", now: 24, progLo: 30, progHi: 39, ceilLo: 30, ceilHi: 39, loft: 73 },
    { key: "baroudeur", now: 24, progLo: 29, progHi: 37, ceilLo: 29, ceilHi: 37, loft: 64 },
    { key: "rouleur", now: 27, progLo: 33, progHi: 42, ceilLo: 33, ceilHi: 42, loft: 81 },
    { key: "gc", now: 23, progLo: 26, progHi: 35, ceilLo: 26, ceilHi: 35, loft: 55 },
  ],
  verdict: { headlineKey: "monitor", confidence: "high", factorKeys: ["ceiling_gap", "value_gap", "type_match", "form_unknown"] },
  precision: { halfWidth: 4.29, nextHalfWidth: null, nextGain: 0, nextLevelIsUseless: false, maxUsefulLevel: 3, limitedByScout: false },
  // #3666: `market` sagde 420.000 om en rytter hvis egen række siger 1.680.000 —
  // to tal om samme rytter, synlige på samme profil. Nu er de enige, og
  // `expected` ligger stadig over, så "røverkøb?"-blokken har noget at vise.
  value: { market: 1680000, expected: 1870000 },
  scout: { isDefault: false, name: "Sofie Lindqvist", tier: 2, overall: 61, hiredAt: "2026-07-20T10:00:00.000Z" },
  generatedAt: "2026-08-05T09:00:00.000Z",
  // #4039: samme forbi-peak-flag som SEED_SCOUT_ESTIMATES["rider-1"] - Ada er
  // under PEAK_AGE, så loft-visningen er den udæmpede gren.
  pastPeak: false,
};

// #2819 preview-seed: onboarding-progress i den ÆGTE respons-form fra
// GET /api/me/onboarding-progress (steps[{key,done}] + completed_count/total_count
// + dismissed/established). Den gamle mock returnerede {steps:[], completed_steps,
// completion_pct} — en form ingen kode læser, så dashboard-kortet stod uden trin og
// "Show me how"-knappen kunne slet ikke klikkes i preview.
// #3007: trin 1 (first_bid_placed) sat til IKKE fuldført (var før "done" for at vise
// trin 2's tour by default). Det betyder AuctionsFirstBidHint + "Første valg"-
// anbefalingen på /auctions nu er synlig uden manuel localStorage-omgåelse, så
// ejeren kan se den flade der rent faktisk afgør aktivering direkte i preview.
// Ingen tests refererer denne seed (kun mockHandlers.js bruges af Playwright).
export const SEED_ONBOARDING_PROGRESS = {
  steps: [
    { key: "first_bid_placed", done: false },
    { key: "first_training_run", done: false },
    { key: "first_squad_selected", done: false },
    { key: "board_plan_set", done: false },
  ],
  completed_count: 0,
  total_count: 4,
  dismissed: false,
  established: false,
};

// #2819 preview-seed: /api/training/me. Uden den var /training tom i preview-mocken
// (ingen roster-tabel, ingen fokus-select), så trin 2's tour havde ingen ankre at
// pege på. Formen spejler useTraining.js' refresh(): plans/condition/progress/
// capped/trainability/smartDefaultFocus. Ada har et fokus + en bar tæt på gennembrud
// (0.82 → "82%"); Mikkel står uden fokus, så assistent-hintet også er synligt.
export const SEED_TRAINING = {
  enabled: true,
  teamId: TEST_TEAM.id,
  slots: { total: 2, used: 1 },
  // #3924 trin 1+2 (design-go 20/8): en gennemført kørsel i går, så preview kan
  // vise "Yesterday's gains"-resuméet + kvitteringsbarens mørke gårsdags-segment
  // uden at kræve et klik på "Træn i dag" (mock-serveren implementerer ikke
  // run-today-endpointet). Ada trænede sprint i går uden at lande et point
  // (+0-dagen #3988 handler om) — sprint gik 75 % → 82 %, som segmentet viser.
  todayRun: {
    executed_by: "manager",
    bonus_applied: true,
    tick_date: "2026-08-19",
    created_at: "2026-08-20T05:00:00Z",
    report: {
      riders: [
        {
          rider_id: "rider-1",
          name: "Ada Pedersen",
          score: 3.1,
          gains: {},
          gains_detail: {},
          progress_before: { sprint: 0.75, acceleration: 0.41 },
          status: "normal",
          form: 72,
          fatigue: 38,
          fatigue_delta: 4,
          injured: false,
          injury_days: 0,
          focus: "sprint",
          intensity: "hard",
          focus_source: "plan",
        },
      ],
    },
  },
  plans: {
    "rider-1": { focus: "sprint", intensity: "normal" },
  },
  condition: {
    "rider-1": { form: 72, fatigue: 38, risk: 0.02, injured_until: null },
    "rider-2": { form: 64, fatigue: 51, risk: 0.03, injured_until: null },
  },
  progress: {
    "rider-1": { sprint: 0.82, acceleration: 0.41 },
    "rider-2": { climbing: 0.35, punch: 0.22, tempo: 0.18 },
  },
  // #3639/#3709: preview SKAL kunne vise låste evner — med capped:{} kunne
  // kvitteringens "færdig"-tilstand ikke ses på preview, og en ejer-verifikation
  // af netop den rettelse var umulig.
  //   Ada (rider-1, fokus sprint): acceleration er låst, sprint har hovedrum →
  //     kvitteringens to sprint-linjer viser præcis forskellen (den ene "færdig",
  //     den anden 82 % på vej). Det var her den gamle ENE bar løj: den viste
  //     sprints 82 % og skjulte at acceleration stod stille.
  //   Mikkel (rider-2, ingen plan): climbing/punch/tempo alle låste → hele vo2max
  //     står "færdig" i kvitteringen, og det er samtidig assistentens
  //     smartDefaultFocus, hvilket er nøjagtig den tavse fælde spillerne faldt i.
  capped: {
    "rider-1": ["acceleration"],
    "rider-2": ["climbing", "punch", "tempo"],
  },
  // #3195: værdierne skal matche backend-vokabularet ("strength"/"limited"/
  // "blocked" — se training.js' focusTrainability), IKKE et "high"-synonym, ellers
  // renderer chippen/dropdown-markøren aldrig i preview (currentTrainability-tjekket
  // matcher kun "limited"/"blocked", og t(`trainability_${level}`) findes ikke for "high").
  trainability: {
    "rider-1": { sprint: "strength", acceleration: "strength", vo2max: "limited", threshold: "limited" },
    "rider-2": { vo2max: "strength", sprint: "blocked", aero: "limited" },
  },
  smartDefaultFocus: { "rider-2": "vo2max" },
  weekPlan: null,
  riderWeekPlans: {},
};

// ── #2863 · Sæsonens bedste ryttere (get_season_honours-RPC) ───────────────────────
// Payloaden fra public.get_season_honours(p_season_id): to top-5-lister, points
// og wins, allerede sorteret af serveren. Tallene serialiseres som STRENGE
// ligesom PostgREST gør med bigint, så preview/e2e faktisk afprøver den
// coercion normalizeHonours laver (uden den ville "9" > "28" sortere som tekst).
//
// Formen efterligner sæson 1 med vilje på to punkter, fordi det er dér den er
// nem at bygge forkert:
//   1. flest point er en AI-ejet rytter → AI-badget skal være synligt øverst
//   2. toppen af sejrs-listen er DELT (11 og 11) → tie-break-noten skal vises
// De to øverste peger på rigtige seed-ryttere, så navnene kan klikkes igennem.
export const SEED_SEASON_HONOURS = {
  points: [
    { rider_id: "rider-2", firstname: "Mikkel", lastname: "Hansen", nationality_code: "dk", team_id: RIVAL_TEAM.id, team_name: RIVAL_TEAM.name, is_ai: true, points: "3412", wins: "8" },
    { rider_id: "rider-1", firstname: "Ada", lastname: "Pedersen", nationality_code: "dk", team_id: TEST_TEAM.id, team_name: TEST_TEAM.name, is_ai: false, points: "2988", wins: "11" },
    { rider_id: "rider-honours-3", firstname: "Luca", lastname: "Bernasconi", nationality_code: "ch", team_id: "team-honours-3", team_name: "Preview Continental", is_ai: false, points: "2455", wins: "6" },
    { rider_id: "rider-honours-4", firstname: "Owen", lastname: "Delaney", nationality_code: "ie", team_id: "team-honours-4", team_name: "Harbour Racing", is_ai: false, points: "2103", wins: "4" },
    { rider_id: "rider-honours-5", firstname: "Timo", lastname: "Vogel", nationality_code: "de", team_id: "team-honours-5", team_name: "Nordwind Pro", is_ai: true, points: "1877", wins: "3" },
  ],
  wins: [
    { rider_id: "rider-1", firstname: "Ada", lastname: "Pedersen", nationality_code: "dk", team_id: TEST_TEAM.id, team_name: TEST_TEAM.name, is_ai: false, points: "2988", wins: "11" },
    { rider_id: "rider-honours-6", firstname: "Nils", lastname: "Ostergaard", nationality_code: "no", team_id: "team-honours-6", team_name: "Fjord Cycling", is_ai: false, points: "1640", wins: "11" },
    { rider_id: "rider-2", firstname: "Mikkel", lastname: "Hansen", nationality_code: "dk", team_id: RIVAL_TEAM.id, team_name: RIVAL_TEAM.name, is_ai: true, points: "3412", wins: "8" },
    { rider_id: "rider-honours-3", firstname: "Luca", lastname: "Bernasconi", nationality_code: "ch", team_id: "team-honours-3", team_name: "Preview Continental", is_ai: false, points: "2455", wins: "6" },
    { rider_id: "rider-honours-4", firstname: "Owen", lastname: "Delaney", nationality_code: "ie", team_id: "team-honours-4", team_name: "Harbour Racing", is_ai: false, points: "2103", wins: "4" },
  ],
};

// ── #3941 · Race Control ops-notices ────────────────────────────────────────
// Én dismissable "warning" (viser dismiss-knappen) + én "incident" (viser at
// incident IKKE kan dismisses) — begge active:true, saa preview/e2e ser begge
// banner-strimler stakket + begge rækker i Hjælp-sidens "Kendte problemer".
export const SEED_OPS_NOTICES = [
  {
    id: "opsnotice-1",
    severity: "warning",
    title_en: "Live auction bidding may lag",
    title_da: "Bud i live-auktioner kan opdatere langsomt",
    body_en: "We are investigating delayed bid updates. No bids are lost.",
    body_da: "Vi undersøger forsinkede budopdateringer. Ingen bud går tabt.",
    active: true,
    starts_at: "2026-08-18T07:00:00Z",
    ends_at: null,
    created_at: "2026-08-18T07:00:00Z",
  },
  {
    id: "opsnotice-2",
    severity: "incident",
    title_en: "Lineups are not filling automatically",
    title_da: "Startfelter fyldes ikke automatisk op",
    body_en: "We are actively fixing this. Manual lineup changes still work.",
    body_da: "Vi arbejder på at rette det. Manuelle ændringer af startfeltet virker stadig.",
    active: true,
    starts_at: "2026-08-18T05:00:00Z",
    ends_at: null,
    created_at: "2026-08-18T05:00:00Z",
  },
];
