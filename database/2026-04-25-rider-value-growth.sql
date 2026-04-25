-- ============================================================
-- RIDER VALUE GROWTH — Dynamisk rytterværdi og lønmodel
-- Kør i Supabase SQL-editor.
--
-- Ændringer:
--   1. Tilføj prize_earnings_bonus til riders
--   2. Minimum 5 UCI point for alle ryttere
--   3. Genberegn alle lønninger: 15% af (uci_points*4000 + bonus)
-- ============================================================

-- ── 1. Ny kolonne: præmiebonus ─────────────────────────────────
ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS prize_earnings_bonus INTEGER NOT NULL DEFAULT 0;

-- ── 2. Minimum 5 UCI point ─────────────────────────────────────
-- Ryttere med færre end 5 UCI point sættes til 5 (= 20.000 CZ$ minimumsværdi)
UPDATE riders
  SET uci_points = 5
  WHERE uci_points < 5;

-- ── 3. Genberegn alle lønninger til 15% ───────────────────────
-- Effektiv værdi = uci_points * 4000 + prize_earnings_bonus
-- Løn = max(1, round(effektiv_værdi * 0.15))
UPDATE riders
  SET salary = GREATEST(1, ROUND((uci_points * 4000 + prize_earnings_bonus) * 0.15));
