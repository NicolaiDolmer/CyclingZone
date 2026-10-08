-- [#6284/#6199] Regel-revisionerne 'official_times_v1' og 'official_times_v2' bliver gyldige
-- værdier i races.engine_rules_revision.
--
-- 'official_times_v1' (#6284) = 'orders_gc_v2'-mekanikken + officielle etapetider (ukappede
-- officielle gaps) og den samlede tidsmodel. 'official_times_v2' (#6199, ejer 8/10) = hele
-- 'orders_gc_v3'-pakken + den samlede tidsmodel (officielle etapetider #6284, fysisk kontakt
-- #6327, fælles gruppeklokke #6199, kontaktsted #6329). Se backend/lib/raceEngineRulesRevision.ts
-- og docs/RACE_ENGINE_RULES.md.
--
-- Migrationen gør kun værdierne LOVLIGE og ændrer ingen række. CURRENT_RACE_RULES_REVISION er
-- uændret: ingen løb bindes til en official_times-revision, før ejeren selv flipper (ejer-only,
-- separat aktiverings-go). Den SKAL være applied før det flip deployes; ellers fejler bindingen
-- på CHECK (højlydt, ingen tavs fallback).
--
-- Additiv og idempotent: constrainten erstattes med en bredere udgave i samme transaktion.
-- Alle eksisterende værdier (NULL, 'legacy', 'orders_gc_v1', 'orders_gc_v2', 'orders_gc_v3') er
-- fortsat gyldige.
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
  CHECK (engine_rules_revision IS NULL OR engine_rules_revision IN ('legacy', 'orders_gc_v1', 'orders_gc_v2', 'orders_gc_v3', 'official_times_v1', 'official_times_v2'));

COMMENT ON COLUMN public.races.engine_rules_revision IS
  '#5955/#6084/#6187/#6284/#6199: taktisk regel-revision bundet ved løbets første etape-claim (legacy | orders_gc_v1 | orders_gc_v2 | orders_gc_v3 | official_times_v1 | official_times_v2). NULL på et startet løb = legacy. Skrives kun af backend-runneren. Kontrakt: backend/lib/raceEngineRulesRevision.ts';

COMMIT;
