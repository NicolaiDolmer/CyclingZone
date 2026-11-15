-- #6490 trin b1, b2 og c: træningshistorikken kan læses fra kvitteringerne i stedet for kopien.
--
-- Design: docs/superpowers/specs/2026-11-15-6490-traeningstabeller-plads-design.md.
-- Additiv og idempotent (CREATE OR REPLACE, ON CONFLICT DO NOTHING). Køres post-merge af
-- auto-migrate; kan køres igen. Intet slettes, intet udløber, og commit_training_date_tick
-- skriver stadig kopien i training_day_runs.report.riders. Ingen kode læser den nye vej, før en
-- kontakt står på "on" (begge seedet "off" her):
--   training_history_from_ticks_6490  træningssiden og GET /training/me (b1, b2)
--   training_peak_from_ticks_6490     peak-signalet, motorens input (c); egen kontakt
--
-- Hvad funktionerne returnerer: præcis de rækker i training_day_runs, som en SELECT ville give,
-- med de samme kolonner (report som json, samme JSON-værdier). Kun report.riders udledes: for en
-- løbsdagsrække (game_day sat) med en registreret dato i training_date_work bygges listen fra
-- training_rider_ticks med den samme regel, som commit_training_date_tick bruger, når den skriver
-- kopien (samme sæson og løbsdag, ryttere på datoens frosne liste, sorteret efter rider_id).
-- Den udledte liste bruges KUN, når dens mængde af rider_id er præcis den gemte report.riders'
-- mængde. Ellers står den gemte rapport urørt (fuld og slank form): ingen kvittering (game_day
-- NULL, ventende reservation, rækker fra før kvitteringerne), færre ryttere (hårdt slettet rytter,
-- ON DELETE CASCADE), flere ryttere (holdskifte midt på en dato) eller ingen gemt kopi.
--
--   training_runs_from_ticks_6490(p_team_ids, p_since, p_until, p_slim)
--     Kun service_role. Flere hold og et datointerval [p_since, p_until) til peak-signalet.
--     p_slim=true giver report = {riders: [...]} med kun rider_id, status og focus pr. rytter
--     (de felter peak-signalet læser); nøgler, der mangler i kvitteringen, mangler også her.
--   training_history_runs(p_team_id, p_since)
--     Træningssiden og GET /training. SECURITY DEFINER, fordi kvitteringerne og datoregistret
--     ikke kan læses af klienten (RLS uden policies). Samme ejerskabstjek som RLS-politikken
--     training_day_runs_select: en indlogget spiller får kun sit eget holds rækker, ellers
--     ingen rækker (ikke en fejl, ligesom RLS). service_role får holdets rækker.
--
-- Rollback (kun læsefunktioner og en kontakt, ingen data):
--   DROP FUNCTION IF EXISTS public.training_history_runs(uuid,date);
--   DROP FUNCTION IF EXISTS public.training_runs_from_ticks_6490(uuid[],date,date,boolean);
--   DELETE FROM public.app_config WHERE key IN ('training_history_from_ticks_6490','training_peak_from_ticks_6490');
--
-- POST-VERIFY (read-only):
--   SELECT key, value FROM public.app_config WHERE key IN ('training_history_from_ticks_6490','training_peak_from_ticks_6490');  -- begge "off"
--   SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('training_history_runs','training_runs_from_ticks_6490');
--   Sammenligning med de gemte rapporter: scripts/ops/6490-history-parity.sql (kun SELECT).
--
-- Refs #6490

-- #6342: fail fast instead of queueing behind live traffic. Safe to re-trigger.
SET lock_timeout = '3s';

BEGIN;

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_history_from_ticks_6490',
  '"off"'::jsonb,
  'Binary flag (off|on) for #6490: the training history, GET /training and the peak signal read the riders from the per-rider receipts (training_rider_ticks) instead of the copy in training_day_runs.report. Only "on" turns it on; beta counts as off.'
)
ON CONFLICT (key) DO NOTHING;

