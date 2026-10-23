-- [#6804] Regel-revisionen 's5_profiles_v3' bliver en gyldig værdi i races.engine_rules_revision.
--
-- 's5_profiles_v3' = hele 's5_profiles_v2'-pakken + udbrudspakken pr. løbsgruppe (#6804, design
-- docs/superpowers/specs/2026-10-21-6804-udbrud-pr-loebsgruppe-design.md). Se
-- backend/lib/raceEngineRulesRevision.ts og docs/RACE_ENGINE_RULES.md.
--
-- RÆKKEFØLGE: denne migration lander i sin EGEN PR før en tænd-PR for v3. Den gør kun værdien
-- LOVLIG og ændrer ingen række og ingen adfærd: CURRENT_RACE_RULES_REVISION peger ikke på
-- 's5_profiles_v3', så intet løb binder til den før tændingen (ejer-only, efter testporten
-- G1'-G14). Den SKAL være applied (auto-migrate.yml, #2642) og post-verificeret, før en tænd-PR
-- merges; ellers fejler første etape-claim efter deployet på CHECK (højlydt, ingen tavs fallback).
--
-- Additiv: alle eksisterende værdier (NULL, 'legacy', 'orders_gc_v1', 'orders_gc_v2', 'orders_gc_v3',
-- 'official_times_v1', 'official_times_v2', 'official_times_v3', 'official_times_v4', 's5_profiles_v1',
-- 'official_times_v5', 's5_profiles_v2') er fortsat gyldige (prod-constrainten læst 23/10 = filen
-- 2026-10-17-6818-*.sql) + 's5_profiles_v3'.
--
-- LÅSE (samme mønster som #6818/#6462): races er en varm tabel. Constrainten erstattes NOT VALID i
-- én kort transaktion, og VALIDATE kører som sit eget statement under en svagere lås. lock_timeout
-- får begge skridt til at fejle hurtigt (og kunne køres igen).
--
-- IDEMPOTENT: erstatningen er guardet mod pg_constraint (kun hvis constrainten ikke allerede kender
-- 's5_profiles_v3'), og VALIDATE på en allerede valideret constraint er en no-op.
--
-- Post-verify (read-only):
--   SELECT pg_get_constraintdef(oid), convalidated FROM pg_constraint
--    WHERE conname = 'races_engine_rules_revision_check' AND conrelid = 'public.races'::regclass;
--   SELECT engine_rules_revision, count(*) FROM public.races GROUP BY 1;

SET lock_timeout = '3s';

-- 1) Erstat constrainten (NOT VALID) i én transaktion: der findes intet øjeblik uden constraint.
BEGIN;

DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conname = 'races_engine_rules_revision_check'
     AND conrelid = 'public.races'::regclass;
  IF def IS NULL OR position('s5_profiles_v3' IN def) = 0 THEN
    ALTER TABLE public.races
      DROP CONSTRAINT IF EXISTS races_engine_rules_revision_check;
    ALTER TABLE public.races
      ADD CONSTRAINT races_engine_rules_revision_check
      CHECK (engine_rules_revision IS NULL OR engine_rules_revision IN ('legacy', 'orders_gc_v1', 'orders_gc_v2', 'orders_gc_v3', 'official_times_v1', 'official_times_v2', 'official_times_v3', 'official_times_v4', 's5_profiles_v1', 'official_times_v5', 's5_profiles_v2', 's5_profiles_v3')) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.races.engine_rules_revision IS
  '#5955/#6084/#6187/#6284/#6199/#6452/#6464/#6369/#6462/#6818/#6804: taktisk regel-revision bundet ved løbets første etape-claim (legacy | orders_gc_v1 | orders_gc_v2 | orders_gc_v3 | official_times_v1 | official_times_v2 | official_times_v3 | official_times_v4 | s5_profiles_v1 | official_times_v5 | s5_profiles_v2 | s5_profiles_v3). NULL på et startet løb = legacy. Skrives kun af backend-runneren. Kontrakt: backend/lib/raceEngineRulesRevision.ts';

COMMIT;

-- 2) Valider de eksisterende rækker i sit eget skridt (svagere lås, ingen blokering af races).
ALTER TABLE public.races
  VALIDATE CONSTRAINT races_engine_rules_revision_check;

-- 3) Verify: constrainten kender alle revisioner og er valideret.
DO $$
DECLARE
  def text;
  validated boolean;
BEGIN
  SELECT pg_get_constraintdef(oid), convalidated INTO def, validated
    FROM pg_constraint
   WHERE conname = 'races_engine_rules_revision_check'
     AND conrelid = 'public.races'::regclass;
  IF def IS NULL OR position('s5_profiles_v3' IN def) = 0 OR position('s5_profiles_v2' IN def) = 0 OR position('official_times_v5' IN def) = 0 OR position('s5_profiles_v1' IN def) = 0 OR position('official_times_v4' IN def) = 0 THEN
    RAISE EXCEPTION '#6804 verify: races_engine_rules_revision_check mangler official_times_v4/s5_profiles_v1/official_times_v5/s5_profiles_v2/s5_profiles_v3 (%).', def;
  END IF;
  IF NOT validated THEN
    RAISE EXCEPTION '#6804 verify: races_engine_rules_revision_check er ikke valideret.';
  END IF;
END $$;

RESET lock_timeout;
