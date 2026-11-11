-- Synthetic dependency subset, NOT a production schema copy.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
CREATE TABLE seasons(id uuid PRIMARY KEY, number integer UNIQUE NOT NULL, status text NOT NULL CHECK(status IN ('active','completed','upcoming')), start_date timestamptz,end_date timestamptz,race_days_total integer DEFAULT 1);
CREATE TABLE teams(id uuid PRIMARY KEY,user_id uuid,name text,division integer,league_division_id integer,sponsor_income bigint DEFAULT 0,balance bigint DEFAULT 0,parked_at timestamptz,is_ai boolean DEFAULT false,is_bank boolean DEFAULT false,is_frozen boolean DEFAULT false,is_test_account boolean DEFAULT false);
CREATE TABLE riders(id uuid PRIMARY KEY, team_id uuid REFERENCES teams(id),is_retired boolean DEFAULT false,contract_end_season integer, squad text DEFAULT 'senior',created_at timestamptz DEFAULT '2026-10-01T00:00:00Z',acquired_at timestamptz);
CREATE TABLE board_profiles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),team_id uuid REFERENCES teams(id),budget_modifier numeric,negotiation_status text);
CREATE TABLE board_consequences(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),team_id uuid,layer integer,severity integer,status text);
CREATE TABLE transfer_windows(id uuid PRIMARY KEY,season_id uuid REFERENCES seasons(id),status text,closed_at timestamptz,created_at timestamptz,board_test_mode boolean DEFAULT false);
CREATE TABLE season_standings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),season_id uuid,team_id uuid,division integer,rank_in_division integer,total_points integer);
CREATE TABLE league_divisions(id integer PRIMARY KEY,tier integer,squad text DEFAULT 'senior');
CREATE TABLE races(id uuid PRIMARY KEY,season_id uuid REFERENCES seasons(id),league_division_id integer,stages integer DEFAULT 1,squad text DEFAULT 'senior',status text);
CREATE TABLE race_stage_schedule(race_id uuid REFERENCES races(id),stage_number integer,game_day integer,scheduled_at timestamptz);
CREATE TABLE rider_peak_plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),season_id uuid,rider_id uuid,target_race_id uuid);
CREATE TABLE race_entries(race_id uuid REFERENCES races(id),rider_id uuid,team_id uuid,is_auto_filled boolean DEFAULT false,PRIMARY KEY(race_id,rider_id));
CREATE TABLE team_race_strategy(team_id uuid PRIMARY KEY,target_race_ids jsonb DEFAULT '[]');
CREATE TABLE admin_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),action_type text,admin_user_id uuid,description text NOT NULL,target_team_id uuid,meta jsonb,created_at timestamptz DEFAULT '2026-11-28T19:00:00Z');
CREATE TABLE app_config(key text PRIMARY KEY,value jsonb);
CREATE TABLE finance_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),team_id uuid,season_id uuid,type text,amount bigint,idempotency_key text UNIQUE,metadata jsonb);
CREATE TABLE training_date_work(team_id uuid,season_id uuid,tick_date date,status text);

-- Columns consumed by the unchanged production audit RPC.
ALTER TABLE finance_transactions ADD COLUMN description text, ADD COLUMN race_id uuid,
 ADD COLUMN related_loan_id uuid, ADD COLUMN actor_type text, ADD COLUMN actor_id uuid,
 ADD COLUMN source_path text, ADD COLUMN reason_code text, ADD COLUMN before_balance bigint,
 ADD COLUMN after_balance bigint, ADD COLUMN related_entity_type text,
 ADD COLUMN related_entity_id uuid, ADD COLUMN created_at timestamptz DEFAULT '2026-11-28T19:00:00Z';
