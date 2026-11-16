-- #6490 B + #8143 H: two switches, both seeded "off". Nothing changes until the owner turns one on.
--
--   training_sweep_memory_6490  the evening training run settles a team's five race days with the
--                               train-now press memory (read once, count, save as before). Same
--                               result; fewer database calls. Read fresh once per sweep.
--   config_cache_8143           flag reads (featureStage.readFlagStage) share one 60 s memory across
--                               all server clients instead of one per client. Engine switches stay
--                               fresh; an admin flag change forgets the key at once.
--
-- Additive and idempotent (ON CONFLICT DO NOTHING). Applied post-merge by auto-migrate (#2642).
--
-- Rollback (switches only, no data):
--   DELETE FROM public.app_config WHERE key IN ('training_sweep_memory_6490','config_cache_8143');
--
-- POST-VERIFY (read-only):
--   SELECT key, value FROM public.app_config WHERE key IN ('training_sweep_memory_6490','config_cache_8143');  -- both "off"
--
-- Refs #6490 #8143

-- #6342: fail fast instead of queueing behind live traffic. Safe to re-trigger.
SET lock_timeout = '3s';

BEGIN;

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_sweep_memory_6490',
  '"off"'::jsonb,
  'Binary flag (off|on) for #6490 B: the evening training run reuses the train-now press memory for a team''s five race days (same receipts and saves, fewer reads). Only "on" turns it on; beta counts as off. Engine path: judge verdict before turning on, owner go.'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_config (key, value, description)
VALUES (
  'config_cache_8143',
  '"off"'::jsonb,
  'Binary flag (off|on) for #8143 H: flag reads share one 60 s server memory across all clients. Engine switches are always read fresh; an admin flag change forgets the key at once. Only "on" turns it on; beta counts as off. Polled by the server every 30 s.'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
