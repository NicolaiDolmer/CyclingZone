-- #6857 L1: additive, nullable race identity storage. No catalog assignments.
-- NULL preserves today's behavior. Apply post-merge; Claude verifies columns below.
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'race_pool'
--   AND column_name IN ('race_identity_type', 'signature', 'authored_route')
-- ORDER BY column_name;
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.race_pool
  ADD COLUMN IF NOT EXISTS race_identity_type text,
  ADD COLUMN IF NOT EXISTS signature jsonb,
  ADD COLUMN IF NOT EXISTS authored_route jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.race_pool'::regclass
      AND conname = 'race_pool_race_identity_type_check'
  ) THEN
    ALTER TABLE public.race_pool
      ADD CONSTRAINT race_pool_race_identity_type_check CHECK (
        race_identity_type IS NULL OR race_identity_type IN (
          'sprinters', 'climbers_gt_prelude', 'hilly', 'cobbles_benelux',
          'time_trial', 'gravel', 'mountains_first', 'allround'
        )
      );
  END IF;
END $$;

COMMIT;
NOTIFY pgrst, 'reload schema';
