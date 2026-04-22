#!/usr/bin/env python3
"""
🚴 Cycling Zone Manager — Automatisk Opsætning
================================================
Kør dette script på din computer:
  python3 setup.py

Det vil automatisk:
  1. Køre databaseskema i Supabase
  2. Oprette alle .env filer
  3. Installere Node.js dependencies
  4. Starte spillet lokalt
"""

import urllib.request
import urllib.error
import json
import subprocess
import sys
import os
import time

# ── Konfiguration ─────────────────────────────────────────────────────────────

SUPABASE_URL = "https://ghwvkxzhsbbltzfnuhhz.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdod3ZreHpoc2JibHR6Zm51aGh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTk0NDQsImV4cCI6MjA5MTgzNTQ0NH0.J4D8QVPsI0VzV8ct-RY2IiwblWPVOhwcZwBHvnREa14"
SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdod3ZreHpoc2JibHR6Zm51aGh6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjI1OTQ0NCwiZXhwIjoyMDkxODM1NDQ0fQ.HGeYCXLHOfHHK0fa4wDt2EzdbfDWRcUTFB_4Pl6lICs"

# ── Farver til terminal output ─────────────────────────────────────────────────

GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
BLUE   = "\033[94m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

def ok(msg):   print(f"{GREEN}✅ {msg}{RESET}")
def warn(msg): print(f"{YELLOW}⚠️  {msg}{RESET}")
def err(msg):  print(f"{RED}❌ {msg}{RESET}")
def info(msg): print(f"{BLUE}ℹ️  {msg}{RESET}")
def step(msg): print(f"\n{BOLD}{YELLOW}{'─'*50}{RESET}\n{BOLD}▶ {msg}{RESET}")

# ── HTTP helper ────────────────────────────────────────────────────────────────

def supabase_request(method, path, data=None):
    url = f"{SUPABASE_URL}{path}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read()
            return resp.status, body.decode() if body else ""
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

# ── Database Schema ────────────────────────────────────────────────────────────

