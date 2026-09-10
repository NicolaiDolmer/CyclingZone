-- #5073 — Pensionsvarslet bliver en GEMT kendsgerning i stedet for et rul der
-- køres forfra ved hver visning.
--
-- ROD-ÅRSAG (målt read-only i prod 10/9, fuld evidens i issue #5073):
--   `GET /api/riders/:id/retirement-status` regnede varslet on-the-fly via
--   `announcedRetirementAfterSeason()` (backend/lib/riderProgression.js). Det er
--   en ren funktion af (rytter-id, fødselsdato, sæson) OG af hash-funktionen bag
--   rullet. PR #4990 (commit 742ba4d30, merged 2026-09-07 12:29 UTC) skiftede
--   `retirementDecision()` fra `seededUnit()` til `seededUnitMixed()` som del af
--   #4987's avalanche-fix. Samme rytter, samme sæson, nyt tal — og dermed nyt
--   varsel MIDT i sæson 3 for 58 af de 229 ryttere i det seedede vindue
--   (sæson-alder 36-39): 36 fik et varsel de ikke havde, 22 mistede et de havde.
--   Uden for vinduet er svaret uændret (under 36 = altid nej, 40+ = altid ja).
--
-- HVAD KOLONNERNE GØR
--   retirement_notice_season        Sæsonen varslet er AFGJORT for. Dette er
--                                   frysnings-markøren: står den på N, er
--                                   spørgsmålet "pensioneres rytteren når sæson N
--                                   slutter?" besvaret én gang for alle, og
--                                   ingen senere ændring af hash-funktionen kan
--                                   flytte svaret.
--   retirement_notice_after_season  Sæsonen rytteren går på pension EFTER.
--                                   Lig retirement_notice_season når svaret er
--                                   ja; NULL når svaret er nej. (Et "nej" for
--                                   sæson N er ikke et "nej" for evigt — rytteren
--                                   rulles igen i sæson N+1 med en højere
--                                   sandsynlighed, derfor er markøren og svaret
--                                   to felter og ikke ét.)
--   retirement_notice_given_at      Hvornår varslet blev givet. Sat KUN når et
--                                   varsel rent faktisk står (svaret er ja) —
--                                   et "nej" er ikke et varsel og får ingen dato.
--                                   Rytterkortet viser datoens sæson som
--                                   "Announced before season N".
--
-- INGEN BACKFILL HER. Bevidst: sæson 3's værdier skal skrives med det GAMLE rul
-- (seededUnit, som før #4990) for netop de ryttere spillerne allerede har
-- planlagt efter, og det er en ejer-gated ops-kørsel med dry-run-tal først, ikke
-- noget en migration må gøre stiltiende. Scriptet er
-- `scripts/ops/retirement-notice-freeze-5073.mjs` (skriver kun med både
-- `--execute` og `OWNER_GO=1`). Indtil da fryser koden selv lazily ved første
-- visning med den GÆLDENDE regel.
--
-- KOLONNE-GRANTS (#2238/#2241): `public.riders` bruger IKKE table-level SELECT —
-- #1162 revoke'ede den og re-grantede kolonne for kolonne. En ny kolonne arver
-- INTET og er usynlig for klienten uden sin egen grant. Varslet er offentligt
-- (banneret er synligt for ALLE viewere, ikke kun ejeren — hele pointen i #2748
-- er at en køber kan se det før et bud), så alle tre kolonner grantes.
--
-- ROLLBACK:
--   ALTER TABLE public.riders DROP COLUMN IF EXISTS retirement_notice_season;
--   ALTER TABLE public.riders DROP COLUMN IF EXISTS retirement_notice_after_season;
--   ALTER TABLE public.riders DROP COLUMN IF EXISTS retirement_notice_given_at;
--   (og gen-apply 2026-07-20-rider-development-atomic-rpc.sql for RPC'en nedenfor)
--
-- Refs #5073 #4990 #2748 #2700.

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS retirement_notice_season integer,
  ADD COLUMN IF NOT EXISTS retirement_notice_after_season integer,
  ADD COLUMN IF NOT EXISTS retirement_notice_given_at timestamptz;

GRANT SELECT (retirement_notice_season, retirement_notice_after_season, retirement_notice_given_at)
  ON public.riders TO anon, authenticated;

COMMENT ON COLUMN public.riders.retirement_notice_season IS
  '#5073: sæsonen pensionsvarslet er afgjort for (frysnings-markør). NULL = endnu ikke afgjort.';
COMMENT ON COLUMN public.riders.retirement_notice_after_season IS
  '#5073: rytteren går på pension EFTER denne sæson. NULL = intet varsel for retirement_notice_season.';
COMMENT ON COLUMN public.riders.retirement_notice_given_at IS
  '#5073: hvornår varslet blev givet. Kun sat når et varsel står; et nej får ingen dato.';

-- Rytterkortet slår kun op pr. rytter (primærnøgle), men ops-scriptet og en
-- fremtidig sæsonstart-sweep skal kunne finde "hvem mangler frysning for sæson
-- N" uden en fuld scan.
CREATE INDEX IF NOT EXISTS idx_riders_retirement_notice_season
  ON public.riders (retirement_notice_season)
  WHERE retirement_notice_season IS NOT NULL;

-- =============================================================================
-- apply_rider_development: skriv også frysningen ved cutover
-- =============================================================================
-- RPC'en fra #2361 har en EKSPLICIT kolonneliste — en ny nøgle i p_rider_patch
-- ville ellers blive stiltiende ignoreret, og cutover-stien ville aldrig få
-- skrevet det svar den rent faktisk brugte. Uændret i øvrigt (samme signatur,
-- samme service_role-gate, samme idempotens-guard).
--
-- Hvorfor CASE og ikke COALESCE på de to sidste felter: et "nej" SKAL kunne
-- skrive NULL i retirement_notice_after_season/-given_at oven på en ældre
-- sæsons "ja". COALESCE ville bevare den gamle værdi og efterlade en række hvor
-- markøren siger sæson N mens svaret peger på N-1. Nøglens TILSTEDEVÆRELSE
-- (`p_rider_patch ? 'retirement_notice_season'`) styrer derfor om de to felter
-- overskrives, så patches uden frysning er fuldstændig uberørte som før.

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
    -- Allerede udviklet (race mod en anden samtidig kørsel) — INGEN mutation.
    RETURN false;
  END IF;

  -- ── 2) Evner (kun de nøgler der er sendt; COALESCE bevarer resten uændret) ─────
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

  -- ── 3) Rytter-felter (aldring, værdi-reconcile, pensionering, #5073-frysning) ──
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
  'Atomisk pr.-rytter season-progression (#2361): dev-log-insert (idempotens-guard) + ability-update + rider-update i én transaktion. #5073: skriver også pensionsvarslets frysning når p_rider_patch bærer retirement_notice_season. Kaldes af backend/lib/riderProgressionEngine.js. Returnerer false uden mutation hvis rytteren allerede var udviklet for sæsonen.';

REVOKE ALL ON FUNCTION public.apply_rider_development(uuid, uuid, integer, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_rider_development(uuid, uuid, integer, jsonb, jsonb, jsonb) TO service_role;

-- PostgREST schema-cache reload så de nye kolonner er læsbare umiddelbart efter migrate.
NOTIFY pgrst, 'reload schema';
