-- #7382 · Blød overgang for kurve B: tændingstidspunktet gemmes.
--
-- Ejer-beslutning 30/10: evner over kurve B's bløde loft glider over 14 dage fra
-- den gamle models fart til kurve B's restfart, regnet fra tændingsdatoen. Motoren
-- (backend/lib/developmentCurveBTransition7382.ts) læser datoen fra app_config-
-- nøglen `development_curve_b_ignited_at`, så overgangen kan regnes efter.
--
-- Hvordan: en trigger på app_config stempler nøglen med transaktionens tidspunkt,
-- FØRSTE gang `development_curve_b` sættes til "on" (eller true). Et senere
-- skift (off og on igen) overskriver aldrig stemplet (ON CONFLICT DO NOTHING).
-- Skal en ny tænding starte en ny overgang, slettes nøglen bevidst først.
-- "beta" stempler ikke: kurve B læser beta som off.
--
-- Additiv + idempotent: én funktion (CREATE OR REPLACE), én trigger (DROP IF
-- EXISTS + CREATE). Ingen række oprettes nu: flaget er off i dag. Står flaget
-- allerede på "on" når migrationen køres, stemples nu (bedste skøn), så en tænding
-- før migrationen ikke mister sin overgang. Apply sker post-merge (auto-migrate.yml,
-- #2642). Ændrer intet i spillet før ejeren tænder kurve B.
--
-- Post-verify (read-only):
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_stamp_development_curve_b_ignition';
--   SELECT key, value FROM public.app_config WHERE key = 'development_curve_b_ignited_at';
--   (forventet før tænding: ingen række)

SET lock_timeout = '5s';

-- Én transaktion: funktion, rettigheder og trigger lander samlet eller slet ikke.
BEGIN;

CREATE OR REPLACE FUNCTION public.stamp_development_curve_b_ignition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.app_config (key, value, description)
  VALUES (
    'development_curve_b_ignited_at',
    to_jsonb(now()),
    '#7382: first time development_curve_b was set to on. Start of the 14-day soft transition. Written by trigger, never overwritten.'
  )
  ON CONFLICT (key) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_development_curve_b_ignition() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_development_curve_b_ignition() TO service_role;

DROP TRIGGER IF EXISTS trg_stamp_development_curve_b_ignition ON public.app_config;
CREATE TRIGGER trg_stamp_development_curve_b_ignition
  AFTER INSERT OR UPDATE OF value ON public.app_config
  FOR EACH ROW
  WHEN (NEW.key = 'development_curve_b' AND NEW.value IN ('"on"'::jsonb, 'true'::jsonb))
  EXECUTE FUNCTION public.stamp_development_curve_b_ignition();

-- Står flaget allerede på "on" (tændt før denne migration): stempl nu.
INSERT INTO public.app_config (key, value, description)
SELECT
  'development_curve_b_ignited_at',
  to_jsonb(now()),
  '#7382: first time development_curve_b was set to on. Start of the 14-day soft transition. Written by trigger, never overwritten.'
FROM public.app_config
WHERE key = 'development_curve_b' AND value IN ('"on"'::jsonb, 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
