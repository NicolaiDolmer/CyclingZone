-- #6490 trin b1/b2/c: sammenligning af den nye læsevej med kopien i prod. KUN SELECT.
--
-- Hvad: for hver række i training_day_runs i vinduet sammenlignes den gemte rapport med
-- training_runs_from_ticks_6490 (den vej training_history_runs og GET /training/me bruger, når
-- training_history_from_ticks_6490 er "on", og peak-signalet, når training_peak_from_ticks_6490
-- er "on"). Funktionen giver report som json; her sammenlignes som jsonb (samme JSON-værdier).
-- Krav før en kontakt tændes: 0 i rows_missing_on_one_side, riders_differ, other_fields_differ
-- og slim_differ, og svartiden for ét hold højst gammel + 300 ms (afsnit 4).
--
-- rider_set_more / rider_set_fewer / rider_set_differ tæller rækker, hvor udledningsreglen (samme
-- sæson og løbsdag, ryttere på datoens frosne liste) giver en ANDEN rytter-mængde end den gemte
-- kopi: flere (holdskifte midt på en dato) eller færre (hårdt slettet rytter). Funktionen giver
-- den gemte rapport uændret for de rækker (låst rytter-mængde), så de tæller ikke i riders_differ;
-- tallet viser, hvor mange rækker der ikke kan læses fra kvitteringerne endnu (åbent for trin d).
-- rider_set_no_copy: kvitteringer findes, men rækken har ingen gemt kopi (også gemt rapport).
--
-- Kørsel (read-only forbindelse er nok; ingen skrivning, ingen låse ud over læsning):
--   psql "$DB_URL" -v since="'2026-10-01'" -f scripts/ops/6490-history-parity.sql
-- Uden -v since bruges de seneste 45 dage. Kør uden for aftenafregningen (læser alle rapporter i
-- vinduet én gang). Resultatet citeres på issuet som tal uden hold- eller rytter-id'er.
--
-- Refs #6490

\if :{?since}
\else
  \set since 'current_date - 45'
\endif

BEGIN READ ONLY;
SET LOCAL statement_timeout = '15min';

-- 1) Fuld rapport: hver række, alle kolonner. Afvigelser opdelt i rytterlisten og resten, plus
--    rækker hvor udledningsreglens rytter-mængde afviger fra den gemte.
WITH teams AS (
  SELECT array_agg(DISTINCT team_id) AS ids FROM public.training_day_runs WHERE tick_date >= :since
),
old AS (
  SELECT id, team_id, season_id, squad, game_day, created_at, tick_date, executed_by, bonus_applied, report
  FROM public.training_day_runs WHERE tick_date >= :since
),
new AS (
  SELECT f.id, f.team_id, f.season_id, f.squad, f.game_day, f.created_at, f.tick_date, f.executed_by, f.bonus_applied,
    f.report::jsonb AS report
  FROM teams, public.training_runs_from_ticks_6490(teams.ids, :since, NULL, false) f
),
sets AS (
  SELECT o.id,
    (SELECT array_agg(t.report->>'rider_id') FROM public.training_rider_ticks t
      WHERE t.season_id = o.season_id AND t.game_day = o.game_day AND t.rider_id = ANY(w.expected_rider_ids)) AS derived_ids,
    CASE WHEN jsonb_typeof(o.report->'riders') = 'array'
      THEN (SELECT COALESCE(array_agg(s.value->>'rider_id'), '{}') FROM jsonb_array_elements(o.report->'riders') s) END AS stored_ids
  FROM old o
  JOIN public.training_date_work w
    ON o.game_day IS NOT NULL AND w.team_id = o.team_id AND w.season_id = o.season_id AND w.tick_date = o.tick_date
)
SELECT
  (SELECT count(*) FROM old) AS rows_stored,
  (SELECT count(*) FROM new) AS rows_new,
  count(*) FILTER (WHERE o.id IS NULL OR n.id IS NULL) AS rows_missing_on_one_side,
  count(*) FILTER (WHERE o.id IS NOT NULL AND n.id IS NOT NULL
    AND o.report->'riders' IS DISTINCT FROM n.report->'riders') AS riders_differ,
  count(*) FILTER (WHERE o.id IS NOT NULL AND n.id IS NOT NULL
    AND ((o.report - 'riders') IS DISTINCT FROM (n.report - 'riders')
      OR (o.team_id, o.season_id, o.squad, o.game_day, o.created_at, o.tick_date, o.executed_by, o.bonus_applied)
        IS DISTINCT FROM (n.team_id, n.season_id, n.squad, n.game_day, n.created_at, n.tick_date, n.executed_by, n.bonus_applied))) AS other_fields_differ,
  count(*) FILTER (WHERE o.game_day IS NOT NULL AND jsonb_typeof(o.report->'riders') = 'array') AS race_day_rows_with_copy,
  (SELECT count(*) FROM sets WHERE derived_ids IS NOT NULL AND stored_ids IS NOT NULL
    AND NOT (derived_ids <@ stored_ids)) AS rider_set_more,
  (SELECT count(*) FROM sets WHERE derived_ids IS NOT NULL AND stored_ids IS NOT NULL
    AND NOT (stored_ids <@ derived_ids)) AS rider_set_fewer,
  (SELECT count(*) FROM sets WHERE derived_ids IS NOT NULL AND stored_ids IS NOT NULL
    AND (NOT (derived_ids <@ stored_ids) OR NOT (stored_ids <@ derived_ids)
      OR cardinality(derived_ids) <> cardinality(stored_ids))) AS rider_set_differ,
  (SELECT count(*) FROM sets WHERE derived_ids IS NOT NULL AND stored_ids IS NULL) AS rider_set_no_copy
