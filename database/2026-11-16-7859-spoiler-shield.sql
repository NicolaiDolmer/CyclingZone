-- #7859 · Spoiler-skjoldet: skjul vinderen, til spilleren selv åbner etapen.
--
-- Ejer 16/11: billede 1-4 (løbssiden), 6 (indbakken neutral) og 7 (indstillingen,
-- fra som standard) bygges bag en SLUKKET kontakt. Slukket = alt som i dag.
--
-- Tre ting:
--   1. Kontakten spoiler_shield_7859 i app_config, startstadie "off".
--   2. public.user_spoiler_shield_7859: spillerens valg (én række pr. bruger):
--      skjoldet for alle løb (fra som standard) og hvor en færdig etape åbner
--      (Results eller Story).
--   3. public.user_spoiler_races_7859: pr. bruger og løb: kontakten i løbets hoved
--      (NULL = følg valget for alle løb) og de etaper spilleren har åbnet. "Åbnet"
--      gemmes på brugeren, ikke på enheden, så ét tryk på telefonen også åbner
--      etapen på computeren.
--
-- Kun backenden læser og skriver (/api/me/spoiler-shield, backend/lib/spoilerShield7859.ts),
-- altid med den indloggede brugers id. Klienten rører aldrig tabellerne.
--
-- ADDITIV OG IDEMPOTENT. Applies post-merge af auto-migrate.yml (#2642).
-- DEPLOY-RAEKKEFOELGE: backend kan naa prod foer migrationen; ruterne svarer da
-- { available: false } / 503, og notifikationerne skrives som i dag
-- (42P01/42883/PGRST205/PGRST202 haandteres).
--
-- RLS: enabled paa begge tabeller, INGEN policy, kun service_role (samme moenster
-- som public.user_ui_prefs, #7778). Hver bruger kan kun naa sine egne raekker,
-- fordi backenden altid skriver og laeser med req.user.id. Funktionen er
-- SECURITY INVOKER og kun kaldbar af service_role.
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT value FROM public.app_config WHERE key = 'spoiler_shield_7859';  -- "off"
--   2. SELECT relname, relrowsecurity FROM pg_class
--       WHERE oid IN ('public.user_spoiler_shield_7859'::regclass, 'public.user_spoiler_races_7859'::regclass);  -- true, true
--   3. SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--       WHERE table_schema = 'public' AND table_name IN ('user_spoiler_shield_7859', 'user_spoiler_races_7859');  -- kun service_role (+ postgres)
--   4. SELECT r, has_function_privilege(r, 'public.spoiler_open_stage_7859(uuid,uuid,integer)', 'EXECUTE')
--       FROM unnest(ARRAY['anon','authenticated','service_role']) r;  -- false, false, true
--
-- Rollback: DROP FUNCTION IF EXISTS public.spoiler_open_stage_7859(uuid, uuid, integer);
--           DROP TABLE IF EXISTS public.user_spoiler_races_7859;
--           DROP TABLE IF EXISTS public.user_spoiler_shield_7859;
--           DELETE FROM public.app_config WHERE key = 'spoiler_shield_7859';
--
-- Refs #7859
-- data-api-access: {"table":"public.user_spoiler_shield_7859","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Per-user spoiler shield choices; only the backend /api/me/spoiler-shield routes and the stage-result notifications read and write them"}
-- data-api-access: {"table":"public.user_spoiler_races_7859","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Per-user, per-race shield switch and opened stages; only the backend /api/me/spoiler-shield routes and the stage-result notifications read and write them"}

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO public.app_config (key, value, description)
VALUES (
  'spoiler_shield_7859',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for the spoiler shield (#7859): race page hides the result until the player opens the stage, and stage/race result notifications stay neutral for players with the shield on. Display only; the engine never reads it.'
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_spoiler_shield_7859 (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  shield_all boolean NOT NULL DEFAULT false,
  open_finished_in text NOT NULL DEFAULT 'results',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_spoiler_shield_7859_open_in CHECK (open_finished_in IN ('results', 'story'))
);

CREATE TABLE IF NOT EXISTS public.user_spoiler_races_7859 (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  race_id uuid NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  shield boolean,
  opened_stages integer[] NOT NULL DEFAULT '{}'::integer[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, race_id),
  CONSTRAINT user_spoiler_races_7859_stages_small CHECK (cardinality(opened_stages) <= 64)
);

-- Notifikationerne slaar alle modtagere af ét løb op paa én gang.
CREATE INDEX IF NOT EXISTS user_spoiler_races_7859_race_idx ON public.user_spoiler_races_7859 (race_id);

ALTER TABLE public.user_spoiler_shield_7859 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_spoiler_races_7859 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_spoiler_shield_7859 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_spoiler_shield_7859 TO service_role;
REVOKE ALL ON TABLE public.user_spoiler_races_7859 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_spoiler_races_7859 TO service_role;

COMMENT ON TABLE public.user_spoiler_shield_7859 IS
  '#7859: per-user spoiler shield choices (shield for all races, where a finished stage opens). service_role only.';
COMMENT ON TABLE public.user_spoiler_races_7859 IS
  '#7859: per-user, per-race shield switch (NULL = follow shield_all) and the stages the user has opened. service_role only.';

-- "Åbn etapen" atomisk: én INSERT ... ON CONFLICT DO UPDATE, saa to enheder der
-- aabner hver sin etape samtidig begge bevares (ingen laes-flet-skriv i Node).
-- En etape kan kun tilfoejes, aldrig fjernes. Returnerer de aabnede etaper.
CREATE OR REPLACE FUNCTION public.spoiler_open_stage_7859(p_user_id uuid, p_race_id uuid, p_stage integer)
RETURNS integer[]
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_stages integer[];
BEGIN
  IF p_stage IS NULL OR p_stage < 1 OR p_stage > 64 THEN
    RAISE EXCEPTION 'p_stage must be between 1 and 64' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_spoiler_races_7859 AS cur (user_id, race_id, opened_stages)
  VALUES (p_user_id, p_race_id, ARRAY[p_stage])
  ON CONFLICT (user_id, race_id) DO UPDATE
    SET opened_stages = ARRAY(SELECT DISTINCT s FROM unnest(cur.opened_stages || p_stage) AS s ORDER BY s),
        updated_at = now()
    WHERE NOT (p_stage = ANY (cur.opened_stages))
  RETURNING cur.opened_stages INTO v_stages;

  IF v_stages IS NULL THEN
    -- Etapen var allerede aabnet: laes den gemte tilstand.
    SELECT cur.opened_stages INTO v_stages FROM public.user_spoiler_races_7859 AS cur
      WHERE cur.user_id = p_user_id AND cur.race_id = p_race_id;
  END IF;
  RETURN COALESCE(v_stages, '{}'::integer[]);
END;
$$;

REVOKE ALL ON FUNCTION public.spoiler_open_stage_7859(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spoiler_open_stage_7859(uuid, uuid, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
