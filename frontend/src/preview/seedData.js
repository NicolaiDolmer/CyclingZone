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
  { id: "race-up-1", season_id: ACTIVE_SEASON.id, name: "Tour de Preview", race_type: "stage_race", race_class: "TourFrance", stages: 3, stages_completed: 0, status: "scheduled", edition_year: 2026, league_division_id: TEST_TEAM.league_division_id, season: { id: ACTIVE_SEASON.id, number: ACTIVE_SEASON.season_number }, pool_race: { date_text: "12 Jul" } },
  { id: "race-live-1", season_id: ACTIVE_SEASON.id, name: "Settimana Preview", race_type: "stage_race", race_class: "ProSeries", stages: 5, stages_completed: 2, status: "scheduled", edition_year: 2026, league_division_id: TEST_TEAM.league_division_id, season: { id: ACTIVE_SEASON.id, number: ACTIVE_SEASON.season_number }, pool_race: { date_text: "20 Jun" } },
  { id: "race-done-1", season_id: ACTIVE_SEASON.id, name: "Omloop Preview", race_type: "single", race_class: "Monuments", stages: 1, stages_completed: 1, status: "completed", edition_year: 2026, league_division_id: TEST_TEAM.league_division_id, season: { id: ACTIVE_SEASON.id, number: ACTIVE_SEASON.season_number }, pool_race: { date_text: "01 Mar" } },
  { id: "race-done-2", season_id: ACTIVE_SEASON.id, name: "Giro di Preview", race_type: "stage_race", race_class: "GiroVuelta", stages: 2, stages_completed: 2, status: "completed", edition_year: 2026, league_division_id: TEST_TEAM.league_division_id, season: { id: ACTIVE_SEASON.id, number: ACTIVE_SEASON.season_number }, pool_race: { date_text: "10 May" } },
];

// race_stage_profiles — ≥1 pr. etape. demand_vector summerer til [0.97, 1.03].
export const SEED_STAGE_PROFILES = [
  { race_id: "race-up-1", stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint", demand_vector: { sprint: 0.61, acceleration: 0.15, positioning: 0.08, flat: 0.06, endurance: 0.02, randomness: 0.08 } },
  { race_id: "race-up-1", stage_number: 2, profile_type: "mountain", finale_type: "long_climb", demand_vector: { climbing: 0.5, endurance: 0.2, tempo: 0.15, recovery: 0.1, randomness: 0.05 } },
  { race_id: "race-up-1", stage_number: 3, profile_type: "hilly", finale_type: "punch", demand_vector: { punch: 0.45, climbing: 0.25, endurance: 0.15, positioning: 0.1, randomness: 0.05 } },
  { race_id: "race-live-1", stage_number: 3, profile_type: "rolling", finale_type: "reduced_sprint", demand_vector: { sprint: 0.4, endurance: 0.3, punch: 0.15, positioning: 0.1, randomness: 0.05 } },
  { race_id: "race-done-1", stage_number: 1, profile_type: "cobbles", finale_type: "breakaway", demand_vector: { cobblestone: 0.4, endurance: 0.25, punch: 0.15, positioning: 0.1, randomness: 0.1 } },
  { race_id: "race-done-2", stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint", demand_vector: { sprint: 0.58, acceleration: 0.17, positioning: 0.1, flat: 0.07, endurance: 0.03, randomness: 0.05 } },
  { race_id: "race-done-2", stage_number: 2, profile_type: "mountain", finale_type: "summit_finish", demand_vector: { climbing: 0.55, endurance: 0.22, tempo: 0.13, recovery: 0.05, randomness: 0.05 } },
];

// race_stage_schedule — scheduled_at pr. etape (driver next-start-countdown).
export const SEED_STAGE_SCHEDULE = [
  { race_id: "race-up-1", stage_number: 1, scheduled_at: "2026-07-12T13:00:00.000Z" },
  { race_id: "race-up-1", stage_number: 2, scheduled_at: "2026-07-13T13:00:00.000Z" },
  { race_id: "race-up-1", stage_number: 3, scheduled_at: "2026-07-14T13:00:00.000Z" },
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

// GET /api/academy/me — eneste kilde for academy-payloaden. Konsumeres af
// mockHandlers.apiResponse("/api/academy/me") (return SEED_ACADEMY) → academy-
// specs afhænger af præcis denne form (3 intakes, 2 free agents).
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
