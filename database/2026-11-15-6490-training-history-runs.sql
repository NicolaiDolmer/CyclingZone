-- #6490 trin b1, b2 og c: træningshistorikken kan læses fra kvitteringerne i stedet for kopien.
--
-- Design: docs/superpowers/specs/2026-11-15-6490-traeningstabeller-plads-design.md.
-- Additiv og idempotent (CREATE OR REPLACE, ON CONFLICT DO NOTHING). Køres post-merge af
-- auto-migrate; kan køres igen. Intet slettes, intet udløber, og commit_training_date_tick
-- skriver stadig kopien i training_day_runs.report.riders. Ingen kode læser den nye vej, før
-- kontakten training_history_from_ticks_6490 står på "on" (seedet "off" her).
--
-- Hvad funktionerne returnerer: præcis de rækker i training_day_runs, som en SELECT ville give,
-- med de samme kolonner. Kun report.riders udledes: for en løbsdagsrække (game_day sat) med en
-- registreret dato i training_date_work bygges listen fra training_rider_ticks med den samme regel,
-- som commit_training_date_tick bruger, når den skriver kopien (samme sæson og løbsdag, ryttere på
-- datoens frosne liste, sorteret efter rider_id). Findes ingen kvittering for rækken (rækker med
-- game_day NULL fra den gamle sti, en ventende reservation, rækker fra før kvitteringerne), står
-- den gemte rapport urørt. Mangler den udledte liste en rytter, som den gemte rapport har (en
-- hårdt slettet rytter mister sine kvitteringer via ON DELETE CASCADE), står den gemte rapport
-- også urørt: den nye vej giver aldrig færre ryttere end kopien.
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
--   DELETE FROM public.app_config WHERE key='training_history_from_ticks_6490';
--
-- POST-VERIFY (read-only):
--   SELECT value FROM public.app_config WHERE key='training_history_from_ticks_6490';  -- "off"
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

CREATE OR REPLACE FUNCTION public.training_runs_from_ticks_6490(
  p_team_ids uuid[], p_since date, p_until date DEFAULT NULL, p_slim boolean DEFAULT false
) RETURNS TABLE(
  id uuid, team_id uuid, season_id uuid, squad text, game_day integer, created_at timestamptz,
  tick_date date, executed_by text, bonus_applied boolean, report jsonb
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT r.id, r.team_id, r.season_id, r.squad, r.game_day, r.created_at, r.tick_date, r.executed_by, r.bonus_applied,
    CASE
      WHEN p_slim THEN jsonb_build_object('riders', COALESCE(
        (SELECT jsonb_agg(CASE WHEN jsonb_typeof(e.value)='object'
            THEN COALESCE((SELECT jsonb_object_agg(k.key, k.value) FROM jsonb_each(e.value) k WHERE k.key IN ('rider_id','status','focus')), '{}'::jsonb)
            ELSE e.value END ORDER BY e.ordinality)
         FROM jsonb_array_elements(COALESCE(safe.riders, CASE WHEN jsonb_typeof(r.report->'riders')='array' THEN r.report->'riders' END)) WITH ORDINALITY e),
        '[]'::jsonb))
      WHEN safe.riders IS NOT NULL THEN (r.report - 'riders') || jsonb_build_object('riders', safe.riders)
      ELSE r.report
    END
  FROM public.training_day_runs r
  LEFT JOIN public.training_date_work w
    ON r.game_day IS NOT NULL AND w.team_id=r.team_id AND w.season_id=r.season_id AND w.tick_date=r.tick_date
  LEFT JOIN LATERAL (
    -- Same rule as the copy in commit_training_date_tick: no rows gives NULL (stored report stays).
    SELECT jsonb_agg(t.report ORDER BY t.rider_id) AS riders
    FROM public.training_rider_ticks t
    WHERE w.team_id IS NOT NULL AND t.season_id=r.season_id AND t.game_day=r.game_day AND t.rider_id=ANY(w.expected_rider_ids)
  ) derived ON true
  LEFT JOIN LATERAL (
    -- Never fewer riders than the stored copy: training_rider_ticks.rider_id is ON DELETE CASCADE, so
    -- a hard-deleted rider loses his receipts. When the stored riders hold a rider_id the derived
    -- list lacks, the stored report is returned unchanged (same result as when every receipt is gone).
    -- Open design point for trin d (copy no longer stored): see #6490.
    SELECT CASE WHEN derived.riders IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.report->'riders')='array' THEN r.report->'riders' ELSE '[]'::jsonb END) s
        WHERE jsonb_typeof(s.value)='object' AND s.value ? 'rider_id'
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(derived.riders) d WHERE d.value->>'rider_id' = s.value->>'rider_id'))
      THEN derived.riders END AS riders
  ) safe ON true
  WHERE r.team_id=ANY(p_team_ids) AND r.tick_date>=p_since AND (p_until IS NULL OR r.tick_date<p_until)
$$;

REVOKE ALL ON FUNCTION public.training_runs_from_ticks_6490(uuid[],date,date,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.training_runs_from_ticks_6490(uuid[],date,date,boolean) TO service_role;

-- secdef-lint: allow training_history_runs (read-only history for the caller's own team; the ownership check mirrors the training_day_runs_select RLS policy)
CREATE OR REPLACE FUNCTION public.training_history_runs(p_team_id uuid, p_since date)
RETURNS TABLE(
  id uuid, team_id uuid, season_id uuid, squad text, game_day integer, created_at timestamptz,
  tick_date date, executed_by text, bonus_applied boolean, report jsonb
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
