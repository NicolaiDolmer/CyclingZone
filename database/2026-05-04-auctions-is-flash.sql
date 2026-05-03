-- Deadline Day Flash Auction: kolonne for 30-min flash-auktioner startet under aktivt DD.
-- Live Supabase har kolonnen siden DD-rollout (manuelt tilføjet); denne migration bringer
-- source-of-truth (schema.sql + supabase_setup.sql + setup.py) på niveau med live tilstand.
-- Audit-reference: docs/archive/DD_SOAK_CODE_AUDIT_2026-05-03.md S3.

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS is_flash BOOLEAN NOT NULL DEFAULT FALSE;
