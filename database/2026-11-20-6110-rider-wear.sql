-- #6110 Udvikling 2.0, model G3a, byggetrin 3 (#8522; spec
-- docs/superpowers/specs/2026-11-20-6110-potentiale-p-og-udvikling-g3a-design.md §3, §6.3).
--
-- ADDITIV + IDEMPOTENT. Ingen eksisterende data aendres.
--
-- 1) public.rider_wear - rytterens varige SLID pr. evne: de point, kroppens aldring har
--    taget ved saesonskiftene, mens XP var taendt. XP-sporet traekker sliddet fra
--    rytterens maal, saa faldet ikke kan traenes tilbage. Sliddet saenker aldrig en
--    synlig evne; det goer kun saesonskiftet.
--    `wear` er et objekt { evne: point }, kun positive heltal (backend/lib/riderWear6110.js).
--    Tabellen er KUN for serveren: RLS uden policies og ingen privilegier til
--    anon/authenticated. Spilleren ser aldrig sliddet som tal.
--
-- 2) apply_rider_development: skriver ogsaa sliddet i SAMME transaktion som evnerne
--    (atomisk pr. rytter, #2361), naar evne-patchen baerer noeglen `ability_wear`.
--    Uden noeglen er funktionen uaendret fra 2026-09-10-5073 (samme signatur, samme
--    service_role-gate, samme idempotens-guard). Med XP slukket sender motoren aldrig
--    noeglen, saa saesonskiftet er bit-identisk med i dag.
--    Rytterens slid-raekke overskrives med det samlede slid, motoren har regnet (gammelt
--    slid + dette skiftes fald). Dobbelt-anvendelse er umulig: dev-loggens guard
--    returnerer foer noget skrives, hvis rytteren allerede er udviklet for saesonen.
--
-- INTET APPLY FOER MERGE (#2642): auto-migrate.yml koerer filen efter merge.
--
-- ROLLBACK:
--   gen-apply database/2026-09-10-5073-retirement-notice-column.sql (RPC'en uden slid)
--   DROP TABLE IF EXISTS public.rider_wear;
--
-- Refs #8522 #6110.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Sliddet pr. rytter
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rider_wear (
  rider_id   uuid        NOT NULL PRIMARY KEY REFERENCES public.riders(id) ON DELETE CASCADE,
  wear       jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(wear) = 'object'),
  -- Den saeson, hvis skifte sidst lagde slid til (revision, ikke spillogik).
  season_id  uuid        REFERENCES public.seasons(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rider_wear IS
  '#6110 G3a (#8522): permanent wear per rider per ability = points taken by aging at season transitions while XP was on. The XP target is lowered by it so aging cannot be trained back. Server-only: RLS without policies, no client privileges.';

-- data-api-access: {"table":"public.rider_wear","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Hidden per-rider aging wear (#6110 G3a); only the backend season transition writes it and the XP engine reads it"}
ALTER TABLE public.rider_wear ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rider_wear FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_wear TO service_role;

-- ---------------------------------------------------------------------------
-- 2) apply_rider_development: slid i samme transaktion som evnerne
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_rider_development(
  p_rider_id uuid,
  p_season_id uuid,
  p_season_number integer,
  p_ability_patch jsonb,
  p_rider_patch jsonb,
  p_log jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_inserted integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- ── 1) Idempotens-guard + snapshot, atomisk i samme transaktion som mutationen ──
  INSERT INTO public.rider_development_log
    (rider_id, season_id, season_number, age, abilities, base_value, retired_this_season)
  VALUES (
    p_rider_id, p_season_id, p_season_number,
    (p_log->>'age')::integer,
    p_log->'abilities',
    (p_log->>'base_value')::integer,
    COALESCE((p_log->>'retired_this_season')::boolean, false)
  )
  ON CONFLICT (rider_id, season_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    -- Allerede udviklet (race mod en anden samtidig koersel) — INGEN mutation.
    RETURN false;
  END IF;

  -- ── 2) Evner (kun de noegler der er sendt; COALESCE bevarer resten uaendret) ─────
  UPDATE public.rider_derived_abilities SET
    climbing     = COALESCE(ROUND((p_ability_patch->>'climbing')::numeric)::smallint, climbing),
    time_trial   = COALESCE(ROUND((p_ability_patch->>'time_trial')::numeric)::smallint, time_trial),
    flat         = COALESCE(ROUND((p_ability_patch->>'flat')::numeric)::smallint, flat),
    tempo        = COALESCE(ROUND((p_ability_patch->>'tempo')::numeric)::smallint, tempo),
    sprint       = COALESCE(ROUND((p_ability_patch->>'sprint')::numeric)::smallint, sprint),
    acceleration = COALESCE(ROUND((p_ability_patch->>'acceleration')::numeric)::smallint, acceleration),
    punch        = COALESCE(ROUND((p_ability_patch->>'punch')::numeric)::smallint, punch),
    endurance    = COALESCE(ROUND((p_ability_patch->>'endurance')::numeric)::smallint, endurance),
    recovery     = COALESCE(ROUND((p_ability_patch->>'recovery')::numeric)::smallint, recovery),
    durability   = COALESCE(ROUND((p_ability_patch->>'durability')::numeric)::smallint, durability),
    descending   = COALESCE(ROUND((p_ability_patch->>'descending')::numeric)::smallint, descending),
    cobblestone  = COALESCE(ROUND((p_ability_patch->>'cobblestone')::numeric)::smallint, cobblestone),
    positioning  = COALESCE(ROUND((p_ability_patch->>'positioning')::numeric)::smallint, positioning),
    aggression   = COALESCE(ROUND((p_ability_patch->>'aggression')::numeric)::smallint, aggression),
    tactics      = COALESCE(ROUND((p_ability_patch->>'tactics')::numeric)::smallint, tactics),
    ability_caps = COALESCE(p_ability_patch->'ability_caps', ability_caps)
  WHERE rider_id = p_rider_id;

  -- ── 2b) #8522: varigt slid, kun naar patchen baerer det (XP + procent-aldring) ──
  IF p_ability_patch ? 'ability_wear' THEN
    IF jsonb_typeof(p_ability_patch->'ability_wear') <> 'object' THEN
      RAISE EXCEPTION 'apply_rider_development: ability_wear must be an object' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.rider_wear (rider_id, wear, season_id, updated_at)
    VALUES (p_rider_id, p_ability_patch->'ability_wear', p_season_id, now())
    ON CONFLICT (rider_id) DO UPDATE
      SET wear = EXCLUDED.wear, season_id = EXCLUDED.season_id, updated_at = EXCLUDED.updated_at;
  END IF;

  -- ── 3) Rytter-felter (aldring, vaerdi-reconcile, pensionering, #5073-frysning) ──
  UPDATE public.riders SET
    is_u25 = COALESCE((p_rider_patch->>'is_u25')::boolean, is_u25),
    base_value = COALESCE(ROUND((p_rider_patch->>'base_value')::numeric)::integer, base_value),
    current_production_value = COALESCE(ROUND((p_rider_patch->>'current_production_value')::numeric)::integer, current_production_value),
    is_retired = COALESCE((p_rider_patch->>'is_retired')::boolean, is_retired),
    retirement_notice_season = COALESCE((p_rider_patch->>'retirement_notice_season')::integer, retirement_notice_season),
    retirement_notice_after_season = CASE
      WHEN p_rider_patch ? 'retirement_notice_season'
        THEN (p_rider_patch->>'retirement_notice_after_season')::integer
      ELSE retirement_notice_after_season END,
    retirement_notice_given_at = CASE
      WHEN p_rider_patch ? 'retirement_notice_season'
        THEN (p_rider_patch->>'retirement_notice_given_at')::timestamptz
      ELSE retirement_notice_given_at END
  WHERE id = p_rider_id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.apply_rider_development(uuid, uuid, integer, jsonb, jsonb, jsonb) IS
  'Atomisk pr.-rytter season-progression (#2361): dev-log-insert (idempotens-guard) + ability-update + rider-update i én transaktion. #5073: skriver også pensionsvarslets frysning når p_rider_patch bærer retirement_notice_season. #8522: skriver rytterens slid (rider_wear) når p_ability_patch bærer ability_wear. Kaldes af backend/lib/riderProgressionEngine.js. Returnerer false uden mutation hvis rytteren allerede var udviklet for sæsonen.';

REVOKE ALL ON FUNCTION public.apply_rider_development(uuid, uuid, integer, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_rider_development(uuid, uuid, integer, jsonb, jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Post-verify i samme transaktion: fejl hellere end at laekke.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(r, 'public.rider_wear', 'SELECT')
       OR has_table_privilege(r, 'public.rider_wear', 'INSERT')
       OR has_table_privilege(r, 'public.rider_wear', 'UPDATE')
       OR has_table_privilege(r, 'public.rider_wear', 'DELETE') THEN
      RAISE EXCEPTION '#8522: role % has privileges on rider_wear - must be server-only', r;
    END IF;
    IF has_function_privilege(r, 'public.apply_rider_development(uuid, uuid, integer, jsonb, jsonb, jsonb)', 'EXECUTE') THEN
      RAISE EXCEPTION '#8522: role % can execute apply_rider_development - must be service_role only', r;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
