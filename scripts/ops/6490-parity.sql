-- #6490 · Read-only paritet: rider_training_seen ≡ det gamle JSON-prædikat.
-- Kør efter apply af database/2026-10-12-6490-rider-training-seen.sql og dagligt
-- i observationsvinduet (2 aftener), før GIN droppes på separat ejer-go.
-- Kun SELECT i en READ ONLY-transaktion, der rulles tilbage. Forventet: alle
-- *_deviations / *_missing / *_extra = 0. Output er tal, aldrig hold/brugere.
--
-- Afsnit 1 og 3 er stikprøver (billige). Afsnit 2 læser hele rapporttabellen
-- én gang (sekvensielt, ingen sortering på disk); spring den over under
-- aftenafregningen eller ved diskpres (#6537).

BEGIN READ ONLY;
SET LOCAL statement_timeout = '5min';
-- JSON-prædikatet skal bruge GIN (samme GUC som first-use-triggeren, #6450).
SET LOCAL enable_seqscan = off;

-- 1. Første-brugs-vagt, gammel vs ny, på en stikprøve af ryttere: nyeste 1000
--    ejede ryttere + 1000 ryttere fra historiktabellen. Gammel vagt = kvittering
--    ELLER løbsbelastning ELLER JSON-rapport; ny = kvittering ELLER
--    løbsbelastning ELLER rider_training_seen. (Tabellen indeholder bevidst også
--    ryttere fra kvitteringer/løbsbelastninger, så det er de samlede vagter der
--    skal være ens.)
WITH sample AS (
  (SELECT id AS rider_id FROM public.riders WHERE team_id IS NOT NULL ORDER BY created_at DESC NULLS LAST LIMIT 1000)
  UNION
  (SELECT rider_id FROM public.rider_training_seen ORDER BY first_seen_date DESC NULLS LAST, rider_id LIMIT 1000)
), guards AS (
  SELECT s.rider_id,
    (EXISTS(SELECT 1 FROM public.training_rider_ticks t WHERE t.rider_id=s.rider_id)
      OR EXISTS(SELECT 1 FROM public.training_race_loads l WHERE l.rider_id=s.rider_id)
      OR EXISTS(SELECT 1 FROM public.training_day_runs r
        WHERE r.report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',s.rider_id)))) AS old_guard,
    (EXISTS(SELECT 1 FROM public.training_rider_ticks t WHERE t.rider_id=s.rider_id)
      OR EXISTS(SELECT 1 FROM public.training_race_loads l WHERE l.rider_id=s.rider_id)
      OR EXISTS(SELECT 1 FROM public.rider_training_seen seen WHERE seen.rider_id=s.rider_id)) AS new_guard
  FROM sample s
)
SELECT 'guard_sample' AS check_name,
       count(*) AS riders_checked,
       count(*) FILTER (WHERE old_guard) AS with_history,
       count(*) FILTER (WHERE old_guard IS DISTINCT FROM new_guard) AS guard_deviations
  FROM guards;

-- 2. Fuld dækning: hver rytter i en rapport findes i tabellen (0 missing), og
--    rapportryttere med ikke-kanonisk id (som det gamle prædikat ikke matchede).
SELECT 'report_coverage' AS check_name,
       count(*) AS report_entries,
       count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM public.rider_training_seen s
         WHERE s.rider_id=(e->>'rider_id')::uuid)) AS seen_missing,
       count(*) FILTER (WHERE e->>'rider_id' <> lower(e->>'rider_id')) AS non_canonical_ids
  FROM public.training_day_runs t
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(t.report->'riders')='array' THEN t.report->'riders' ELSE '[]'::jsonb END) e
 WHERE jsonb_typeof(e)='object'
   AND e->>'rider_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 3. Ingen ekstra rækker: en stikprøve af tabellen har altid en kilde (rapport,
--    kvittering eller løbsbelastning). Ekstra rækker opstår kun hvis rapporter
--    slettes uden rebuild_rider_training_seen().
WITH sample AS (
  SELECT rider_id FROM public.rider_training_seen ORDER BY rider_id LIMIT 2000
)
SELECT 'seen_extra_sample' AS check_name,
       count(*) AS riders_checked,
       count(*) FILTER (WHERE NOT (
         EXISTS(SELECT 1 FROM public.training_rider_ticks t WHERE t.rider_id=s.rider_id)
         OR EXISTS(SELECT 1 FROM public.training_race_loads l WHERE l.rider_id=s.rider_id)
         OR EXISTS(SELECT 1 FROM public.training_day_runs r
           WHERE r.report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',s.rider_id)))
       )) AS seen_extra
  FROM sample s;

-- 4. Tabelstørrelse + dagens tilvækst (til observationsvinduet).
SELECT 'seen_size' AS check_name,
       count(*) AS seen_rows,
       count(*) FILTER (WHERE first_seen_date >= current_date - 1) AS seen_last_2_days,
       pg_size_pretty(pg_total_relation_size('public.rider_training_seen')) AS seen_total_size
  FROM public.rider_training_seen;

ROLLBACK;
