-- ============================================================
-- Forever-relaunch FORM-FREEZE (#1608): 4-tier / 15-pulje liga-pyramide
-- ============================================================
--
-- Den PERMANENTE skema-form for liga-strukturen (frosset for evigt i forever-
-- relaunch-vinduet). Path (A): kun FORM-minimummet er granit — de dyre mekanik-
-- dele (parallelle løb-instanser, AI-fyld-generator, 4-tier op/nedrykning) bygges
-- additivt EFTER forever uden et nyt reset.
--
-- DESIGN-INVARIANTER (afvig ikke):
--   * league_divisions ER puljerne: én række = én pulje inden for en tier.
--     Navnet undgår kollision med eksisterende race-`pool`.
--   * teams.division FORBLIVER = tier-tallet (1-4). Al tier-keyet økonomi-kode
--     (*_BY_DIVISION[tier]) er urørt. league_division_id = pulje, bruges KUN til
--     race/standings-gruppering.
--   * Økonomi er TIER-keyet, IKKE pulje-keyet (tier-4-konstanterne er Task 4,
--     gated separat — IKKE rørt her).
--
-- 15 puljer: tier1×1, tier2×2, tier3×4, tier4×8.
--
-- Idempotent (IF NOT EXISTS / ON CONFLICT / DROP ... IF EXISTS) — kan køres flere
-- gange uden fejl. Anvendes automatisk ved deploy (Supabase auto-migrate af
-- database/*.sql). EJEREN MERGER (migration auto-applies i prod).
--
-- KOLONNE-PRIVILEGIER (#1162/#1309): ADD COLUMN giver IKKE klient-læseadgang.
-- league_division_id er player-facing (standings/liga-visning), så hver ny kolonne
-- får et eksplicit GRANT SELECT (col) TO anon, authenticated i SAMME migration —
-- ellers får frontend "permission denied".

-- ─── league_divisions: puljerne (tier + pulje-indeks) ───────────────────────────
CREATE TABLE IF NOT EXISTS league_divisions (
  id SERIAL PRIMARY KEY,
  tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3, 4)),
  pool_index INTEGER NOT NULL,            -- 0-baseret indeks inden for tier
  label TEXT NOT NULL,
  UNIQUE (tier, pool_index)
);

-- Seed 15 puljer: tier1×1, tier2×2, tier3×4, tier4×8.
INSERT INTO league_divisions (tier, pool_index, label) VALUES
  (1, 0, 'Division 1'),
  (2, 0, 'Division 2 — A'), (2, 1, 'Division 2 — B'),
  (3, 0, 'Division 3 — A'), (3, 1, 'Division 3 — B'), (3, 2, 'Division 3 — C'), (3, 3, 'Division 3 — D'),
  (4, 0, 'Division 4 — A'), (4, 1, 'Division 4 — B'), (4, 2, 'Division 4 — C'), (4, 3, 'Division 4 — D'),
  (4, 4, 'Division 4 — E'), (4, 5, 'Division 4 — F'), (4, 6, 'Division 4 — G'), (4, 7, 'Division 4 — H')
ON CONFLICT (tier, pool_index) DO NOTHING;

ALTER TABLE league_divisions ENABLE ROW LEVEL SECURITY;
-- Læs-adgang for klienten (standings/league-visning). Hele tabellen er offentlig
-- reference-data (ingen følsomme felter), så en simpel SELECT-policy er nok.
DROP POLICY IF EXISTS "league_divisions_read" ON league_divisions;
CREATE POLICY "league_divisions_read" ON league_divisions
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON league_divisions TO anon, authenticated;

-- ─── teams: udvid tier-domæne + pulje-FK + backfill ─────────────────────────────
-- Udvid tier-domænet (teams.division ER nu tier-tallet 1-4; var 1-3).
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_division_check;
ALTER TABLE teams ADD CONSTRAINT teams_division_check CHECK (division IN (1, 2, 3, 4));

-- Pulje-reference (race/standings-gruppe). NULL tilladt indtil allokering.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS league_division_id INTEGER REFERENCES league_divisions(id);
GRANT SELECT (league_division_id) ON teams TO anon, authenticated; -- #1162 kolonne-privilege-mønster

-- Backfill: map eksisterende heltals-division til tier-puljens pulje 0.
UPDATE teams t SET league_division_id = ld.id
  FROM league_divisions ld
  WHERE ld.tier = t.division AND ld.pool_index = 0 AND t.league_division_id IS NULL;

-- ─── season_standings: pulje-akse + index ───────────────────────────────────────
ALTER TABLE season_standings ADD COLUMN IF NOT EXISTS league_division_id INTEGER REFERENCES league_divisions(id);
GRANT SELECT (league_division_id) ON season_standings TO anon, authenticated; -- #1162 kolonne-privilege-mønster
CREATE INDEX IF NOT EXISTS idx_standings_pool ON season_standings(season_id, league_division_id);

-- pgrst_ddl_watch reloader normalt ved DDL/GRANT; eksplicit NOTIFY koster intet (#1162).
NOTIFY pgrst, 'reload schema';