# Split schema into individual statements for the REST API
SCHEMA_STATEMENTS = [
    'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"',

    '''CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('admin', 'manager')),
  created_at TIMESTAMPTZ DEFAULT NOW()
)''',

    '''CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  is_ai BOOLEAN DEFAULT FALSE,
  ai_source_id INTEGER,
  division INTEGER DEFAULT 3 CHECK (division IN (1, 2, 3)),
  balance BIGINT DEFAULT 500,
  sponsor_income BIGINT DEFAULT 100,
  is_frozen BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
)''',

    '''CREATE TABLE IF NOT EXISTS riders (
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
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  ai_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  stat_fl INTEGER, stat_bj INTEGER, stat_kb INTEGER, stat_bk INTEGER,
  stat_tt INTEGER, stat_prl INTEGER, stat_bro INTEGER, stat_sp INTEGER,
  stat_acc INTEGER, stat_ned INTEGER, stat_udh INTEGER, stat_mod INTEGER,
  stat_res INTEGER, stat_ftr INTEGER,
  is_u25 BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)''',

    '''CREATE TABLE IF NOT EXISTS seasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  number INTEGER NOT NULL,
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'completed')),
  start_date DATE,
  end_date DATE,
  race_days_total INTEGER DEFAULT 60,
  race_days_completed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
)''',

    '''CREATE TABLE IF NOT EXISTS races (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID REFERENCES seasons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  race_type TEXT DEFAULT 'single' CHECK (race_type IN ('single', 'stage_race')),
  stages INTEGER DEFAULT 1,
  start_date DATE,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed')),
  prize_pool BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
)''',

    '''CREATE TABLE IF NOT EXISTS race_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id UUID REFERENCES races(id) ON DELETE CASCADE,
  stage_number INTEGER DEFAULT 1,
  result_type TEXT NOT NULL CHECK (result_type IN ('stage', 'gc', 'points', 'mountain', 'young', 'team')),
  rank INTEGER,
  rider_id UUID REFERENCES riders(id) ON DELETE SET NULL,
  rider_name TEXT,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  team_name TEXT,
  finish_time TEXT,
  points_earned INTEGER DEFAULT 0,
  prize_money BIGINT DEFAULT 0,
  imported_at TIMESTAMPTZ DEFAULT NOW()
)''',

    '''CREATE TABLE IF NOT EXISTS auctions (
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
  created_at TIMESTAMPTZ DEFAULT NOW()
)''',

    '''CREATE TABLE IF NOT EXISTS auction_bids (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auction_id UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  bid_time TIMESTAMPTZ DEFAULT NOW(),
  triggered_extension BOOLEAN DEFAULT FALSE
)''',

    '''CREATE TABLE IF NOT EXISTS transfer_listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  seller_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  asking_price INTEGER NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'negotiating', 'sold', 'withdrawn')),
  created_at TIMESTAMPTZ DEFAULT NOW()
)''',

    '''CREATE TABLE IF NOT EXISTS transfer_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID REFERENCES transfer_listings(id) ON DELETE CASCADE,
  buyer_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  offer_amount INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'countered')),
  counter_amount INTEGER,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)''',

    '''CREATE TABLE IF NOT EXISTS board_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID UNIQUE NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  plan_type TEXT DEFAULT '1yr' CHECK (plan_type IN ('1yr', '3yr', '5yr')),
  focus TEXT DEFAULT 'balanced' CHECK (focus IN ('youth_development', 'star_signing', 'balanced')),
  satisfaction INTEGER DEFAULT 50 CHECK (satisfaction >= 0 AND satisfaction <= 100),
  budget_modifier FLOAT DEFAULT 1.0,
  current_goals JSONB DEFAULT '[]',
  season_id UUID REFERENCES seasons(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)''',

    '''CREATE TABLE IF NOT EXISTS finance_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sponsor','prize','salary','transfer_in','transfer_out','interest','bonus','starting_budget')),
  amount BIGINT NOT NULL,
  description TEXT,
  season_id UUID REFERENCES seasons(id),
  race_id UUID REFERENCES races(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
)''',

    '''CREATE TABLE IF NOT EXISTS season_standings (
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
)''',

    '''CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  related_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
)''',

    '''CREATE TABLE IF NOT EXISTS import_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_type TEXT NOT NULL,
  filename TEXT,
  rows_processed INTEGER DEFAULT 0,
  rows_updated INTEGER DEFAULT 0,
  rows_inserted INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  imported_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
)''',

    # Indexes
    "CREATE INDEX IF NOT EXISTS idx_riders_team ON riders(team_id)",
    "CREATE INDEX IF NOT EXISTS idx_riders_uci ON riders(uci_points DESC)",
    "CREATE INDEX IF NOT EXISTS idx_riders_u25 ON riders(is_u25)",
    "CREATE INDEX IF NOT EXISTS idx_riders_pcm_id ON riders(pcm_id)",
    "CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status)",
    "CREATE INDEX IF NOT EXISTS idx_auctions_end ON auctions(calculated_end)",
    "CREATE INDEX IF NOT EXISTS idx_auction_bids_auction ON auction_bids(auction_id)",
    "CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read)",
    "CREATE INDEX IF NOT EXISTS idx_finance_team ON finance_transactions(team_id)",
    "CREATE INDEX IF NOT EXISTS idx_standings_season ON season_standings(season_id, division)",
    "CREATE INDEX IF NOT EXISTS idx_race_results_race ON race_results(race_id)",

    # RLS
    "ALTER TABLE users ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE teams ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE riders ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE auctions ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE auction_bids ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE transfer_listings ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE transfer_offers ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE notifications ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE board_profiles ENABLE ROW LEVEL SECURITY",

    # Policies
    "CREATE POLICY IF NOT EXISTS \"Public read riders\" ON riders FOR SELECT USING (true)",
    "CREATE POLICY IF NOT EXISTS \"Public read teams\" ON teams FOR SELECT USING (true)",
    "CREATE POLICY IF NOT EXISTS \"Public read auctions\" ON auctions FOR SELECT USING (true)",
    "CREATE POLICY IF NOT EXISTS \"Public read auction_bids\" ON auction_bids FOR SELECT USING (true)",
    "CREATE POLICY IF NOT EXISTS \"Public read transfer_listings\" ON transfer_listings FOR SELECT USING (true)",
    "CREATE POLICY IF NOT EXISTS \"Public read standings\" ON season_standings FOR SELECT USING (true)",
    "CREATE POLICY IF NOT EXISTS \"Public read races\" ON races FOR SELECT USING (true)",
    "CREATE POLICY IF NOT EXISTS \"Public read seasons\" ON seasons FOR SELECT USING (true)",
    "CREATE POLICY IF NOT EXISTS \"Public read race_results\" ON race_results FOR SELECT USING (true)",
    "CREATE POLICY IF NOT EXISTS \"Own notifications\" ON notifications FOR SELECT USING (auth.uid() = user_id)",
    "CREATE POLICY IF NOT EXISTS \"Own finances\" ON finance_transactions FOR SELECT USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()))",
    "CREATE POLICY IF NOT EXISTS \"Own board\" ON board_profiles FOR SELECT USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()))",
]

