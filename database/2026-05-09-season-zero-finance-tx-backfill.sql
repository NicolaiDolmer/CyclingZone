-- Slice 07h · Sæson 0 seed + finance_transactions backfill + auto-fill trigger
-- Sub-issue: #86 (Slice 07 Economy Overhaul)
--
-- Tre problemer der løses i én idempotent migration:
--   1) seasons-tabellen er tom i prod (verificeret 2026-05-09: COUNT=0).
--      Vi seeder sæson 0 = open beta transfervindue (åbnede 2026-05-08 18:00 UTC,
--      stadig aktiv — sæson 1 ikke startet).
--   2) Alle 79 eksisterende finance_transactions har season_id = NULL fordi
--      auctionFinalization.js + andre 07d Fase B-callsites glemte at sætte
--      season_id i payload. Backfill'es til sæson 0.
--   3) 77/79 rows har reason_code = NULL (legacy fra før v2.92). Backfill'es
--      heuristisk via type + description-mønster — alle 79 rows er auktion-rows
--      (verificeret med GROUP BY type, description), så mappingen er entydig.
--
-- Plus: BEFORE INSERT-trigger på finance_transactions auto-stamper season_id
-- fra aktiv sæson hvis callsite glemte det. Dette er centralt og 26-callsite-safe.
--
-- Spillere mærker intet — ingen balance-ændringer, ingen UI-state ændret.
--
-- Idempotent: ON CONFLICT DO NOTHING + WHERE …IS NULL + CREATE OR REPLACE.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS finance_tx_fill_season ON finance_transactions;
--   DROP FUNCTION IF EXISTS fill_finance_tx_season();
--   -- Backfill'ed rows kan IKKE rulles tilbage (vi har ingen pre-image af NULL).
--   -- Slet sæson 0 manuelt hvis ønsket — men det vil bryde finance-rapporten.

-- ============================================================
-- 1. Seed sæson 0
-- ============================================================
-- Faste UUID så docs/tests kan referere uden runtime-lookup.
-- Sæson 0 = "Open beta transfervindue" — ingen løb køres her, kun rytter-køb.

INSERT INTO seasons (id, number, status, start_date, end_date, race_days_total, race_days_completed)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  0,
  'active',
  '2026-05-08T18:00:00Z',  -- Danish 20:00 = UTC 18:00 (CEST = UTC+2)
  NULL,                     -- slutter når sæson 1 starter (separat slice)
  0,
  0
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. Backfill finance_transactions.season_id → sæson 0
-- ============================================================
-- Alle 79 eksisterende rows er fra open beta (2026-05-08+), så de tilhører sæson 0.

UPDATE finance_transactions
SET season_id = '00000000-0000-0000-0000-000000000000'
WHERE season_id IS NULL;

-- ============================================================
-- 3. Backfill finance_transactions.reason_code (heuristisk men entydig)
-- ============================================================
-- Verificeret 2026-05-09: alle 79 rows har type ∈ {transfer_in, transfer_out}
-- og description starter med "Solgt" eller "Købt" + "på auktion".
-- Mapping er derfor 1:1 — ingen tvetydighed.

UPDATE finance_transactions
SET reason_code = CASE
  WHEN type = 'transfer_out' AND description LIKE 'Købt%på auktion%'
    THEN 'auction_winner_payment'
  WHEN type = 'transfer_in' AND description LIKE 'Solgt%på auktion%'
    THEN 'auction_seller_payout'
  WHEN type = 'sponsor'
    THEN 'season_start_sponsor'
  WHEN type = 'salary'
    THEN 'season_end_salary'
  WHEN type = 'prize'
    THEN 'race_prize_payout'
  WHEN type = 'starting_budget'
    THEN 'starting_budget'
  WHEN type = 'admin_adjustment'
    THEN 'admin_balance_adjustment'
  WHEN type = 'loan_received'
    THEN 'loan_principal_received'
  WHEN type = 'loan_repayment'
    THEN 'loan_repayment'
  WHEN type = 'loan_interest'
    THEN 'season_end_loan_interest'
  WHEN type = 'emergency_loan'
    THEN 'emergency_loan_received'
  WHEN type = 'auto_squad_purchase'
    THEN 'squad_auto_purchase'
  WHEN type = 'auto_squad_sale'
    THEN 'squad_auto_sale'
  WHEN type = 'squad_violation_fine'
    THEN 'squad_violation_fine'
  WHEN type = 'bonus'
    THEN 'board_bonus_accepted'
  WHEN type = 'interest'
    THEN 'season_end_negative_interest'
  ELSE NULL  -- behold NULL hvis ingen match (skulle ikke ske; verificeret efter migration)
END
WHERE reason_code IS NULL;

-- ============================================================
-- 4. Backfill actor_type på legacy rows (07d Fase A populerer kun nye rows)
-- ============================================================
-- Ingen audit-info for legacy → markér som 'migration' så vi tydeligt kan filtrere
-- backfill'ede rows fra rigtige cron/api-rows i admin-dashboardet.

UPDATE finance_transactions
SET actor_type = 'migration'
WHERE actor_type IS NULL;

-- ============================================================
-- 5. BEFORE INSERT-trigger: auto-stamp season_id fra aktiv sæson
-- ============================================================
-- 26 callsites går via increment_balance_with_audit-RPC og glemmer ofte season_id.
-- En central BEFORE INSERT-trigger garanterer at season_id altid er sat — uden
-- at vi skal røre callsites.
--
-- Trigger-logik: hvis NEW.season_id er NULL → vælg seneste aktive sæson.
-- "Seneste" = MAX(number) for at håndtere overlap (sjældent, men muligt mellem
-- sæson-rollover og afslutning af gammel sæson).

CREATE OR REPLACE FUNCTION fill_finance_tx_season() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.season_id IS NULL THEN
    SELECT id INTO NEW.season_id
    FROM seasons
    WHERE status = 'active'
    ORDER BY number DESC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_tx_fill_season ON finance_transactions;
CREATE TRIGGER finance_tx_fill_season
  BEFORE INSERT ON finance_transactions
  FOR EACH ROW
  EXECUTE FUNCTION fill_finance_tx_season();

-- ============================================================
-- 6. Verifikation (kør efter migration; skal returnere 0 for begge)
-- ============================================================
--   SELECT COUNT(*) FROM finance_transactions WHERE season_id IS NULL;
--   SELECT COUNT(*) FROM finance_transactions WHERE reason_code IS NULL;
