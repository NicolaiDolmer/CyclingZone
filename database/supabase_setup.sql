-- ============================================================
-- 🚴 CYCLING ZONE MANAGER — Supabase Database Setup
-- ============================================================
-- Instruktioner:
--   1. Gå til https://supabase.com/dashboard/project/ghwvkxzhsbbltzfnuhhz/sql/new
--   2. Slet alt eksisterende tekst i editoren
--   3. Kopiér ALT indhold fra denne fil og indsæt
--   4. Klik "Run" (eller Ctrl+Enter)
-- ============================================================

-- UUID support
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── USERS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('admin', 'manager')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TEAMS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  is_ai BOOLEAN DEFAULT FALSE,
  ai_source_id INTEGER,
  division INTEGER DEFAULT 3 CHECK (division IN (1, 2, 3)),
  balance BIGINT DEFAULT 500,
  sponsor_income BIGINT DEFAULT 100,
  is_frozen BOOLEAN DEFAULT FALSE,
  manager_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RIDERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.riders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pcm_id INTEGER UNIQUE,
  firstname TEXT NOT NULL,
  lastname TEXT NOT NULL,
  birthdate DATE,
  nationality_code TEXT,
  height INTEGER,
  weight INTEGER,
  popularity INTEGER DEFAULT 0,
  uci_points INTEGER DEFAULT 1,
  salary INTEGER DEFAULT 0,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  ai_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  stat_fl  INTEGER,
  stat_bj  INTEGER,
  stat_kb  INTEGER,
  stat_bk  INTEGER,
  stat_tt  INTEGER,
  stat_prl INTEGER,
  stat_bro INTEGER,
  stat_sp  INTEGER,
  stat_acc INTEGER,
  stat_ned INTEGER,
  stat_udh INTEGER,
  stat_mod INTEGER,
  stat_res INTEGER,
  stat_ftr INTEGER,
  is_u25 BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── SEASONS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  number INTEGER NOT NULL,
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'completed')),
  start_date DATE,
  end_date DATE,
  race_days_total INTEGER DEFAULT 60,
  race_days_completed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RACES ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.races (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID REFERENCES public.seasons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  race_type TEXT DEFAULT 'single' CHECK (race_type IN ('single', 'stage_race')),
  stages INTEGER DEFAULT 1,
  start_date DATE,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed')),
  prize_pool BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RACE RESULTS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.race_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id UUID REFERENCES public.races(id) ON DELETE CASCADE,
  stage_number INTEGER DEFAULT 1,
  result_type TEXT NOT NULL CHECK (result_type IN ('stage','gc','points','mountain','young','team')),
  rank INTEGER,
  rider_id UUID REFERENCES public.riders(id) ON DELETE SET NULL,
  rider_name TEXT,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  team_name TEXT,
  finish_time TEXT,
  points_earned INTEGER DEFAULT 0,
  prize_money BIGINT DEFAULT 0,
  imported_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── AUCTIONS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auctions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rider_id UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  seller_team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  starting_price INTEGER NOT NULL DEFAULT 1,
  current_price INTEGER NOT NULL DEFAULT 1,
  current_bidder_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  min_increment INTEGER DEFAULT 1,
  requested_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  calculated_end TIMESTAMPTZ NOT NULL,
  actual_end TIMESTAMPTZ,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','extended','completed','cancelled')),
  extension_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── AUCTION BIDS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auction_bids (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auction_id UUID NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  bid_time TIMESTAMPTZ DEFAULT NOW(),
  triggered_extension BOOLEAN DEFAULT FALSE
);

-- ── TRANSFER LISTINGS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.transfer_listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rider_id UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  seller_team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  asking_price INTEGER NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','negotiating','sold','withdrawn')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TRANSFER OFFERS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.transfer_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID REFERENCES public.transfer_listings(id) ON DELETE CASCADE,
  buyer_team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  offer_amount INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','countered')),
  counter_amount INTEGER,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── BOARD PROFILES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.board_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID UNIQUE NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  plan_type TEXT DEFAULT '1yr' CHECK (plan_type IN ('1yr','3yr','5yr')),
  focus TEXT DEFAULT 'balanced' CHECK (focus IN ('youth_development','star_signing','balanced')),
  satisfaction INTEGER DEFAULT 50 CHECK (satisfaction >= 0 AND satisfaction <= 100),
  budget_modifier FLOAT DEFAULT 1.0,
  current_goals JSONB DEFAULT '[]',
  season_id UUID REFERENCES public.seasons(id),
  negotiation_status TEXT NOT NULL DEFAULT 'pending' CHECK (negotiation_status IN ('pending', 'completed')),
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

CREATE TABLE IF NOT EXISTS public.board_plan_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES public.board_profiles(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES public.seasons(id),
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

CREATE INDEX IF NOT EXISTS idx_plan_snapshots_team
  ON public.board_plan_snapshots(team_id, board_id);

CREATE TABLE IF NOT EXISTS public.board_request_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES public.board_profiles(id) ON DELETE CASCADE,
  season_id UUID REFERENCES public.seasons(id) ON DELETE SET NULL,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_board_request_log_team_season_unique
ON public.board_request_log(team_id, season_number)
WHERE season_number IS NOT NULL;

-- ── FINANCE TRANSACTIONS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sponsor','prize','salary','transfer_in','transfer_out','interest','bonus','starting_budget')),
  amount BIGINT NOT NULL,
  description TEXT,
  season_id UUID REFERENCES public.seasons(id),
  race_id UUID REFERENCES public.races(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── SEASON STANDINGS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.season_standings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  division INTEGER NOT NULL,
  total_points INTEGER DEFAULT 0,
  races_completed INTEGER DEFAULT 0,
  stage_wins INTEGER DEFAULT 0,
  gc_wins INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, team_id)
);

-- ── NOTIFICATIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  related_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── IMPORT LOG ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.import_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_type TEXT NOT NULL,
  filename TEXT,
  rows_processed INTEGER DEFAULT 0,
  rows_updated INTEGER DEFAULT 0,
  rows_inserted INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  imported_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_riders_team      ON public.riders(team_id);
CREATE INDEX IF NOT EXISTS idx_riders_uci       ON public.riders(uci_points DESC);
CREATE INDEX IF NOT EXISTS idx_riders_u25       ON public.riders(is_u25);
CREATE INDEX IF NOT EXISTS idx_riders_pcm_id    ON public.riders(pcm_id);
CREATE INDEX IF NOT EXISTS idx_auctions_status  ON public.auctions(status);
CREATE INDEX IF NOT EXISTS idx_auctions_end     ON public.auctions(calculated_end);
CREATE INDEX IF NOT EXISTS idx_auction_bids     ON public.auction_bids(auction_id);
CREATE INDEX IF NOT EXISTS idx_notifications    ON public.notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_finance_team     ON public.finance_transactions(team_id);
CREATE INDEX IF NOT EXISTS idx_standings_season ON public.season_standings(season_id, division);
CREATE INDEX IF NOT EXISTS idx_race_results     ON public.race_results(race_id);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auctions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_bids        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_listings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_offers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.races               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_results        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_standings    ENABLE ROW LEVEL SECURITY;

-- ── PUBLIC READ POLICIES ──────────────────────────────────────
DO $$ BEGIN
  CREATE POLICY "Public read riders"           ON public.riders FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Public read teams"            ON public.teams FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Public read auctions"         ON public.auctions FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Public read auction_bids"     ON public.auction_bids FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Public read transfer_listings" ON public.transfer_listings FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Public read standings"        ON public.season_standings FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Public read races"            ON public.races FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Public read seasons"          ON public.seasons FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Public read race_results"     ON public.race_results FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── PRIVATE POLICIES ──────────────────────────────────────────
DO $$ BEGIN
  CREATE POLICY "Own notifications" ON public.notifications
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Own finances" ON public.finance_transactions
    FOR SELECT USING (team_id IN (SELECT id FROM public.teams WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Own board" ON public.board_profiles
    FOR SELECT USING (team_id IN (SELECT id FROM public.teams WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── AUTO-CREATE USER PROFILE ON SIGNUP ───────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, username, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    'manager'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ✅ FÆRDIG! Alle tabeller er oprettet.
-- Næste trin: Se README.md for at starte backend og frontend.
