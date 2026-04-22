-- ============================================================
-- CYCLING ZONE MANAGER — Full Database Schema
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  is_ai BOOLEAN DEFAULT FALSE,
  ai_source_id INTEGER, -- fkIDteam from PCM world db
  division INTEGER DEFAULT 3 CHECK (division IN (1, 2, 3)),
  balance BIGINT DEFAULT 500, -- in points/currency
  sponsor_income BIGINT DEFAULT 100, -- per season
  is_frozen BOOLEAN DEFAULT FALSE,
  is_bank BOOLEAN DEFAULT FALSE,
  manager_name TEXT,
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
  -- UCI Points (from Google Sheets top-1000, else 1)
  uci_points INTEGER DEFAULT 1,
  price INTEGER GENERATED ALWAYS AS (GREATEST(uci_points, 1)) STORED,
  -- salary: calculated as % of price, set at purchase
  salary INTEGER DEFAULT 0,
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
  -- Flags
  is_u25 BOOLEAN DEFAULT FALSE,
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
  stages INTEGER DEFAULT 1,
  start_date DATE,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed')),
  prize_pool BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RACE RESULTS
-- ============================================================

CREATE TABLE race_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id UUID REFERENCES races(id) ON DELETE CASCADE,
  stage_number INTEGER DEFAULT 1,
  result_type TEXT NOT NULL CHECK (result_type IN ('stage', 'gc', 'points', 'mountain', 'young', 'team')),
  rank INTEGER,
  rider_id UUID REFERENCES riders(id) ON DELETE SET NULL,
  rider_name TEXT, -- denormalized for display
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  team_name TEXT, -- denormalized
  finish_time TEXT,
  points_earned INTEGER DEFAULT 0,
  prize_money BIGINT DEFAULT 0,
  imported_at TIMESTAMPTZ DEFAULT NOW()
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE auction_bids (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auction_id UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  bid_time TIMESTAMPTZ DEFAULT NOW(),
  triggered_extension BOOLEAN DEFAULT FALSE
);

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
    CHECK (status IN ('pending','active','completed','rejected','cancelled','buyout')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_season >= start_season)
);

-- ============================================================
-- BOARD SYSTEM
-- ============================================================

CREATE TABLE board_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID UNIQUE NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  plan_type TEXT DEFAULT '1yr' CHECK (plan_type IN ('1yr', '3yr', '5yr')),
  focus TEXT DEFAULT 'balanced' CHECK (focus IN ('youth_development', 'star_signing', 'balanced')),
  satisfaction INTEGER DEFAULT 50 CHECK (satisfaction >= 0 AND satisfaction <= 100),
  budget_modifier FLOAT DEFAULT 1.0,
  current_goals JSONB DEFAULT '[]',
  season_id UUID REFERENCES seasons(id),
  negotiation_status TEXT NOT NULL DEFAULT 'pending' CHECK (negotiation_status IN ('pending', 'completed')),
  -- Multi-year plan tracking
  plan_start_season_number INTEGER,
  plan_end_season_number INTEGER,
  seasons_completed INTEGER NOT NULL DEFAULT 0,
  cumulative_stage_wins INTEGER NOT NULL DEFAULT 0,
  cumulative_gc_wins INTEGER NOT NULL DEFAULT 0,
  plan_start_balance BIGINT,
  plan_start_sponsor_income BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_snapshots_team ON board_plan_snapshots(team_id, board_id);

-- ============================================================
-- FINANCE
-- ============================================================

CREATE TABLE finance_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sponsor','prize','salary','transfer_in','transfer_out','interest','bonus','starting_budget')),
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
  division INTEGER NOT NULL,
  total_points INTEGER DEFAULT 0,
  races_completed INTEGER DEFAULT 0,
  stage_wins INTEGER DEFAULT 0,
  gc_wins INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, team_id)
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'bid_received','bid_placed','auction_won','auction_lost','auction_outbid',
    'transfer_offer_received','transfer_offer_accepted','transfer_offer_rejected','transfer_counter',
    'new_race','race_results_imported','season_started','season_ended',
    'board_update','salary_paid','sponsor_paid'
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
-- INDEXES
-- ============================================================

CREATE INDEX idx_riders_team ON riders(team_id);
CREATE INDEX idx_riders_uci ON riders(uci_points DESC);
CREATE INDEX idx_riders_u25 ON riders(is_u25);
CREATE INDEX idx_riders_pcm_id ON riders(pcm_id);
CREATE INDEX idx_auctions_status ON auctions(status);
CREATE INDEX idx_auctions_end ON auctions(calculated_end);
CREATE INDEX idx_auction_bids_auction ON auction_bids(auction_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX idx_finance_team ON finance_transactions(team_id);
CREATE INDEX idx_standings_season ON season_standings(season_id, division);
CREATE INDEX idx_race_results_race ON race_results(race_id);

-- ============================================================
-- ROW LEVEL SECURITY (Supabase)
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE riders ENABLE ROW LEVEL SECURITY;
ALTER TABLE auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read all public data
CREATE POLICY "Public read riders" ON riders FOR SELECT USING (true);
CREATE POLICY "Public read teams" ON teams FOR SELECT USING (true);
CREATE POLICY "Public read auctions" ON auctions FOR SELECT USING (true);
CREATE POLICY "Public read auction_bids" ON auction_bids FOR SELECT USING (true);
CREATE POLICY "Public read transfer_listings" ON transfer_listings FOR SELECT USING (true);
CREATE POLICY "Public read standings" ON season_standings FOR SELECT USING (true);
CREATE POLICY "Public read races" ON races FOR SELECT USING (true);
CREATE POLICY "Public read seasons" ON seasons FOR SELECT USING (true);
CREATE POLICY "Public read race_results" ON race_results FOR SELECT USING (true);

-- Users can only read their own sensitive data
CREATE POLICY "Own notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Own finances" ON finance_transactions FOR SELECT
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));
CREATE POLICY "Own board" ON board_profiles FOR SELECT
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

-- Mutations handled via backend service role (bypasses RLS)
