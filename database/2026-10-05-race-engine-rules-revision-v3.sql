-- [#6187] Regel-revisionen 'orders_gc_v3' bliver en gyldig værdi i races.engine_rules_revision.
--
-- 'orders_gc_v3' = hele 'orders_gc_v2'-pakken + "eget hold jagter aldrig sine egne" (#6187):
-- et hold fører aldrig jagten på en gruppe hvor det selv har en rytter, og holdets egne
-- udbrydere sidder på hjul ved en trussel mod holdets klassementsrytter. Samlepunkt for
-- uge 41-pakken. Se backend/lib/raceEngineRulesRevision.ts og docs/RACE_ENGINE_RULES.md.
--
-- Migrationen gør kun værdien LOVLIG og ændrer ingen række. CURRENT_RACE_RULES_REVISION er
-- fortsat 'orders_gc_v2': ingen løb bindes til v3, før ejeren selv flipper (ejer-only). Den
-- SKAL være applied før det flip deployes; ellers fejler bindingen på CHECK (højlydt, ingen
-- tavs fallback).
--
-- Additiv og idempotent: constrainten erstattes med en bredere udgave i samme transaktion.
-- Alle eksisterende værdier (NULL, 'legacy', 'orders_gc_v1', 'orders_gc_v2') er fortsat gyldige.
--
-- Post-verify (read-only):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'races_engine_rules_revision_check' AND conrelid = 'public.races'::regclass;
--   SELECT engine_rules_revision, count(*) FROM public.races GROUP BY 1;

BEGIN;

ALTER TABLE public.races
  DROP CONSTRAINT IF EXISTS races_engine_rules_revision_check;

ALTER TABLE public.races
  ADD CONSTRAINT races_engine_rules_revision_check
  CHECK (engine_rules_revision IS NULL OR engine_rules_revision IN ('legacy', 'orders_gc_v1', 'orders_gc_v2', 'orders_gc_v3'));

COMMENT ON COLUMN public.races.engine_rules_revision IS
  '#5955/#6084/#6187: taktisk regel-revision bundet ved løbets første etape-claim (legacy | orders_gc_v1 | orders_gc_v2 | orders_gc_v3). NULL på et startet løb = legacy. Skrives kun af backend-runneren. Kontrakt: backend/lib/raceEngineRulesRevision.ts';

COMMIT;
