import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

const bin = process.env.TRAIN_NOW_BONUS_PG_BIN;
const scratch = process.env.TRAIN_NOW_BONUS_PG_SCRATCH;
const port = process.env.TRAIN_NOW_BONUS_PG_PORT ?? '57837';
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const TEAM=id(1), SEASON=id(900), A=id(11), DATE='2026-11-09', AT='2026-11-09T06:00:00Z';
const DAYS=[41,42,43,44,45];
const lit = value => `'${JSON.stringify(value).replace(/'/g,"''")}'::jsonb`;

test('native PG17 serializes first choice and existing receipt CAS', {
  skip: !bin || !scratch, timeout: 120000,
}, async t => {
  const directory = await mkdtemp(join(resolve(scratch), 'bonus-pg17-'));
  const data = join(directory,'data');
  const exe = name => join(bin,`${name}.exe`);
  const run = (name,args,input?) => execFileSync(exe(name),args,{input,encoding:'utf8',windowsHide:true,timeout:30000});
  const args=['-X','-q','-tA','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'];
  const sql = source => run('psql',args,source).trim();
  const asyncSql = source => new Promise<{out:string;error:string}>((done,reject) => {
    const child=spawn(exe('psql'),args,{windowsHide:true}); let out='',error='';
    child.stdout.on('data',chunk=>{out+=chunk;}); child.stderr.on('data',chunk=>{error+=chunk;});
    child.once('error',reject); child.once('close',code=>done({out:out.trim(),error:code ? error : ''}));
    child.stdin.end(source);
  });
  const file = name => readFile(new URL(`../../database/${name}`,import.meta.url),'utf8');
  let started=false, startAttempted=false;
  const children=[];
  try {
    assert.match(run('psql',['--version']),/17\./);
    run('initdb',['-D',data,'-U','postgres','-A','trust','-E','UTF8','--locale=C']);
    startAttempted=true;
    const start=spawnSync(exe('pg_ctl'),['-D',data,'-o',`-p ${port} -c listen_addresses=127.0.0.1 -c max_connections=20`,'-w','-l',join(directory,'pg.log'),'start'],{windowsHide:true,stdio:'ignore',timeout:30000});
    assert.equal(start.status,0); started=true;
    sql(await readFile(new URL('./__fixtures__/trainingHeldSchema.sql',import.meta.url),'utf8'));
    for(const name of ['2026-09-29-5928-training-condition-date.sql','2026-09-29-5928-training-condition-partial.sql','2026-09-29-5928-training-condition-recovery.sql','2026-09-29-5928-training-condition-initialization.sql']) sql(await file(name));
    sql('ALTER TABLE race_results ADD COLUMN rider_id uuid; ALTER TABLE training_day_runs ADD COLUMN id uuid DEFAULT gen_random_uuid(); ALTER TABLE app_config ADD COLUMN description text');
    for(const name of ['2026-09-30-5860-shared-race-day-recovery.sql','2026-10-10-6439-training-follows-rider.sql','2026-10-01-traen-nu-locks.sql']) sql(await file(name));
    sql('CREATE TABLE race_entries(race_id uuid,rider_id uuid,team_id uuid,race_role text,PRIMARY KEY(race_id,rider_id))');
    for(const name of ['2026-10-25-6461-train-now-whole-day.sql','2026-11-09-7737-train-now-instant.sql','2026-11-10-7737-train-now-bonus.sql','2026-11-10-7737-train-now-bonus.sql']) sql(await file(name));
    sql(`INSERT INTO riders VALUES('${A}','${TEAM}'); INSERT INTO rider_derived_abilities VALUES('${A}',50,'{}');
      INSERT INTO rider_condition(rider_id,form,fatigue,updated_at) VALUES('${A}',50,32,'2026-11-08T20:00:00Z');
      INSERT INTO app_config(key,value) VALUES('training_condition_per_date','"on"'),('training_train_now_instant','"on"'),('training_train_now_bonus','"on"') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;`);
    const work=JSON.parse(sql(`SELECT register_training_date_work('${TEAM}','${SEASON}','${DATE}','{${DAYS}}','{${A}}',NULL,'${AT}')`));
    const lock=bonus=>`INSERT INTO training_train_now_locks(rider_id,tick_date,season_id,team_id,pressed_at,train_now_bonus) VALUES('${A}','${DATE}','${SEASON}','${TEAM}','${AT}',${bonus}) ON CONFLICT(rider_id,tick_date) DO NOTHING;`;
    const publish=`SELECT publish_train_now_bonus_press('${TEAM}','${SEASON}','${DATE}','{${A}}','{${A}}','${AT}');`;
    await t.test('publication waits on the team lock before touching the lock row',async()=>{
      const holder=spawn(exe('psql'),args,{windowsHide:true}); children.push(holder);
      const held=new Promise<void>((done,reject)=>{ let out=''; holder.stdout.on('data',chunk=>{out+=chunk;if(out.includes('HELD'))done();});holder.once('error',reject); });
      holder.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('training-date:${TEAM}',0));\n\\echo HELD\n`);
      await held;
      const blocked=await asyncSql(`SET lock_timeout='150ms'; ${publish}`);
      assert.match(blocked.error,/lock timeout/);
      assert.equal(sql('SELECT count(*) FROM training_train_now_locks'),'0');
      const stopped=once(holder,'close');holder.stdin.end('COMMIT;\n\\q\n');await stopped;
      assert.equal(holder.exitCode,0);
    });
    await t.test('concurrent first presses publish one immutable row',async()=>{
      const attempts=await Promise.all(Array.from({length:6},()=>asyncSql(publish)));
      assert.ok(attempts.every(result=>!result.error),JSON.stringify(attempts));
      assert.equal(sql('SELECT count(*) FROM training_train_now_locks'),'1');
      const choice=sql('SELECT train_now_bonus FROM training_train_now_locks');
      sql(lock(choice!=='t'));
      assert.equal(sql('SELECT train_now_bonus FROM training_train_now_locks'),choice);
    });
    // New synthetic rider/date publication for the deterministic positive-choice CAS proof.
    sql('TRUNCATE training_train_now_locks');
    await t.test('internal freeze failure rolls back the initial lock and choice',async()=>{
      sql("CREATE FUNCTION test_reject_bonus_freeze() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic freeze failure'; END $$; CREATE TRIGGER test_reject_bonus_freeze BEFORE UPDATE OF instant_entry_snapshot ON training_train_now_locks FOR EACH ROW EXECUTE FUNCTION test_reject_bonus_freeze();");
      const result=await asyncSql(publish);
      assert.match(result.error,/synthetic freeze failure/);
      assert.equal(sql('SELECT count(*) FROM training_train_now_locks'),'0');
      sql('DROP TRIGGER test_reject_bonus_freeze ON training_train_now_locks; DROP FUNCTION test_reject_bonus_freeze();');
    });
    sql(publish);
    assert.equal(sql('SELECT instant_at IS NOT NULL FROM training_train_now_locks'),'t');
    const commit=(day,expected,patch)=>{
      const report={condition_per_date:true,riders:[{rider_id:A,intensity:'normal',train_now_bonus:true,expected_date_receipt_days:expected,condition_before_date:work.opening_conditions[A],condition_observed:work.opening_conditions[A],missing_evidence:[]}]};
      return `SELECT commit_training_date_tick('${TEAM}','${SEASON}','senior',${day},'${DATE}','{${DAYS}}','assistant',${lit(report)},${lit([{riderId:A,patch:{ability_progress:{climbing:patch}}}])},'[]','[]','[]','[]','[]',false,'${AT}');`;
    };
    await t.test('different-slot concurrency rejects stale abilities; same-slot retries are no-ops',async()=>{
      sql("UPDATE app_config SET value='\"off\"' WHERE key IN('training_train_now_bonus','training_train_now_instant')");
      const results=await Promise.all([asyncSql(commit(41,[],0.25)),asyncSql(commit(42,[],0.5))]);
      assert.equal(results.filter(result=>!result.error).length,1);
      assert.match(results.find(result=>result.error).error,/receipt snapshot changed/);
      const first=Number(sql('SELECT game_day FROM training_rider_ticks'));
      const second=first===41?42:41;
      sql(commit(second,[first],0.75));
      const dup=await Promise.all([asyncSql(commit(second,[first],0.99)),asyncSql(commit(second,[first],0.99))]);
      assert.ok(dup.every(result=>!result.error));
      assert.equal(sql('SELECT count(*) FROM training_rider_ticks'),'2');
      assert.equal(sql("SELECT ability_progress->>'climbing' FROM rider_derived_abilities"),'0.75');
    });
  } finally {
    try {
      for(const child of children) if(child.exitCode===null) { const closed=once(child,'close');child.stdin.end('ROLLBACK;\n\\q\n');await closed; }
    } finally {
    if(startAttempted) {
      const stop=spawnSync(exe('pg_ctl'),['-D',data,'-m','fast','-w','stop'],{windowsHide:true,stdio:'ignore',timeout:30000});
      if(started) assert.equal(stop.status,0,'cluster stop observed');
      assert.equal(spawnSync(exe('pg_ctl'),['-D',data,'status'],{windowsHide:true,stdio:'ignore',timeout:30000}).status,3);
      const safePath=data.replace(/'/g,"''");
      const count=execFileSync('pwsh',['-NoProfile','-Command',`@(Get-CimInstance Win32_Process -Filter "name = 'postgres.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${safePath}') }).Count`],{encoding:'utf8',windowsHide:true}).trim();
      assert.equal(count,'0','no cluster process remains');
      t.diagnostic(`cluster_stopped=true status=3 process_count=0 artifacts=${directory}`);
    }
    }
  }
});
