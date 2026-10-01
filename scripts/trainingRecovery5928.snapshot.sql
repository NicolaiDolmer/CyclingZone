-- Read-only, one-statement snapshot for the private offline proposal.
-- Never publish the output: it contains player inputs and engine state.
WITH w AS MATERIALIZED (
  SELECT * FROM training_date_work
  WHERE tick_date='2026-09-29' AND cardinality(quarantined_rider_ids)>0
), q AS MATERIALIZED (
  SELECT w.team_id,w.season_id,w.created_at AS work_created,unnest(w.quarantined_rider_ids) AS rider_id FROM w
), tm AS MATERIALIZED (
  SELECT id,name,user_id,league_division_id,u23_league_division_id,junior_league_division_id
  FROM teams WHERE id IN(SELECT team_id FROM w)
), rr AS MATERIALIZED (
  SELECT id,season_id,league_division_id,race_type FROM races
  WHERE season_id IN(SELECT season_id FROM w)
    AND league_division_id IN(SELECT league_division_id FROM tm UNION SELECT u23_league_division_id FROM tm UNION SELECT junior_league_division_id FROM tm)
), staff AS MATERIALIZED (
  SELECT * FROM team_staff WHERE team_id IN(SELECT team_id FROM w) AND role='training'
)
SELECT jsonb_build_object(
 'tick_date','2026-09-29','exported_at',statement_timestamp(),'season_number',4,
 'expected_rider_count',84,'expected_team_count',17,
 'manifest',jsonb_build_object(
   'eligible',(SELECT jsonb_agg(q.rider_id ORDER BY q.rider_id) FROM q WHERE NOT EXISTS(SELECT 1 FROM training_plans p WHERE p.rider_id=q.rider_id AND p.team_id=q.team_id AND p.season_id=q.season_id AND p.updated_at>q.work_created)),
   'excluded',(SELECT jsonb_agg(q.rider_id ORDER BY q.rider_id) FROM q WHERE EXISTS(SELECT 1 FROM training_plans p WHERE p.rider_id=q.rider_id AND p.team_id=q.team_id AND p.season_id=q.season_id AND p.updated_at>q.work_created))
 ),
 'evidence',(SELECT jsonb_agg(jsonb_build_object(
   'rider_id',q.rider_id,
   'condition_count',(SELECT count(*) FROM rider_condition c WHERE c.rider_id=q.rider_id),
   'receipt_count',(SELECT count(*) FROM training_rider_ticks t WHERE t.rider_id=q.rider_id),
   'settlement_count',(SELECT count(*) FROM training_condition_settlements s WHERE s.rider_id=q.rider_id),
   'race_load_count',(SELECT count(*) FROM training_race_loads l WHERE l.rider_id=q.rider_id),
   'race_result_count',(SELECT count(*) FROM race_results r WHERE r.rider_id=q.rider_id),
   'canonical_report_count',(SELECT count(*) FROM training_day_runs t WHERE (t.report->'riders') @> jsonb_build_array(jsonb_build_object('rider_id',q.rider_id::text))),
   'history_after_work_count',(SELECT count(*) FROM rider_derived_ability_history h WHERE h.rider_id=q.rider_id AND h.created_at>q.work_created)
 )) FROM q),
 'tables',jsonb_build_object(
   'training_date_work',COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY team_id) FROM w),'[]'),
   'riders',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM riders r WHERE id IN(SELECT rider_id FROM q)),'[]'),
   'rider_derived_abilities',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY rider_id) FROM rider_derived_abilities a WHERE rider_id IN(SELECT rider_id FROM q)),'[]'),
   'training_plans',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY rider_id) FROM training_plans p WHERE rider_id IN(SELECT rider_id FROM q) AND season_id IN(SELECT season_id FROM w)),'[]'),
   'training_week_plans',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY team_id,rider_id) FROM training_week_plans p WHERE team_id IN(SELECT team_id FROM w) AND (rider_id IS NULL OR rider_id IN(SELECT rider_id FROM q))),'[]'),
   'team_facilities',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM team_facilities f WHERE team_id IN(SELECT team_id FROM w) AND track='training'),'[]'),
   'team_staff',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM staff s),'[]'),
   'staff_derived_abilities',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY staff_id) FROM staff_derived_abilities a WHERE staff_id IN(SELECT id FROM staff)),'[]'),
   'finance_transactions',COALESCE((SELECT jsonb_agg(jsonb_build_object('team_id',f.team_id,'idempotency_key',f.idempotency_key,'created_at',f.created_at) ORDER BY f.id) FROM finance_transactions f WHERE team_id IN(SELECT team_id FROM w) AND (idempotency_key LIKE 'staff_severance:%' OR idempotency_key LIKE 'staff_release_severance:%')),'[]'),
   'app_config',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',key,'value',value) ORDER BY key) FROM app_config WHERE key IN('training_condition_per_date','training_tick_per_race_day','race_day_engine_enabled','race_day_development_enabled','training_programs')),'[]'),
   'teams',COALESCE((SELECT jsonb_agg(to_jsonb(tm) ORDER BY id) FROM tm),'[]'),
   'users',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'role',role,'is_beta_tester',is_beta_tester) ORDER BY id) FROM users WHERE id IN(SELECT user_id FROM tm)),'[]'),
   'races',COALESCE((SELECT jsonb_agg(to_jsonb(rr) ORDER BY id) FROM rr),'[]'),
   'race_stage_schedule',COALESCE((SELECT jsonb_agg(jsonb_build_object('race_id',race_id,'stage_number',stage_number,'game_day',game_day,'scheduled_at',scheduled_at) ORDER BY race_id,stage_number) FROM race_stage_schedule WHERE race_id IN(SELECT id FROM rr)),'[]'),
   'race_results',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM race_results r WHERE rider_id IN(SELECT rider_id FROM q)),'[]'),
   'race_stage_profiles',COALESCE((SELECT jsonb_agg(jsonb_build_object('race_id',race_id,'stage_number',stage_number,'profile_type',profile_type)) FROM race_stage_profiles WHERE race_id IN(SELECT race_id FROM race_results WHERE rider_id IN(SELECT rider_id FROM q))),'[]'),
   'race_entry_days',COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM race_entry_days e WHERE rider_id IN(SELECT rider_id FROM q) AND season_id IN(SELECT season_id FROM w) AND game_day IN(SELECT unnest(game_days) FROM w)),'[]'),
   'race_simulation_runs',COALESCE((SELECT jsonb_agg(jsonb_build_object('race_id',race_id,'stage_number',stage_number,'entrant_snapshot',entrant_snapshot)) FROM race_simulation_runs WHERE stage_number=1 AND race_id IN(SELECT race_id FROM race_entry_days WHERE rider_id IN(SELECT rider_id FROM q) AND season_id IN(SELECT season_id FROM w) AND game_day IN(SELECT unnest(game_days) FROM w))),'[]'),
   'training_race_loads',COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM training_race_loads l WHERE rider_id IN(SELECT rider_id FROM q)),'[]'),
   'rider_condition',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM rider_condition c WHERE rider_id IN(SELECT rider_id FROM q)),'[]'),
   'training_day_runs',COALESCE((SELECT jsonb_agg(jsonb_build_object('team_id',team_id,'season_id',season_id,'squad',squad,'tick_date',tick_date,'game_day',game_day,'report',jsonb_build_object('condition_per_date',report->'condition_per_date','condition_settled',report->'condition_settled')) ORDER BY team_id,game_day) FROM training_day_runs t WHERE team_id IN(SELECT team_id FROM w) AND tick_date='2026-09-29'),'[]'),
   'training_rider_ticks',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM training_rider_ticks t WHERE rider_id IN(SELECT rider_id FROM q)),'[]')
 )) AS snapshot;