FROM old o FULL JOIN new n ON n.id = o.id;

-- 2) Peak-signalets slanke form (rider_id, status, focus) mod den gemte rytterliste.
WITH teams AS (
  SELECT array_agg(DISTINCT team_id) AS ids FROM public.training_day_runs WHERE tick_date >= :since
),
slim AS (
  SELECT f.id, f.report::jsonb AS report FROM teams, public.training_runs_from_ticks_6490(teams.ids, :since, NULL, true) f
),
expected AS (
  SELECT r.id, jsonb_build_object('riders', COALESCE((
    SELECT jsonb_agg(CASE WHEN jsonb_typeof(e.value) = 'object'
        THEN COALESCE((SELECT jsonb_object_agg(k.key, k.value) FROM jsonb_each(e.value) k WHERE k.key IN ('rider_id','status','focus')), '{}'::jsonb)
        ELSE e.value END ORDER BY e.ordinality)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.report->'riders') = 'array' THEN r.report->'riders' ELSE '[]'::jsonb END) WITH ORDINALITY e
  ), '[]'::jsonb)) AS report
  FROM public.training_day_runs r WHERE r.tick_date >= :since
)
SELECT count(*) AS slim_rows, count(*) FILTER (WHERE s.report IS DISTINCT FROM x.report) AS slim_differ
FROM expected x LEFT JOIN slim s ON s.id = x.id;

-- 3) Afvigende rækker (højst 20) til fejlsøgning: kun rækkens egen id, dato og løbsdag.
WITH teams AS (
  SELECT array_agg(DISTINCT team_id) AS ids FROM public.training_day_runs WHERE tick_date >= :since
),
new AS (
  SELECT f.id, f.report::jsonb AS report FROM teams, public.training_runs_from_ticks_6490(teams.ids, :since, NULL, false) f
)
SELECT o.id AS run_id, o.tick_date, o.game_day,
  jsonb_array_length(COALESCE(o.report->'riders', '[]')) AS riders_stored,
  jsonb_array_length(COALESCE(n.report->'riders', '[]')) AS riders_new
FROM public.training_day_runs o JOIN new n ON n.id = o.id
WHERE o.tick_date >= :since AND o.report IS DISTINCT FROM n.report
ORDER BY o.tick_date DESC, o.game_day
LIMIT 20;

-- 4) Svartid for det hold med flest rækker i vinduet: den gamle SELECT, den nye læser og den
--    rigtige funktion træningssiden kalder (som service_role; ejerskabstjekket er det samme).
SELECT team_id AS busiest_team FROM public.training_day_runs WHERE tick_date >= :since
GROUP BY team_id ORDER BY count(*) DESC LIMIT 1 \gset
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON)
  SELECT id, season_id, squad, game_day, created_at, tick_date, executed_by, bonus_applied, report
  FROM public.training_day_runs WHERE team_id = :'busiest_team' AND tick_date >= :since;
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON)
  SELECT * FROM public.training_runs_from_ticks_6490(ARRAY[:'busiest_team']::uuid[], :since, NULL, false);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON)
  SELECT * FROM public.training_history_runs(:'busiest_team', :since);

ROLLBACK;
