-- ============================================================
-- ECONOMY SCALE 4000x MIGRATION
-- Kør i Supabase SQL-editor.
-- Alle beløb og værdier ganges med 4000.
-- Rytterens pris = uci_points * 4000.
-- ============================================================

-- ── Teams ─────────────────────────────────────────────────────
UPDATE teams
SET
  balance        = balance        * 4000,
  sponsor_income = sponsor_income * 4000;

-- ── Riders — løn ──────────────────────────────────────────────
UPDATE riders
SET salary = salary * 4000
WHERE salary > 0;

-- ── Riders — price (generated column) ─────────────────────────
-- Genereret kolonne kan ikke alters direkte; drop + re-add.
ALTER TABLE riders DROP COLUMN price;
ALTER TABLE riders ADD COLUMN price INTEGER
  GENERATED ALWAYS AS (uci_points * 4000) STORED;

-- ── Loan agreements (rytter-lån) ──────────────────────────────
UPDATE loan_agreements
SET
  loan_fee         = loan_fee * 4000,
  buy_option_price = CASE
    WHEN buy_option_price IS NOT NULL THEN buy_option_price * 4000
    ELSE NULL
  END;

-- ── Finance loans (nødlån + manuelle lån) ─────────────────────
UPDATE loans
SET
  principal        = principal        * 4000,
  origination_fee  = origination_fee  * 4000,
  amount_remaining = amount_remaining * 4000;

-- ── Loan config — gældsloft ───────────────────────────────────
UPDATE loan_config
SET debt_ceiling = debt_ceiling * 4000;

-- ── Finance transactions (historik) ───────────────────────────
UPDATE finance_transactions
SET amount = amount * 4000;

-- ── Prize tables ──────────────────────────────────────────────
UPDATE prize_tables
SET prize_amount = prize_amount * 4000;

-- ── Auctions (aktive + historiske) ────────────────────────────
UPDATE auctions
SET
  starting_price   = starting_price   * 4000,
  current_price    = current_price    * 4000,
  min_increment    = min_increment    * 4000,
  guaranteed_price = CASE
    WHEN guaranteed_price IS NOT NULL THEN guaranteed_price * 4000
    ELSE NULL
  END;

-- ── Auction bids ──────────────────────────────────────────────
UPDATE auction_bids
SET amount = amount * 4000;

-- ── Transfer listings ─────────────────────────────────────────
UPDATE transfer_listings
SET asking_price = asking_price * 4000;

-- ── Transfer offers ───────────────────────────────────────────
UPDATE transfer_offers
SET
  offer_amount   = offer_amount * 4000,
  counter_amount = CASE
    WHEN counter_amount IS NOT NULL THEN counter_amount * 4000
    ELSE NULL
  END;

-- ── Swap offers ───────────────────────────────────────────────
UPDATE swap_offers
SET
  cash_adjustment = cash_adjustment * 4000,
  counter_cash    = CASE
    WHEN counter_cash IS NOT NULL THEN counter_cash * 4000
    ELSE NULL
  END;

-- ── Board profiles — startbalance-snapshot ────────────────────
UPDATE board_profiles
SET
  plan_start_balance       = CASE
    WHEN plan_start_balance IS NOT NULL THEN plan_start_balance * 4000
    ELSE NULL
  END,
  plan_start_sponsor_income = CASE
    WHEN plan_start_sponsor_income IS NOT NULL THEN plan_start_sponsor_income * 4000
    ELSE NULL
  END;
