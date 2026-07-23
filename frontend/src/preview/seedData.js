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
export const POOL_RACES = [
  { status: "completed", stages: 1, stages_completed: 1, league_division_id: 2 },
  { status: "completed", stages: 1, stages_completed: 1, league_division_id: 2 },
  { status: "scheduled", stages: 7, stages_completed: 2, league_division_id: 2 },
  { status: "scheduled", stages: 1, stages_completed: 0, league_division_id: 2 },
  { status: "scheduled", stages: 1, stages_completed: 0, league_division_id: 2 },
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
  name: "Sæson 1",
  status: "active",
  started_at: "2026-05-01T00:00:00.000Z",
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

export const AUCTIONS = [
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
export const SEED_STAGE_SCHEDULE = [
  { race_id: "race-up-1", stage_number: 1, scheduled_at: "2026-07-12T13:00:00.000Z" },
  { race_id: "race-up-1", stage_number: 2, scheduled_at: "2026-07-13T13:00:00.000Z" },
  { race_id: "race-up-1", stage_number: 3, scheduled_at: "2026-07-14T13:00:00.000Z" },
  { race_id: "race-up-1", stage_number: 4, scheduled_at: "2026-07-15T13:00:00.000Z" },
  { race_id: "race-live-1", stage_number: 3, scheduled_at: "2026-06-25T13:00:00.000Z" },
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
export const SEED_RACE_STAGE_MOMENTS = [
  { id: "mom-d2-s1-1", race_id: "race-done-2", stage_number: 1, moment_key: "team_day", params: { teamId: TEST_TEAM.id, count: 2 }, significance: 45, rider_ids: [], team_ids: [TEST_TEAM.id] },
  { id: "mom-d2-s1-2", race_id: "race-done-2", stage_number: 1, moment_key: "tag_outsider_win", params: { riderId: RIDERS[0].id }, significance: 30, rider_ids: [RIDERS[0].id], team_ids: [] },
  { id: "mom-d2-s2-1", race_id: "race-done-2", stage_number: 2, moment_key: "gc_takeover", params: { riderId: RIDERS[1].id, previousLeaderId: RIDERS[0].id }, significance: 80, rider_ids: [RIDERS[1].id, RIDERS[0].id], team_ids: [] },
  { id: "mom-d2-s2-2", race_id: "race-done-2", stage_number: 2, moment_key: "final_gc", params: { riderIds: [RIDERS[1].id, RIDERS[0].id] }, significance: 90, rider_ids: [RIDERS[1].id, RIDERS[0].id], team_ids: [] },
  { id: "mom-d2-s2-3", race_id: "race-done-2", stage_number: 2, moment_key: "tag_crash_ruined", params: { riderId: "rider-99", kind: "crash", outcome: "abandon" }, significance: 30, rider_ids: ["rider-99"], team_ids: [] },
  { id: "mom-d2-s2-4", race_id: "race-done-2", stage_number: 2, moment_key: "tag_jour_sans", params: { riderId: RIDERS[0].id }, significance: 30, rider_ids: [RIDERS[0].id], team_ids: [] },
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

// GET /api/races/distribution — board-aggregat. ≥1 tids-overlap-kolonne (begge
// kolonner deler bindingWindow → bindingMap binder en rytter væk fra den anden).
// roster = column[0].riders (RaceHubBoard: roster = columns[0]?.riders).
const SEED_BOARD_ROSTER = RIDERS.filter((r) => r.team_id === TEST_TEAM.id).map((r, i) => ({
  id: r.id, firstname: r.firstname, lastname: r.lastname,
  primary_type: r.primary_type, secondary_type: r.secondary_type, nationality_code: r.nationality_code,
  // S5: suitability + aggression + kondition så RoleCards/FitBar/jæger-chip har data i preview.
  suitability: 78 - i * 9, aggression: 72 - i * 6, form: 60 - i * 3, fatigue: 12 + i * 7,
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
      stages: 3, stages_completed: 0, status: "scheduled", window: { day: 12 }, bindingWindow: { start: 12, end: 14 },
      game_day: 12, game_day_end: 14, // #2195: synligt "Race days 12-14"-mærke
      // S5: fladt løb → jæger-chip = høj udbruds-chance.
      primaryProfileType: "flat", primaryFinaleType: null,
      size: { min: 6, max: 8 }, riders: SEED_BOARD_ROSTER,
      selection: { rider_ids: [RIDERS[0].id], captain_id: RIDERS[0].id, sprint_captain_id: null, hunter_id: null, is_auto_filled: false },
      withdrawn: false, lineup_locked: false,
      counts: { selected: 1, target: 8 },
    },
    {
      // In-game-dag-overlap med race-up-1 (gd 12 ⊂ 12-14) → én-rytter/ét-løb-binding.
      id: "race-overlap-1", name: "Critérium Preview", race_class: "ProSeries", race_type: "single",
      stages: 1, stages_completed: 0, status: "scheduled", window: { day: 12 }, bindingWindow: { start: 12, end: 12 },
      game_day: 12, game_day_end: 12, // in-game-dag 12 → ægte overlap med race-up-1
      // S5: bjerg-løb med summit-finale → jæger-chip = lav udbruds-chance (favoritterne afgør).
      primaryProfileType: "high_mountain", primaryFinaleType: "long_climb",
      size: { min: 6, max: 7 }, riders: SEED_BOARD_ROSTER,
      selection: { rider_ids: [], captain_id: null, sprint_captain_id: null, hunter_id: null, is_auto_filled: false },
      withdrawn: false, lineup_locked: false,
      counts: { selected: 0, target: 7 },
    },
    {
      // Kronologi-rebuild: samme IRL-dag, men in-game-dag 15 (efter race-up-1's span) → binder
      // IKKE race-up-1's ryttere. En rytter i Tour de Preview KAN derfor også stilles her.
      id: "race-free-1", name: "Klassiker Preview", race_class: "ProSeries", race_type: "single",
      stages: 1, stages_completed: 0, status: "scheduled", window: { day: 12 }, bindingWindow: { start: 15, end: 15 },
      game_day: 15, game_day_end: 15, // samme IRL-dag, in-game-dag 15 → kompatibel med race-up-1
      primaryProfileType: "cobbles", primaryFinaleType: null,
      size: { min: 6, max: 7 }, riders: SEED_BOARD_ROSTER,
      selection: { rider_ids: [], captain_id: null, sprint_captain_id: null, hunter_id: null, is_auto_filled: false },
      withdrawn: false, lineup_locked: false,
      counts: { selected: 0, target: 7 },
    },
  ],
  // bindingMap (server): rider_id → kolonne-løb rytteren er i som overlapper et andet (game-dag).
  bindingMap: { [RIDERS[0].id]: ["race-up-1"] },
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
      stages: 1, stages_completed: 0, status: "scheduled", window: { day: 12 },
      primaryProfileType: "flat", visible: true, daysUntilStart: 2, opensInDays: 0,
      teamCount: 2,
      teams: [
        { team: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name }, riders: PREVIEW_SQUAD_RIVAL },
        { team: { id: TEST_TEAM.id, name: TEST_TEAM.name }, riders: PREVIEW_SQUAD_OWN },
      ],
    },
    {
      id: "race-locked-1", name: "GP des Préviews", race_class: "Class1", race_type: "single",
      stages: 1, stages_completed: 0, status: "scheduled", window: { day: 23 },
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
  captain_priorities: { flat: RIDERS[0].id, hills: RIDERS[0].id, mountains: null, cobbles: RIDERS[0].id, time_trial: null },
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

export const SEED_CALENDAR = {
  season: { id: ACTIVE_SEASON.id, number: ACTIVE_SEASON.season_number, raceDaysTotal: 60, raceDaysCompleted: 14 },
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
  ],
};

// #1441 A3 — start-tilstand for Klub-preview (mid-game D2-hold). Muteres af clubMock.
export const SEED_CLUB = {
  facilities: {
    training: { tier: 2, staff: { name: "Sofie Lindqvist", tier: 2 } },
    scouting: { tier: 1, staff: null },
    medical: { tier: 0, staff: null },
    academy: { tier: 3, staff: { name: "Aldo Terranova", tier: 1 } },
    commercial: { tier: 0, staff: null },
  },
};

// #2100 preview-seed: Udvikling-fanen med loft-projektion. En udviklende ung sprinter
// (rating 58→70) + det maskerede loft-bånd + fuzzy projektion. Tallene er genereret via
// backend/lib/developmentProjection.js (samme model prod bruger) så preview matcher live.
export const SEED_DEVELOPMENT = [
  { snapshot_date: "2026-03-01", season_number: 6, source: "baseline", abilities: { climbing: 38, time_trial: 44, flat: 44, tempo: 46, sprint: 34, acceleration: 30, punch: 48, endurance: 50, recovery: 50, durability: 52, descending: 46, cobblestone: 42, positioning: 54, aggression: 46, tactics: 50 } },
  { snapshot_date: "2026-04-01", season_number: 6, source: "daily_training", abilities: { climbing: 38, time_trial: 44, flat: 46, tempo: 46, sprint: 38, acceleration: 34, punch: 48, endurance: 50, recovery: 50, durability: 52, descending: 46, cobblestone: 42, positioning: 54, aggression: 46, tactics: 50 } },
  { snapshot_date: "2026-05-01", season_number: 6, source: "daily_training", abilities: { climbing: 38, time_trial: 44, flat: 48, tempo: 46, sprint: 42, acceleration: 38, punch: 48, endurance: 50, recovery: 50, durability: 52, descending: 46, cobblestone: 42, positioning: 54, aggression: 46, tactics: 50 } },
  { snapshot_date: "2026-06-01", season_number: 6, source: "daily_training", abilities: { climbing: 38, time_trial: 44, flat: 50, tempo: 46, sprint: 46, acceleration: 42, punch: 48, endurance: 50, recovery: 50, durability: 52, descending: 46, cobblestone: 42, positioning: 54, aggression: 46, tactics: 50 } },
  { snapshot_date: "2026-07-01", season_number: 6, source: "daily_training", abilities: { climbing: 38, time_trial: 44, flat: 52, tempo: 46, sprint: 50, acceleration: 46, punch: 48, endurance: 50, recovery: 50, durability: 52, descending: 46, cobblestone: 42, positioning: 54, aggression: 46, tactics: 50 } },
];

export const SEED_PROJECTION = {
  level: 3, maxLevel: 3, own: true, capsMissing: false,
  primaryKey: "sprinter", now: 70, ceil: { lo: 78, hi: 86 },
  band: [
    { season: 0, lo: 70, hi: 70 }, { season: 1, lo: 71, hi: 76 }, { season: 2, lo: 72, hi: 79 },
    { season: 3, lo: 72, hi: 81 }, { season: 4, lo: 73, hi: 82 }, { season: 5, lo: 73, hi: 83 },
    { season: 6, lo: 73, hi: 83 },
  ],
  timing: { seasons: { lo: 2, hi: null }, ageAt: { lo: 23, hi: null } },
  pastPeak: false,
};
