// Compile a private, owner-approved transaction. This module never connects to
// production. The caller reviews/tests/merges it before executing the output.
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {validateSnapshot} from './trainingRecovery5928.mjs';
import {copenhagenDateString} from '../backend/lib/copenhagenTime.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const literal=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const check=(ok,message)=>{if(!ok)throw new Error(message);};
// Match runTeamTrainingDay's roster select. Metadata outside this list is not
// consumed by historical training and is never written by this recovery.
const rosterColumns=['id','primary_type','secondary_type','potentiale','birthdate','firstname','lastname','team_id','is_academy','is_retired'];
const trainingRoster=row=>Object.fromEntries(rosterColumns.map(key=>[key,row[key]??null]));
const block=body=>{
  check(!body.includes('$cz_recovery$'),'Recovery data contains the SQL block delimiter');
  return `DO $cz_recovery$\n${body}\n$cz_recovery$;`;
};

export function buildRecoverySql({snapshot,proposal,approvedHash,now,mode='apply',scope,executionState}) {
  validateSnapshot(snapshot,scope);
  const {proposal_sha256,...signed}=proposal;
  check(approvedHash===proposal_sha256 && hash(signed)===approvedHash,'Owner-approved proposal checksum required');
  check(hash(snapshot)===proposal.snapshot_sha256,'Snapshot checksum changed');
  check(mode==='apply'||mode==='rollback','Invalid recovery mode');
  check(Number.isFinite(Date.parse(now)),'Explicit execution time required');
  now=new Date(now).toISOString();
  check(copenhagenDateString(new Date(now))==='2026-09-30','Only the approved recovery window is supported');
  const ids=proposal.manifest.eligible;
  check(ids.length===(scope?.eligible??75),'Approved rider scope changed');
  const selected=new Set(ids),teams=new Set(proposal.riders.map(r=>r.team_id));
  check(Array.isArray(executionState?.outbox)&&Array.isArray(executionState?.reports)&&executionState?.peers?.length===teams.size,'Fresh report/outbox/peer before-images required');
  check(executionState.existing_scores===0&&executionState.existing_daily_history===0,'Preexisting recovery write keys');
  const season=snapshot.tables.training_date_work[0].season_id;
  check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(season),'Invalid season key');
  check(proposal.riders.length===ids.length && proposal.riders.every(r=>selected.has(r.rider_id)),'Proposal rider membership changed');
  const expectedDays=new Map(snapshot.tables.training_date_work.map(w=>[w.team_id,w.game_days]));
  for(const days of expectedDays.values())check(JSON.stringify(days)==='[5,6,7,8,9]','Unsupported game-day axis');
  const seen=new Set();
  for(const c of proposal.commits) {
    check(teams.has(c.p_team_id)&&c.p_season_id===season&&c.p_tick_date===snapshot.tick_date&&c.p_squad==='senior','Commit outside approved team/date');
    check(JSON.stringify(c.p_date_game_days)===JSON.stringify(expectedDays.get(c.p_team_id)),'Commit date axis changed');
    for(const r of c.p_report.riders){
      check(selected.has(r.rider_id)&&proposal.riders.some(x=>x.rider_id===r.rider_id&&x.team_id===c.p_team_id),'Report outside approved scope');
      const key=`${r.rider_id}:${c.p_game_day}`;check(!seen.has(key),'Duplicate proposed receipt');seen.add(key);
    }
    for(const a of c.p_abilities)check(selected.has(a.riderId),'Ability patch outside approved scope');
    check((c.p_race_loads??[]).length===0,'Recovery cannot own race loads');
    for(const field of ['p_conditions','p_history','p_race_history','p_scores','p_race_loads'])for(const r of c[field]??[])check(selected.has(r.rider_id),'Write outside approved scope');
  }
  check(seen.size===ids.length*5,'Complete five receipts per approved rider required');
  const t=snapshot.tables;
  const selectedStaff=new Set(t.team_staff.filter(r=>teams.has(r.team_id)).map(r=>r.id));
  const selectedUsers=new Set(t.teams.filter(r=>teams.has(r.id)).map(r=>r.user_id));
  const before={
    riders:t.riders.filter(r=>selected.has(r.id)).map(trainingRoster),rider_derived_abilities:t.rider_derived_abilities.filter(r=>selected.has(r.rider_id)),
    training_date_work:t.training_date_work.filter(r=>teams.has(r.team_id)),
    training_plans:t.training_plans.filter(r=>selected.has(r.rider_id)),
    training_week_plans:t.training_week_plans.filter(r=>teams.has(r.team_id)&&(r.rider_id==null||selected.has(r.rider_id))),
    team_facilities:t.team_facilities.filter(r=>teams.has(r.team_id)),team_staff:t.team_staff.filter(r=>teams.has(r.team_id)),
    staff_derived_abilities:t.staff_derived_abilities.filter(r=>selectedStaff.has(r.staff_id)),
    finance_transactions:t.finance_transactions.filter(r=>teams.has(r.team_id)),app_config:t.app_config,
    teams:t.teams.filter(r=>teams.has(r.id)),users:t.users.filter(r=>selectedUsers.has(r.id)),
    races:t.races,race_stage_schedule:t.race_stage_schedule,
    training_condition_timeout_outbox:executionState.outbox,training_day_runs:executionState.reports,
  };
  const projections={
    riders:`jsonb_build_object(${rosterColumns.map(key=>`'${key}',x.${key}`).join(',')})`,
    finance_transactions:"jsonb_build_object('team_id',x.team_id,'idempotency_key',x.idempotency_key,'created_at',x.created_at)",
    app_config:"jsonb_build_object('key',x.key,'value',x.value)",
    teams:"jsonb_build_object('id',x.id,'name',x.name,'user_id',x.user_id,'league_division_id',x.league_division_id,'u23_league_division_id',x.u23_league_division_id,'junior_league_division_id',x.junior_league_division_id)",
    users:"jsonb_build_object('id',x.id,'role',x.role,'is_beta_tester',x.is_beta_tester)",
    races:"jsonb_build_object('id',x.id,'season_id',x.season_id,'league_division_id',x.league_division_id,'race_type',x.race_type)",
    race_stage_schedule:"jsonb_build_object('race_id',x.race_id,'stage_number',x.stage_number,'game_day',x.game_day,'scheduled_at',x.scheduled_at)",
    training_day_runs:"jsonb_build_object('team_id',x.team_id,'season_id',x.season_id,'game_day',x.game_day,'tick_date',x.tick_date,'report_header',x.report-'riders','report_md5',md5(x.report::text))",
  };
  const where={riders:'x.id=ANY(ids)',rider_derived_abilities:'x.rider_id=ANY(ids)',
    training_date_work:"x.team_id=ANY(team_ids) AND x.season_id=season_key AND x.tick_date=date_key",
    training_plans:'x.rider_id=ANY(ids) AND x.season_id=season_key',
    training_week_plans:'x.team_id=ANY(team_ids) AND (x.rider_id IS NULL OR x.rider_id=ANY(ids))',
    team_facilities:"x.team_id=ANY(team_ids) AND x.track='training'",team_staff:"x.team_id=ANY(team_ids) AND x.role='training'",
    staff_derived_abilities:"x.staff_id IN(SELECT id FROM team_staff WHERE team_id=ANY(team_ids) AND role='training')",
    finance_transactions:"x.team_id=ANY(team_ids) AND (x.idempotency_key LIKE 'staff_severance:%' OR x.idempotency_key LIKE 'staff_release_severance:%')",
    app_config:"x.key IN('training_condition_per_date','training_tick_per_race_day','race_day_engine_enabled','race_day_development_enabled','training_programs')",
    teams:'x.id=ANY(team_ids)',users:"x.id IN(SELECT user_id FROM teams WHERE id=ANY(team_ids))",
    races:"x.id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(b->'races'))",
    race_stage_schedule:"x.race_id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(b->'races'))",
    training_day_runs:'x.team_id=ANY(team_ids) AND x.season_id=season_key AND x.tick_date=date_key',
    training_condition_timeout_outbox:'x.team_id=ANY(team_ids) AND x.season_id=season_key AND x.tick_date=date_key',
  };
  const compare=(table,projection=projections[table]??'to_jsonb(x)',predicate=where[table])=>`
  IF EXISTS((SELECT ${projection} FROM public.${table} x WHERE ${predicate} EXCEPT ALL SELECT value FROM jsonb_array_elements(b->'${table}'))
    UNION ALL(SELECT value FROM jsonb_array_elements(b->'${table}') EXCEPT ALL SELECT ${projection} FROM public.${table} x WHERE ${predicate}))
    THEN RAISE EXCEPTION 'Recovery snapshot changed: ${table}'; END IF;`;
  const afterAbilities=before.rider_derived_abilities.map(row=>{
    const result=structuredClone(row);for(const c of proposal.commits)for(const a of c.p_abilities)if(a.riderId===row.rider_id)Object.assign(result,a.patch);return result;
  });
  const afterWork=before.training_date_work.map(w=>{
    const result=structuredClone(w);
    for(const r of proposal.riders.filter(r=>r.team_id===w.team_id))result.opening_conditions[r.rider_id]=r.opening;
    result.quarantined_rider_ids=result.quarantined_rider_ids.filter(id=>!selected.has(id));
    result.quarantine_evidence=result.quarantine_evidence.filter(e=>!selected.has(e.rider_id));
    result.missing_evidence=result.missing_evidence.filter(e=>!selected.has(e.rider_id));
    result.status=result.missing_evidence.length?'needs_reconciliation':'complete';result.updated_at=now;return result;
  });
  const afterOutbox=before.training_condition_timeout_outbox.filter(o=>afterWork.find(w=>w.team_id===o.team_id).status!=='complete').map(o=>{
    const w=afterWork.find(w=>w.team_id===o.team_id),rider_ids=[...new Set(w.missing_evidence.map(e=>e.rider_id))].sort();
    return {...o,payload:{team_id:w.team_id,season_id:w.season_id,tick_date:w.tick_date,missing_evidence:w.missing_evidence,rider_ids},updated_at:now,delivered_at:null};
  });
  const compact={manifest:proposal.manifest,commits:proposal.commits,riders:proposal.riders.map(r=>({rider_id:r.rider_id,team_id:r.team_id,opening:r.opening,condition_after:r.condition_after})),after_abilities:afterAbilities,after_work:afterWork,after_outbox:afterOutbox,peers:executionState.peers};
  const lockTables=[...new Set([...Object.keys(before),'rider_condition','race_results','race_entry_days','race_incidents','training_rider_ticks','training_condition_settlements','training_race_loads','training_day_runs','rider_training_scores','rider_derived_ability_history','rider_ability_race_day_history','training_condition_timeout_outbox'])].sort();
  const start=`DECLARE b jsonb:=${literal(before)};p jsonb:=${literal(compact)};
  proposal_hash text:='${approvedHash}';execution_time timestamptz:='${now}';
  date_key date:='2026-09-29';season_key uuid:='${season}';ids uuid[];team_ids uuid[];
  team_key uuid;rider_key uuid;item jsonb;c jsonb;result jsonb;patch jsonb;assignments text;affected integer;
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  ids:=ARRAY(SELECT jsonb_array_elements_text(p->'manifest'->'eligible'))::uuid[];
  team_ids:=ARRAY(SELECT DISTINCT (value->>'team_id')::uuid FROM jsonb_array_elements(p->'riders') ORDER BY 1);
  PERFORM pg_advisory_xact_lock(hashtextextended('training-date-cutover:'||date_key::text,0));
  FOREACH team_key IN ARRAY team_ids LOOP PERFORM pg_advisory_xact_lock(hashtextextended('training-date:'||team_key::text,0));END LOOP;
  LOCK TABLE ${lockTables.map(name=>'public.'+name).join(',')} IN SHARE ROW EXCLUSIVE MODE;
  PERFORM id FROM public.riders WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.riders WHERE id=ANY(ids))<>cardinality(ids) THEN RAISE EXCEPTION 'Recovery roster missing'; END IF;
`;
  const noLater=`
  IF EXISTS(SELECT 1 FROM public.training_condition_settlements WHERE rider_id=ANY(ids) AND tick_date>date_key)
    OR EXISTS(SELECT 1 FROM public.training_rider_ticks WHERE rider_id=ANY(ids) AND tick_date>date_key)
    OR EXISTS(SELECT 1 FROM public.training_race_loads WHERE rider_id=ANY(ids))
    OR EXISTS(SELECT 1 FROM public.race_results WHERE rider_id=ANY(ids))
    OR EXISTS(SELECT 1 FROM public.race_entry_days WHERE rider_id=ANY(ids) AND season_id=season_key AND game_day=ANY(ARRAY[5,6,7,8,9]))
    OR EXISTS(SELECT 1 FROM public.race_incidents WHERE rider_id=ANY(ids))
    THEN RAISE EXCEPTION 'Recovery has later or unknown rider activity'; END IF;`;
  const peerGuard=`
  FOR item IN SELECT value FROM jsonb_array_elements(p->'peers') LOOP
    IF (SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,',' ORDER BY t.rider_id,t.game_day),'')) FROM training_rider_ticks t WHERE t.team_id=(item->>'team_id')::uuid AND t.season_id=season_key AND t.tick_date=date_key AND NOT t.rider_id=ANY(ids)) IS DISTINCT FROM item->>'md5'
      THEN RAISE EXCEPTION 'Recovery teammate receipts changed';END IF;
  END LOOP;`;
  if(mode==='apply') return block(start+`
  IF (SELECT count(*) FROM training_rider_ticks WHERE rider_id=ANY(ids) AND season_id=season_key AND tick_date=date_key AND report->>'recovery_proposal_sha256'=proposal_hash)=cardinality(ids)*5
    AND (SELECT count(*) FROM training_condition_settlements WHERE rider_id=ANY(ids) AND season_id=season_key AND tick_date=date_key AND status='complete')=cardinality(ids)
    THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM training_rider_ticks WHERE rider_id=ANY(ids)) OR EXISTS(SELECT 1 FROM training_condition_settlements WHERE rider_id=ANY(ids))
    OR EXISTS(SELECT 1 FROM rider_condition WHERE rider_id=ANY(ids)) THEN RAISE EXCEPTION 'Recovery is not a pristine missing-condition batch';END IF;
  ${noLater}
  ${peerGuard}
  ${Object.keys(before).map(name=>compare(name)).join('\n')}
  IF EXISTS(SELECT 1 FROM training_day_runs WHERE (report->'riders') @> ANY(ARRAY(SELECT jsonb_build_array(jsonb_build_object('rider_id',id::text)) FROM unnest(ids)id))) THEN RAISE EXCEPTION 'Canonical rider report already exists';END IF;
  IF EXISTS(SELECT 1 FROM training_day_runs x WHERE x.team_id=ANY(team_ids) AND x.season_id=season_key AND x.tick_date=date_key AND x.report->'riders' IS DISTINCT FROM
    COALESCE((SELECT jsonb_agg(t.report ORDER BY t.rider_id) FROM training_rider_ticks t WHERE t.team_id=x.team_id AND t.season_id=x.season_id AND t.game_day=x.game_day),'[]')) THEN RAISE EXCEPTION 'Canonical teammate report differs from receipt ledger';END IF;
  IF EXISTS(SELECT 1 FROM rider_derived_ability_history WHERE rider_id=ANY(ids) AND created_at>(SELECT min((value->>'created_at')::timestamptz) FROM jsonb_array_elements(b->'training_date_work')))
    OR EXISTS(SELECT 1 FROM rider_training_scores WHERE rider_id=ANY(ids) AND season_id=season_key AND game_day=ANY(ARRAY[5,6,7,8,9]))
    OR EXISTS(SELECT 1 FROM rider_ability_race_day_history WHERE rider_id=ANY(ids) AND season_id=season_key AND game_day=ANY(ARRAY[5,6,7,8,9]))
    OR EXISTS(SELECT 1 FROM rider_derived_ability_history WHERE rider_id=ANY(ids) AND snapshot_date=date_key AND source='daily_training')
    THEN RAISE EXCEPTION 'Recovery has prior partial write evidence';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p->'riders') LOOP
    rider_key:=(item->>'rider_id')::uuid;team_key:=(item->>'team_id')::uuid;
    INSERT INTO rider_condition(rider_id,form,fatigue,injured_until,injury_cause,updated_at,injury_end_game_day,injury_season_id,injury_race_days_left)
      SELECT rider_id,form,fatigue,injured_until,injury_cause,execution_time,injury_end_game_day,injury_season_id,injury_race_days_left
      FROM jsonb_populate_record(NULL::public.rider_condition,item->'opening');
    UPDATE training_date_work SET opening_conditions=opening_conditions||jsonb_build_object(rider_key::text,item->'opening'),
      quarantined_rider_ids=array_remove(quarantined_rider_ids,rider_key),
      quarantine_evidence=COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(quarantine_evidence)e WHERE e->>'rider_id'<>rider_key::text),'[]'),
      status='partial',updated_at=execution_time WHERE team_id=team_key AND season_id=season_key AND tick_date=date_key;
  END LOOP;
  FOR c IN SELECT value FROM jsonb_array_elements(p->'commits') LOOP
    c:=jsonb_set(c,'{p_report,riders}',(SELECT jsonb_agg(r||jsonb_build_object('recovery_proposal_sha256',proposal_hash)) FROM jsonb_array_elements(c->'p_report'->'riders')r));
    result:=public.commit_training_date_tick((c->>'p_team_id')::uuid,(c->>'p_season_id')::uuid,c->>'p_squad',(c->>'p_game_day')::integer,(c->>'p_tick_date')::date,
      ARRAY(SELECT jsonb_array_elements_text(c->'p_date_game_days'))::integer[],c->>'p_executed_by',c->'p_report',c->'p_abilities',c->'p_conditions',c->'p_history',c->'p_race_history',c->'p_scores',c->'p_race_loads',false,execution_time);
    IF result->>'already_ran'='true' OR jsonb_array_length(result->'applied_rider_ids')<>jsonb_array_length(c->'p_report'->'riders') THEN RAISE EXCEPTION 'Recovery commit rejected rider scope';END IF;
  END LOOP;
  DELETE FROM training_condition_timeout_outbox o USING training_date_work w WHERE o.team_id=w.team_id AND o.season_id=w.season_id AND o.tick_date=w.tick_date AND w.team_id=ANY(team_ids) AND w.season_id=season_key AND w.tick_date=date_key AND w.status='complete';
  ${peerGuard}
  b:=jsonb_set(b,'{rider_derived_abilities}',p->'after_abilities');
  ${compare('rider_derived_abilities')}
  FOR item IN SELECT value FROM jsonb_array_elements(p->'after_work') LOOP
    IF NOT EXISTS(SELECT 1 FROM training_date_work x WHERE x.team_id=(item->>'team_id')::uuid AND x.season_id=season_key AND x.tick_date=date_key AND (to_jsonb(x)-'updated_at')=(item-'updated_at') AND x.updated_at=(item->>'updated_at')::timestamptz) THEN RAISE EXCEPTION 'Recovery final work differs from approved result';END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(p->'riders') LOOP
    IF NOT EXISTS(SELECT 1 FROM rider_condition x WHERE x.rider_id=(item->>'rider_id')::uuid AND (to_jsonb(x)-'updated_at')=((item->'condition_after')-'updated_at') AND x.updated_at=(item->'condition_after'->>'updated_at')::timestamptz) THEN RAISE EXCEPTION 'Recovery final condition differs from approved result';END IF;
  END LOOP;
  IF (SELECT count(*) FROM training_rider_ticks WHERE rider_id=ANY(ids) AND season_id=season_key AND tick_date=date_key AND report->>'recovery_proposal_sha256'=proposal_hash)<>cardinality(ids)*5
    OR (SELECT count(*) FROM training_condition_settlements WHERE rider_id=ANY(ids) AND season_id=season_key AND tick_date=date_key AND status='complete')<>cardinality(ids)
    THEN RAISE EXCEPTION 'Recovery incomplete';END IF;
END;`);
  return block(start+noLater+peerGuard+`
  IF (SELECT count(*) FROM training_rider_ticks WHERE rider_id=ANY(ids) AND season_id=season_key AND tick_date=date_key AND report->>'recovery_proposal_sha256'=proposal_hash)<>cardinality(ids)*5 THEN RAISE EXCEPTION 'Rollback receipt ownership missing';END IF;
  b:=jsonb_set(b,'{rider_derived_abilities}',p->'after_abilities');
  ${compare('riders')}${compare('rider_derived_abilities')}
  FOR item IN SELECT value FROM jsonb_array_elements(p->'after_work') LOOP
    IF NOT EXISTS(SELECT 1 FROM training_date_work x WHERE x.team_id=(item->>'team_id')::uuid AND x.season_id=season_key AND x.tick_date=date_key AND (to_jsonb(x)-'updated_at')=(item-'updated_at') AND x.updated_at=(item->>'updated_at')::timestamptz) THEN RAISE EXCEPTION 'Rollback work state changed';END IF;
  END LOOP;
  IF (SELECT count(*) FROM training_condition_timeout_outbox WHERE team_id=ANY(team_ids) AND season_id=season_key AND tick_date=date_key)<>jsonb_array_length(p->'after_outbox') THEN RAISE EXCEPTION 'Rollback outbox set changed';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p->'after_outbox') LOOP
    IF NOT EXISTS(SELECT 1 FROM training_condition_timeout_outbox x WHERE x.id=(item->>'id')::uuid AND (to_jsonb(x)-'updated_at')=(item-'updated_at') AND x.updated_at=(item->>'updated_at')::timestamptz) THEN RAISE EXCEPTION 'Rollback outbox changed';END IF;
  END LOOP;
  FOR c IN SELECT value FROM jsonb_array_elements(p->'commits') LOOP
    IF NOT EXISTS(SELECT 1 FROM training_day_runs x WHERE x.team_id=(c->>'p_team_id')::uuid AND x.season_id=season_key AND x.game_day=(c->>'p_game_day')::integer AND (x.report-'riders')=(((c->'p_report')-'riders')||jsonb_build_object('complete',true,'partial',false,'condition_settled',(c->>'p_game_day')::integer=9)) AND x.report->'riders'=COALESCE((SELECT jsonb_agg(t.report ORDER BY t.rider_id) FROM training_rider_ticks t WHERE t.team_id=x.team_id AND t.season_id=x.season_id AND t.game_day=x.game_day),'[]')) THEN RAISE EXCEPTION 'Rollback canonical report changed';END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(c->'p_report'->'riders') LOOP
      IF NOT EXISTS(SELECT 1 FROM training_rider_ticks x WHERE x.rider_id=(item->>'rider_id')::uuid AND x.season_id=season_key AND x.game_day=(c->>'p_game_day')::integer AND x.report=item||jsonb_build_object('recovery_proposal_sha256',proposal_hash)) THEN RAISE EXCEPTION 'Rollback receipt content changed';END IF;
    END LOOP;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(p->'riders') LOOP
    IF NOT EXISTS(SELECT 1 FROM rider_condition x WHERE x.rider_id=(item->>'rider_id')::uuid AND (to_jsonb(x)-'updated_at')=((item->'condition_after')-'updated_at')
      AND x.updated_at=(item->'condition_after'->>'updated_at')::timestamptz) THEN RAISE EXCEPTION 'Rollback condition changed';END IF;
  END LOOP;
  IF (SELECT count(*) FROM rider_training_scores WHERE rider_id=ANY(ids) AND season_id=season_key AND game_day=ANY(ARRAY[5,6,7,8,9]))<>(SELECT COALESCE(sum(jsonb_array_length(value->'p_scores')),0) FROM jsonb_array_elements(p->'commits'))
    OR (SELECT count(*) FROM rider_ability_race_day_history WHERE rider_id=ANY(ids) AND season_id=season_key AND game_day=ANY(ARRAY[5,6,7,8,9]))<>(SELECT COALESCE(sum(jsonb_array_length(value->'p_race_history')),0) FROM jsonb_array_elements(p->'commits'))
    OR (SELECT count(*) FROM rider_derived_ability_history WHERE rider_id=ANY(ids) AND snapshot_date=date_key AND source='daily_training')<>(SELECT COALESCE(sum(jsonb_array_length(value->'p_history')),0) FROM jsonb_array_elements(p->'commits')) THEN RAISE EXCEPTION 'Rollback history or score set changed';END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(p->'commits') LOOP
    FOR item IN SELECT value FROM jsonb_array_elements(c->'p_scores') LOOP
      IF NOT EXISTS(SELECT 1 FROM rider_training_scores x WHERE to_jsonb(x) @> item) THEN RAISE EXCEPTION 'Rollback score content changed';END IF;
    END LOOP;
    FOR item IN SELECT value FROM jsonb_array_elements(c->'p_history') LOOP
      IF NOT EXISTS(SELECT 1 FROM rider_derived_ability_history x WHERE to_jsonb(x) @> item) THEN RAISE EXCEPTION 'Rollback history content changed';END IF;
    END LOOP;
    FOR item IN SELECT value FROM jsonb_array_elements(c->'p_race_history') LOOP
      IF NOT EXISTS(SELECT 1 FROM rider_ability_race_day_history x WHERE to_jsonb(x) @> item) THEN RAISE EXCEPTION 'Rollback race history content changed';END IF;
    END LOOP;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(${literal(before.rider_derived_abilities)}) LOOP
    SELECT string_agg(format('%I=incoming.%I',key,key),',') INTO assignments FROM jsonb_object_keys(item)key WHERE key<>'rider_id';
    EXECUTE format('UPDATE rider_derived_abilities x SET %s FROM jsonb_populate_record(NULL::public.rider_derived_abilities,$1)incoming WHERE x.rider_id=$2',assignments) USING item,(item->>'rider_id')::uuid;
    GET DIAGNOSTICS affected=ROW_COUNT;IF affected<>1 THEN RAISE EXCEPTION 'Rollback ability row missing';END IF;
  END LOOP;
  DELETE FROM rider_training_scores WHERE rider_id=ANY(ids) AND season_id=season_key AND game_day=ANY(ARRAY[5,6,7,8,9]);
  DELETE FROM rider_ability_race_day_history WHERE rider_id=ANY(ids) AND season_id=season_key AND game_day=ANY(ARRAY[5,6,7,8,9]);
  DELETE FROM rider_derived_ability_history WHERE rider_id=ANY(ids) AND snapshot_date=date_key AND source='daily_training' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p->'commits')AS rollback_commit(value) CROSS JOIN LATERAL jsonb_array_elements(rollback_commit.value->'p_history')AS rollback_history(value) WHERE (rollback_history.value->>'rider_id')::uuid=rider_derived_ability_history.rider_id AND rollback_history.value->>'source'=rider_derived_ability_history.source AND (rollback_history.value->>'snapshot_date')::date=rider_derived_ability_history.snapshot_date);
  DELETE FROM training_condition_settlements WHERE rider_id=ANY(ids) AND season_id=season_key AND tick_date=date_key;
  DELETE FROM training_rider_ticks WHERE rider_id=ANY(ids) AND season_id=season_key AND tick_date=date_key AND report->>'recovery_proposal_sha256'=proposal_hash;
  DELETE FROM rider_condition WHERE rider_id=ANY(ids);
  FOR item IN SELECT value FROM jsonb_array_elements(b->'training_date_work') LOOP
    UPDATE training_date_work SET opening_conditions=opening_conditions-ids::text[],
      quarantined_rider_ids=ARRAY(SELECT jsonb_array_elements_text(item->'quarantined_rider_ids'))::uuid[],
      quarantine_evidence=item->'quarantine_evidence',missing_evidence=item->'missing_evidence',status=item->>'status',updated_at=(item->>'updated_at')::timestamptz
      WHERE team_id=(item->>'team_id')::uuid AND season_id=season_key AND tick_date=date_key;
  END LOOP;
  DELETE FROM training_day_runs x WHERE x.team_id=ANY(team_ids) AND x.season_id=season_key AND x.tick_date=date_key AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b->'training_day_runs')r WHERE (r->>'team_id')::uuid=x.team_id AND (r->>'game_day')::integer=x.game_day);
  FOR item IN SELECT value FROM jsonb_array_elements(b->'training_day_runs') LOOP
    UPDATE training_day_runs x SET report=(item->'report_header')||jsonb_build_object('riders',COALESCE((SELECT jsonb_agg(t.report ORDER BY t.rider_id) FROM training_rider_ticks t WHERE t.team_id=x.team_id AND t.season_id=x.season_id AND t.game_day=x.game_day),'[]')) WHERE x.team_id=(item->>'team_id')::uuid AND x.season_id=season_key AND x.game_day=(item->>'game_day')::integer;
  END LOOP;
  DELETE FROM training_condition_timeout_outbox WHERE team_id=ANY(team_ids) AND season_id=season_key AND tick_date=date_key;
  INSERT INTO training_condition_timeout_outbox SELECT * FROM jsonb_populate_recordset(NULL::public.training_condition_timeout_outbox,b->'training_condition_timeout_outbox');
  b:=jsonb_set(b,'{rider_derived_abilities}',${literal(before.rider_derived_abilities)});
  ${compare('rider_derived_abilities')}${compare('training_date_work')}${compare('training_day_runs')}${compare('training_condition_timeout_outbox')}
END;`);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  check(process.argv.length===9,'Usage: node apply.mjs SNAPSHOT PROPOSAL APPROVED_HASH EXPLICIT_NOW MODE PRIVATE_SQL_OUTPUT EXECUTION_BEFORE_IMAGES');
  const snapshot=JSON.parse(await readFile(process.argv[2],'utf8')),proposal=JSON.parse(await readFile(process.argv[3],'utf8'));
  const executionState=JSON.parse(await readFile(process.argv[8],'utf8'));
  const sql=buildRecoverySql({snapshot,proposal,approvedHash:process.argv[4],now:process.argv[5],mode:process.argv[6],executionState});
  await writeFile(process.argv[7],sql,{flag:'wx'});console.log(JSON.stringify({compiled:true,mode:process.argv[6],bytes:Buffer.byteLength(sql)}));
}
