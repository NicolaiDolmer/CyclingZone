
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE league_divisions(id bigint PRIMARY KEY, tier int, pool_index int, label text);
    CREATE TABLE teams(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, user_id uuid,
      is_ai boolean DEFAULT false, is_bank boolean DEFAULT false, is_frozen boolean DEFAULT false,
      is_test_account boolean DEFAULT false, league_division_id bigint REFERENCES league_divisions,
      retired_at timestamptz, pending_removal_at timestamptz,
      pending_removal_blocked_reason text, pending_removal_blocked_since timestamptz);
    CREATE TABLE riders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams,
      firstname text, lastname text, pending_team_id uuid REFERENCES teams, is_retired boolean DEFAULT false);
    CREATE TABLE races(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text DEFAULT 'scheduled',
      stages_completed int DEFAULT 0, prize_paid_at timestamptz);
    CREATE TABLE race_entries(race_id uuid REFERENCES races, rider_id uuid REFERENCES riders,
      team_id uuid REFERENCES teams, PRIMARY KEY(race_id,rider_id));
    CREATE TABLE race_stage_claims(race_id uuid REFERENCES races,stage_index int,claimed_at timestamptz,
      claimed_by text,PRIMARY KEY(race_id,stage_index));
    CREATE TABLE race_results(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), race_id uuid REFERENCES races,
      rider_id uuid REFERENCES riders, team_id uuid REFERENCES teams, prize_money numeric);
    CREATE TABLE transfer_offers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rider_id uuid REFERENCES riders,
      seller_team_id uuid REFERENCES teams, buyer_team_id uuid REFERENCES teams, status text);
    CREATE TABLE transfer_listings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rider_id uuid REFERENCES riders,
      seller_team_id uuid REFERENCES teams, status text);
    CREATE TABLE swap_offers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), offered_rider_id uuid REFERENCES riders,
      requested_rider_id uuid REFERENCES riders, proposing_team_id uuid REFERENCES teams,
      receiving_team_id uuid REFERENCES teams, status text, cash_adjustment numeric);
    CREATE TABLE auctions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rider_id uuid REFERENCES riders,
      seller_team_id uuid REFERENCES teams, current_bidder_id uuid REFERENCES teams, status text);
    CREATE TABLE rider_watchlist(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, rider_id uuid REFERENCES riders);
    CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text,
      title text, message text, related_id uuid, metadata jsonb, created_at timestamptz DEFAULT now());
    CREATE TABLE app_config(key text PRIMARY KEY, value jsonb);
    INSERT INTO app_config VALUES ('ai_team_retire_enabled','"on"'),('ai_pool_retirement_v2_enabled','"on"');
    GRANT USAGE ON SCHEMA public TO service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
  