-- Fable-dom 15/11, fund 1: the peak signal (motor input) gets its OWN switch, so turning on the
-- training page can never change what the race engine reads.
INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_peak_from_ticks_6490',
  '"off"'::jsonb,
  'Binary flag (off|on) for #6490 trin c: the peak signal (racePeakPlans.loadTeamTrainingRuns, race engine input) reads status and focus from the per-rider receipts instead of the copy in training_day_runs.report. Only "on" turns it on; beta counts as off. Owner-only flip (motor input; see #8180 for the page cap on the old read).'
)
ON CONFLICT (key) DO NOTHING;

-- report is json (not jsonb): the derived riders are built with json_agg, which appends each
-- receipt's text instead of rebuilding a jsonb tree twice (jsonb_agg plus the merge into the stored
-- keys). Same JSON values for every client (PostgREST serialises json and jsonb alike). Compare
-- as ::jsonb in SQL (json has no equality). Local measurement: see the PR #8174 body.
--
-- No SET search_path on purpose (Fable-dom 15/11, fund 3): a function with SET is never inlined,
-- so its result is materialised once inside the function and once more by the caller. Without
-- SET, LANGUAGE sql STABLE SECURITY INVOKER is inlined into training_history_runs and into the
-- PostgREST query. Safe without it: every table and function is schema-qualified (public.,
-- pg_catalog.), built-in operators, casts and the "C" collation resolve from pg_catalog (always
-- searched first), the caller's own rights apply (INVOKER), and only service_role may EXECUTE.
-- training_history_runs keeps its SET, so the inlined body runs with search_path=public,pg_temp.
-- Advisor finding function_search_path_mutable for this function: scripts/ops/supabase-advisor-allowlist.json.
CREATE OR REPLACE FUNCTION public.training_runs_from_ticks_6490(
  p_team_ids uuid[], p_since date, p_until date DEFAULT NULL, p_slim boolean DEFAULT false
) RETURNS TABLE(
  id uuid, team_id uuid, season_id uuid, squad text, game_day integer, created_at timestamptz,
  tick_date date, executed_by text, bonus_applied boolean, report json
) LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT r.id, r.team_id, r.season_id, r.squad, r.game_day, r.created_at, r.tick_date, r.executed_by, r.bonus_applied,
    CASE
      WHEN p_slim THEN pg_catalog.jsonb_build_object('riders', COALESCE(safe.slim,
        (SELECT pg_catalog.jsonb_agg(CASE WHEN pg_catalog.jsonb_typeof(e.value)='object'
            THEN COALESCE((SELECT pg_catalog.jsonb_object_agg(k.key, k.value) FROM pg_catalog.jsonb_each(e.value) k WHERE k.key IN ('rider_id','status','focus')), '{}'::jsonb)
            ELSE e.value END ORDER BY e.ordinality)
         FROM pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(r.report->'riders')='array' THEN r.report->'riders' END) WITH ORDINALITY e),
        '[]'::jsonb))::json
      -- The stored keys without the copy (cheap: the riders subtree is skipped), then the derived riders.
      WHEN safe.riders IS NOT NULL THEN (
        SELECT pg_catalog.json_object_agg(x.key, x.value ORDER BY x.ord, x.key COLLATE "C")
        FROM (
          SELECT k.key, k.value::json AS value, 0 AS ord FROM pg_catalog.jsonb_each(r.report - 'riders') k
          UNION ALL SELECT 'riders', safe.riders, 1
        ) x)
      ELSE r.report::json
    END
  FROM public.training_day_runs r
  LEFT JOIN public.training_date_work w
    ON r.game_day IS NOT NULL AND w.team_id=r.team_id AND w.season_id=r.season_id AND w.tick_date=r.tick_date
  LEFT JOIN LATERAL (
    -- Same rule as the copy in commit_training_date_tick (same season and race day, riders on the
    -- date's frozen list, ordered by rider_id). Only the form the caller asked for is built.
    SELECT pg_catalog.count(*) AS n,
      pg_catalog.json_agg(t.report ORDER BY t.rider_id) FILTER (WHERE NOT p_slim) AS riders,
      -- Slim entry: only rider_id, status and focus; a missing key stays missing, an explicit null
      -- stays null (same result as filtering jsonb_each, without unpacking every key).
      pg_catalog.jsonb_agg(CASE WHEN pg_catalog.jsonb_typeof(t.report)='object'
          THEN (CASE WHEN t.report ? 'rider_id' THEN pg_catalog.jsonb_build_object('rider_id', t.report->'rider_id') ELSE '{}'::jsonb END)
            || (CASE WHEN t.report ? 'status' THEN pg_catalog.jsonb_build_object('status', t.report->'status') ELSE '{}'::jsonb END)
            || (CASE WHEN t.report ? 'focus' THEN pg_catalog.jsonb_build_object('focus', t.report->'focus') ELSE '{}'::jsonb END)
          ELSE t.report END ORDER BY t.rider_id) FILTER (WHERE p_slim) AS slim,
      pg_catalog.array_agg(t.report->>'rider_id' ORDER BY t.report->>'rider_id' COLLATE "C") FILTER (WHERE t.report->>'rider_id' IS NOT NULL) AS ids
    FROM public.training_rider_ticks t
    WHERE w.team_id IS NOT NULL AND t.season_id=r.season_id AND t.game_day=r.game_day AND t.rider_id=ANY(w.expected_rider_ids)
  ) derived ON true
  LEFT JOIN LATERAL (
    -- Locked rider set (Fable-dom 15/11, fund 2): the derived list is used ONLY when its set of
    -- rider_id is exactly the stored report.riders set (same count, same ids, every stored entry an
    -- object with a rider_id). Otherwise the stored report is returned unchanged, full and slim:
    --  * fewer: training_rider_ticks.rider_id is ON DELETE CASCADE, a hard-deleted rider loses his
    --    receipts;
    --  * more: a rider on two teams' frozen lists on the same date (team change mid-date) has his
    --    receipt picked up by both teams' rows, the stored copy only holds it once;
    --  * no stored copy (trin d not built): nothing to lock against, so the stored report stays.
    -- Both id lists are sorted the same way (COLLATE "C"), so equal sets give equal arrays.
    SELECT derived.riders, derived.slim
    FROM (
      SELECT pg_catalog.count(*) AS n,
        pg_catalog.array_agg(s.value->>'rider_id' ORDER BY s.value->>'rider_id' COLLATE "C") FILTER (WHERE s.value->>'rider_id' IS NOT NULL) AS ids
      FROM pg_catalog.jsonb_array_elements(CASE WHEN derived.n > 0 AND pg_catalog.jsonb_typeof(r.report->'riders')='array' THEN r.report->'riders' END) s
    ) st
    WHERE derived.n > 0
      AND derived.n = pg_catalog.cardinality(derived.ids)
      AND st.n = pg_catalog.cardinality(st.ids)
      AND st.ids = derived.ids
  ) safe ON true
  WHERE r.team_id=ANY(p_team_ids) AND r.tick_date>=p_since AND (p_until IS NULL OR r.tick_date<p_until)
$$;

REVOKE ALL ON FUNCTION public.training_runs_from_ticks_6490(uuid[],date,date,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.training_runs_from_ticks_6490(uuid[],date,date,boolean) TO service_role;

-- secdef-lint: allow training_history_runs (read-only history for the caller's own team; the ownership check mirrors the training_day_runs_select RLS policy)
CREATE OR REPLACE FUNCTION public.training_history_runs(p_team_id uuid, p_since date)
RETURNS TABLE(
  id uuid, team_id uuid, season_id uuid, squad text, game_day integer, created_at timestamptz,
  tick_date date, executed_by text, bonus_applied boolean, report json
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
    AND NOT EXISTS(SELECT 1 FROM public.teams WHERE teams.id=p_team_id AND teams.user_id=(SELECT auth.uid())) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.training_runs_from_ticks_6490(ARRAY[p_team_id], p_since, NULL, false);
END;
$$;

REVOKE ALL ON FUNCTION public.training_history_runs(uuid,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.training_history_runs(uuid,date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
