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
// for tæller-queryen (league_division_id=eq-filter), så "kommende løb"-listen + RacesPage
// stadig ser en tom races-tabel (uændrede snapshots dér).
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
