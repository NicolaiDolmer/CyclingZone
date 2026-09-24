-- #5443 / #5435: data-only preparation. No population backfill or flag flip.
-- Auto-migrate applies database/*.sql after an owner-approved merge.
-- Apply before the next value refresh; no production apply in this task.
-- NULL means not computed. Only backend service-role writers populate the cache.
BEGIN;

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS best_role text,
  ADD COLUMN IF NOT EXISTS best_role_rating smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.riders'::regclass AND conname = 'riders_best_role_valid') THEN
    ALTER TABLE public.riders ADD CONSTRAINT riders_best_role_valid CHECK (
      (best_role IS NULL AND best_role_rating IS NULL)
      OR (best_role IS NOT NULL AND best_role_rating IS NOT NULL
        AND best_role IN ('sprinter', 'tt', 'climber', 'puncheur', 'brostensrytter', 'rouleur', 'baroudeur', 'gc')
        AND best_role_rating BETWEEN 0 AND 99)
    );
  END IF;
END $$;

GRANT SELECT (best_role, best_role_rating) ON public.riders TO authenticated;

COMMENT ON COLUMN public.riders.best_role IS
  'Best current role from displayRecipes; ties follow recipe order. Independent of natural identity. Refreshed by riderValueRefresh; not a live UI input yet.';
COMMENT ON COLUMN public.riders.best_role_rating IS
  'Maximum displayed role rating; NULL until computed. No value-model or visible-rating switch in this migration.';

-- The extraordinary value run must preserve every field its refresh can write.
ALTER TABLE public.backup_5443_value_event_20260920
  ADD COLUMN IF NOT EXISTS best_role text,
  ADD COLUMN IF NOT EXISTS best_role_rating smallint;

COMMIT;
