import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
export const NOW = '2026-11-28T19:00:00.000Z';
export const id = n => '00000000-0000-0000-0000-' + n.toString(16).padStart(12, '0');
const FROM = id(4), TO = id(5), TEAM = id(101), RIDER = id(201);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)));
const identifier = text => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(text)) throw Error('Unsupported SQL identifier: ' + text);
  return '"' + text + '"';
};
const value = input => input == null ? 'NULL' : typeof input === 'boolean' ? String(input) :
  typeof input === 'number' && Number.isFinite(input) ? String(input) :
  "'" + (typeof input === 'object' ? JSON.stringify(input) : String(input)).replaceAll("'", "''") + "'";

export function validateTarget({ bin, scratch, database, port }) {
  if (!bin || !scratch || !/^rehearsal7325_[a-z0-9_]+$/.test(database)) throw Error('Explicit owned local target required');
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local port');
  if (!resolve(scratch).toLowerCase().includes('7325')) throw Error('Scratch must identify the owned rehearsal');
  return { bin: resolve(bin), scratch: resolve(scratch), database, port };
}

function binary(options, name, args, input, timeout = 30000) {
  const result = spawnSync(join(options.bin, name + (process.platform === 'win32' ? '.exe' : '')), args,
    { input, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 12 * 1024 * 1024,
      stdio: name === 'pg_ctl' && args.includes('start') ? 'ignore' : undefined,
      env: { ...cleanEnv(), PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5' } });
  if (result.error || result.status !== 0) {
    const error = Error(name + ': ' + (result.error?.message || result.stderr || result.stdout));
    error.status = result.status;
    error.sqlState = (result.stderr || '').match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1];
    throw error;
  }
  return (result.stdout || '').trim();
}
function ownedDataDirectory(options) {
  const owner=JSON.parse(readFileSync(join(options.scratch,'owner.json'),'utf8'));
  const expected=resolve(options.scratch,'data');
  if(owner.format!=='season-transition-7325' || owner.root!==ROOT ||
    resolve(owner.data)!==expected || owner.port!==options.port) throw Error('Owned cluster marker mismatch');
  return expected;
}

export function validateSqlScript(source) {
  // psql meta commands are client operations, so validate before opening a session.
  const ordinary=source.replace(/^\s*SET\s+standard_conforming_strings\s*=\s*on\s*;\s*$/gim,'');
  if(/\bstandard_conforming_strings\b/i.test(ordinary)) throw Error('Unsupported SQL string configuration');
  let i=0,state='normal',blockDepth=0,escapeString=false,restriction=null;
  while(i<source.length) {
    const c=source[i],n=source[i+1];
    if(state==='line') {if(c==='\n')state='normal';i++;continue;}
    if(state==='block') {
      if(c==='/'&&n==='*'){blockDepth++;i+=2;}
      else if(c==='*'&&n==='/'){if(--blockDepth===0)state='normal';i+=2;}
      else i++;
      continue;
    }
    if(state==='single') {
      if(escapeString&&c==='\\'){i+=2;continue;}
      if(c==="'"){if(n==="'"){i+=2;continue;}state='normal';}
      i++;continue;
    }
    if(state==='double') {
      if(c==='"'){if(n==='"'){i+=2;continue;}state='normal';}
      i++;continue;
    }
    if(c==='-'&&n==='-'){state='line';i+=2;continue;}
    if(c==='/'&&n==='*'){state='block';blockDepth=1;i+=2;continue;}
    if(c==="'"){escapeString=/[eE]/.test(source[i-1]||'')&&!/[a-z0-9_$]/i.test(source[i-2]||'');state='single';i++;continue;}
    if(c==='"'){state='double';i++;continue;}
    if(c==='$') {
      const tag=source.slice(i).match(/^\$(?:[a-z_][a-z0-9_]*)?\$/i)?.[0];
      if(tag){const end=source.indexOf(tag,i+tag.length);if(end<0)throw Error('Unterminated SQL body');i=end+tag.length;continue;}
    }
    if(c==='\\') {
      const start=source.lastIndexOf('\n',i-1)+1;
      let end=source.indexOf('\n',i);if(end<0)end=source.length;
      const meta=source.slice(i,end).trim().match(/^\\(restrict|unrestrict)\s+([a-z0-9]+)$/i);
      if(source.slice(start,i).trim()||!meta) throw Error('Executable psql meta command rejected');
      if(meta[1]==='restrict'){if(restriction!==null)throw Error('Nested dump restriction rejected');restriction=meta[2];}
      else {if(restriction!==meta[2])throw Error('Mismatched dump restriction rejected');restriction=null;}
      i=end;continue;
    }
    i++;
  }
  if(!['normal','line'].includes(state)||restriction!==null)throw Error('Unterminated SQL script');
  return source;
}

function guardedPsql(options, source, { maintenance=false, timeout=30000 }={}) {
  options=validateTarget(options);
  const dataDirectory=ownedDataDirectory(options);
  const expected=process.platform==='win32'?dataDirectory.replaceAll('\\','/').toLowerCase():dataDirectory;
  const actualDirectory=process.platform==='win32'?"lower(replace(current_setting('data_directory'),chr(92),'/'))":"current_setting('data_directory')";
  const database=maintenance?'postgres':options.database;
  validateSqlScript(source);
  const guard="SET statement_timeout='20s'; SET standard_conforming_strings=on; DO $rehearsal7325_guard$ BEGIN IF "+
    actualDirectory+" <> "+value(expected)+
    " OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999"+
    " OR current_database() <> "+value(database)+
    " THEN RAISE EXCEPTION 'Owned PG17 session identity mismatch' USING ERRCODE='55000'; END IF; END; $rehearsal7325_guard$;";
  // Both actions use one psql connection. The guard commits before standalone DDL.
  return binary(options,'psql',['-X','-q','-tA','-h','127.0.0.1','-p',String(options.port),
    '-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-c',guard,'-f','-'],
    source+'\n',timeout);
}
export function connection(options) {
  options=validateTarget(options);
  ownedDataDirectory(options);
  return source=>guardedPsql(options,source);
}
export function createLocalDatabase(options,name) {
  validateTarget({...options,database:name});
  return guardedPsql(options,'CREATE DATABASE '+identifier(name)+';',{maintenance:true});
}
export function restoreLocalDatabase(options,file) {
  // Feed the validated bytes directly; psql never reopens a mutable source file.
  return guardedPsql(options,readFileSync(file,'utf8'),{timeout:120000});
}

/** SQL transport only: all data, errors, constraints and commits are native PG. */
export function nativeClient(sql, { afterCommit = () => {} } = {}) {
  function from(table) {
    identifier(table);
    let columns='*', operation='select', rows, conflict, single=false, exact=false, head=false;
    let filters=[], orders=[], limit, offset;
    const col = name => name.includes('.') ? name.split('.').map(identifier).join('.') : 't.'+identifier(name);
    function projection() {
      let joins='';
      const embedded = [];
      let flat=columns;
      flat=flat.replace(/board_profiles\(([^()]*)\)/g, (_, fields) => {
        embedded.push("(SELECT COALESCE(jsonb_agg(to_jsonb(bp)), '[]'::jsonb) FROM (SELECT "+
          (fields==='*'?'*':fields.split(',').map(field=>identifier(field.trim())).join(','))+
          ' FROM board_profiles WHERE team_id=t.id) bp) AS board_profiles');
        return '';
      });
      flat=flat.replace(/(?:race:race_id|races)!inner\(([^()]*)\)/g, (_, fields) => {
        const alias=table==='race_entries'?'race':'races';
        joins+=' JOIN races '+alias+' ON '+alias+'.id=t.race_id';
        embedded.push('jsonb_build_object('+fields.split(',').flatMap(x=>[value(x.trim()),alias+'.'+identifier(x.trim())]).join(',')+') AS '+alias);
        return '';
      });
      if (/[()!]/.test(flat)) throw Error('Unsupported embedded select: '+columns);
      return { joins, select: [...flat.split(',').map(x=>x.trim()).filter(Boolean).map(x=>x==='*'?'t.*':col(x)),...embedded].join(',') };
    }
    const query={
      select(c='*', opts={}) {columns=c;exact=opts.count==='exact';head=opts.head===true;return query;},
      insert(data) {operation='insert';rows=Array.isArray(data)?data:[data];return query;},
      upsert(data,opts={}) {operation='insert';rows=Array.isArray(data)?data:[data];conflict=opts;return query;},
      update(data) {operation='update';rows=data;return query;},
      eq(c,v) {filters.push(col(c)+' = '+value(v));return query;},
      neq(c,v) {filters.push(col(c)+' <> '+value(v));return query;},
      is(c,v) {filters.push(col(c)+' IS '+value(v));return query;},
      not(c,op,v) {if(op!=='is')throw Error('Unsupported not');filters.push(col(c)+' IS NOT '+value(v));return query;},
      in(c,vs) {filters.push(vs.length?col(c)+' IN ('+vs.map(value).join(',')+')':'FALSE');return query;},
      lte(c,v) {filters.push(col(c)+' <= '+value(v));return query;},
      gte(c,v) {filters.push(col(c)+' >= '+value(v));return query;},
      gt(c,v) {filters.push(col(c)+' > '+value(v));return query;},
      lt(c,v) {filters.push(col(c)+' < '+value(v));return query;},
      contains(c,v) {filters.push(col(c)+' @> '+value(v)+'::jsonb');return query;},
      or(expression) {
        filters.push('('+expression.split(',').map(part=>{
          const [c,op,...rest]=part.split('.'); const v=rest.join('.');
          if(op==='is'&&v==='null')return col(c)+' IS NULL';
          if(op==='eq')return col(c)+' = '+value(v);
          throw Error('Unsupported or: '+expression);
        }).join(' OR ')+')');return query;
      },
      order(c,{ascending=true}={}) {orders.push(col(c)+(ascending?' ASC':' DESC'));return query;},
      range(a,b) {offset=a;limit=b-a+1;return query;},
      limit(n) {limit=n;return query;},
      maybeSingle() {single='maybe';return query;},
      single() {single='required';return query;},
      then(yes,no) {
        return Promise.resolve().then(()=>{
          const where=filters.length?' WHERE '+filters.join(' AND '):'';
          let statement;
          if(operation==='select') {
            const p=projection();
            statement='SELECT '+p.select+' FROM '+identifier(table)+' t'+p.joins+where+
              (orders.length?' ORDER BY '+orders.join(','):'')+
              (limit!=null?' LIMIT '+Number(limit):'')+(offset?' OFFSET '+Number(offset):'');
          } else if(operation==='update') {
            statement='UPDATE '+identifier(table)+' t SET '+Object.entries(rows).map(([k,v])=>identifier(k)+' = '+value(v)).join(',')+where+' RETURNING *';
          } else {
            if(!rows.length)return {data:[],error:null,count:0};
            const keys=Object.keys(rows[0]);
            statement='INSERT INTO '+identifier(table)+' ('+keys.map(identifier).join(',')+') VALUES '+
              rows.map(r=>'('+keys.map(k=>value(r[k])).join(',')+')').join(',')+
              (conflict?' ON CONFLICT ('+conflict.onConflict.split(',').map(identifier).join(',')+') '+
                (conflict.ignoreDuplicates?'DO NOTHING':'DO UPDATE SET '+keys.map(k=>identifier(k)+' = EXCLUDED.'+identifier(k)).join(',')):'')+' RETURNING *';
          }
          try {
            const text=operation==='select'?
              'SELECT COALESCE(jsonb_agg(to_jsonb(q)),\'[]\'::jsonb) FROM ('+statement+') q':
              'WITH q AS ('+statement+') SELECT COALESCE(jsonb_agg(to_jsonb(q)),\'[]\'::jsonb) FROM q';
            const data=JSON.parse(sql(text));
            if(operation!=='select')afterCommit({table,operation,rows,data});
            if(single && (data.length>1 || (single==='required'&&!data.length))) {
              return {data:null,error:{message:'Expected single row, got '+data.length,code:'PGRST116'}};
            }
            return {data:head?null:single?(data[0]??null):data,error:null,count:exact?data.length:null};
          } catch(error) {return {data:null,error:{message:error.message,code:error.sqlState||'NATIVE_SQL_ERROR'},count:null};}
        }).then(yes,no);
      }
    };
    return query;
  }
  return { from, async rpc(name,args={}) {
    try {
      const data=JSON.parse(sql('SELECT to_jsonb('+identifier(name)+'('+Object.entries(args).map(([k,v])=>identifier(k)+' := '+value(v)).join(',')+'))') || 'null');
      afterCommit({table:'rpc:'+name,operation:'rpc',rows:args,data});
      return {data,error:null};
    } catch(error){return {data:null,error:{message:error.message,code:error.sqlState||'NATIVE_SQL_ERROR'}};}
  }};
}

export async function installNoNetworkBoundary() {
  const attempts=[];
  const deny=kind=>(..._args)=>{
    attempts.push(kind);
    throw Object.assign(Error('JavaScript network disabled in local PG17 rehearsal: '+kind),{code:'REHEARSAL_NETWORK_DENIED'});
  };
  globalThis.fetch=async (...args)=>deny('fetch')(...args);
  for(const name of ['node:http','node:https']) {
    const module=(await import(name)).default;
    module.request=deny(name+'.request');module.get=deny(name+'.get');
  }
  const net=(await import('node:net')).default;
  net.Socket.prototype.connect=deny('net.Socket.connect');
  net.connect=deny('net.connect');net.createConnection=deny('net.createConnection');
  const tls=(await import('node:tls')).default;
  tls.connect=deny('tls.connect');
  const dns=(await import('node:dns')).default;
  for(const key of Object.keys(dns).filter(key=>key==='lookup'||key.startsWith('resolve'))) {
    if(typeof dns[key]==='function') dns[key]=deny('dns.'+key);
  }
  for(const key of Object.keys(dns.promises).filter(key=>key==='lookup'||key.startsWith('resolve'))) {
    if(typeof dns.promises[key]==='function') dns.promises[key]=async (...args)=>deny('dns.promises.'+key)(...args);
  }
  const http2=(await import('node:http2')).default;http2.connect=deny('http2.connect');
  const dgram=(await import('node:dgram')).default;
  dgram.Socket.prototype.send=deny('dgram.send');dgram.Socket.prototype.connect=deny('dgram.connect');
  syncBuiltinESMExports();
  // dotenv in legacy modules must not replace the service boundary with a live URL.
  Object.assign(process.env,{
    SUPABASE_URL:'http://127.0.0.1:1',
    SUPABASE_SERVICE_KEY:'synthetic-rehearsal7325',
    SUPABASE_SERVICE_ROLE_KEY:'synthetic-rehearsal7325',
    SUPABASE_ANON_KEY:'synthetic-rehearsal7325',
    DISCORD_LIVE_MESSAGING:'deny',
  });
  return attempts;
}

export function rankPublicationSql(source) {
  const normalized=source.replaceAll('\r\n','\n');
  const start=normalized.indexOf("  SELECT pg_get_functiondef('public.apply_global_rank_season_rollover(uuid)'::regprocedure) INTO definition;");
  const end=normalized.indexOf('\nEND;\n$$;',start);
  if(start<0 || end<=start) throw Error('Unrecognized production rank publication block');
  return 'DO $$ DECLARE definition text; BEGIN\n'+normalized.slice(start,end)+'\nEND; $$;';
}

export function attemptFiles(scratch,attemptId) {
  if(!/^[a-z0-9][a-z0-9-]{0,100}$/.test(attemptId))throw Error('Invalid attempt identity');
  const stem=join(scratch,attemptId);
  return {stdout:stem+'.stdout.log',stderr:stem+'.stderr.log',result:stem+'.result.json',stop:stem+'.stop.json'};
}

async function worker(options, mode, stop, attemptId) {
  const files=attemptFiles(options.scratch,attemptId);
  const networkAttempts=await installNoNetworkBoundary();
  const sql=connection(options);
  const commits=[];
  const client=nativeClient(sql,{afterCommit:mutation=>{
    commits.push({table:mutation.table,operation:mutation.operation});
    const hit=(stop==='activation'&&mutation.table==='seasons'&&mutation.rows.status==='active')||
      (stop==='previous'&&mutation.table==='seasons'&&mutation.rows.status==='completed')||
      (stop==='global'&&mutation.table==='rpc:apply_global_rank_season_rollover')||
      (stop==='contract'&&mutation.table==='sponsor_contracts'&&mutation.rows.status==='active')||
      (stop==='carry'&&mutation.table==='training_plans'&&mutation.operation==='insert');
    if(hit){writeFileSync(files.stop,JSON.stringify({attemptId,stop,commits,networkAttempts}),{flag:'wx'});process.exit(86);}
  }});
  try {
    let result;
    if(mode==='carry') {
      const {carryOverManagerSetup}=await import('../backend/lib/seasonCarryOver.js');
      result=await carryOverManagerSetup({supabase:client,fromSeasonId:FROM,toSeasonId:TO});
    } else {
      const {transitionToNextSeason}=await import('../backend/lib/seasonTransition.js');
      result=await transitionToNextSeason({supabase:client,fromSeasonId:FROM,transitionAt:new Date(NOW)});
    }
    writeFileSync(files.result,JSON.stringify({attemptId,ok:true,result,commits,networkAttempts},null,2),{flag:'wx'});
  } catch(error) {
    writeFileSync(files.result,JSON.stringify({attemptId,ok:false,error:error.message,commits,networkAttempts},null,2),{flag:'wx'});
    process.exitCode=2;
  }
}

function tableDDL(source, name) {
  const start=source.indexOf('CREATE TABLE '+name+' (');
  if(start<0)throw Error('Owning DDL not found: '+name);
  const end=source.indexOf('\n);',start);
  if(end<0)throw Error('Owning DDL terminator not found: '+name);
  return source.slice(start,end+4);
}
function seed(sql) {
  sql("ALTER TABLE teams ADD COLUMN u23_league_division_id integer, ADD COLUMN junior_league_division_id integer, ADD COLUMN assistant_autopick_enabled boolean DEFAULT false, ADD COLUMN created_at timestamptz DEFAULT '2026-10-01T00:00:00Z', ADD COLUMN comeback_at timestamptz; ALTER TABLE riders ADD COLUMN is_academy boolean DEFAULT false, ADD COLUMN pending_team_id uuid;");
  sql("INSERT INTO seasons(id,number,status,start_date,end_date) VALUES ('"+FROM+"',4,'active','2026-10-01',NULL),('"+TO+"',5,'upcoming','2026-11-29',NULL);"+
    "INSERT INTO teams(id,user_id,name,division,league_division_id) VALUES ('"+TEAM+"','"+id(301)+"','Synthetic A',1,1);"+
    "INSERT INTO riders(id,team_id,contract_end_season) VALUES ('"+RIDER+"','"+TEAM+"',99),('"+id(202)+"','"+TEAM+"',99),('"+id(203)+"','"+TEAM+"',99);"+
    "INSERT INTO league_divisions(id,tier) VALUES (1,1);"+
    "INSERT INTO transfer_windows(id,season_id,status,created_at) VALUES ('"+id(401)+"','"+FROM+"','closed','2026-10-01');"+
    "INSERT INTO races(id,season_id,league_division_id,status) VALUES ('"+id(501)+"','"+FROM+"',1,'completed'),('"+id(502)+"','"+TO+"',1,'scheduled');"+
    "INSERT INTO race_stage_schedule VALUES ('"+id(501)+"',1,1,'2026-11-28T12:00:00Z');"+
    "INSERT INTO training_date_work VALUES ('"+TEAM+"','"+FROM+"','2026-11-28','complete');"+
    "INSERT INTO training_plans(team_id,rider_id,season_id,focus,intensity) VALUES ('"+TEAM+"','"+RIDER+"','"+FROM+"','climbing','normal'),('"+TEAM+"','"+id(202)+"','"+FROM+"','sprint','rest'),('"+TEAM+"','"+id(203)+"','"+FROM+"','sprint','normal');"+
    "UPDATE riders SET team_id=NULL WHERE id='"+id(203)+"';"+
    "INSERT INTO sponsor_contracts(team_id,sponsor_name,guaranteed_base,length_seasons,start_season,expires_after_season,status,variant,guaranteed_fraction,race_day_share) VALUES ('"+TEAM+"','Synthetic sponsor',100,1,5,5,'pending','safe',1,0);");
}
async function observe(options) {
  const sql=connection(options),client=nativeClient(sql),warnings=[];
  const {loadSingleActiveSeason}=await import('../backend/lib/activeSeasonLookup.js');
  const active=await loadSingleActiveSeason(client,{select:'id,number,status',tag:'7325-local',captureExceptionFn:e=>warnings.push(e.message)});
  const requestSeason=await client.from('seasons').select('id,number').eq('status','active').maybeSingle();
  const requestPlans=await client.from('training_plans').select('rider_id,season_id,focus,intensity').eq('team_id',TEAM);
  const {deriveTrainingState}=await import('../backend/lib/training.js');
  const requestState=deriveTrainingState(requestPlans.data,requestSeason.data?.id??null);
  const rankDigest=sql("SELECT md5(COALESCE(string_agg(team_id::text || ':' || banked_points::text,',' ORDER BY team_id),'')) FROM team_global_rank_points");
  const {resolveTransitionSourceSeason}=await import('../backend/lib/seasonTransition.js');
  const defaultSource=await resolveTransitionSourceSeason({supabase:client});
  const data=JSON.parse(sql("SELECT jsonb_build_object('active_count',(SELECT count(*) FROM seasons WHERE status='active'),'source_status',(SELECT status FROM seasons WHERE id='"+FROM+"'),'target_plans',(SELECT count(*) FROM training_plans WHERE season_id='"+TO+"'),'source_plans',(SELECT count(*) FROM training_plans WHERE season_id='"+FROM+"'),'active_contracts',(SELECT count(*) FROM sponsor_contracts WHERE status='active'),'pending_contracts',(SELECT count(*) FROM sponsor_contracts WHERE status='pending'),'finance_rows',(SELECT count(*) FROM finance_transactions),'anchors',(SELECT COALESCE(jsonb_agg(meta->>'status'),'[]') FROM admin_log WHERE meta->>'source'='season_transition_phase'))"));
  return {...data,active_lookup:active,default_transition_source:defaultSource,warnings,training_reader:{activeSeason:requestSeason.data,error:requestSeason.error,visiblePlanCount:Object.keys(requestState.plans).length},rankDigest};
}
function stopOwnedCluster(options,ownPid) {
  const data=join(options.scratch,'data');
  if(!ownPid&&existsSync(join(data,'postmaster.pid')))ownPid=Number(readFileSync(join(data,'postmaster.pid'),'utf8').split('\n')[0]);
  binary(options,'pg_ctl',['-D',data,'-m','fast','-w','-t','120','stop'],undefined,150000);
  const status=spawnSync(join(options.bin,'pg_ctl'+(process.platform==='win32'?'.exe':'')),['-D',data,'status'],
    {encoding:'utf8',windowsHide:true,env:cleanEnv(),timeout:150000});
  let alive=true;try{process.kill(ownPid,0);}catch(error){if(error.code==='ESRCH')alive=false;else throw error;}
  const observed={status:status.status,ownPid,ownPostmasterAlive:alive};
  assert.equal(status.status,3);assert.equal(alive,false);
  return observed;
}

export function identitySwitchRegression(options) {
  const evidence={rejections:[],stops:[]};
  let active=null,ownPid;
  const prepare=name=>{
    const target={...options,scratch:join(options.scratch,'identity-'+name),database:'rehearsal7325_identity'};
    if(existsSync(target.scratch))throw Error('Identity evidence already exists');
    mkdirSync(target.scratch);
    writeFileSync(join(target.scratch,'owner.json'),JSON.stringify({format:'season-transition-7325',root:ROOT,
      data:join(target.scratch,'data'),port:target.port}),{flag:'wx'});
    binary(target,'initdb',['-D',join(target.scratch,'data'),'-U','postgres','-A','trust','-E','UTF8','--locale=C'],undefined,120000);
    active=target;ownPid=undefined;
    binary(target,'pg_ctl',['-D',join(target.scratch,'data'),'-o','-p '+target.port+' -c listen_addresses=127.0.0.1',
      '-l',join(target.scratch,'pg.log'),'-w','-t','120','start'],undefined,150000);
    ownPid=Number(readFileSync(join(target.scratch,'data','postmaster.pid'),'utf8').split('\n')[0]);
    createLocalDatabase(target,target.database);
    return target;
  };
  try {
    const owned=prepare('owned');
    const stale=connection(owned);
    stale('CREATE TABLE identity_sentinel(value integer); INSERT INTO identity_sentinel VALUES(11);');
    const restoreFile=join(owned.scratch,'restore.sql');
    writeFileSync(restoreFile,'UPDATE identity_sentinel SET value=22; CREATE TABLE identity_restore_marker(id integer);',{flag:'wx'});
    evidence.stops.push(stopOwnedCluster(owned,ownPid));active=null;ownPid=undefined;
    const foreign=prepare('foreign');
    const foreignSql=connection(foreign);
    foreignSql('CREATE TABLE identity_sentinel(value integer); INSERT INTO identity_sentinel VALUES(11);');
    const snapshot=()=>foreignSql("SELECT jsonb_build_object('sentinel',(SELECT value FROM identity_sentinel),"+
      "'extra_database',(SELECT count(*) FROM pg_database WHERE datname='rehearsal7325_guard_forbidden'),"+
      "'restore_marker',to_regclass('identity_restore_marker'),'reconnect_marker',to_regclass('identity_reconnect_marker'))");
    const before=snapshot();
    for(const [operation,action] of [
      ['reused connection',()=>stale('UPDATE identity_sentinel SET value=22;')],
      ['database creation',()=>createLocalDatabase(owned,'rehearsal7325_guard_forbidden')],
      ['restore',()=>restoreLocalDatabase(owned,restoreFile)],
    ]) {
      let refusal;
      try{action();}catch(error){refusal=error;}
      assert.equal(refusal?.sqlState,'55000',operation+' must fail at the live identity guard');
      evidence.rejections.push({operation,sqlState:refusal.sqlState});
    }
    const reconnectFile=join(foreign.scratch,'reconnect.sql');
    writeFileSync(reconnectFile,'CREATE TABLE identity_reconnect_marker(id integer);\n\\connect postgres\n',{flag:'wx'});
    assert.throws(()=>restoreLocalDatabase(foreign,reconnectFile),/psql meta command rejected/);
    evidence.reconnectRejectedBeforeExecution=true;
    evidence.foreignUnchanged=before===snapshot();
    assert.equal(evidence.foreignUnchanged,true,'foreign sentinel/catalog must remain unchanged');
  } finally {
    if(active) {
      try{evidence.stops.push(stopOwnedCluster(active,ownPid));}
      catch(error){evidence.stopError=error.message;writeFileSync(join(options.scratch,'identity-evidence.json'),JSON.stringify(evidence,null,2),{flag:'wx'});throw error;}
    }
    if(!existsSync(join(options.scratch,'identity-evidence.json')))
      writeFileSync(join(options.scratch,'identity-evidence.json'),JSON.stringify(evidence,null,2),{flag:'wx'});
  }
  return evidence;
}

export async function rehearse(input) {
  const options=validateTarget(input), data=join(options.scratch,'data'), marker=join(options.scratch,'owner.json');
  if(existsSync(options.scratch))throw Error('Use a new exclusive scratch directory; existing evidence is preserved');
  mkdirSync(options.scratch,{recursive:true});
  writeFileSync(marker,JSON.stringify({format:'season-transition-7325',root:ROOT,data,port:options.port}));
  const networkAttempts=await installNoNetworkBoundary();
  const report={networkPolicy:'All JavaScript network denied; only owned native PG binaries use verified loopback',networkAttempts,scope:'partial synthetic native PG17 copy, not full production copy',clock:NOW,scenarios:[],sourceHashes:{}};
  for(const name of ['backend/lib/seasonTransition.js','backend/lib/seasonCarryOver.js','database/2026-06-08-training-l2-teaser.sql','database/2026-07-17-global-rank.sql','database/2026-10-06-5692-ranking-refresh-events.sql','database/2026-05-26-backend-message-codes.sql']) {
    report.sourceHashes[name]=createHash('sha256').update(readFileSync(join(ROOT,name))).digest('hex');
  }
  let started=false,ownPid;
  try {
    report.version=binary(options,'pg_ctl',['--version']);
    assert.match(report.version,/PostgreSQL\) 17\./);
    report.identityRegression=identitySwitchRegression(options);
    binary(options,'initdb',['-D',data,'-U','postgres','-A','trust','-E','UTF8','--locale=C'],undefined,120000);
    started=true;
    binary(options,'pg_ctl',['-D',data,'-o','-p '+options.port+' -c listen_addresses=127.0.0.1','-l',join(options.scratch,'pg.log'),'-w','-t','120','start'],undefined,150000);
    ownPid=Number(readFileSync(join(data,'postmaster.pid'),'utf8').split('\n')[0]);
    const admin={...options,database:'rehearsal7325_admin'};
    createLocalDatabase(admin,admin.database);
    const adminSql=connection(admin);
    adminSql('CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;');
    adminSql(readFileSync(join(ROOT,'scripts/fixtures/seasonTransition7325/schema.sql'),'utf8'));
    const production=readFileSync(join(ROOT,'database/schema.sql'),'utf8');
    adminSql(tableDDL(production,'sponsor_contracts'));
    adminSql("CREATE UNIQUE INDEX idx_sponsor_contracts_team_active ON sponsor_contracts(team_id) WHERE status='active'; CREATE UNIQUE INDEX idx_sponsor_contracts_team_pending ON sponsor_contracts(team_id) WHERE status='pending';");
    adminSql(readFileSync(join(ROOT,'database/2026-06-08-training-l2-teaser.sql'),'utf8'));
    const rankSource=readFileSync(join(ROOT,'database/2026-07-17-global-rank.sql'),'utf8');
    const rankEnd="GRANT EXECUTE ON FUNCTION public.apply_global_rank_season_rollover(uuid) TO service_role;";
    const rankEndIndex=rankSource.indexOf(rankEnd);
    assert.ok(rankEndIndex>0);
    adminSql(rankSource.slice(0,rankEndIndex+rankEnd.length));
    const publication=readFileSync(join(ROOT,'database/2026-10-06-5692-ranking-refresh-events.sql'),'utf8');
    adminSql(rankPublicationSql(publication));
    report.rankSql='Original rollover prefix plus unchanged #5692 publication transformation; latest full materialized-view dependency closure is not claimed';
    const {balanceRpcFrom}=await import('../backend/lib/__fixtures__/saleEscrow6181Schema.js');
    adminSql(balanceRpcFrom(readFileSync(join(ROOT,'database/2026-05-26-backend-message-codes.sql'),'utf8')));
    seed(adminSql);
    adminSql("INSERT INTO team_global_rank_points(team_id,banked_points) VALUES ('"+TEAM+"',37); INSERT INTO season_standings(season_id,team_id,division,rank_in_division,total_points) VALUES ('"+FROM+"','"+TEAM+"',1,1,11);");
    const dump=join(options.scratch,'synthetic-copy.sql');
    binary(options,'pg_dump',['-h','127.0.0.1','-p',String(options.port),'-U','postgres','--no-owner','--no-privileges','--column-inserts','-f',dump,admin.database],undefined,120000);
    report.dumpBytes=readFileSync(dump).length;
    for(const scenario of ['activation','previous','global','contract','carry']) {
      const target={...options,database:'rehearsal7325_'+scenario};
      createLocalDatabase(target,target.database);
      restoreLocalDatabase(target,dump);
      const mode=scenario==='carry'?'carry':'transition';
      if(mode==='carry')connection(target)("UPDATE seasons SET status='completed' WHERE id='"+FROM+"'; UPDATE seasons SET status='active' WHERE id='"+TO+"'");
      const attempts=[];let attemptNumber=0;
      const child=(stop,childMode=mode)=>{
        const attemptId=scenario+'-'+String(++attemptNumber).padStart(2,'0')+'-'+childMode+'-'+(stop?'stop-'+stop:'resume');
        const files=attemptFiles(options.scratch,attemptId);
        const r=spawnSync(process.execPath,[SELF,'--worker',JSON.stringify(target),childMode,stop,attemptId],{
          cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:3*1024*1024,env:cleanEnv()});
        writeFileSync(files.stdout,r.stdout||'',{flag:'wx'});
        writeFileSync(files.stderr,r.stderr||'',{flag:'wx'});
        const attempt={attemptId,mode:childMode,stop:stop||null,status:r.status,...files,
          hasResult:existsSync(files.result),hasStop:existsSync(files.stop)};
        attempts.push(attempt);
        if(r.error)throw r.error;
        return attempt;
      };
      const interruptedAttempt=child(scenario),interrupted=interruptedAttempt.status;
      const afterStop=await observe(target);
      const resumedAttempt=child(''),resumed=resumedAttempt.status;
      const afterResume=await observe(target);
      let result;
      const resultPath=resumedAttempt.result;
      if(existsSync(resultPath))result=JSON.parse(readFileSync(resultPath,'utf8'));
      const transitionAgainAttempt=mode==='transition'?child('','transition'):null;
      const transitionAgain=transitionAgainAttempt?.status??null;
      const afterTransitionAgain=await observe(target);
      const rankChangedOnReplay=mode==='transition'?afterResume.rankDigest!==afterTransitionAgain.rankDigest:null;
      const carryResumeAttempt=child('','carry'),carryResume=carryResumeAttempt.status;
      const afterCarry=await observe(target);
      const carryAgainAttempt=child('','carry'),carryAgain=carryAgainAttempt.status;
      const afterAgain=await observe(target);
      report.scenarios.push({scenario,attempts,interrupted,resumed,afterStop,afterResume,transitionResult:result,transitionAgain,afterTransitionAgain,rankChangedOnReplay,carryResume,carryAgain,afterCarry,afterAgain});
      assert.equal(interrupted,86,scenario+' must actually reach the interruption');
      assert.ok([0,2].includes(resumed));assert.ok(resumedAttempt.hasResult);
      assert.equal(result.attemptId,resumedAttempt.attemptId);
      const paths=attempts.flatMap(attempt=>[attempt.stdout,attempt.stderr,attempt.result,attempt.stop]);
      assert.equal(new Set(paths).size,paths.length,'each attempt must own exclusive output paths');
      assert.ok(interruptedAttempt.hasStop);
      assert.equal(carryResume,0);assert.equal(carryAgain,0);
      assert.equal(afterCarry.target_plans,1);assert.equal(afterAgain.target_plans,1);
      assert.equal(afterAgain.source_plans,3);
      assert.ok(afterAgain.active_contracts<=1);

    }
  } catch(error) {report.failure=error.message;throw error;}
  finally {
    if(started) {
      try {
        report.stop=stopOwnedCluster(options,ownPid);
      } catch(error){report.stop={error:error.message};process.exitCode=1;}
    }
    writeFileSync(join(options.scratch,'evidence.json'),JSON.stringify(report,null,2));
  }
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===SELF) {
  if(process.argv[2]==='--worker')await worker(JSON.parse(process.argv[3]),process.argv[4],process.argv[5],process.argv[6]);
  else {
    const args=Object.fromEntries(process.argv.slice(2).map(a=>{const i=a.indexOf('=');if(i<0)throw Error('Use --name=value');return [a.slice(2,i),a.slice(i+1)];}));
    const report=await rehearse({bin:args.bin,scratch:args.scratch,database:'rehearsal7325_admin',port:Number(args.port)});
    console.log(JSON.stringify({scope:report.scope,version:report.version,identityRegression:report.identityRegression,scenarios:report.scenarios.map(s=>({scenario:s.scenario,interrupted:s.interrupted,resumed:s.resumed,plans:s.afterAgain.target_plans})),stop:report.stop},null,2));
  }
}
