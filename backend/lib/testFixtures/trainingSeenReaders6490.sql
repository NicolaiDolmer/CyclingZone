-- Fixture schema based on existing compensation integration tests; no production use.
CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE app_config(key text PRIMARY KEY,value jsonb,updated_at timestamptz);
 CREATE TABLE teams(id uuid PRIMARY KEY,user_id uuid,my_result_seen_race_id uuid,onboarding_progress_dismissed_at timestamptz,balance bigint);
 CREATE TABLE users(id uuid PRIMARY KEY,role text,is_beta_tester boolean,last_seen timestamptz,last_login_date date,nps_last_prompted_at timestamptz,xp integer);
 CREATE TABLE riders(id uuid PRIMARY KEY,team_id uuid,is_retired boolean,is_academy boolean,birthdate date,potentiale numeric,primary_type text,secondary_type text,market_value bigint,updated_at timestamptz);
 CREATE TABLE seasons(id uuid PRIMARY KEY,number integer,status text,race_days_completed integer);
 CREATE TABLE rider_derived_abilities(rider_id uuid PRIMARY KEY,climbing smallint,ability_progress jsonb);
 CREATE TABLE rider_condition(rider_id uuid PRIMARY KEY,form integer,fatigue integer,injured_until date,injury_cause text,updated_at timestamptz);
 CREATE TABLE training_race_loads(rider_id uuid,race_id uuid,stage_number integer,season_id uuid,game_day integer,tick_date date,load numeric,consumed_at timestamptz,reconciliation_required boolean,duplicate_of_race_id uuid,duplicate_of_stage_number integer);
 CREATE TABLE training_rider_ticks(rider_id uuid,season_id uuid,game_day integer,tick_date date,team_id uuid,report jsonb);
 CREATE TABLE training_condition_settlements(rider_id uuid,season_id uuid,tick_date date,team_id uuid,status text,opening_condition jsonb,applied_condition jsonb,missing_evidence jsonb);
 CREATE TABLE training_day_runs(report jsonb);
 CREATE TABLE training_date_work(team_id uuid,season_id uuid,tick_date date,game_days integer[],expected_rider_ids uuid[],deadline_at timestamptz,status text,missing_evidence jsonb,opening_conditions jsonb,quarantined_rider_ids uuid[],quarantine_evidence jsonb,updated_at timestamptz);
 CREATE TABLE training_plans(id uuid,team_id uuid,rider_id uuid,season_id uuid,focus text,intensity text,updated_at timestamptz);
 CREATE TABLE training_week_plans(id uuid,team_id uuid,rider_id uuid,days jsonb,program_key text,updated_at timestamptz);
 CREATE TABLE team_training_rules(id uuid,team_id uuid,rider_id uuid,fatigue_threshold integer,fallback text,recovery_after_stage boolean);
 CREATE TABLE training_groups(id uuid,team_id uuid,name text,days jsonb,program_key text,fatigue_threshold integer,fallback text);
 CREATE TABLE training_group_members(rider_id uuid,group_id uuid,team_id uuid,follows_group boolean);
 CREATE TABLE team_facilities(id uuid,team_id uuid,track text,tier integer);
 CREATE TABLE team_staff(id uuid,team_id uuid,role text,name text,tier integer,status text,salary integer);
 CREATE TABLE staff_derived_abilities(staff_id uuid,overall numeric,dimensions jsonb,levels jsonb,updated_at timestamptz);
 CREATE TABLE races(id uuid PRIMARY KEY,season_id uuid,race_type text,stages_completed integer,status text,finalize_state text);
 CREATE TABLE race_stage_schedule(race_id uuid,stage_number integer,scheduled_at timestamptz,game_day integer,created_at timestamptz);
 CREATE TABLE race_stage_profiles(id uuid,race_id uuid,stage_number integer,profile_type text,weather jsonb);
 CREATE TABLE race_simulation_runs(id uuid,race_id uuid,stage_number integer,entrant_snapshot jsonb,seed text);
 CREATE TABLE race_results(id uuid,race_id uuid,stage_number integer,result_type text,rider_id uuid,rank integer);
 CREATE TABLE race_entry_days(race_id uuid,rider_id uuid,season_id uuid,game_day integer,team_id uuid);
 GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
 GRANT INSERT ON rider_condition TO service_role;
ALTER TABLE riders ADD COLUMN acquired_at timestamptz, ADD COLUMN created_at timestamptz;
ALTER TABLE training_day_runs ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ADD COLUMN team_id uuid, ADD COLUMN season_id uuid, ADD COLUMN tick_date date,
 ADD COLUMN game_day integer, ADD COLUMN squad text, ADD COLUMN executed_by text,
 ADD COLUMN bonus_applied boolean, ADD COLUMN created_at timestamptz DEFAULT '2026-10-11T12:00:00Z';
CREATE INDEX idx_training_day_runs_report_riders ON training_day_runs USING gin((report->'riders') jsonb_path_ops);
ALTER TABLE training_date_work ADD COLUMN created_at timestamptz DEFAULT '2026-10-11T12:00:00Z',
 ADD PRIMARY KEY(team_id,season_id,tick_date);
ALTER TABLE training_date_work ALTER COLUMN status SET DEFAULT 'pending',
 ALTER COLUMN missing_evidence SET DEFAULT '[]', ALTER COLUMN opening_conditions SET DEFAULT '{}',
 ALTER COLUMN quarantined_rider_ids SET DEFAULT '{}', ALTER COLUMN quarantine_evidence SET DEFAULT '[]';
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO service_role,anon,authenticated;
