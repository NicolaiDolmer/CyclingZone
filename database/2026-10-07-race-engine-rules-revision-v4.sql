-- [#6156] Regel-revisionen 'orders_gc_v4' bliver en gyldig værdi i races.engine_rules_revision.
--
-- 'orders_gc_v4' = hele 'orders_gc_v3'-pakken + samlet form i løbet (#6156): rytterens form
-- plus formtoppens tillæg (eller minus dykket efter toppen) virker igen i løbsmotor v4, både
-- på ydeevnen hele etapen og på risikoen for en dårlig dag. Se
-- backend/lib/raceEngineRulesRevision.ts og docs/RACE_ENGINE_RULES.md.
--
-- Migrationen gør kun værdien LOVLIG og ændrer ingen række. CURRENT_RACE_RULES_REVISION er
-- fortsat 'orders_gc_v2': ingen løb bindes til v4, før ejeren selv flipper (ejer-only, ordret
-- go efter gate-simuleringen). Den SKAL være applied før det flip deployes; ellers fejler
-- bindingen på CHECK (højlydt, ingen tavs fallback).
--
-- Additiv og idempotent: constrainten erstattes med en bredere udgave i samme transaktion.
-- Alle eksisterende værdier (NULL, 'legacy', 'orders_gc_v1', 'orders_gc_v2', 'orders_gc_v3')
-- er fortsat gyldige.
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
  CHECK (engine_rules_revision IS NULL OR engine_rules_revision IN ('legacy', 'orders_gc_v1', 'orders_gc_v2', 'orders_gc_v3', 'orders_gc_v4'));

COMMENT ON COLUMN public.races.engine_rules_revision IS
  '#5955/#6084/#6187/#6156: taktisk regel-revision bundet ved løbets første etape-claim (legacy | orders_gc_v1 | orders_gc_v2 | orders_gc_v3 | orders_gc_v4). NULL på et startet løb = legacy. Skrives kun af backend-runneren. Kontrakt: backend/lib/raceEngineRulesRevision.ts';

COMMIT;
