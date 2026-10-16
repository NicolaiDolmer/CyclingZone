-- [#6369] Regel-revisionen 's5_profiles_v1' bliver en gyldig værdi i races.engine_rules_revision.
--
-- 's5_profiles_v1' = hele 'official_times_v4'-pakken + S5-motoren (nye finaler, mellembjerg-terræn,
-- udbrud som adfærd, enkeltstartens evne, målgab af løbet, farlige klassementsryttere, GT-træthed).
-- Se backend/lib/raceEngineRulesRevision.ts og docs/RACE_ENGINE_RULES.md.
--
-- Migrationen gør kun værdien LOVLIG og ændrer ingen række. Den hører til tænd-PR'en (#6369), hvor
-- CURRENT_RACE_RULES_REVISION samtidig skifter til 's5_profiles_v1'; den SKAL være applied før
-- første etape-claim efter deployet, ellers fejler bindingen på CHECK (højlydt, ingen tavs fallback).
-- Løb der allerede er bundet til en revision (fx official_times_v4), beholder den; kun løb med NULL
-- binder til s5_profiles_v1. Rollback = revert af konstanten; migrationen kan blive stående.
--
-- Additiv og idempotent: constrainten erstattes med en bredere udgave i samme transaktion.
-- Alle eksisterende værdier (NULL, 'legacy', 'orders_gc_v1', 'orders_gc_v2', 'orders_gc_v3',
-- 'official_times_v1', 'official_times_v2', 'official_times_v3', 'official_times_v4') er fortsat gyldige.
--
-- Post-verify (read-only):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'races_engine_rules_revision_check' AND conrelid = 'public.races'::regclass;
--   SELECT engine_rules_revision, count(*) FROM public.races GROUP BY 1;

-- Lock-timeout: races er en varm tabel, og ADD CONSTRAINT ... CHECK kraever et
-- kort ACCESS EXCLUSIVE-lock mens eksisterende raekker valideres. SET LOCAL
-- lock_timeout faar migrationen til at fejle hurtigt (og kan koeres igen) i
-- stedet for at staa i koe bag en lang transaktion og blokere races imens.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.races
  DROP CONSTRAINT IF EXISTS races_engine_rules_revision_check;

ALTER TABLE public.races
  ADD CONSTRAINT races_engine_rules_revision_check
  CHECK (engine_rules_revision IS NULL OR engine_rules_revision IN ('legacy', 'orders_gc_v1', 'orders_gc_v2', 'orders_gc_v3', 'official_times_v1', 'official_times_v2', 'official_times_v3', 'official_times_v4', 's5_profiles_v1'));

COMMENT ON COLUMN public.races.engine_rules_revision IS
  '#5955/#6084/#6187/#6284/#6199/#6452/#6464/#6369: taktisk regel-revision bundet ved løbets første etape-claim (legacy | orders_gc_v1 | orders_gc_v2 | orders_gc_v3 | official_times_v1 | official_times_v2 | official_times_v3 | official_times_v4 | s5_profiles_v1). NULL på et startet løb = legacy. Skrives kun af backend-runneren. Kontrakt: backend/lib/raceEngineRulesRevision.ts';

-- Verify i samme transaktion: constrainten kender alle revisioner, ellers rulles alt tilbage.
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conname = 'races_engine_rules_revision_check'
     AND conrelid = 'public.races'::regclass;
  IF def IS NULL OR position('s5_profiles_v1' IN def) = 0 OR position('official_times_v4' IN def) = 0 THEN
    RAISE EXCEPTION '#6369 verify: races_engine_rules_revision_check mangler official_times_v4/s5_profiles_v1 (%).', def;
  END IF;
END $$;

COMMIT;
