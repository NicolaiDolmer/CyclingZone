-- #1663 Økonomi Fase 2: forhandlbare sponsor-kontrakter. Én aktiv pr. hold + historik.
-- Sponsor-indkomst bliver en forhandlet kontrakt: garanteret base + per-løbsdag-rate +
-- længde 1-3 sæsoner. Idempotent. RLS: holdet ser kun egne kontrakter.
-- Backfill renown-neutral (nul saldo-chok): nuværende hold er friske → renown 1.0 →
-- division-base = dagens sponsor (SPONSOR_INCOME_BY_DIVISION: D1 600k / D2 400k / D3 340k).
-- Spec: docs/superpowers (økonomi-sammenhæng / FM-omdømme).
--
-- ⚠️ Migration auto-applies i prod ved merge — EJEREN merger PR'en. Verificér FØRST
--    mod en disposabel Supabase-branch.

BEGIN;

-- 1. sponsor_contracts: én aktiv kontrakt pr. hold (delvist unik-index) + fuld historik.
CREATE TABLE IF NOT EXISTS sponsor_contracts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id              UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  sponsor_name         TEXT NOT NULL,
  guaranteed_base      BIGINT NOT NULL,
  per_race_day_rate    BIGINT NOT NULL DEFAULT 0,
  length_seasons       INTEGER NOT NULL CHECK (length_seasons BETWEEN 1 AND 3),
  start_season         INTEGER NOT NULL,
  expires_after_season INTEGER NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'replaced', 'pending')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE sponsor_contracts IS
  'Sponsor-kontrakter (#1663, Økonomi Fase 2): forhandlet sponsor-indkomst pr. hold. '
  'guaranteed_base + per_race_day_rate, længde 1-3 sæsoner. Højst én status=active OG '
  'højst én status=pending pr. hold (to delvise unik-indekser). status pending->active '
  'ved sæson-skifte; active->expired/replaced. Backfill er renown-neutral.';

-- Højst én aktiv kontrakt pr. hold; udløbne/erstattede beholdes som historik.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsor_contracts_team_active
  ON sponsor_contracts(team_id) WHERE status = 'active';

-- Højst én pending kontrakt pr. hold (manager-valg for kommende sæson, aktiveres ved skifte).
CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsor_contracts_team_pending
  ON sponsor_contracts(team_id) WHERE status = 'pending';

ALTER TABLE sponsor_contracts ENABLE ROW LEVEL SECURITY;
-- Hold-ejeren læser egne kontrakter. Skrivning sker service-role (backend), ingen client-write-policy.
DROP POLICY IF EXISTS sponsor_contracts_select_own ON sponsor_contracts;
CREATE POLICY sponsor_contracts_select_own ON sponsor_contracts
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

GRANT SELECT ON sponsor_contracts TO authenticated;

-- 2. Backfill: alle ikke-AI/ikke-bank/ikke-frosne hold får en renown-neutral kontrakt.
--    guaranteed_base = division-base (= dagens sponsor for et renown-1.0-hold) → nul saldo-chok.
--    per_race_day_rate = 0 (ingen variabel del endnu). Længde 1 sæson, start = nuværende sæson.
--    Nuværende sæson = den eneste seasons-række med status='active' (number-kolonnen).
--    Fallback til 1 hvis ingen aktiv sæson findes (frisk DB / mellem sæsoner).
INSERT INTO sponsor_contracts
  (team_id, sponsor_name, guaranteed_base, per_race_day_rate, length_seasons,
   start_season, expires_after_season, status)
SELECT
  t.id,
  'Founding Partner',
  CASE t.division WHEN 1 THEN 600000 WHEN 2 THEN 400000 ELSE 340000 END,
  0,
  1,
  COALESCE((SELECT number FROM seasons WHERE status = 'active' ORDER BY number DESC LIMIT 1), 1),
  COALESCE((SELECT number FROM seasons WHERE status = 'active' ORDER BY number DESC LIMIT 1), 1),
  'active'
FROM teams t
WHERE t.is_ai = false AND t.is_bank = false AND t.is_frozen = false
  AND NOT EXISTS (
    SELECT 1 FROM sponsor_contracts c WHERE c.team_id = t.id AND c.status = 'active'
  );

COMMIT;
