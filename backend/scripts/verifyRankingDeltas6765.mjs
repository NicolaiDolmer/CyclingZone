import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '../..');
const bin = process.env.PG_BIN ?? join(homedir(), 'scoop/apps/postgresql17/current/bin');
const dir = mkdtempSync(join(tmpdir(), 'cz-6765-'));
const port = process.env.PG_PORT ?? '55675';
const exe = name => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
function run(name, args) {
  const r = spawnSync(exe(name), args, {encoding:'utf8', windowsHide:true, ...(name==='pg_ctl'?{stdio:'ignore'}:{})});
  if(r.status !== 0) throw Error(r.stderr || r.stdout || String(r.error));
  return r.stdout ?? '';
}
const args = ['-X','-q','-A','-t','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'];
function sql(source) {
  const path=join(dir,'query.sql'); writeFileSync(path,source);
  return run('psql',[...args,'-f',path]).trim();
}
const senior = readFileSync(join(root,'database/2026-09-25-5535-senior-only-result-aggregates.sql'),'utf8');
const youth = readFileSync(join(root,'database/2026-09-25-4620-youth-rider-rankings-mv.sql'),'utf8');
const names=['rider_rankings_mv','team_standings_ext_mv','team_race_points_mv','youth_rider_rankings_mv'];
const definitions=names.map(name=>{
  const src=name.startsWith('youth')?youth:senior;
  const re=new RegExp('CREATE MATERIALIZED VIEW (?:IF NOT EXISTS )?public\\.'+name+' AS\\s*([\\s\\S]*?);');
  return src.match(re)[1];
});
const refresh=names.map(n=>'REFRESH MATERIALIZED VIEW CONCURRENTLY public.'+n+';').join('\n');
function timed(source) { const start=performance.now(); sql(source); return +(performance.now()-start).toFixed(2); }
try {
  run('initdb',['-D',join(dir,'data'),'-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);
  run('pg_ctl',['-D',join(dir,'data'),'-o','-p '+port+' -h 127.0.0.1 -c log_lock_waits=on -c deadlock_timeout=100ms','-l',join(dir,'pg.log'),'-w','start']);
  console.log(sql('SELECT version();'));
  assert.match(sql('SHOW server_version'),/^17\./,'requires native PG17');
  sql([
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;',
    'GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;',
    'CREATE TABLE app_config(key text PRIMARY KEY,value jsonb);',
    'CREATE TABLE races(id uuid PRIMARY KEY,season_id uuid,squad text,race_type text,name text);',
    'CREATE TABLE riders(id uuid PRIMARY KEY,team_id uuid);',
    'CREATE TABLE race_results(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,race_id uuid,rider_id uuid,team_id uuid,points_earned integer,prize_money bigint,rank int,result_type text);',
    'CREATE INDEX idx_race_results ON race_results(race_id);',
    "CREATE FUNCTION fid(int) RETURNS uuid LANGUAGE SQL IMMUTABLE AS 'SELECT md5($1::text)::uuid';",
    'INSERT INTO riders SELECT fid(i),CASE WHEN i%17=0 THEN NULL ELSE fid(10000+i%40) END FROM generate_series(1,240) i;',
    "INSERT INTO races SELECT fid(100000+i),fid(200000+i%4),(ARRAY['senior','senior','u23','junior'])[1+i%4],CASE WHEN i%2=0 THEN 'stage_race' ELSE 'single' END,'fixture '||i FROM generate_series(1,"+(process.argv.includes('--quick')?12:1200)+") i;",
    "INSERT INTO race_results(race_id,rider_id,team_id,points_earned,prize_money,rank,result_type) SELECT r.id,CASE WHEN i%19=0 THEN NULL ELSE fid(1+i%240) END,CASE WHEN i%3=0 THEN fid(10000+i%40) ELSE NULL END,CASE WHEN i%23=0 THEN NULL ELSE i%80 END,CASE WHEN i%7=0 THEN NULL ELSE (i%60)*100 END,1+i%12,(ARRAY['stage','gc','points','mountain','young','leader','points_day','mountain_day','young_day','team'])[1+i%10] FROM races r CROSS JOIN generate_series(1,1920) i;",
    'ANALYZE;'
  ].join('\n'));
  sql(names.map((n,i)=>'CREATE MATERIALIZED VIEW public.'+n+' AS '+definitions[i]+'; CREATE UNIQUE INDEX '+n+'_pk ON public.'+n+'('+(n.startsWith('youth')?'season_id,squad,rider_id':n.startsWith('rider')?'season_id,rider_id':n.startsWith('team_race')?'season_id,team_id,race_id':'season_id,team_id')+');').join('\n'));
  const baseline = [timed(refresh),timed(refresh),timed(refresh)];
  console.log(JSON.stringify({phase:'baseline',rows:sql('SELECT count(*) FROM race_results'),full_refresh_ms:baseline}));
  if(!process.argv.includes('--baseline')) {
    const migration=readFileSync(join(root,'database/2026-10-19-6765-incremental-rankings-shadow.sql'),'utf8');
    sql(migration);
    const tables=['ranking_rider_season','ranking_team_season_ext','ranking_team_race_points','ranking_youth_rider_season'];
    function drain() {
      const batchMs=[];
      for(let i=0;i<100;i++) {
        const start=performance.now();
        const out=JSON.parse(sql('SELECT public.apply_ranking_deltas(200);'));
        batchMs.push(+(performance.now()-start).toFixed(2));
        if(!out.pending) { console.log(JSON.stringify({drain_batch_ms:batchMs})); return; }
      }
      throw Error('queue did not drain');
    }
    function parity(label) {
      names.forEach((n,i)=>{
        const expected=definitions[i], actual='SELECT * FROM public.'+tables[i];
        const diff=sql('SELECT count(*) FROM (('+expected+' EXCEPT ALL '+actual+') UNION ALL ('+actual+' EXCEPT ALL '+expected+')) d;');
        assert.equal(diff,'0',label+': '+n);
      });
      console.log('PASS '+label);
    }
    drain(); parity('initial backfill, four outputs/all columns');
    const snapshot=()=>sql(tables.map(n=>"SELECT md5(coalesce(string_agg(row_to_json(t)::text,',' ORDER BY row_to_json(t)::text),'')) FROM public."+n+" t;").join('\n'));
    const before=snapshot(); sql(migration); drain(); assert.equal(snapshot(),before,'migration replay');
    sql("INSERT INTO ranking_dirty_log(kind,race_id) VALUES('race',fid(100004)),('race',fid(100004));");
    drain(); assert.equal(snapshot(),before,'duplicate events');
    sql("BEGIN; DELETE FROM race_results WHERE race_id=fid(100004); ROLLBACK;");
    assert.equal(sql('SELECT count(*) FROM ranking_dirty_log'),'0','event rollback');
    const incremental=[];
    for(let i=0;i<3;i++) {
      sql("UPDATE race_results SET points_earned=points_earned+1 WHERE race_id=fid(100004);");
      incremental.push(timed('SELECT apply_ranking_deltas(200);'));
      parity('changed race '+i);
    }
    console.log(JSON.stringify({phase:'after',full_refresh_ms:baseline,changed_race_ms:incremental}));
    if(!process.argv.includes('--benchmark-only')) {
    sql("UPDATE riders SET team_id=fid(10039) WHERE id=fid(1);"); drain(); parity('historical transfer');
    sql("UPDATE riders SET team_id=NULL WHERE id=fid(1);"); drain(); parity('transfer to no team');
    sql("DELETE FROM riders WHERE id=fid(2);"); drain(); parity('deleted rider');
    sql("UPDATE races SET season_id=fid(200099),squad='junior',race_type='single',name='corrected' WHERE id=fid(100004);"); drain(); parity('race metadata');
    sql("DELETE FROM races WHERE id=fid(100004);"); drain(); parity('deleted race');
    sql("DELETE FROM race_results WHERE race_id=fid(100008); INSERT INTO race_results(race_id,rider_id,team_id,points_earned,prize_money,rank,result_type) VALUES(fid(100008),fid(3),NULL,NULL,NULL,1,'gc'),(fid(100008),NULL,fid(10001),NULL,NULL,1,'team'),(fid(100008),NULL,NULL,NULL,NULL,1,'stage');");
    drain(); parity('race replay, all-NULL sums, team-only and unowned rows');
    for(const role of ['anon','authenticated']) {
      assert.throws(()=>sql('SET ROLE '+role+'; SELECT apply_ranking_deltas(200);'),/permission denied/);
      assert.throws(()=>sql('SET ROLE '+role+'; SELECT * FROM ranking_race_contrib;'),/permission denied/);
    }
    sql('SET ROLE service_role; SELECT apply_ranking_deltas(200); RESET ROLE;');
    if(process.argv.includes('--concurrency')) {
      // Hold the processor transaction open after deleting a dirty queue item.
      // A concurrent stage append must not wait on that queue or source table.
      sql("INSERT INTO ranking_dirty_log(kind,race_id) VALUES('race',fid(100012));");
      const holder=join(dir,'holder.sql');
      writeFileSync(holder,"BEGIN; SELECT apply_ranking_deltas(200); SELECT 'HOLDING'; SELECT pg_sleep(3); COMMIT;");
      const child=spawn(exe('psql'),[...args,'-f',holder],{windowsHide:true});
      let errors='';
      child.stderr.on('data',b=>{errors+=b;});
      const finished=new Promise((resolve,reject)=>child.on('exit',code=>code===0?resolve(null):reject(Error(errors))));
      await new Promise((resolve,reject)=>{
        child.stdout.on('data',b=>{if(String(b).includes('HOLDING')) resolve(null);});
        child.on('exit',code=>{if(code!==0) reject(Error(errors));});
      });
      const writeMs=timed("SET lock_timeout='100ms'; INSERT INTO race_results(race_id,rider_id,points_earned,prize_money,rank,result_type) VALUES(fid(100012),fid(3),20,100,1,'stage');");
      await finished; drain(); parity('concurrent stage insert with processor transaction held');
      const log=readFileSync(join(dir,'pg.log'),'utf8');
      assert.doesNotMatch(log,/still waiting for .*lock/,'no lock waits above 100ms');
      console.log(JSON.stringify({concurrent_stage_request_ms:writeMs,lock_timeout_ms:100,logged_lock_waits:0}));
      writeFileSync(holder,"BEGIN; LOCK TABLE race_results IN ROW EXCLUSIVE MODE; SELECT 'DDL_HOLDING'; SELECT pg_sleep(8); COMMIT;");
      const ddlHolder=spawn(exe('psql'),[...args,'-f',holder],{windowsHide:true});
      let ddlErrors='';
      ddlHolder.stderr.on('data',b=>{ddlErrors+=b;});
      const ddlFinished=new Promise((resolve,reject)=>ddlHolder.on('exit',code=>code===0?resolve(null):reject(Error(ddlErrors))));
      await new Promise((resolve,reject)=>{
        ddlHolder.stdout.on('data',b=>{if(String(b).includes('DDL_HOLDING')) resolve(null);});
        ddlHolder.on('exit',code=>{if(code!==0) reject(Error(ddlErrors));});
      });
      const ddlStart=performance.now();
      assert.throws(()=>sql(migration),/lock timeout/,'migration fails fast behind live writer');
      console.log(JSON.stringify({blocked_migration_ms:+(performance.now()-ddlStart).toFixed(2)}));
      await ddlFinished;
      sql(migration); drain(); parity('migration retry after bounded DDL lock failure');
    }
    sql('TRUNCATE race_results;'); drain(); parity('truncate/rebuild removes orphan contributions');
    console.log('ALL PARITY AND IDEMPOTENCY CHECKS PASSED');
    }
  }
} finally {
  try { console.log(run('pg_ctl',['-D',join(dir,'data'),'-m','fast','-w','stop']).trim()); }
  finally { rmSync(dir,{recursive:true,force:true}); }
}
