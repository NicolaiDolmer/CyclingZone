-- #2594 — Værdimodel v4 + løn-decoupling CUTOVER (bundlet migration).
-- Ejer-gates lukket 18/7: #2591 = A (omfavn, ROI-loft 200%), Q1 = drop
-- prize_earnings_bonus fra market_value, Q2 discount=0,80, Q3 beta_pt=0.
--
-- (1) riders.current_production_value — løn-basen (#2428 løn-decoupling):
--     sæson-0-leddet af v4-karriere-NPV'en (riderCareerNpv.currentProductionValue).
--     Plain skalar (som base_value) — afhænger af evner via modellen, kan derfor
--     ikke være GENERATED. Skrives af værdi-sweepen/backfill/progression-motoren.
--
-- (2) riders.market_value — GENERATED-udtrykket mister prize_earnings_bonus
--     (Q1 = drop): v4-modellen prissætter forventet præmieproduktion, så den
--     additive bonus dobbelt-talte. Kolonnen prize_earnings_bonus SLETTES IKKE
--     (historisk statistik + visning); den indgår bare ikke i værdien længere.
--     GENERATED-udtryk kan ikke ALTERes → drop + genopret + genskab afhængige
--     indekser (idx_riders_market_value + idx_riders_tradeable).
--
-- Idempotent: kolonne-add er IF NOT EXISTS; market_value-genopbygningen er gated
-- på at det gamle udtryk stadig indeholder prize_earnings_bonus.
--
-- EFTER apply køres den globale v4-recompute (runBaseValueBackfill) som fylder
-- base_value + current_production_value for hele populationen og re-synker
-- akademi-lønninger (#2083-guarden). Se PR #2594-cutover for verify-tjekliste.

ALTER TABLE riders ADD COLUMN IF NOT EXISTS current_production_value INTEGER;

COMMENT ON COLUMN riders.current_production_value IS
  '#2428/#2594: forventet produktion i indeværende sæson (v4 sæson-0-led, skaleret, uden elite-præmie). Løn-base: salary = cpv × SALARY_RATE_PROD[division], frossen ved signering (#1309).';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'riders'
      AND column_name = 'market_value'
      AND generation_expression LIKE '%prize_earnings_bonus%'
  ) THEN
    -- Afhængige indekser genskabes efter kolonne-genopbygningen.
    DROP INDEX IF EXISTS idx_riders_market_value;
    DROP INDEX IF EXISTS idx_riders_tradeable;

    ALTER TABLE riders DROP COLUMN market_value;
    ALTER TABLE riders ADD COLUMN market_value INTEGER
      GENERATED ALWAYS AS (COALESCE(base_value, 1000)) STORED;

    CREATE INDEX idx_riders_market_value ON riders (market_value DESC);
    -- Spejler database/2026-07-07-riders-owner-is-ai.sql (partial index på
    -- default-visningen: skjul AI + skjul pensionerede).
    CREATE INDEX idx_riders_tradeable
      ON public.riders (market_value DESC)
      WHERE owner_is_ai = false AND is_retired = false;
  END IF;
END $$;

COMMENT ON COLUMN riders.market_value IS
  '#2594: GENERATED = COALESCE(base_value, 1000). base_value er v4-karriere-NPV (fremtids-pris); prize_earnings_bonus indgår IKKE længere (dobbelt-talte præmier). Fase 3 (#1281) tilføjer market_premium.';

-- PostgREST schema-cache reload (ny kolonne + genopbygget market_value).
NOTIFY pgrst, 'reload schema';
