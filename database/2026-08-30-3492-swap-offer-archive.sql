-- 2026-08-30 — #3492: byttetilbud kan arkiveres, præcis som transfertilbud.
--
-- PROBLEM
--   Afsluttede byttetilbud (accepted/rejected) bliver hængende i Forhandlinger-
--   fanen for evigt. transfer_offers fik per-side arkivering allerede 30/4
--   (database/2026-04-30-transfer-offer-archive.sql) — swap_offers blev glemt.
--
-- HVORFOR TO KOLONNER OG IKKE ÉN
--   Samme kontrakt som transfer_offers: arkivering er PER SIDE. Den ene manager
--   må kunne rydde sin egen liste uden at fjerne forhandlingen fra modpartens.
--
-- IDEMPOTENT: kan køres flere gange uden effekt (IF NOT EXISTS overalt).

ALTER TABLE swap_offers
  ADD COLUMN IF NOT EXISTS proposing_archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS receiving_archived_at TIMESTAMPTZ;

-- Indeks-formen spejler transfer_offers': (ejer-kolonne, arkiv-flag, sorterings-
-- kolonne DESC) dækker både "mine aktive" (archived_at IS NULL, sorteret på
-- updated_at) og "mit arkiv" (archived_at IS NOT NULL).
CREATE INDEX IF NOT EXISTS idx_swap_offers_proposing_archive
  ON swap_offers (proposing_team_id, proposing_archived_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_swap_offers_receiving_archive
  ON swap_offers (receiving_team_id, receiving_archived_at, updated_at DESC);

-- POST-VERIFY (kør efter apply — begge skal give 2 rækker):
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'swap_offers'
--      AND column_name IN ('proposing_archived_at','receiving_archived_at');
--
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'swap_offers'
--      AND indexname IN ('idx_swap_offers_proposing_archive',
--                        'idx_swap_offers_receiving_archive');
