-- =============================================================================
-- 2026-09-25 — #5647 (Y7 / plan S4): ungdomsstilling pr. trup og gruppe
-- =============================================================================
-- Applies af auto-migrate.yml ved merge (#2642). Claude post-verificerer
-- (kommandoer nederst). Rent additiv: ny tabel + ny RPC, ingen eksisterende
-- objekter ændres, ingen rækker skrives af selve migrationen.
--
-- ── HVORFOR EN EGEN TABEL ──────────────────────────────────────────────────
-- Plan 2026-09-23 §2.0 V1: U23-/juniorstillingen bor i sin egen tabel i stedet
-- for en `squad`-kolonne på `season_standings`. Seniorlæserne (stilling,
-- op/nedrykning, divisionsbonus, Global Rank) er dermed urørte, og nøglen
-- `(season_id, team_id)` på season_standings består.
--
-- ── MODEL (ejer 24/9, #2492) ───────────────────────────────────────────────
-- S4: ungdomsgrupper à 24 pr. trup (tier 1). Stillingen deles op pr. gruppe
-- (`league_division_id` = holdets u23_/junior_league_division_id). Ved S4-slut
-- rangeres U23-holdene på disse resultater.
--
-- ── RPC: recompute_youth_season_standings(p_season_id, p_squad) ────────────
-- Fuld, mængdebaseret genberegning af ÉN trups stilling i ÉN sæson, samme
-- tilskrivning som seniorens recompute_season_standings
-- (`coalesce(rr.team_id, rytterens hold)`), men kun løb med
-- `races.squad = p_squad` (aldrig 'senior'). Idempotent: samme input giver
-- samme rækker, og rækker for hold der ikke længere hører til (ingen gruppe og
-- ingen resultater) slettes, så en genkørsel aldrig efterlader forældede rækker.
--
-- Hvem står i stillingen:
--   * alle ikke-parkerede, ikke-pensionerede hold (ikke banken) med en
--     ungdomsgruppe for truppen (0 point til de har kørt), OG
--   * ethvert hold der har point/resultater i truppens løb i sæsonen (så et
--     resultat aldrig forsvinder, fx hvis holdet senere mister gruppen).
-- Placering (`rank_in_pool`) er inden for gruppen; tie-break på team_id, som
-- senior. Hold uden gruppe placeres i deres egen "uden gruppe"-partition.
-- Ingen penalty_points og ingen præmiepenge (ungdom v1, YOUTH_RULES §2.3).
--
-- ── RLS/GRANTS (som season_standings) ──────────────────────────────────────
-- RLS slået til med én læse-policy for alle (samme som season_standings'
-- "Public read standings"); ingen skrive-policy, så kun service_role (som
-- omgår RLS) skriver. Skrive-privilegier revokes desuden eksplicit fra
-- anon/authenticated. RPC'en er SECURITY DEFINER og kun for service_role.
--
-- ── IDEMPOTENS ─────────────────────────────────────────────────────────────
-- CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY,
-- CREATE OR REPLACE FUNCTION og REVOKE/GRANT er sikre at køre igen.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS public.recompute_youth_season_standings(uuid, text);
--   DROP TABLE IF EXISTS public.youth_season_standings;

BEGIN;

CREATE TABLE IF NOT EXISTS public.youth_season_standings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id          uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  squad              text NOT NULL CHECK (squad IN ('u23', 'junior')),
  league_division_id integer REFERENCES public.league_divisions(id) ON DELETE SET NULL,
  team_id            uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  total_points       integer NOT NULL DEFAULT 0,
  wins               integer NOT NULL DEFAULT 0,
  podiums            integer NOT NULL DEFAULT 0,
  races              integer NOT NULL DEFAULT 0,
  rank_in_pool       integer,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT youth_season_standings_season_squad_team_key UNIQUE (season_id, squad, team_id)
);

CREATE INDEX IF NOT EXISTS youth_season_standings_pool_idx
  ON public.youth_season_standings (season_id, squad, league_division_id, rank_in_pool);
CREATE INDEX IF NOT EXISTS youth_season_standings_team_idx
  ON public.youth_season_standings (team_id);
CREATE INDEX IF NOT EXISTS youth_season_standings_league_division_idx
  ON public.youth_season_standings (league_division_id);

ALTER TABLE public.youth_season_standings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read youth standings" ON public.youth_season_standings;
CREATE POLICY "Public read youth standings" ON public.youth_season_standings
  FOR SELECT USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.youth_season_standings FROM anon, authenticated;
GRANT SELECT ON public.youth_season_standings TO anon, authenticated;
GRANT ALL ON public.youth_season_standings TO service_role;

CREATE OR REPLACE FUNCTION public.recompute_youth_season_standings(p_season_id uuid, p_squad text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_squad IS NULL OR p_squad NOT IN ('u23', 'junior') THEN
    RAISE EXCEPTION 'invalid youth squad: %', p_squad USING ERRCODE = '22023';
  END IF;

  -- Ét statement med data-modificerende CTE'er: `calc` er den nye stilling,
  -- `deleted` fjerner rækker for hold der ikke længere hører til, `upserted`
  -- skriver resten. De to skrivninger rammer disjunkte hold (NOT EXISTS i calc
  -- vs. rækkerne FRA calc), så de kan ligge i samme statement.
  WITH attributed AS (
    SELECT coalesce(rr.team_id, ri.team_id) AS team_id,
           rr.race_id, rr.result_type, rr.rank, rr.points_earned
    FROM public.race_results rr
    JOIN public.races r ON r.id = rr.race_id
                       AND r.season_id = p_season_id
                       AND r.squad = p_squad            -- aldrig 'senior' (p_squad er valideret)
    LEFT JOIN public.riders ri ON ri.id = rr.rider_id
  ),
  team_pool AS (
    SELECT t.id AS team_id,
           CASE p_squad WHEN 'u23' THEN t.u23_league_division_id
                        ELSE t.junior_league_division_id END AS league_division_id,
           (t.league_division_id IS NOT NULL
            AND t.retired_at IS NULL
            AND t.is_bank IS NOT TRUE) AS active
    FROM public.teams t
  ),
  members AS (
    SELECT tp.team_id, tp.league_division_id
    FROM team_pool tp
    WHERE (tp.active AND tp.league_division_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM attributed a WHERE a.team_id = tp.team_id)
  ),
  agg AS (
    SELECT m.team_id, m.league_division_id,
           coalesce(sum(a.points_earned), 0)::int AS total_points,
           count(a.race_id) FILTER (WHERE a.result_type IN ('stage', 'gc') AND a.rank = 1)::int AS wins,
           count(a.race_id) FILTER (WHERE a.result_type IN ('stage', 'gc') AND a.rank BETWEEN 1 AND 3)::int AS podiums,
           count(DISTINCT a.race_id)::int AS races
    FROM members m
    LEFT JOIN attributed a ON a.team_id = m.team_id
    GROUP BY m.team_id, m.league_division_id
  ),
  calc AS (
    SELECT agg.team_id, agg.league_division_id, agg.total_points, agg.wins, agg.podiums, agg.races,
           row_number() OVER (
             PARTITION BY coalesce(agg.league_division_id::text, 'none')
             ORDER BY agg.total_points DESC, agg.team_id ASC
           )::int AS rank_in_pool
    FROM agg
  ),
  deleted AS (
    DELETE FROM public.youth_season_standings ys
    WHERE ys.season_id = p_season_id
      AND ys.squad = p_squad
      AND NOT EXISTS (SELECT 1 FROM calc c WHERE c.team_id = ys.team_id)
    RETURNING ys.team_id
  ),
  upserted AS (
    INSERT INTO public.youth_season_standings AS tgt
      (season_id, squad, league_division_id, team_id,
       total_points, wins, podiums, races, rank_in_pool, updated_at)
    SELECT p_season_id, p_squad, c.league_division_id, c.team_id,
           c.total_points, c.wins, c.podiums, c.races, c.rank_in_pool, now()
    FROM calc c
    ON CONFLICT (season_id, squad, team_id) DO UPDATE SET
      league_division_id = EXCLUDED.league_division_id,
      total_points       = EXCLUDED.total_points,
      wins               = EXCLUDED.wins,
      podiums            = EXCLUDED.podiums,
      races              = EXCLUDED.races,
      rank_in_pool       = EXCLUDED.rank_in_pool,
      updated_at         = EXCLUDED.updated_at
    RETURNING tgt.total_points
  )
  SELECT jsonb_build_object(
           'squad', p_squad,
           'rows_updated', (SELECT count(*) FROM upserted),
           'rows_deleted', (SELECT count(*) FROM deleted),
           'teams_with_points', (SELECT count(*) FROM upserted WHERE total_points > 0)
         )
  INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.recompute_youth_season_standings(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_youth_season_standings(uuid, text) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Post-merge verifikation (read-only, køres af Claude efter auto-migrate) ──
-- V1. Tabel + RLS + policy:
--   SELECT c.relrowsecurity, array_to_string(c.relacl, '|') AS acl,
--          (SELECT json_agg(p.polname) FROM pg_policy p WHERE p.polrelid = c.oid)
--   FROM pg_class c WHERE c.oid = 'public.youth_season_standings'::regclass;
--   Forvent relrowsecurity = true, én policy "Public read youth standings",
--   anon/authenticated kun 'r' (SELECT).
-- V2. RPC-ACL: kun postgres + service_role har EXECUTE:
--   SELECT array_to_string(p.proacl, '|') FROM pg_proc p
--   WHERE p.proname = 'recompute_youth_season_standings';
-- V3. Tør (ingen ungdomspuljer/-løb endnu): tabellen har 0 rækker.
-- V4. get_advisors(type: 'security'): ingen nye fund for tabellen/RPC'en.
