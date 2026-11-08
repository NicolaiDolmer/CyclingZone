export const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE app_config (key text PRIMARY KEY, value jsonb NOT NULL, description text);
CREATE TABLE teams (id uuid PRIMARY KEY, balance bigint NOT NULL);
CREATE TABLE riders (id uuid PRIMARY KEY, team_id uuid, pending_team_id uuid,
  squad text NOT NULL DEFAULT 'senior', is_academy boolean NOT NULL DEFAULT false, is_retired boolean DEFAULT false,
  salary integer DEFAULT 1000, contract_length integer DEFAULT 2, contract_end_season integer DEFAULT 3,
  market_value bigint DEFAULT 1000000, base_value bigint DEFAULT 1000000, prize_earnings_bonus bigint DEFAULT 0,
  acquired_at timestamptz DEFAULT now(), updated_at timestamptz);
CREATE TABLE transfer_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL, seller_team_id uuid NOT NULL, asking_price integer NOT NULL,
  status text DEFAULT 'open' CHECK (status IN ('open', 'negotiating', 'sold', 'withdrawn', 'paused')),
  created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX uniq_transfer_listings_one_active_per_rider ON transfer_listings(rider_id) WHERE status IN ('open', 'negotiating');
CREATE TABLE auctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL, seller_team_id uuid,
  starting_price integer NOT NULL DEFAULT 1, current_price integer NOT NULL DEFAULT 1, current_bidder_id uuid,
  min_increment integer DEFAULT 1, requested_start timestamptz NOT NULL DEFAULT now(),
  calculated_end timestamptz NOT NULL, actual_end timestamptz,
  status text DEFAULT 'active' CHECK (status IN ('active', 'extended', 'completed', 'cancelled')),
  extension_count integer DEFAULT 0, is_flash boolean NOT NULL DEFAULT false, is_youth boolean DEFAULT false,
  created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX uniq_auctions_one_active_per_rider ON auctions(rider_id) WHERE status IN ('active', 'extended');
CREATE TABLE auction_bids (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auction_id uuid NOT NULL, team_id uuid NOT NULL,
  amount integer NOT NULL, bid_time timestamptz NOT NULL DEFAULT now(), triggered_extension boolean DEFAULT false, is_proxy boolean DEFAULT false);
CREATE TABLE auction_proxy_bids (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auction_id uuid NOT NULL, team_id uuid NOT NULL, max_amount bigint NOT NULL);
CREATE TABLE swap_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), offered_rider_id uuid, requested_rider_id uuid, status text NOT NULL);
GRANT SELECT, INSERT, UPDATE ON teams, riders, transfer_listings, auctions, auction_bids, auction_proxy_bids, swap_offers TO service_role;
GRANT SELECT, INSERT, UPDATE ON transfer_listings TO authenticated;
`;
