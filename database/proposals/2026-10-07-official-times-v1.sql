-- PROPOSAL ONLY: not applied, not an activation. Refs #6284.
-- Owner approval and the merge-before-apply protocol are required before
-- promoting this proposal to a migration. Verify the CHECK read-only after
-- apply, then obtain separate activation approval before changing the default.
-- No existing race revision or result row is updated.
BEGIN;
ALTER TABLE public.races
  DROP CONSTRAINT IF EXISTS races_engine_rules_revision_check;
ALTER TABLE public.races
  ADD CONSTRAINT races_engine_rules_revision_check
  CHECK (engine_rules_revision IS NULL OR engine_rules_revision IN
    ('legacy', 'orders_gc_v1', 'orders_gc_v2', 'orders_gc_v3', 'official_times_v1', 'official_times_v2'));
COMMIT;

-- Read-only post-verify:
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conname = 'races_engine_rules_revision_check'
--   AND conrelid = 'public.races'::regclass;
