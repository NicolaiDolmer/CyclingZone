// #6181 · Minimalt udsnit af prod-skemaet til pengelaas-testene (PGlite og rigtig PG17).
// Kun de kolonner, migrationerne laeser og skriver. Hold og ryttere er aliaser.
export const FUTURE = '2099-01-01T12:00:00Z';

export const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE teams (id uuid PRIMARY KEY, balance bigint NOT NULL, user_id uuid);
CREATE TABLE riders (id uuid PRIMARY KEY, firstname text, lastname text, team_id uuid, pending_team_id uuid, acquired_at timestamptz,
  is_academy boolean NOT NULL DEFAULT false, squad text NOT NULL DEFAULT 'senior', is_retired boolean NOT NULL DEFAULT false,
  salary integer, contract_length integer, contract_end_season integer, updated_at timestamptz);
CREATE TABLE app_config (key text PRIMARY KEY, value jsonb, description text);
CREATE TABLE finance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id),
  type text NOT NULL CHECK (type IN ('transfer_in', 'transfer_out', 'prize')),
  amount bigint NOT NULL, description text, season_id uuid, race_id uuid, related_loan_id uuid,
  actor_type text, actor_id uuid, source_path text, reason_code text,
  before_balance bigint, after_balance bigint,
  related_entity_type text CHECK (related_entity_type IS NULL OR related_entity_type IN
    ('auction','loan','transfer','swap','race','season','manual')),
  related_entity_id uuid, idempotency_key text, metadata jsonb,
  created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX uniq_finance_idempotency_key ON finance_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE auctions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rider_id uuid, seller_team_id uuid,
  starting_price bigint, current_price bigint NOT NULL DEFAULT 1, current_bidder_id uuid,
  status text DEFAULT 'active' CHECK (status IN ('active','extended','completed','cancelled')),
  calculated_end timestamptz NOT NULL DEFAULT '${FUTURE}', is_youth boolean DEFAULT false);
CREATE TABLE auction_bids (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auction_id uuid NOT NULL, team_id uuid NOT NULL,
  amount bigint NOT NULL, bid_time timestamptz NOT NULL DEFAULT now(), triggered_extension boolean DEFAULT false, is_proxy boolean DEFAULT false);
CREATE TABLE auction_proxy_bids (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auction_id uuid NOT NULL, team_id uuid NOT NULL,
  max_amount bigint NOT NULL, UNIQUE (auction_id, team_id));
CREATE TABLE transfer_offers (id uuid PRIMARY KEY, status text NOT NULL, updated_at timestamptz);
CREATE TABLE swap_offers (id uuid PRIMARY KEY, status text NOT NULL, updated_at timestamptz);
CREATE TABLE notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text NOT NULL,
  title text NOT NULL, message text NOT NULL, is_read boolean DEFAULT false, related_id uuid, metadata jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE races (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'scheduled', stages_completed integer NOT NULL DEFAULT 0);
CREATE TABLE race_entries (race_id uuid NOT NULL, rider_id uuid NOT NULL, team_id uuid NOT NULL, PRIMARY KEY (race_id, rider_id));
CREATE TABLE academy_graduation (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL, rider_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending', resolved_at timestamptz, created_at timestamptz DEFAULT now());
`;

// Alle migrationer i den raekkefoelge, auto-migrate koerer dem.
export const MIGRATIONS = [
  '2026-11-07-6181-sale-escrow-m1.sql',
  '2026-11-07-6181-sale-escrow-m2-guards.sql',
  '2026-11-07-6181-m3-market-commitment.sql',
  '2026-11-09-6181-tjekliste.sql',
];

// increment_balance_with_audit, kopieret ud af sin rigtige migration.
export function balanceRpcFrom(source) {
  const match = source.match(/CREATE OR REPLACE FUNCTION increment_balance_with_audit\([\s\S]*?\$\$ LANGUAGE plpgsql;/);
  if (!match) throw new Error('increment_balance_with_audit not found in its migration');
  return match[0];
}
