// #6490 L2: bounded staging-only backfill. Does not install SQL or touch any index.
import { spawnSync } from 'node:child_process';
import { openSync, closeSync, writeSync, ftruncateSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { assertIsolation, checkEnv, STAGING_REF } from './assertLoadtestIsolation.mjs';

export function parseArgs(argv) {
  const raw = {};
  const names = new Set(['--batch-size','--pause-ms','--max-batches','--out']);
  for (let i=0;i<argv.length;i+=2) {
    const key=argv[i], value=argv[i+1];
    if(!names.has(key)||Object.hasOwn(raw,key)||!value||value.startsWith('--')) throw new Error('USAGE');
    raw[key]=value;
  }
  function integer(name,min,max) {
    const value=raw[name];
    if(!/^\d+$/.test(value??'')) throw new Error('USAGE');
    const n=Number(value);
    if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error('USAGE');
    return n;
  }
  if(!raw['--out'])throw new Error('USAGE');
  return {batchSize:integer('--batch-size',1,1000),pauseMs:integer('--pause-ms',0,60000),
    maxBatches:integer('--max-batches',1,10000),out:raw['--out']};
}

function stagingDatabase(env) {
  if(env.CZ_LOADTEST_WRAPPER!=='1'||checkEnv(env).length) throw new Error('CONFIG_INVALID');
  const db=new URL(env.SUPABASE_DB_URL);
  if(!['postgres:','postgresql:'].includes(db.protocol)||db.hostname!==`db.${STAGING_REF}.supabase.co`
    ||!['','5432'].includes(db.port)||db.pathname!=='/postgres'||!db.username||!db.password||db.search||db.hash) {
    throw new Error('CONFIG_INVALID');
  }
  return db;
}

function makeSql(db,env) {
  const childEnv={};
  for(const key of ['SystemRoot','windir','ComSpec','PATH','Path','PATHEXT','TEMP','TMP']) {
    if(env[key])childEnv[key]=env[key];
  }
  Object.assign(childEnv,{PGHOST:db.hostname,PGPORT:'5432',PGDATABASE:'postgres',
    PGUSER:decodeURIComponent(db.username),PGPASSWORD:decodeURIComponent(db.password),
    PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15',PGAPPNAME:'training-seen-backfill-6490'});
  return async statement => {
    const result=spawnSync('psql',['-X','-w','-qAt','-P','pager=off','-v','ON_ERROR_STOP=1'],{
      input:`SET statement_timeout='90s';\n${statement}`,encoding:'utf8',env:childEnv,
      windowsHide:true,timeout:120000,maxBuffer:1024*1024,
    });
    if(result.error||result.status!==0)throw new Error('SQL_FAILED');
    return JSON.parse(result.stdout.trim());
  };
}

const validCount = value => Number.isSafeInteger(value)&&value>=0;
const projections = {
  counter: {prefix:'training_seen',parityFields:['unindexed','missing_keys','extra_keys','wrong_counts']},
  membership: {prefix:'training_membership',parityFields:['unindexed','missing_refs','extra_refs']},
};

export async function runBackfill(argv,env=process.env,deps={},projection='counter') {
  let phase='config';
  const progress={targetRef:STAGING_REF,batches:0,processed:0,remaining:null};
  try {
    if(!Object.hasOwn(projections,projection))throw new Error('CONFIG_INVALID');
    const {prefix,parityFields}=projections[projection];
    const options=parseArgs(argv), database=stagingDatabase(env);
    phase='isolation';
    if((await (deps.isolation??assertIsolation)(env)).status!=='ISOLATED') {
      return {...progress,status:'BLOCKED',code:'ISOLATION_FAILED'};
    }
    const sql=deps.sql??makeSql(database,env);
    phase='schema';
    const schema=await sql(`SELECT public.${prefix}_assert_contract();
      SELECT json_build_object('ready',to_regprocedure('public.${prefix}_backfill_batch(integer)') IS NOT NULL
        AND to_regprocedure('public.${prefix}_assert_ready()') IS NOT NULL
        AND to_regprocedure('public.${prefix}_parity()') IS NOT NULL);`);
    if(schema?.ready!==true)return {...progress,status:'BLOCKED',code:'SCHEMA_NOT_READY'};
    phase='batch';
    for(let i=0;i<options.maxBatches;i++) {
      const result=await sql(`SELECT row_to_json(b) FROM public.${prefix}_backfill_batch(${options.batchSize}) b;`);
      if(!validCount(result?.processed)||result.processed>options.batchSize||!validCount(result?.remaining)) {
        throw new Error('COUNTERS_INVALID');
      }
      progress.batches++;
      progress.processed+=result.processed;
      progress.remaining=result.remaining;
      await deps.onProgress?.({...progress,status:'RUNNING'});
      if(result.remaining===0) {
        phase='parity';
        const parity=await sql(`BEGIN ISOLATION LEVEL REPEATABLE READ;
          SELECT public.${prefix}_assert_ready();
          SELECT row_to_json(p) FROM public.${prefix}_parity() p; COMMIT;`);
        if(!parityFields.every(key=>parity?.[key]===0))throw new Error('PARITY_FAILED');
        return {...progress,status:'READY',parity};
      }
      if(i+1<options.maxBatches)await (deps.pause??pause)(options.pauseMs);
    }
    return {...progress,status:'BLOCKED',code:'BATCH_BUDGET_EXHAUSTED'};
  } catch {
    // Fixed phase codes only: SQL errors may contain reports or credential-bearing URLs.
    return {...progress,status:['config','isolation','schema'].includes(phase)?'BLOCKED':'FAIL',code:`${phase.toUpperCase()}_FAILED`};
  }
}

export async function runBackfillCli(argv=process.argv.slice(2),env=process.env,projection='counter') {
  let fd;
  try {
    const options=parseArgs(argv);
    const output=resolve(options.out);
    mkdirSync(dirname(output),{recursive:true});
    fd=openSync(output,'wx'); // Never overwrite a previous report or a user's file.
    const save=value=>{
      const bytes=Buffer.from(`${JSON.stringify(value,null,2)}\n`);
      writeSync(fd,bytes,0,bytes.length,0); ftruncateSync(fd,bytes.length);
    };
    const result=await runBackfill(argv,env,{onProgress:save},projection);
    save(result);
    console.log(JSON.stringify(result));
    process.exitCode=result.status==='READY'?0:1;
  } catch {
    console.error(JSON.stringify({status:'BLOCKED',code:'USAGE_OR_OUTPUT_FAILED'}));
    process.exitCode=1;
  } finally {
    if(fd!==undefined)closeSync(fd);
  }
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await runBackfillCli();
