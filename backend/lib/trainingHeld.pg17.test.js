import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
const port = process.env.TRAINING_HELD_PG_PORT;
const bin = process.env.TRAINING_HELD_PG_BIN;

test('#6839 PG17: baseline waits; manager returns held; sweep still waits and commits once', {skip: !port || !bin}, async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'training-held-'));
  const exe = join(bin, 'psql.exe');
  const args = ['-X','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-tA'];
  let seq=0;
  const sql = async text => {
    const path=join(scratch, `${seq++}.sql`); await writeFile(path,text);
    return (await promisify(execFile)(exe,[...args,'-f',path],{windowsHide:true})).stdout.trim();
  };
  const file = name => readFile(new URL(`../../database/${name}`,import.meta.url),'utf8');
  assert.match(await sql('SELECT version()'), /PostgreSQL 17\./);
  await sql(await readFile(new URL('./__fixtures__/trainingHeldSchema.sql',import.meta.url),'utf8'));
  for(const name of ['2026-09-29-5928-training-condition-date.sql','2026-09-29-5928-training-condition-partial.sql','2026-09-29-5928-training-condition-recovery.sql','2026-09-29-5928-training-condition-initialization.sql']) await sql(await file(name));
  await sql('ALTER TABLE race_results ADD COLUMN rider_id uuid');
  await sql(await file('2026-09-30-5860-shared-race-day-recovery.sql'));
  await sql(await file('2026-10-10-6439-training-follows-rider.sql'));
  const team='00000000-0000-0000-0000-000000000001', rider='00000000-0000-0000-0000-000000000002', season='00000000-0000-0000-0000-000000000003';
  const register=`('${team}','${season}','2026-09-29',ARRAY[1,2,3,4,5],ARRAY['${rider}']::uuid[],NULL,'2026-09-29T19:00:00Z')`;
  await sql(`INSERT INTO riders VALUES('${rider}','${team}'); INSERT INTO rider_derived_abilities VALUES('${rider}',50,'{}'); INSERT INTO rider_condition(rider_id,form,fatigue) VALUES('${rider}',50,60); SELECT register_training_date_work${register};`);
  const before=await sql("SELECT md5(string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid),'' ORDER BY p.oid)) FROM pg_proc p WHERE proname IN ('register_training_date_work','commit_training_date_tick')");
  let holder;
  const hold=async()=>{
    holder=spawn(exe,args,{windowsHide:true});
    const ready=new Promise((resolve,reject)=>{let out='';holder.stdout.on('data',c=>{out+=c;if(out.includes('HELD'))resolve();});holder.once('error',reject);holder.stderr.on('data',c=>reject(new Error(String(c))));});
    holder.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('training-date:${team}',0));\n\\echo HELD\n`);
    await ready;
  };
  const release=async()=>{const closed=once(holder,'exit');holder.stdin.end('COMMIT;\n\\q\n');await closed;holder=null;};
  try {
    await hold();
    await assert.rejects(sql(`SET statement_timeout='200ms'; SELECT register_training_date_work${register};`),/statement timeout/);
    t.diagnostic('Baseline: current registration waits on held team lock (statement timeout).');
    await release();
    const migration=await file('2026-10-19-6827-training-date-try-lock.sql');
    await sql(migration); await sql(migration);
    assert.equal(await sql("SELECT md5(string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid),'' ORDER BY p.oid)) FROM pg_proc p WHERE proname IN ('register_training_date_work','commit_training_date_tick')"),before,'sweep functions unchanged');
    const work=JSON.parse(await sql(`SELECT register_training_date_work${register}`));
    const opening=work.opening_conditions[rider];
    const report={condition_per_date:true,riders:[{rider_id:rider,game_day:1,condition_before_date:opening,condition_observed:opening,missing_evidence:[]}]};
    const commit=`('${team}','${season}','senior',1,'2026-09-29',ARRAY[1,2,3,4,5],'manager','${JSON.stringify(report)}','[]','[]','[]','[]','[]','[]',false,'2026-09-29T19:00:00Z')`;
    await hold();
    for(const query of [`try_register_training_date_work${register}`,`try_commit_training_date_tick${commit}`]) {
      assert.deepEqual(JSON.parse((await sql(`SET statement_timeout='2s'; SELECT ${query}`)).split('\n').at(-1)),{held:true});
    }
    assert.equal(await sql('SELECT count(*) FROM training_rider_ticks'),'0');
    await assert.rejects(sql(`SET statement_timeout='200ms'; SELECT commit_training_date_tick${commit}`),/statement timeout/);
    await release();
    assert.equal(JSON.parse(await sql(`SELECT try_commit_training_date_tick${commit}`)).already_ran,false);
    assert.equal(JSON.parse(await sql(`SELECT commit_training_date_tick${commit}`)).already_ran,true);
    assert.equal(await sql('SELECT count(*) FROM training_rider_ticks'),'1');
    for(const role of ['anon','authenticated']) await assert.rejects(sql(`SET ROLE ${role}; SELECT try_register_training_date_work${register}`),/permission denied/);
    t.diagnostic('PASS: held registration/commit, no writes, normal commit, idempotent sweep, unchanged sweep RPCs, denied public roles, migration twice.');
  } finally {if(holder) await release();}
});
