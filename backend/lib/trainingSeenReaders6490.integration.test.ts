import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildApplyPayload } from '../scripts/dev/compensation6061Source.mjs';
import { createTrainingSeenReadersFixture,readManual,READER_SIGNATURES } from './testFixtures/trainingSeenReaders6490.ts';
import type { PGlite } from '@electric-sql/pglite';

const RID='aaaaaaaa-0000-0000-0000-000000000001', TEAM='00000000-0000-0000-0000-000000000002';
const OTHER='00000000-0000-0000-0000-000000000004', SEASON='00000000-0000-0000-0000-000000000003';
const NOW='2026-10-11T12:00:00Z', DATE='2026-10-11', THROUGH='2026-10-10';
async function seed(db:PGlite,historyKey?:string) {
  await db.exec(`INSERT INTO teams(id) VALUES('${TEAM}'),('${OTHER}');
    INSERT INTO riders(id,team_id,is_retired,created_at) VALUES('${RID}','${TEAM}',false,'${NOW}');
    INSERT INTO rider_derived_abilities VALUES('${RID}',50,'{"climbing":0.2}');
    INSERT INTO seasons(id,number,status) VALUES('${SEASON}',4,'active');
    INSERT INTO app_config(key,value) VALUES('training_condition_per_date','"on"'),('training_tick_per_race_day','"on"');`);
  if(historyKey)await db.query('INSERT INTO training_day_runs(report) VALUES($1)',[JSON.stringify({riders:[{rider_id:historyKey}]})]);
}
async function snapshot(db:PGlite) {
  const result={};
  for(const table of ['rider_condition','rider_derived_abilities','training_date_work','training_compensation_receipts']) {
    result[table]=(await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return result;
}
async function register(db:PGlite) {
  return (await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6) AS work',
    [TEAM,SEASON,DATE,[0,1,2,3,4],[RID],NOW])).rows[0].work;
}
async function compensate(db:PGlite,key=RID) {
  const scope={rider_ids:[RID],team_ids:[TEAM],season_ids:[SEASON]};
  const sourceHashes=(await db.query('SELECT training_compensation_6061_source_hashes($1,$2,$3,$4) AS h',
    [scope.rider_ids,scope.team_ids,scope.season_ids,THROUGH])).rows[0].h;
  const abilities=(await db.query('SELECT to_jsonb(a) AS row FROM rider_derived_abilities a')).rows[0].row;
  const result={policy:'current_plans_current_engine',through:THROUGH,source_hash:'f'.repeat(64),plans:[{
    rider_id:key,team_id:TEAM,season_id:SEASON,current_condition:null,expected_abilities:abilities,
    patch:{climbing:51,ability_progress:{climbing:0.3}},days:[{gameDay:0,tickDate:THROUGH,key:`6061:${SEASON}:0:${key}`,kind:'free_slot'}],
    perDay:[{key:`6061:${SEASON}:0:${key}`,progress:0.1,gains:{}}],
  }]};
  const payload=JSON.stringify(buildApplyPayload(result,{scope,sourceHashes}));
  const hash=createHash('sha256').update(payload).digest('hex');
  return (await db.query('SELECT apply_training_compensation_6061($1,$2,$3) AS result',[payload,hash,NOW])).rows[0].result;
}

test('switched registration, first-use trigger and compensation no longer need report SELECT', async t=>{
  for(const operation of ['register','first-use','compensate']) {
    const db=await createTrainingSeenReadersFixture(); t.after(()=>db.close());
    await seed(db); await db.exec(await readManual('readers'));
    await db.exec('REVOKE SELECT ON training_day_runs FROM service_role; SET ROLE service_role');
    if(operation==='register')assert.ok((await register(db)).opening_conditions[RID]);
    if(operation==='first-use') {
      await db.query('UPDATE riders SET team_id=$1 WHERE id=$2',[OTHER,RID]);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n,1);
    }
    if(operation==='compensate')assert.equal((await compensate(db)).rider_days,1);
  }
});

test('real readers preserve return values, errors and writes including raw compensation text', async ()=>{
  for(const [operation,history,input] of [
    ['register',null,RID],['register',RID,RID],['first-use',RID,RID],['compensate',null,RID],
    ['compensate',RID,RID],['compensate',RID,RID.toUpperCase()],['compensate',RID,'not-a-uuid'],
  ]) {
    const outcomes=[];
    for(const switched of [false,true]) {
      const db=await createTrainingSeenReadersFixture();
      try {
        await seed(db,history??undefined); if(switched)await db.exec(await readManual('readers'));
        let result;
        try {
          if(operation==='register')result=await register(db);
          else if(operation==='first-use')result=(await db.query('UPDATE riders SET team_id=$1 WHERE id=$2 RETURNING id',[OTHER,RID])).rows;
          else result=await compensate(db,input);
        } catch(error) { result={code:error.code,message:error.message}; }
        outcomes.push({result,state:await snapshot(db)});
      } finally { await db.close(); }
    }
    assert.deepEqual(outcomes[1],outcomes[0],JSON.stringify({operation,history,input}));
  }
});

test('cutover is fail-closed, idempotent and rollback restores exact definitions and grants', async t=>{
  const db=await createTrainingSeenReadersFixture(); t.after(()=>db.close()); await seed(db);
  const definitions=async()=> (await db.query(`SELECT oid::regprocedure::text AS signature,
    replace(pg_get_functiondef(oid),chr(13),'') AS definition,proacl::text AS acl FROM pg_proc
    WHERE oid=ANY($1::regprocedure[]) ORDER BY signature`,[READER_SIGNATURES])).rows;
  const before=await definitions();
  await db.exec('ALTER TABLE training_day_runs DISABLE TRIGGER training_seen_update');
  await assert.rejects(db.exec(await readManual('readers')),/training_seen.*contract/);
  await db.exec('ROLLBACK; ALTER TABLE training_day_runs ENABLE TRIGGER training_seen_update');
  assert.deepEqual(await definitions(),before);
  await db.exec(await readManual('readers')); await db.exec(await readManual('readers'));
  assert.notDeepEqual(await definitions(),before);
  await register(db);
  await db.exec(await readManual('readers-rollback')); await db.exec(await readManual('readers-rollback'));
  assert.deepEqual(await definitions(),before);
});

test('reader switch and rollback preserve definitions with LF and CRLF script bytes',async t=>{
  for(const eol of ['\n','\r\n']){
    const db=await createTrainingSeenReadersFixture();t.after(()=>db.close());
    const definitions=async()=> (await db.query(`SELECT replace(pg_get_functiondef(oid),chr(13),'') AS body,proacl::text AS acl
      FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid::regprocedure::text`,[READER_SIGNATURES])).rows;
    const before=await definitions();
    for(const script of ['readers','readers','readers-rollback','readers-rollback']){
      await db.exec((await readManual(script)).replace(/\r?\n/g,eol));
    }
    assert.deepEqual(await definitions(),before);
  }
});