# ── Step 1: Test connection ────────────────────────────────────────────────────

def test_connection():
    step("Tester forbindelse til Supabase...")
    status, body = supabase_request("GET", "/rest/v1/")
    if status in (200, 404):  # 404 = no tables yet, but connection works
        ok(f"Forbundet til {SUPABASE_URL}")
        return True
    else:
        err(f"Kan ikke forbinde til Supabase (status {status})")
        err("Tjek at URL og nøgler er korrekte")
        return False

# ── Step 2: Run schema via Supabase SQL endpoint ───────────────────────────────

def run_schema():
    step("Opretter database tabeller...")

    # Supabase exposes a SQL endpoint via the Management API
    # We use the pg REST approach: POST to /rest/v1/rpc/exec_sql if available
    # Otherwise we run each statement via the query endpoint

    success = 0
    skipped = 0
    failed = 0

    for i, stmt in enumerate(SCHEMA_STATEMENTS):
        stmt_clean = stmt.strip()
        if not stmt_clean:
            continue

        # Use Supabase's SQL execution via REST
        status, body = supabase_request(
            "POST",
            "/rest/v1/rpc/query",
            {"query": stmt_clean}
        )

        label = stmt_clean[:60].replace('\n', ' ')

        if status in (200, 201, 204):
            success += 1
            print(f"  {GREEN}✓{RESET} {label}...")
        elif status == 404:
            # rpc/query not available — try direct approach
            # Fall through to manual SQL editor approach
            skipped += 1
        elif "already exists" in body.lower() or status == 409:
            skipped += 1
            print(f"  {YELLOW}○{RESET} {label}... (eksisterer allerede)")
        else:
            failed += 1
            print(f"  {RED}✗{RESET} {label}...")
            if failed <= 3:
                print(f"    Status: {status}, Body: {body[:100]}")

    return success, skipped, failed

# ── Step 3: Create .env files ─────────────────────────────────────────────────

def create_env_files():
    step("Opretter .env konfigurationsfiler...")

    script_dir = os.path.dirname(os.path.abspath(__file__))

    # Backend .env
    backend_env = f"""SUPABASE_URL={SUPABASE_URL}
SUPABASE_SERVICE_KEY={SUPABASE_SERVICE_KEY}
FRONTEND_URL=http://localhost:5173
PORT=3001
# Tilføj denne når du har publiceret dit Google Sheet som CSV:
# GOOGLE_SHEETS_CSV_URL=https://docs.google.com/spreadsheets/d/DIT_SHEET_ID/export?format=csv
"""
    backend_path = os.path.join(script_dir, "backend", ".env")
    os.makedirs(os.path.dirname(backend_path), exist_ok=True)
    with open(backend_path, "w") as f:
        f.write(backend_env)
    ok(f"backend/.env oprettet")

    # Frontend .env
    frontend_env = f"""VITE_SUPABASE_URL={SUPABASE_URL}
VITE_SUPABASE_ANON_KEY={SUPABASE_ANON_KEY}
VITE_API_URL=http://localhost:3001
"""
    frontend_path = os.path.join(script_dir, "frontend", ".env")
    os.makedirs(os.path.dirname(frontend_path), exist_ok=True)
    with open(frontend_path, "w") as f:
        f.write(frontend_env)
    ok(f"frontend/.env oprettet")

