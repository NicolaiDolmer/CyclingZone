-- [#6084] Regel-revisionen 'orders_gc_v2' bliver en gyldig værdi i races.engine_rules_revision.
--
-- 'orders_gc_v2' = hele 'orders_gc_v1'-pakken + bjergselektionen fra #6084 (feltet holder
-- samlet til finalestigningen, udbruddet hentes dér). Se backend/lib/raceEngineRulesRevision.ts
-- og docs/RACE_ENGINE_RULES.md "Regel-revision pr. løb".
--
-- Migrationen gør kun værdien LOVLIG. Ingen række får den: nye løb bindes stadig til
-- CURRENT_RACE_RULES_REVISION i koden ('orders_gc_v1'), og skiftet til 'orders_gc_v2' er et
-- særskilt ejer-go. Uden migrationen ville en binding til 'orders_gc_v2' fejle på CHECK.
--
-- Additiv og idempotent: constrainten erstattes med en bredere udgave i samme transaktion.
-- Alle eksisterende værdier (NULL, 'legacy', 'orders_gc_v1') er fortsat gyldige.
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
  CHECK (engine_rules_revision IS NULL OR engine_rules_revision IN ('legacy', 'orders_gc_v1', 'orders_gc_v2'));

COMMENT ON COLUMN public.races.engine_rules_revision IS
  '#5955/#6084: taktisk regel-revision bundet ved løbets første etape-claim (legacy | orders_gc_v1 | orders_gc_v2). NULL på et startet løb = legacy. Skrives kun af backend-runneren. Kontrakt: backend/lib/raceEngineRulesRevision.ts';

COMMIT;
