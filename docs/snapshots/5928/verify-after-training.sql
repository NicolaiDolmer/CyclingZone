-- READ ONLY. Post-apply verification proposal; not executed against prod.
-- psql -v tick_date=2026-09-29 -f docs/snapshots/5928/verify-after-training.sql
BEGIN READ ONLY;
SELECT key,value FROM app_config WHERE key IN
 ('training_condition_per_date','training_tick_per_race_day','training_condition_activation_date','stage_scheduler_enabled');
-- Expected: zero missing or mismatching original stage loads.
WITH actual AS (
 SELECT r.season_id,rs.race_id,rs.stage_number,
 COALESCE(e->>'rider_id',e#>>'{}')::uuid AS rider_id,rs.condition_load_snapshot
 FROM race_simulation_runs rs JOIN race_stage_schedule s USING(race_id,stage_number)
 JOIN races r ON r.id=rs.race_id
 CROSS JOIN LATERAL jsonb_array_elements(rs.entrant_snapshot) e
 WHERE (s.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date=:'tick_date'::date
)
SELECT count(*) AS actual_stage_starts,
 count(*) FILTER(WHERE l.rider_id IS NULL) AS missing_loads,
 count(*) FILTER(WHERE l.rider_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM jsonb_array_elements(a.condition_load_snapshot) x
 WHERE (x->>'rider_id')::uuid=a.rider_id AND (x->>'load')::numeric=l.load
 )) AS missing_or_mismatched_snapshot_loads
FROM actual a LEFT JOIN training_race_loads l USING(rider_id,race_id,stage_number);
-- Expected after evening: explain every non-complete work item; no silent losses.
SELECT status,count(*) FROM training_date_work WHERE tick_date=:'tick_date'::date GROUP BY status;
SELECT status,count(*) FROM training_condition_settlements WHERE tick_date=:'tick_date'::date GROUP BY status;
SELECT count(*) FILTER(WHERE consumed_at IS NULL) AS unconsumed,
 count(*) FILTER(WHERE reconciliation_required) AS reconciliation
 FROM training_race_loads WHERE tick_date=:'tick_date'::date;
SELECT count(*) AS alerts,count(*) FILTER(WHERE delivered_at IS NULL) AS undelivered,
 sum(attempts) AS attempts FROM training_condition_timeout_outbox WHERE tick_date=:'tick_date'::date;
-- Expected zero rows, also enforced by keys.
SELECT rider_id,season_id,game_day,count(*) FROM training_rider_ticks
 WHERE tick_date=:'tick_date'::date GROUP BY 1,2,3 HAVING count(*)>1;
SELECT rider_id,season_id,tick_date,count(*) FROM training_condition_settlements
 WHERE tick_date=:'tick_date'::date GROUP BY 1,2,3 HAVING count(*)>1;
-- Private only. Classify team ownership with verified teams schema separately.
SELECT count(*) AS settled,
 percentile_cont(0.5) WITHIN GROUP(ORDER BY (applied_condition->>'fatigue')::numeric) AS median_fatigue,
 count(*) FILTER(WHERE (applied_condition->>'fatigue')::numeric>=70) AS fatigue_ge_70,
 min((applied_condition->>'form')::numeric-(opening_condition->>'form')::numeric) AS min_form_delta,
 max((applied_condition->>'form')::numeric-(opening_condition->>'form')::numeric) AS max_form_delta
FROM training_condition_settlements WHERE tick_date=:'tick_date'::date;
SELECT count(*) AS racing_riders_zero FROM training_condition_settlements s
 WHERE s.tick_date=:'tick_date'::date AND (s.applied_condition->>'fatigue')::numeric=0
 AND EXISTS(SELECT 1 FROM training_race_loads l WHERE l.rider_id=s.rider_id AND l.tick_date=s.tick_date);
-- PRIVATE evidence for three examples. Replay production helper; SQL alone is NOT proof.
SELECT s.rider_id,s.opening_condition,s.applied_condition,
 (SELECT jsonb_agg(t.report ORDER BY t.game_day) FROM training_rider_ticks t
  WHERE t.rider_id=s.rider_id AND t.season_id=s.season_id AND t.tick_date=s.tick_date) AS receipts,
 (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.game_day) FROM training_race_loads l
  WHERE l.rider_id=s.rider_id AND l.season_id=s.season_id AND l.tick_date=s.tick_date) AS race_loads
FROM training_condition_settlements s WHERE s.tick_date=:'tick_date'::date
 AND (s.applied_condition->>'fatigue')::numeric=0
 AND EXISTS(SELECT 1 FROM training_race_loads l WHERE l.rider_id=s.rider_id AND l.tick_date=s.tick_date)
ORDER BY s.rider_id LIMIT 3;
-- Injury tuple changes are candidates, not an observed incidence definition.
SELECT applied_condition->>'injury_cause' AS cause,count(*) AS changed_injury_tuples
FROM training_condition_settlements WHERE tick_date=:'tick_date'::date
 AND (applied_condition->>'injured_until',applied_condition->>'injury_end_game_day')
 IS DISTINCT FROM (opening_condition->>'injured_until',opening_condition->>'injury_end_game_day')
GROUP BY 1;
ROLLBACK;