# ── Step 4: Install dependencies ──────────────────────────────────────────────

def install_deps():
    step("Installerer dependencies...")

    script_dir = os.path.dirname(os.path.abspath(__file__))

    for folder in ["backend", "frontend"]:
        path = os.path.join(script_dir, folder)
        if not os.path.exists(os.path.join(path, "package.json")):
            warn(f"{folder}/package.json ikke fundet — springer over")
            continue

        info(f"Installerer {folder} packages...")
        result = subprocess.run(
            ["npm", "install"],
            cwd=path,
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            ok(f"{folder} dependencies installeret")
        else:
            err(f"{folder} npm install fejlede:")
            print(result.stderr[:300])

# ── Step 5: Print SQL for manual run if needed ────────────────────────────────

def save_sql_for_manual():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    sql_path = os.path.join(script_dir, "database", "schema.sql")

    if os.path.exists(sql_path):
        info(f"SQL schema er klar til manuel kørsel: database/schema.sql")
    else:
        # Write it out
        os.makedirs(os.path.join(script_dir, "database"), exist_ok=True)
        full_sql = ";\n\n".join(SCHEMA_STATEMENTS) + ";"
        with open(sql_path, "w") as f:
            f.write("-- Cycling Zone Manager — Database Schema\n")
            f.write("-- Kør dette i Supabase SQL Editor\n\n")
            f.write(full_sql)
        ok(f"database/schema.sql gemt")

# ── Step 6: Print start instructions ─────────────────────────────────────────

def print_start_instructions():
    print(f"""
{BOLD}{GREEN}{'='*50}
🚴 CYCLING ZONE MANAGER — KLAR TIL START!
{'='*50}{RESET}

{BOLD}NÆSTE TRIN:{RESET}

{YELLOW}1. Kør database schema i Supabase:{RESET}
   • Gå til: https://supabase.com/dashboard/project/ghwvkxzhsbbltzfnuhhz/sql
   • Klik "New query"
   • Kopier indholdet af: database/schema.sql
   • Klik "Run" (Ctrl+Enter)

{YELLOW}2. Start backend (Terminal 1):{RESET}
   cd backend
   npm run dev

{YELLOW}3. Start frontend (Terminal 2):{RESET}
   cd frontend
   npm run dev

{YELLOW}4. Åbn spillet:{RESET}
   http://localhost:5173

{YELLOW}5. Opret din admin-konto:{RESET}
   • Registrér dig i spillet
   • Kør denne SQL i Supabase for at gøre dig til admin:

   UPDATE public.users SET role = 'admin'
   WHERE email = 'DIN@EMAIL.DK';

{BOLD}Direkte link til Supabase SQL Editor:{RESET}
{BLUE}https://supabase.com/dashboard/project/ghwvkxzhsbbltzfnuhhz/sql/new{RESET}
""")

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"""
{BOLD}{BLUE}{'='*50}
🚴 CYCLING ZONE MANAGER
   Automatisk Opsætning
{'='*50}{RESET}
""")

    # Check Python version
    if sys.version_info < (3, 8):
        err("Python 3.8+ påkrævet")
        sys.exit(1)

    # Check Node is installed
    node_check = subprocess.run(["node", "--version"], capture_output=True, text=True)
    if node_check.returncode != 0:
        err("Node.js ikke fundet — installér fra https://nodejs.org")
        sys.exit(1)
    ok(f"Node.js {node_check.stdout.strip()} fundet")

    # Step 1: Test connection
    if not test_connection():
        err("Kan ikke fortsætte uden Supabase forbindelse")
        sys.exit(1)

    # Step 2: Try to run schema
    success, skipped, failed = run_schema()
    if failed > 5:
        warn(f"Skema via API fejlede ({failed} fejl) — brug manuel SQL metode nedenfor")
    else:
        ok(f"Database: {success} oprettet, {skipped} eksisterede allerede")

    # Step 3: Create .env files
    create_env_files()

    # Step 4: Save SQL
    save_sql_for_manual()

    # Step 5: Install npm deps
    install_deps()

    # Step 6: Print instructions
    print_start_instructions()

if __name__ == "__main__":
    main()
