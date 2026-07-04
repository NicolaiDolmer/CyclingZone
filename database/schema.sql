-- ============================================================
-- CYCLING ZONE MANAGER — Full Database Schema
-- ============================================================
--
-- ⚠️  IKKE SOURCE-OF-TRUTH — REFERENCE-DUMP, KAN VÆRE STALE.
-- Sandheden om prod-skemaet (især RLS-policies, GRANTs og constraints)
-- er de daterede migrations i database/*.sql + den faktiske prod-DB.
-- Denne fil er et bekvemt overblik, men RLS/policies her kan halte bagefter
-- migrationerne (fx blev permissive policies strammet i
-- 2026-05-22-rls-permissive-policy-lockdown.sql uden at denne fil blev
-- opdateret). VERIFICÉR altid RLS/privilegier mod prod (Supabase advisor /
-- execute_sql mod pg_policies/pg_proc) før du konkluderer på sikkerhed.
-- Audit-noten her indført 2026-06-20 efter en security-audit blev vildledt af
-- stale RLS i denne fil.
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS & TEAMS
-- ============================================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('admin', 'manager')),
  last_seen TIMESTAMPTZ,
  login_streak INTEGER DEFAULT 0,
  last_login_date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- league_divisions = puljerne i 4-tier-pyramiden (#1608 forever-relaunch form-freeze).
-- Én række = én pulje inden for en tier. 15 puljer: tier1×1, tier2×2, tier3×4, tier4×8.
-- teams.division = TIER (1-4, økonomi); league_division_id = pulje (race/standings).
-- Definér FØR teams (FK-reference). Kanonisk migration:
-- database/2026-06-21-league-divisions-pyramid.sql.
CREATE TABLE league_divisions (
  id SERIAL PRIMARY KEY,
  tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3, 4)),
  pool_index INTEGER NOT NULL,            -- 0-baseret indeks inden for tier
  label TEXT NOT NULL,
  UNIQUE (tier, pool_index)
);

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  is_ai BOOLEAN DEFAULT FALSE,
  ai_source_id INTEGER, -- fkIDteam from PCM world db
  -- division = TIER (1-4). Default 4 = bunden (nye spillere ind fra bunden, #1608
  -- forever-relaunch form-freeze). Tier-keyet økonomi (*_BY_DIVISION[tier]).
  division INTEGER DEFAULT 4 CHECK (division IN (1, 2, 3, 4)),
  -- Pulje-reference (race/standings-gruppe, #1608). NULL = endnu ikke pulje-allokeret.
  league_division_id INTEGER REFERENCES league_divisions(id),
  balance BIGINT DEFAULT 500000, -- in points/currency (#1717: 800000 → 500000)
  sponsor_income BIGINT DEFAULT 240000, -- per season
  is_frozen BOOLEAN DEFAULT FALSE,
  is_bank BOOLEAN DEFAULT FALSE,
  manager_name TEXT,
  season_1_identity_basis JSONB DEFAULT NULL, -- S-02b: frosset identity-snapshot fra sæson-1-slut
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RIDERS
-- ============================================================

CREATE TABLE riders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pcm_id INTEGER UNIQUE, -- IDcyclist from WORLD_DB
  firstname TEXT NOT NULL,
  lastname TEXT NOT NULL,
  full_name TEXT GENERATED ALWAYS AS (firstname || ' ' || lastname) STORED,
  birthdate DATE,
  nationality_code TEXT, -- ISO country code (added later)
  height INTEGER, -- cm
  weight INTEGER, -- kg
  popularity INTEGER DEFAULT 0,
  -- UCI Points (legacy/afkoblet siden #1101-cutover 2026-06-10 — styrer IKKE økonomien)
  uci_points INTEGER DEFAULT 1,
  prize_earnings_bonus INTEGER NOT NULL DEFAULT 0,
  -- Data-drevet rytter-værdi (#1101, model v3 — riderValuationModel.json).
  -- Skrives af backfillRiderBaseValue/relaunch-orchestrator. NULL = endnu ikke
  -- beregnet (insert→backfill-vinduet) — generated-kolonnerne falder da tilbage
  -- til 1000 (bundskala; spejles i marketUtils.RIDER_BASE_VALUE_FALLBACK).
  base_value INTEGER,
  market_value INTEGER GENERATED ALWAYS AS (COALESCE(base_value, 1000) + prize_earnings_bonus) STORED,
  -- salary: FROSSEN kontrakt-løn (#1309). Var GENERATED (10% af market_value);
  -- nu sat ved signering og fast til udløb. Skrives af runContractSeed +
  -- finalization (create-if-missing). NULL = free agent (UI estimerer).
  salary INTEGER,
  -- Kontrakt (#1309): længde 1-3 sæsoner + sidste aktive sæson-number.
  -- NULL for free agents (kontrakt kræver et hold).
  contract_length INTEGER CHECK (contract_length IS NULL OR contract_length BETWEEN 1 AND 3),
  contract_end_season INTEGER CHECK (contract_end_season IS NULL OR contract_end_season >= 1),
  -- Current owner
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  ai_team_id UUID REFERENCES teams(id) ON DELETE SET NULL, -- original AI team
  -- Stats (in order: FL BJ KB BK TT PRL Bro SP ACC NED UDH MOD RES FTR)
  stat_fl INTEGER, -- Flad
  stat_bj INTEGER, -- Bjerg
  stat_kb INTEGER, -- Mellembjerg
  stat_bk INTEGER, -- Bakke
  stat_tt INTEGER, -- Enkeltstart
  stat_prl INTEGER, -- Prolog
  stat_bro INTEGER, -- Brosten
  stat_sp INTEGER, -- Sprint
  stat_acc INTEGER, -- Acceleration
  stat_ned INTEGER, -- Nedkørsel
  stat_udh INTEGER, -- Udholdenhed
  stat_mod INTEGER, -- Modstandsdygtighed
  stat_res INTEGER, -- Restituering
  stat_ftr INTEGER, -- Fighter
  potentiale DECIMAL(3,1),           -- fra dyn_cyclist.value_f_potentiel (1.0–6.0, 0.5-trin)
  -- Flags
  is_u25 BOOLEAN DEFAULT FALSE,
  is_retired BOOLEAN NOT NULL DEFAULT FALSE,
  is_academy BOOLEAN NOT NULL DEFAULT FALSE, -- akademi-rytter (#1308): ekskluderet fra senior-cap i runtime
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SEASONS & RACES
-- ============================================================

CREATE TABLE seasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  number INTEGER NOT NULL,
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'completed')),
  start_date DATE,
  end_date DATE,
  race_days_total INTEGER DEFAULT 60,
  race_days_completed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE races (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID REFERENCES seasons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  race_type TEXT DEFAULT 'single' CHECK (race_type IN ('single', 'stage_race')),
  race_class TEXT,
  stages INTEGER DEFAULT 1,
  edition_year INTEGER CHECK (edition_year IS NULL OR (edition_year BETWEEN 2000 AND 2099)),
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT races_no_season_zero CHECK (season_id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

-- ============================================================
-- RACE RESULTS
-- ============================================================

CREATE TABLE race_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id UUID REFERENCES races(id) ON DELETE CASCADE,
  stage_number INTEGER DEFAULT 1,
  result_type TEXT NOT NULL CHECK (result_type IN ('stage', 'gc', 'points', 'mountain', 'young', 'team', 'leader', 'mountain_day', 'points_day', 'young_day')),
  rank INTEGER,
  rider_id UUID REFERENCES riders(id) ON DELETE SET NULL,
  rider_name TEXT, -- denormalized for display
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  team_name TEXT, -- denormalized
  finish_time TEXT,
  points_earned INTEGER DEFAULT 0,
  prize_money BIGINT DEFAULT 0,
  in_breakaway BOOLEAN NOT NULL DEFAULT false,     -- #1499: deskriptiv udbruds-etiket (escapee); påvirker ikke rang/point
  breakaway_caught BOOLEAN NOT NULL DEFAULT false, -- #1499: escapee indhentet før mål (ikke-escapee finishede foran)
  imported_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE race_points (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_class TEXT NOT NULL,
  result_type TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank > 0),
  points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (race_class, result_type, rank)
);

-- ============================================================
-- AUCTIONS
-- ============================================================

CREATE TABLE auctions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  seller_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  starting_price INTEGER NOT NULL DEFAULT 1,
  current_price INTEGER NOT NULL DEFAULT 1,
  current_bidder_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  min_increment INTEGER DEFAULT 1,
  requested_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  calculated_end TIMESTAMPTZ NOT NULL,
  actual_end TIMESTAMPTZ,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'extended', 'completed', 'cancelled')),
  extension_count INTEGER DEFAULT 0,
  is_guaranteed_sale BOOLEAN DEFAULT FALSE,
  guaranteed_price INTEGER,
  is_flash BOOLEAN NOT NULL DEFAULT FALSE,
  is_youth BOOLEAN NOT NULL DEFAULT FALSE, -- ungdomsauktion (#1308): afvist akademi-kandidat
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE auction_bids (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auction_id UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  bid_time TIMESTAMPTZ DEFAULT NOW(),
  triggered_extension BOOLEAN DEFAULT FALSE,
  is_proxy BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE auction_proxy_bids (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auction_id UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  max_amount INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(auction_id, team_id)
);

-- ============================================================
-- AKADEMI (#1308)
-- ============================================================

CREATE TABLE academy_intake (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES seasons(id),
  is_serious BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'offered'
    CHECK (status IN ('offered','signed','rejected','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (team_id, rider_id)
);
COMMENT ON TABLE academy_intake IS
  'Akademi-intake-kuld (#1308): kandidater tilbudt et hold ved sæsonstart. status offered->signed/rejected/expired.';
CREATE INDEX IF NOT EXISTS idx_academy_intake_team_status ON academy_intake(team_id, status);

ALTER TABLE academy_intake ENABLE ROW LEVEL SECURITY;
-- Hold-ejeren kan læse eget kuld. Skrivning sker service-role (backend), ingen client-write-policy.
CREATE POLICY academy_intake_owner_read ON academy_intake
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

-- Akademi-graduering (#932): akademiryttere der har passeret 21 og afventer
-- promover/sælg/slip. Mens pending beholder rytteren is_academy=true (uden for cap).
CREATE TABLE academy_graduation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES seasons(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','promoted','sold','released','expired')),
  deadline TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (rider_id, season_id)
);
COMMENT ON TABLE academy_graduation IS
  'Akademi-graduering (#932): akademiryttere der har passeret 21 og afventer promover/sælg/slip. status pending->promoted/sold/released/expired.';
CREATE INDEX IF NOT EXISTS idx_academy_graduation_team_status ON academy_graduation(team_id, status);

ALTER TABLE academy_graduation ENABLE ROW LEVEL SECURITY;
-- Hold-ejeren kan læse eget; skrivning sker service-role (backend).
CREATE POLICY academy_graduation_owner_read ON academy_graduation
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

-- Sponsor-kontrakter (#1663, Økonomi Fase 2): forhandlet sponsor-indkomst pr. hold.
-- guaranteed_base + per_race_day_rate, længde 1-3 sæsoner. Højst én status=active pr.
-- hold (delvist unik-index). Backfill (i migrationen) er renown-neutral. Spejlet fra
-- database/2026-06-21-sponsor-contracts.sql (backfill-INSERT bor kun i migrationen).
CREATE TABLE sponsor_contracts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id              UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  sponsor_name         TEXT NOT NULL,
  guaranteed_base      BIGINT NOT NULL,
  per_race_day_rate    BIGINT NOT NULL DEFAULT 0,
  length_seasons       INTEGER NOT NULL CHECK (length_seasons BETWEEN 1 AND 3),
  start_season         INTEGER NOT NULL,
  expires_after_season INTEGER NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'replaced', 'pending')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE sponsor_contracts IS
  'Sponsor-kontrakter (#1663, Økonomi Fase 2): forhandlet sponsor-indkomst pr. hold. status pending->active ved sæson-skifte; active->expired/replaced.';
-- Højst én aktiv kontrakt pr. hold; udløbne/erstattede beholdes som historik.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsor_contracts_team_active
  ON sponsor_contracts(team_id) WHERE status = 'active';
-- Højst én pending kontrakt pr. hold (manager-valg for kommende sæson, aktiveres ved skifte).
CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsor_contracts_team_pending
  ON sponsor_contracts(team_id) WHERE status = 'pending';

ALTER TABLE sponsor_contracts ENABLE ROW LEVEL SECURITY;
-- Hold-ejeren læser egne kontrakter; skrivning sker service-role (backend).
CREATE POLICY sponsor_contracts_select_own ON sponsor_contracts
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

GRANT SELECT ON sponsor_contracts TO authenticated;

-- ============================================================
-- TRANSFER LISTINGS & OFFERS
-- ============================================================

CREATE TABLE transfer_listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  seller_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  asking_price INTEGER NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'negotiating', 'sold', 'withdrawn')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE transfer_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID REFERENCES transfer_listings(id) ON DELETE CASCADE,
  buyer_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  offer_amount INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'countered', 'awaiting_confirmation')),
  counter_amount INTEGER,
  message TEXT,
  buyer_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  seller_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  buyer_archived_at TIMESTAMPTZ,
  seller_archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SWAP OFFERS
-- ============================================================

CREATE TABLE swap_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  offered_rider_id   UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  requested_rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  proposing_team_id  UUID NOT NULL REFERENCES teams(id)  ON DELETE CASCADE,
  receiving_team_id  UUID NOT NULL REFERENCES teams(id)  ON DELETE CASCADE,
  -- positive = proposing pays receiving; negative = receiving pays proposing
  cash_adjustment    INTEGER NOT NULL DEFAULT 0,
  counter_cash       INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','countered','awaiting_confirmation','accepted','rejected','withdrawn')),
  message TEXT,
  proposing_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  receiving_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- LOAN AGREEMENTS
-- ============================================================

CREATE TABLE loan_agreements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rider_id      UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  from_team_id  UUID NOT NULL REFERENCES teams(id)  ON DELETE CASCADE,
  to_team_id    UUID NOT NULL REFERENCES teams(id)  ON DELETE CASCADE,
  loan_fee      INTEGER NOT NULL DEFAULT 0,
  start_season  INTEGER NOT NULL,
  end_season    INTEGER NOT NULL,
  buy_option_price INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','window_pending','buyout_pending','completed','rejected','cancelled','buyout')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_season >= start_season)
);

-- ============================================================
-- BOARD SYSTEM
-- ============================================================

CREATE TABLE board_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  plan_type TEXT DEFAULT '1yr' CHECK (plan_type IN ('1yr', '3yr', '5yr', 'baseline')),
  focus TEXT DEFAULT 'balanced' CHECK (focus IN ('youth_development', 'star_signing', 'balanced')),
  satisfaction INTEGER DEFAULT 50 CHECK (satisfaction >= 0 AND satisfaction <= 100),
  budget_modifier FLOAT DEFAULT 1.0,
  current_goals JSONB DEFAULT '[]',
  season_id UUID REFERENCES seasons(id),
  negotiation_status TEXT NOT NULL DEFAULT 'pending' CHECK (negotiation_status IN ('pending', 'completed')),
  is_baseline BOOLEAN NOT NULL DEFAULT FALSE,
  tradeoff_active_until_season_id UUID REFERENCES seasons(id),
  tradeoff_payload JSONB,
  major_pivot_used_at TIMESTAMPTZ,
  -- Multi-year plan tracking
  plan_start_season_number INTEGER,
  plan_end_season_number INTEGER,
  seasons_completed INTEGER NOT NULL DEFAULT 0,
  cumulative_stage_wins INTEGER NOT NULL DEFAULT 0,
  cumulative_gc_wins INTEGER NOT NULL DEFAULT 0,
  plan_start_balance BIGINT,
  plan_start_sponsor_income BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (team_id, plan_type)
);

CREATE TABLE board_plan_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES board_profiles(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES seasons(id),
  season_number INTEGER NOT NULL,
  season_within_plan INTEGER NOT NULL,
  stage_wins INTEGER NOT NULL DEFAULT 0,
  gc_wins INTEGER NOT NULL DEFAULT 0,
  division_rank INTEGER,
  satisfaction_delta INTEGER,
  goals_met INTEGER NOT NULL DEFAULT 0,
  goals_total INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT board_plan_snapshots_board_season_unique UNIQUE (board_id, season_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_snapshots_team ON board_plan_snapshots(team_id, board_id);

CREATE TABLE board_request_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES board_profiles(id) ON DELETE CASCADE,
  season_id UUID REFERENCES seasons(id) ON DELETE SET NULL,
  season_number INTEGER,
  request_type TEXT NOT NULL CHECK (
    request_type IN (
      'lower_results_pressure',
      'more_youth_focus',
      'more_results_focus',
      'ease_identity_requirements'
    )
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('approved', 'partial', 'rejected', 'tradeoff')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  tradeoff_summary TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}',
  board_changes JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Én request pr. board (plan) pr. sæson. Parallelle 1/3/5-års-planer betyder
-- op til 3 requests/hold/sæson (én pr. plan). Per-(board_id, season_number)
-- afløste det oprindelige per-team-index (migration 2026-04-24).
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_request_log_board_season_unique
  ON board_request_log(board_id, season_number)
  WHERE season_number IS NOT NULL;

-- ============================================================
-- FINANCE
-- ============================================================

CREATE TABLE finance_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'sponsor','prize','salary','transfer_in','transfer_out','interest','bonus','starting_budget',
    'loan_received','loan_repayment','loan_interest','emergency_loan','admin_adjustment',
    'auto_squad_purchase','auto_squad_sale','squad_violation_fine',
    'academy_signing','academy_drift'
  )),
  amount BIGINT NOT NULL, -- positive = income, negative = expense
  description TEXT,
  season_id UUID REFERENCES seasons(id),
  race_id UUID REFERENCES races(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SEASON STANDINGS
-- ============================================================

CREATE TABLE season_standings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  division INTEGER NOT NULL, -- TIER (1-4)
  league_division_id INTEGER REFERENCES league_divisions(id), -- pulje (#1608); rank_in_division = rang INDEN FOR puljen
  rank_in_division INTEGER,
  total_points INTEGER DEFAULT 0,
  races_completed INTEGER DEFAULT 0,
  stage_wins INTEGER DEFAULT 0,
  gc_wins INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, team_id)
);

-- ============================================================
-- ACTIVITY FEED (offentligt liga-feed)
-- ============================================================

CREATE TABLE activity_feed (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  team_name TEXT,
  rider_id UUID REFERENCES riders(id) ON DELETE SET NULL,
  rider_name TEXT,
  amount INTEGER,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_feed_created ON activity_feed(created_at DESC);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'bid_received','bid_placed','auction_won','auction_lost','auction_outbid','auction_proxy_outbid',
    'transfer_offer_received','transfer_offer_accepted','transfer_offer_rejected','transfer_counter',
    'transfer_offer_withdrawn','transfer_interest',
    'new_race','race_results_imported','race_result','season_started','season_ended',
    'board_update','board_critical','salary_paid','sponsor_paid',
    'watchlist_rider_listed','watchlist_rider_auction','loan_created','emergency_loan','emergency_loan_breach','loan_paid_off',
    'deadline_day_warning','auction_cancelled','squad_enforced','rider_retired',
    'academy_intake_ready','academy_signed','academy_rejected',
    'academy_graduation_ready','academy_graduated','contract_expiring',
    'academy_promoted','academy_demoted'
  )),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  related_id UUID, -- auction/transfer/race id
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- IMPORT LOG
-- ============================================================

CREATE TABLE import_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_type TEXT NOT NULL CHECK (import_type IN ('riders_worlddb', 'uci_points_sheets', 'race_results')),
  filename TEXT,
  rows_processed INTEGER DEFAULT 0,
  rows_updated INTEGER DEFAULT 0,
  rows_inserted INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  imported_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- COUNTRIES (#844) — kanonisk lande-reference, 3 akser
-- ============================================================

CREATE TABLE countries (
  iso2              TEXT PRIMARY KEY CHECK (iso2 ~ '^[A-Z]{2}$'),  -- matcher riders.nationality_code
  name_en           TEXT NOT NULL,
  name_da           TEXT,
  ioc_code          TEXT,                                          -- cyklings IOC 3-bogstav (DEN/FRA)
  continent         TEXT,
  birth_weight      NUMERIC NOT NULL DEFAULT 0   CHECK (birth_weight >= 0),     -- akse 1: størrelse
  talent_ceiling    NUMERIC NOT NULL DEFAULT 1.0 CHECK (talent_ceiling > 0),    -- akse 2: talent-loft
  reputation        NUMERIC NOT NULL DEFAULT 50  CHECK (reputation BETWEEN 0 AND 100),       -- akse 3: dynamisk
  reputation_seed   NUMERIC NOT NULL DEFAULT 50  CHECK (reputation_seed BETWEEN 0 AND 100),  -- akse 3: baseline
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_riders_team ON riders(team_id);
CREATE INDEX idx_riders_uci ON riders(uci_points DESC);
CREATE INDEX idx_riders_u25 ON riders(is_u25);
CREATE INDEX idx_riders_pcm_id ON riders(pcm_id);
CREATE INDEX idx_riders_team_academy ON riders(team_id, is_academy); -- akademi-filter (#1308)
CREATE INDEX idx_auctions_status ON auctions(status);
CREATE INDEX idx_auctions_end ON auctions(calculated_end);
-- DB-level guard: max én aktiv auktion per rytter. Blokkerer TOCTOU-race i POST /api/auctions.
CREATE UNIQUE INDEX uniq_auctions_one_active_per_rider ON auctions(rider_id) WHERE status IN ('active', 'extended');
CREATE INDEX idx_auction_bids_auction ON auction_bids(auction_id);
CREATE INDEX idx_proxy_bids_auction ON auction_proxy_bids(auction_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX idx_finance_team ON finance_transactions(team_id);
CREATE INDEX idx_standings_season ON season_standings(season_id, division);
CREATE INDEX idx_race_results_race ON race_results(race_id);
CREATE INDEX idx_race_points_class ON race_points(race_class);

-- ============================================================
-- ROW LEVEL SECURITY (Supabase)
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE riders ENABLE ROW LEVEL SECURITY;
ALTER TABLE auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_proxy_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_feed ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_points ENABLE ROW LEVEL SECURITY;

-- Users can read all public data
CREATE POLICY "Public read riders" ON riders FOR SELECT USING (true);
CREATE POLICY "Public read teams" ON teams FOR SELECT USING (true);
CREATE POLICY "Public read auctions" ON auctions FOR SELECT USING (true);
CREATE POLICY "Public read auction_bids" ON auction_bids FOR SELECT USING (true);
CREATE POLICY "Own proxy bids" ON auction_proxy_bids FOR SELECT
  USING (EXISTS (SELECT 1 FROM teams WHERE teams.id = auction_proxy_bids.team_id AND teams.user_id = auth.uid()));
CREATE POLICY "Public read transfer_listings" ON transfer_listings FOR SELECT USING (true);
CREATE POLICY "Public read standings" ON season_standings FOR SELECT USING (true);
CREATE POLICY "Public read races" ON races FOR SELECT USING (true);
CREATE POLICY "Public read seasons" ON seasons FOR SELECT USING (true);
CREATE POLICY "Public read race_results" ON race_results FOR SELECT USING (true);
CREATE POLICY "Public read race_points" ON race_points FOR SELECT USING (true);
CREATE POLICY "Public read activity_feed" ON activity_feed FOR SELECT USING (true);
CREATE POLICY "Service insert activity_feed" ON activity_feed FOR INSERT WITH CHECK (true);

-- Users can only read their own sensitive data
CREATE POLICY "Own notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Own finances" ON finance_transactions FOR SELECT
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));
CREATE POLICY "Own board" ON board_profiles FOR SELECT
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

-- Countries (#844): reference-data uden secrets — read for authenticated, write kun for admin.
ALTER TABLE countries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "countries_select_authenticated" ON countries FOR SELECT TO authenticated USING (true);
CREATE POLICY "countries_admin_write" ON countries FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Mutations handled via backend service role (bypasses RLS)
