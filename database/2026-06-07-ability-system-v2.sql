-- Evne-system v2 (#1122 / #1101-kæden) — udvid rider_derived_abilities til de nye
-- evner og omdøb cobble_classics → cobblestone (brosten ≠ klassiker, design §2 i
-- docs/decisions/rider-ability-system-v2.md). Abilities afledes nu direkte af PCM-
-- stats (50-85 → 1-99) i backend/lib/abilityDerivation.js (FORMULA_VERSION=2).
--
-- 16 synlige evner: climbing, time_trial, prolog*, flat*, tempo*, sprint,
-- acceleration, punch, endurance, recovery, durability*, descending*, cobblestone
-- (omdøbt), positioning, aggression*, tactics. + skjult hidden_potential*. (* = ny)
--
-- Idempotent: rename kun hvis den gamle kolonne findes; ADD COLUMN IF NOT EXISTS.
-- Nye kolonner er NULLABLE — de fyldes af previewDerivedAbilities.js --apply
-- (re-deriv hele pool) umiddelbart efter migration; indtil da viser UI "-" (ikke 0).
-- schema_migrations-insert håndteres af .github/workflows/auto-migrate.yml.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'rider_derived_abilities'
               AND column_name = 'cobble_classics') THEN
    ALTER TABLE public.rider_derived_abilities RENAME COLUMN cobble_classics TO cobblestone;
  END IF;
END $$;

ALTER TABLE public.rider_derived_abilities
  ADD COLUMN IF NOT EXISTS prolog           SMALLINT CHECK (prolog           BETWEEN 0 AND 99),
  ADD COLUMN IF NOT EXISTS flat             SMALLINT CHECK (flat             BETWEEN 0 AND 99),
  ADD COLUMN IF NOT EXISTS tempo            SMALLINT CHECK (tempo            BETWEEN 0 AND 99),
  ADD COLUMN IF NOT EXISTS durability       SMALLINT CHECK (durability       BETWEEN 0 AND 99),
  ADD COLUMN IF NOT EXISTS descending       SMALLINT CHECK (descending       BETWEEN 0 AND 99),
  ADD COLUMN IF NOT EXISTS aggression       SMALLINT CHECK (aggression       BETWEEN 0 AND 99),
  ADD COLUMN IF NOT EXISTS hidden_potential SMALLINT CHECK (hidden_potential BETWEEN 0 AND 99);

COMMENT ON TABLE public.rider_derived_abilities IS
  'Evne-system v2 (#1122): 16 synlige + 1 skjult (hidden_potential) game-abilities afledt af PCM-stats (50-85 → 1-99) via abilityDerivation.js (formula_version=2). Reproducérbar — ikke source of truth.';
