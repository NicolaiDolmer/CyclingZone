\set ON_ERROR_STOP on

-- Local temporary Postgres integration test. Never point this at production.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE public.league_divisions (id bigint PRIMARY KEY, retired_at timestamptz);
CREATE TABLE public.teams (
  id uuid PRIMARY KEY, is_ai boolean NOT NULL DEFAULT false, user_id uuid,
  is_bank boolean NOT NULL DEFAULT false, is_frozen boolean NOT NULL DEFAULT false,
  is_test_account boolean NOT NULL DEFAULT false, parked_at timestamptz,
  retired_at timestamptz, pending_removal_at timestamptz, league_division_id bigint,
  u23_league_division_id bigint, junior_league_division_id bigint
);
CREATE TABLE public.riders (
  id uuid PRIMARY KEY, team_id uuid, squad text, is_academy boolean, is_retired boolean
);
CREATE TABLE public.races (id uuid PRIMARY KEY, squad text, status text);
CREATE TABLE public.race_entries (id uuid PRIMARY KEY, team_id uuid, rider_id uuid, race_id uuid);
INSERT INTO public.league_divisions(id) VALUES (10),(21),(22),(23),(33),(34),(35);

-- Existing retired ghost in A/A and one active race-bound AI in F/H.
INSERT INTO public.teams(id,is_ai,retired_at,u23_league_division_id,junior_league_division_id)
  VALUES ('00000000-0000-0000-0000-000000000001',true,'2026-09-28T08:00:00Z',21,33);
INSERT INTO public.teams(id,is_ai,league_division_id,u23_league_division_id,junior_league_division_id)
  VALUES ('00000000-0000-0000-0000-000000000002',true,10,22,34);
INSERT INTO public.teams(id,u23_league_division_id,junior_league_division_id)
  SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,21,33 FROM generate_series(1000,1022) i;
INSERT INTO public.teams(id,u23_league_division_id,junior_league_division_id)
  SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,22,34 FROM generate_series(2000,2022) i;

-- Two distinct startable AI reserves, with no youth group or future entries.
INSERT INTO public.teams(id,is_ai,league_division_id) VALUES
  ('00000000-0000-0000-0000-000000000101',true,10),
  ('00000000-0000-0000-0000-000000000102',true,10);
INSERT INTO public.riders(id,team_id,squad,is_academy,is_retired)
  SELECT ('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
    '00000000-0000-0000-0000-000000000101',CASE WHEN i<=6 THEN 'u23' ELSE 'junior' END,true,false
  FROM generate_series(1,12) i;
INSERT INTO public.riders(id,team_id,squad,is_academy,is_retired)
  SELECT ('20000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
    '00000000-0000-0000-0000-000000000102',CASE WHEN i<=6 THEN 'u23' ELSE 'junior' END,true,false
  FROM generate_series(1,12) i;

\ir ../../../database/2026-09-28-4753-youth-pool-retirement-replacement.sql

DO $$
DECLARE result jsonb;
BEGIN
  SELECT public.replace_retired_ai_youth_group('00000000-0000-0000-0000-000000000001') INTO result;
  IF result->>'replacementTeamId'<>'00000000-0000-0000-0000-000000000101' THEN
    RAISE EXCEPTION 'ghost did not get first deterministic replacement: %',result;
  END IF;
  IF (SELECT count(*) FROM public.teams WHERE u23_league_division_id=21)<>24 OR
      (SELECT count(*) FROM public.teams WHERE junior_league_division_id=33)<>24 THEN
    RAISE EXCEPTION 'Group A lost occupancy';
  END IF;
END;
$$;

-- A claimed or unfinished race blocks retirement and rolls the UPDATE back.
INSERT INTO public.races VALUES ('00000000-0000-0000-0000-000000000900','junior','scheduled');
INSERT INTO public.race_entries(id,team_id,race_id) VALUES ('00000000-0000-0000-0000-000000000901',
  '00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000900');
DO $$
BEGIN
  BEGIN
    UPDATE public.teams SET retired_at='2026-10-01T15:00:00Z',league_division_id=NULL
      WHERE id='00000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'expected unfinished-race guard';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'target_has_unfinished_entries' THEN RAISE; END IF;
  END;
  IF (SELECT retired_at FROM public.teams WHERE id='00000000-0000-0000-0000-000000000002') IS NOT NULL THEN
    RAISE EXCEPTION 'blocked retirement partially wrote team';
  END IF;
END;
$$;

UPDATE public.races SET status='completed' WHERE id='00000000-0000-0000-0000-000000000900';
UPDATE public.teams SET retired_at='2026-10-01T15:00:00Z',league_division_id=NULL
  WHERE id='00000000-0000-0000-0000-000000000002';
DO $$
BEGIN
  IF (SELECT u23_league_division_id FROM public.teams WHERE id='00000000-0000-0000-0000-000000000102')<>22 OR
      (SELECT junior_league_division_id FROM public.teams WHERE id='00000000-0000-0000-0000-000000000102')<>34 THEN
    RAISE EXCEPTION 'race-complete retirement did not use distinct second reserve';
  END IF;
  IF (SELECT count(*) FROM public.teams WHERE u23_league_division_id=22)<>24 OR
      (SELECT count(*) FROM public.teams WHERE junior_league_division_id=34)<>24 THEN
    RAISE EXCEPTION 'Group F/H lost occupancy';
  END IF;
END;
$$;

-- No third reserve: fail closed, leaving the club and both youth groups intact.
INSERT INTO public.teams(id,is_ai,league_division_id,u23_league_division_id,junior_league_division_id)
  VALUES ('00000000-0000-0000-0000-000000000003',true,10,23,35);
INSERT INTO public.teams(id,u23_league_division_id,junior_league_division_id)
  SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,23,35 FROM generate_series(3000,3022) i;
DO $$
BEGIN
  BEGIN
    UPDATE public.teams SET retired_at='2026-10-01T16:00:00Z',league_division_id=NULL
      WHERE id='00000000-0000-0000-0000-000000000003';
    RAISE EXCEPTION 'expected no-candidate guard';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'no_safe_youth_replacement' THEN RAISE; END IF;
  END;
  IF (SELECT retired_at FROM public.teams WHERE id='00000000-0000-0000-0000-000000000003') IS NOT NULL THEN
    RAISE EXCEPTION 'no-candidate retirement partially wrote team';
  END IF;
END;
$$;

SELECT 'youth-retirement-sql-smoke: ok' AS result;
