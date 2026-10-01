-- #4847 "Train now" without bonus: one lock row per rider + date.
-- Idempotent (safe to run twice). Build only: applied post-merge per #2642.
--
-- A row means: the team pressed "Train now" for this date. The date's race
-- entries are locked for the team, and the rider cannot be entered into a race
-- on this date afterwards. The PRIMARY KEY is the idempotency key (I2): a
-- repeated press keeps the first row.
CREATE TABLE IF NOT EXISTS public.training_train_now_locks (
  rider_id uuid NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  tick_date date NOT NULL,
  season_id uuid NOT NULL,
  team_id uuid NOT NULL,
  pressed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rider_id, tick_date)
);
CREATE INDEX IF NOT EXISTS training_train_now_locks_team_date
  ON public.training_train_now_locks(team_id, tick_date);

ALTER TABLE public.training_train_now_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.training_train_now_locks FROM anon, authenticated;
GRANT SELECT, INSERT ON public.training_train_now_locks TO service_role;

-- Stage flag, seeded in beta (owner call 2026-10-01: all three training flags beta first). Flip to on is owner-only (off | beta | on).
INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_train_now',
  '"beta"'::jsonb,
  'Stage flag (off|beta|on) for "Train now" without bonus (#4847, design 2026-09-29): settles the date''s training race days now from the start-of-date condition and locks the date''s entries. Requires training_condition_per_date.'
)
ON CONFLICT (key) DO NOTHING;
