// Native multi-session evidence in an empty, explicitly marked local PostgreSQL 17.
// No external URL, production fallback, DROP INDEX, or generic table cleanup.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { readManual, sourceFunction, READER_SIGNATURES } from '../../lib/testFixtures/trainingSeenReaders6490.ts';

export class PsqlSession {
  constructor(env,deps={}) {
    const childEnv={};
    for(const key of ['SystemRoot','windir','ComSpec','PATH','Path','PATHEXT','TEMP','TMP',
      'PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD'])if(env[key])childEnv[key]=env[key];
    Object.assign(childEnv,{PGCONNECT_TIMEOUT:'10',PGAPPNAME:'6490-native-fixture',PGSSLMODE:'disable'});
    this.child=(deps.spawn??spawn)(env.CZ_PSQL_BIN??'psql',['-X','-w','-qAt','-P','pager=off','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],
      {env:childEnv,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.sequence=0;this.buffer='';this.ended=false;
    this.done=new Promise(resolveDone=>{this.resolveDone=resolveDone;});
    this.child.stdout.on('data',data=>{
      this.buffer+=data.toString().replaceAll('\r','');
      if(this.buffer.length>4*1024*1024){this.child.kill();return;}
      if(this.pending&&this.buffer.endsWith(`${this.pending.marker}\n`)){
        const result=this.buffer.slice(0,-this.pending.marker.length-1).trim();this.buffer='';
        clearTimeout(this.pending.timer);this.pending.resolve(result);this.pending=null;
      }
    });
    this.child.stderr.on('data',data=>{const code=/ERROR:\s+([0-9A-Z]{5})\b/.exec(data.toString());if(code)this.sqlState=code[1];});
    const finish=()=>{this.ended=true;this.resolveDone();if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(Object.assign(new Error('SQL_FAILED'),{sqlState:this.sqlState}));this.pending=null;}};
    this.child.on('error',finish);this.child.on('close',finish);
    this.child.stdin.on('error',finish);
  }
  query(sql) {
    if(this.pending||this.ended)return Promise.reject(new Error('SESSION_UNAVAILABLE'));
    return new Promise((resolveQuery,reject)=>{
      const marker=`__6490_${++this.sequence}__`;
      this.pending={marker,resolve:resolveQuery,reject,timer:setTimeout(()=>this.child.kill(),30000)};
      this.child.stdin.write(`${sql};\n\\echo ${marker}\n`);
    });
  }
  async close(){if(!this.ended)this.child.kill();await this.done;}
}

export async function waitForBlock(observer,waiter,holder,{attempts=200,pause:delay=pause}={}) {
  if(![waiter,holder].every(n=>Number.isSafeInteger(n)&&n>0))throw new Error('INVALID_PID');
  for(let i=0;i<attempts;i++){
    if(await observer.query(`SELECT ${holder}=ANY(pg_blocking_pids(${waiter}))`)==='t')return;
    await delay(25);
  }
  throw new Error('BARRIER_NOT_OBSERVED');
}

function options(argv,env){
  const raw={};for(let i=0;i<argv.length;i+=2){
    if(!['--mode','--clock','--out'].includes(argv[i])||Object.hasOwn(raw,argv[i])||!argv[i+1])throw new Error('USAGE');
    raw[argv[i]]=argv[i+1];
  }
  if(!['concurrency','multi-statement'].includes(raw['--mode'])||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$/.test(raw['--clock']??'')
    ||!Number.isFinite(Date.parse(raw['--clock']))||!raw['--out'])throw new Error('USAGE');
  if(env.CZ_TARGET_ENV!=='local-disposable'||env.PGHOST!=='127.0.0.1'||env.PGPORT!=='56490'
    ||env.PGUSER!=='cz6490'||!/^cz_6490_[a-f0-9]{12}$/.test(env.PGDATABASE??'')||!env.PGPASSWORD)throw new Error('TARGET');
  return {mode:raw['--mode'],clock:raw['--clock'],out:raw['--out']};
}
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
const json=keys=>`${literal(JSON.stringify({riders:keys.map(rider_id=>({rider_id}))}))}::jsonb`;
const keyA='6490:a',keyB='6490:b';

export async function runVerification(argv,env=process.env,deps={}) {
  const sessions=[],cases=[],fixtureIds=[];let phase='config',control;
  const result={status:'BLOCKED',cases,targetRef:'local-disposable',parity:null};
  try {
    const config=options(argv,env);result.clock=config.clock;result.mode=config.mode;
    result.runnerHash=createHash('sha256').update((await readFile(new URL(import.meta.url),'utf8')).replaceAll('\r','')).digest('hex');
    const connect=()=>{const s=(deps.connect??(e=>new PsqlSession(e)))(env);sessions.push(s);return s;};
    phase='preflight';control=connect();
    const metadata=JSON.parse(await control.query(`SELECT json_build_object('version',current_setting('server_version_num'),
      'marker',current_setting('cz.fixture',true),'empty',NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n
      ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p','v','m','S')))`));
    if(!/^17\d{4}$/.test(metadata.version)||metadata.marker!=='6490'||!metadata.empty)throw new Error('FIXTURE_REQUIRED');
    result.version=metadata.version;
    phase='setup';
    let fixture=await readFile(new URL('../../lib/testFixtures/trainingSeenReaders6490.sql',import.meta.url),'utf8');
    fixture=fixture.replace('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;',()=>
      `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF; END $$;`);
    const sources=[fixture,await readFile(new URL('../../../database/2026-10-05-6061-compensation-ledger.sql',import.meta.url),'utf8')];
    for(const [file,name] of [
      ['2026-10-10-6439-training-follows-rider.sql','register_training_date_work'],
      ['2026-10-11-academy-sign-latency.sql','initialize_first_use_rider_condition'],
      ['2026-10-05-6129-compensation-slim-source.sql','training_compensation_6061_source_hashes'],
      ['2026-10-05-6129-compensation-slim-source.sql','apply_training_compensation_6061'],
    ])sources.push(await sourceFunction(file,name));
    for(const name of ['foundation','parity','backfill'])sources.push(await readManual(name));
    const laterScripts=await Promise.all(['readers','readers-rollback','restore','restore-check'].map(readManual));
    result.fixtureHash=createHash('sha256').update([...sources,...laterScripts].join('\n').replaceAll('\r','')).digest('hex');
    await control.query(sources.join('\n'));
    await control.query(`INSERT INTO app_config VALUES('cz_environment','"loadtest-staging"',${literal(config.clock)});
      REVOKE ALL ON FUNCTION ${READER_SIGNATURES.join(',')} FROM PUBLIC,anon,authenticated;
      GRANT EXECUTE ON FUNCTION ${READER_SIGNATURES.join(',')} TO service_role`);
    const a=connect(),b=connect(),observer=connect();
    for(const s of [control,a,b,observer])await s.query("SET statement_timeout='20s';SET lock_timeout='15s'");
    const pidA=Number(await a.query('SELECT pg_backend_pid()')),pidB=Number(await b.query('SELECT pg_backend_pid()'));
    const parity=async()=>{
      const p=JSON.parse(await control.query('SELECT row_to_json(p) FROM training_seen_parity() p'));
      if(!['unindexed','missing_keys','extra_keys','wrong_counts'].every(k=>p[k]===0))throw new Error('PARITY_FAILED');
      await control.query('SELECT training_seen_assert_ready()');result.parity=p;
    };
    const fresh=()=>{const id=randomUUID();fixtureIds.push(id);return id;};
    const insert=(id,keys)=>`INSERT INTO training_day_runs(id,team_id,report) VALUES(${literal(id)},'00000000-0000-0000-0000-000000000001',${json(keys)})`;
    const old=async(keys)=>{const id=fresh();await control.query(`BEGIN;SET LOCAL session_replication_role=replica;${insert(id,keys)};COMMIT`);return id;};
    const exercise=async(name,fn)=>{phase=name;await fn();await parity();cases.push({name,status:'PASS'});};

    await exercise('locked_old_row_skip_and_update',async()=>{
      const id=await old([keyA]);await a.query(`BEGIN;SELECT id FROM training_day_runs WHERE id=${literal(id)} FOR UPDATE`);
      const batch=JSON.parse(await b.query('SELECT row_to_json(b) FROM training_seen_backfill_batch(1) b'));
      if(batch.processed!==0||batch.remaining!==1)throw new Error('SKIP_LOCKED_FAILED');
      await a.query(`UPDATE training_day_runs SET report=${json([keyB])} WHERE id=${literal(id)};COMMIT`);
    });
    await exercise('update_waits_for_backfill_and_preserves_both_deltas',async()=>{
      const id=await old([keyA]);await a.query('BEGIN;SELECT training_seen_backfill_batch(1)');
      const updating=b.query(`UPDATE training_day_runs SET report=${json([keyB])} WHERE id=${literal(id)}`);
      updating.catch(()=>{});await waitForBlock(observer,pidB,pidA);await a.query('COMMIT');await updating;
    });
    await exercise('delete_before_and_after_counting',async()=>{
      const before=await old([keyA]);await a.query(`DELETE FROM training_day_runs WHERE id=${literal(before)}`);
      const after=await old([keyB]);await a.query('BEGIN;SELECT training_seen_backfill_batch(1)');
      const deleting=b.query(`DELETE FROM training_day_runs WHERE id=${literal(after)}`);
      deleting.catch(()=>{});await waitForBlock(observer,pidB,pidA);await a.query('COMMIT');await deleting;
    });
    await exercise('two_teams_reverse_key_order',async()=>{
      await a.query(`BEGIN;SET LOCAL ROLE service_role;${insert(fresh(),[keyA,keyB])}`);
      const writing=b.query(insert(fresh(),[keyB,keyA]).replace("'00000000-0000-0000-0000-000000000001'","'00000000-0000-0000-0000-000000000002'"));
      writing.catch(()=>{});await waitForBlock(observer,pidB,pidA);await a.query('COMMIT');await writing;
    });
    await exercise('mixed_upsert_and_rollback',async()=>{
      const id=fresh();await a.query(insert(id,[keyA]));
      await a.query(`INSERT INTO training_day_runs(id,report) VALUES(${literal(id)},${json([keyB])}),(${literal(fresh())},${json([keyA])})
        ON CONFLICT(id) DO UPDATE SET report=excluded.report`);
      const before=await control.query('SELECT json_agg(s ORDER BY rider_key) FROM rider_training_seen s');
      await a.query(`BEGIN;${insert(fresh(),[keyA,keyB])};ROLLBACK`);
      if(before!==await control.query('SELECT json_agg(s ORDER BY rider_key) FROM rider_training_seen s'))throw new Error('ROLLBACK_FAILED');
    });
    const mixedUpsertCase=async()=>{
      const first=fresh(),second=fresh();await control.query(`${insert(first,[])};${insert(second,[])}`);
      // Hold both sessions after their UPDATE transition trigger but before INSERT.
      // Shared locks let both proceed together when the exclusive test barrier releases.
      await control.query(`CREATE FUNCTION fixture_pause_after_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_advisory_xact_lock_shared(6490,1);RETURN NULL;END $$;
        CREATE TRIGGER zz_fixture_pause AFTER UPDATE ON training_day_runs FOR EACH STATEMENT EXECUTE FUNCTION fixture_pause_after_update();
        BEGIN;SELECT pg_advisory_xact_lock(6490,1)`);
      const controllerPid=Number(await control.query('SELECT pg_backend_pid()'));
      const upsert=(id,existing,added)=>`INSERT INTO training_day_runs(id,report)
        VALUES(${literal(id)},${json([existing])}),(${literal(fresh())},${json([added])})
        ON CONFLICT(id) DO UPDATE SET report=excluded.report`;
      const firstWrite=a.query(upsert(first,keyA,keyB)),secondWrite=b.query(upsert(second,keyB,keyA));
      firstWrite.catch(()=>{});secondWrite.catch(()=>{});
      await waitForBlock(observer,pidA,controllerPid);await waitForBlock(observer,pidB,controllerPid);
      await control.query('COMMIT');await Promise.all([firstWrite,secondWrite]);
      await control.query('DROP TRIGGER zz_fixture_pause ON training_day_runs;DROP FUNCTION fixture_pause_after_update()');
    };
    await exercise('reader_switch_while_report_write_is_uncommitted',async()=>{
      await a.query(`BEGIN;${insert(fresh(),[keyA])}`);
      await b.query(await readManual('readers'));await a.query('COMMIT');
      await b.query(await readManual('readers'));await b.query(await readManual('readers-rollback'));
      await b.query(await readManual('readers-rollback'));
    });
    await exercise('missing_trigger_blocks_readiness',async()=>{
      await control.query(`BEGIN;ALTER TABLE training_day_runs DISABLE TRIGGER training_seen_update;
        DO $$ BEGIN
          BEGIN PERFORM training_seen_assert_ready(); EXCEPTION WHEN OTHERS THEN
            IF SQLERRM LIKE 'training_seen%contract%' THEN RETURN; END IF; RAISE; END;
          RAISE EXCEPTION 'BROKEN_CONTRACT_ACCEPTED';
        END $$;ROLLBACK`);
    });
    await exercise('client_acl_and_replica_restore',async()=>{
      for(const role of ['anon','authenticated']){
        const client=connect();let denied=false;
        try{await client.query(`SET ROLE ${role};SELECT * FROM rider_training_seen`);}catch(error){denied=error.sqlState==='42501';}
        if(!denied)throw new Error('CLIENT_READ_ALLOWED');
      }
      await control.query(`BEGIN;SET LOCAL session_replication_role=replica;
        UPDATE rider_training_seen SET report_count=999;
        GRANT EXECUTE ON FUNCTION training_seen_keys(jsonb) TO PUBLIC;
        ${await readManual('restore')};COMMIT`);
      if(await control.query(await readManual('restore-check'))!=='TRAINING_SEEN_READY')throw new Error('RESTORE_STDOUT_FAILED');
    });
    if(config.mode==='concurrency')await exercise('concurrent_mixed_upserts_reverse_event_order',mixedUpsertCase);
    else await exercise('reverse_keys_across_multiple_statements',async()=>{
      await a.query(`BEGIN;${insert(fresh(),[keyA])}`);await b.query(`BEGIN;${insert(fresh(),[keyB])}`);
      const first=a.query(insert(fresh(),[keyB]));first.catch(()=>{});
      await waitForBlock(observer,pidA,pidB);
      const second=b.query(insert(fresh(),[keyA]));second.catch(()=>{});
      await Promise.all([first,second]);await a.query('COMMIT');await b.query('COMMIT');
    });
    phase='cleanup';
    await control.query(`DELETE FROM training_day_runs WHERE id=ANY(ARRAY[${fixtureIds.map(literal).join(',')}]::uuid[])`);
    await parity();
    if(await control.query("SELECT to_regclass('public.idx_training_day_runs_report_riders') IS NOT NULL")!=='t')throw new Error('GIN_MISSING');
    result.status='PASS';return result;
  } catch(error) {
    result.status=['config','preflight'].includes(phase)?'BLOCKED':'FAIL';result.code=phase.toUpperCase();
    result.parity=null; // A previous case's parity is not evidence for the failed case.
    if(error.sqlState)result.sqlState=error.sqlState;
    if(!['config','preflight','setup','cleanup'].includes(phase))cases.push({name:phase,status:'FAIL'});
    return result;
  } finally {await Promise.all(sessions.map(s=>s.close()));}
}

async function main(){
  let config;try{config=options(process.argv.slice(2),process.env);}catch{console.log('{"status":"BLOCKED","code":"CONFIG"}');process.exitCode=1;return;}
  const out=resolve(config.out);await mkdir(dirname(out),{recursive:true});
  // Reserve output before any connection, never overwrite earlier evidence.
  await writeFile(out,'{"status":"RUNNING"}\n',{flag:'wx'});
  const result=await runVerification(process.argv.slice(2));
  const commit=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true});
  result.commit=commit.status===0?commit.stdout.trim():null;
  await writeFile(out,`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify(result));process.exitCode=result.status==='PASS'?0:1;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
