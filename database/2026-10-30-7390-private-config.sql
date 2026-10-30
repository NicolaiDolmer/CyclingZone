-- #7390 (ejer-go 30/10): lukket tabel til private motor- og træningsindstillinger.
--
-- app_config kan læses af ALLE indloggede (policy app_config_select_authenticated),
-- så private balancetal (fx kurve B's params) kan ikke ligge dér. De har hidtil
-- ligget som Railway-variabler. private_config er én række pr. nøgle med en
-- JSON-værdi, og private_config_history logger hver ændring (gammel og ny
-- værdi, hvornår og af hvem) via en trigger.
--
-- Privat: RLS slået til UDEN policies, og kun service_role har grants. Ingen
-- klient (anon/authenticated) kan læse eller skrive. Historikken er append-only
-- for service_role (SELECT, INSERT; ingen UPDATE/DELETE).
--
-- Validering: SQL'en tjekker formen (nøgleformat, værdien er et JSON-objekt
-- eller -array). Skemaet pr. nøgle bor ét sted, i backendens register
-- (backend/lib/privateConfig.ts), og håndhæves ved skrivning af ops-scriptet
-- (backend/scripts/ops/setPrivateConfig.mjs) og ved hver læsning.
--
-- ADDITIV + IDEMPOTENT: to nye tabeller, to triggerfunktioner, intet andet
-- ændres. Ingen data indsættes (ingen balance-tal i repoet, hard rule 17).
-- Apply post-merge (#2642, auto-migrate.yml).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- data-api-access: {"table":"public.private_config","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Private engine/training settings (#7390); read by the backend and written by the ops script with the service role only, never by a client"}
CREATE TABLE IF NOT EXISTS public.private_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT 'unknown',
  CONSTRAINT private_config_key_format CHECK (key ~ '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT private_config_value_shape CHECK (jsonb_typeof(value) IN ('object', 'array'))
);

ALTER TABLE public.private_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.private_config FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.private_config TO service_role;

-- data-api-access: {"table":"public.private_config_history","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT"]},"reason":"Append-only change log for private_config (#7390), written by its trigger; service role only, never a client"}
CREATE TABLE IF NOT EXISTS public.private_config_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  old_value jsonb,
  new_value jsonb,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text NOT NULL
);

CREATE INDEX IF NOT EXISTS private_config_history_key_changed_at_idx
  ON public.private_config_history (key, changed_at DESC);

ALTER TABLE public.private_config_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.private_config_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.private_config_history TO service_role;

-- updated_at sættes altid af databasen; updated_by må aldrig være tom.
CREATE OR REPLACE FUNCTION public.private_config_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(NULLIF(btrim(NEW.updated_by), ''), 'unknown');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.private_config_touch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS private_config_touch ON public.private_config;
CREATE TRIGGER private_config_touch
  BEFORE INSERT OR UPDATE ON public.private_config
  FOR EACH ROW EXECUTE FUNCTION public.private_config_touch();

-- Hver ændring logges med gammel og ny værdi. En UPDATE der ikke ændrer
-- værdien logges ikke. Ved DELETE er aktøren databasens rolle.
CREATE OR REPLACE FUNCTION public.private_config_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.private_config_history (key, operation, old_value, new_value, changed_by)
    VALUES (NEW.key, 'INSERT', NULL, NEW.value, NEW.updated_by);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.value IS NOT DISTINCT FROM OLD.value AND NEW.key = OLD.key THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.private_config_history (key, operation, old_value, new_value, changed_by)
    VALUES (NEW.key, 'UPDATE', OLD.value, NEW.value, NEW.updated_by);
    RETURN NEW;
  ELSE
    INSERT INTO public.private_config_history (key, operation, old_value, new_value, changed_by)
    VALUES (OLD.key, 'DELETE', OLD.value, NULL, current_user::text);
    RETURN OLD;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.private_config_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS private_config_audit ON public.private_config;
CREATE TRIGGER private_config_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.private_config
  FOR EACH ROW EXECUTE FUNCTION public.private_config_audit();

COMMENT ON TABLE public.private_config IS
  '#7390: private engine/training settings (one JSON value per key). RLS on, no policies, service role only. Per-key schema lives in backend/lib/privateConfig.ts; write with backend/scripts/ops/setPrivateConfig.mjs on owner go.';
COMMENT ON TABLE public.private_config_history IS
  '#7390: append-only change log for private_config (old and new value, when, by whom), filled by the private_config_audit trigger. Service role only.';

COMMIT;
