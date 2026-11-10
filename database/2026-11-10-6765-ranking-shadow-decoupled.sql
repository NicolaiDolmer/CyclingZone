-- Separate rollout control; the existing shadow and publication flags are unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
INSERT INTO public.app_config (key, value)
VALUES ('ranking_shadow_decoupled_6765', '"off"'::jsonb)
ON CONFLICT (key) DO NOTHING;
COMMIT;
