// #6765: the two open Codex findings in the design (PR #6849, "Åbne review-fund").
// P1 drain the claimed version before it is acknowledged; P2 durable progress
// across a rebuild. Same fixture shape, legacy reference SELECTs and EXCEPT ALL
// parity as the M1/M1.5 suites, with enough races that one statement queues
// more than one 200-item batch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { runRankingShadowPass } from '../rankingShadowPass.ts';

const read=(path:string)=>readFileSync(new URL('../../../database/'+path,import.meta.url),'utf8');
const m1=read('2026-10-19-6765-incremental-rankings-shadow.sql');
const m15=read('2026-10-23-6765-ranking-shadow-contrib-transfers.sql');
const p1p2=read('2026-10-31-6765-ranking-shadow-codex-p1-p2.sql');
const oldSenior=read('2026-09-25-5535-senior-only-result-aggregates.sql');
const oldYouth=read('2026-09-25-4620-youth-rider-rankings-mv.sql');
const views=['rider_rankings_mv','youth_rider_rankings_mv','team_standings_ext_mv','team_race_points_mv'];
const tables=['ranking_rider_season','ranking_youth_rider_season','ranking_team_season_ext','ranking_team_race_points'];
const definitions=views.map(name=>(name.startsWith('youth')?oldYouth:oldSenior)
  .match(new RegExp('CREATE MATERIALIZED VIEW (?:IF NOT EXISTS )?public\\.'+name+' AS\\s*([\\s\\S]*?);'))![1]);
const RACES=450;
const MORNING=Date.parse('2026-10-19T08:00:00Z');
type Applied={pending:boolean;processed?:number;seasons?:number;next_id?:string|null;rebuild_from?:string|null;rebuild_through?:string|null};

async function fixture(){
  const db=await PGlite.create();
  await db.exec([
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;',
    'GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;',
    'CREATE TABLE app_config(key text PRIMARY KEY,value jsonb);',
    'CREATE TABLE races(id uuid PRIMARY KEY,season_id uuid,squad text,race_type text,name text);',
    'CREATE TABLE riders(id uuid PRIMARY KEY,team_id uuid);',
    'CREATE INDEX idx_riders_team ON riders(team_id);',
    'CREATE TABLE race_results(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,race_id uuid REFERENCES races(id) ON DELETE CASCADE,rider_id uuid REFERENCES riders(id) ON DELETE SET NULL,team_id uuid,points_earned integer,prize_money bigint,rank int,result_type text);',
    'CREATE INDEX idx_race_results ON race_results(race_id);',
    "CREATE FUNCTION fid(int) RETURNS uuid LANGUAGE SQL IMMUTABLE AS 'SELECT md5($1::text)::uuid';",
    'CREATE TABLE ranking_refresh_work_state(matview_group text,lease_token uuid,leased_version bigint,lease_expires_at timestamptz,requested_version bigint,completed_version bigint);',
    // A live lease without any wall-clock read (AGENTS.md rule 16): the SQL
    // fence compares against clock_timestamp(), and 'infinity' is later than
    // every instant. Lease expiry itself is covered by the M1/M1.5 suites.
    "INSERT INTO ranking_refresh_work_state VALUES('ranking',fid(900),8,'infinity',8,7);",
    'INSERT INTO riders SELECT fid(i),CASE WHEN i%9=0 THEN NULL ELSE fid(100+i%4) END FROM generate_series(1,24) i;',
    // Three seasons plus the NULL season (every 50th race), three squads.
    `INSERT INTO races SELECT fid(1000+i),CASE WHEN i%50=0 THEN NULL ELSE fid(2000+i%3) END,(ARRAY['senior','senior','u23','junior'])[1+i%4],CASE WHEN i%2=0 THEN 'single' ELSE 'stage_race' END,'race '||i FROM generate_series(1,${RACES}) i;`,
    "INSERT INTO race_results(race_id,rider_id,team_id,points_earned,prize_money,rank,result_type) SELECT r.id,CASE WHEN i%11=0 THEN NULL ELSE fid(1+i%24) END,CASE WHEN i%3=0 THEN fid(100+i%4) ELSE NULL END,CASE WHEN i%7=0 THEN NULL ELSE i END,CASE WHEN i%5=0 THEN NULL ELSE i*100 END,1+i%12,(ARRAY['stage','gc','points','mountain','young','leader','points_day','mountain_day','young_day','team'])[1+i%10] FROM races r CROSS JOIN generate_series(1,12) i;",
    ...views.map((n,i)=>'CREATE MATERIALIZED VIEW public.'+n+' AS '+definitions[i]+';'),
    ...views.map((n,i)=>'CREATE UNIQUE INDEX '+n+'_pk ON public.'+n+'('+
      ['season_id,rider_id','season_id,squad,rider_id','season_id,team_id','season_id,team_id,race_id'][i]+');'),
  ].join('\n'));
  await db.exec(m1);
  await db.exec(m15);
  await db.exec(p1p2);
  await db.exec("UPDATE app_config SET value='\"on\"'::jsonb WHERE key='ranking_shadow_enabled';");
  await drain(db);
  await parity(db,'backfill');
  return db;
}
async function apply(db:PGlite,batch=200){
  return (await db.query<{v:Applied}>('SELECT apply_ranking_deltas($1) v',[batch])).rows[0].v;
}
async function drain(db:PGlite,batch=200){
  for(let i=0;i<500;i++) if(!(await apply(db,batch)).pending) return;
  assert.fail('queue did not drain');
}
async function refreshLegacy(db:PGlite){
  for(const v of views) await db.exec('REFRESH MATERIALIZED VIEW CONCURRENTLY public.'+v+';');
}
async function parity(db:PGlite,label:string){
  for(let i=0;i<views.length;i++){
    const a=definitions[i],b='SELECT * FROM '+tables[i];
    const r=await db.query<{n:number}>('SELECT count(*)::int n FROM (('+a+' EXCEPT ALL '+b+') UNION ALL ('+b+' EXCEPT ALL '+a+')) d');
    assert.equal(r.rows[0].n,0,label+': '+views[i]);
  }
}
const queue=async(db:PGlite)=>(await db.query<{kind:string;season_id:string|null}>('SELECT kind,season_id FROM ranking_dirty_log ORDER BY id')).rows;
const count=async(db:PGlite,sql:string)=>(await db.query<{n:number}>('SELECT count(*)::int n FROM '+sql)).rows[0].n;

// The real Node pass against PGlite, as PostgREST would call it.
const CASTS:Record<string,string>={p_max_items:'int',p_owner_token:'uuid',p_target_version:'bigint',p_now:'timestamptz'};
function client(db:PGlite){
  return {
    from:()=>({select:()=>({eq:(_c:string,key:string)=>({maybeSingle:async()=>{
      const r=await db.query<{value:unknown}>('SELECT value FROM app_config WHERE key=$1',[key]);
      return {data:r.rows[0]??null,error:null};
    }})})}),
    rpc:async(name:string,args:Record<string,unknown>)=>{
      const keys=Object.keys(args).filter(k=>args[k]!==null&&args[k]!==undefined);
      const sql='SELECT public.'+name+'('+keys.map((k,i)=>k+' => $'+(i+1)+'::'+CASTS[k]).join(',')+') v';
      try { return {data:(await db.query<{v:unknown}>(sql,keys.map(k=>args[k]))).rows[0].v,error:null}; }
      catch(e){ return {data:null,error:{code:(e as {code?:string}).code,message:(e as Error).message}}; }
    },
  };
}
test('#6765 Codex P1/P2 on the shadow processor',async t=>{
  const db=await fixture(); t.after(()=>db.close());
  // fid(900) is the lease token in the work-state fixture.
  const token=(await db.query<{t:string}>('SELECT fid(900)::text t')).rows[0].t;
  // A leased coordinator pass. Every apply costs 5 s on the injected clock, so
  // the M1.5 soft budget (8 s) alone would stop after one batch.
  const pass=async()=>{
    let elapsed=0;const logs:Array<Record<string,unknown>>=[];
    const c=client(db);const rpc=c.rpc;
    c.rpc=async(name,args)=>{if(name==='apply_ranking_deltas')elapsed+=5000;return rpc(name,args);};
    const ok=await runRankingShadowPass(c,{ownerToken:token,targetVersion:'8',now:MORNING,
      clock:()=>elapsed,logger:{info:(_m,d)=>{logs.push(d);}},parityEveryPass:true,renewLease:async()=>true});
    return {ok,log:logs[0]};
  };

  await t.test('P1: one statement over >200 races is drained by the leased pass before acknowledgement',async()=>{
    await db.exec('UPDATE race_results SET points_earned=coalesce(points_earned,0)+1;');
    // An UPDATE queues each race from old_rows and new_rows: 2 x 450 items, five batches.
    assert.equal(await count(db,"ranking_dirty_log WHERE kind='race'"),2*RACES,'one statement queued more than 200 items');
    await refreshLegacy(db); // the legacy refresh runs before the shadow in the coordinator
    const {ok,log}=await pass();
    assert.equal(ok,true);
    assert.equal(await count(db,'ranking_dirty_log'),0,'no item of the claimed version is left for an unrelated later write');
    assert.equal(log.batches,5);assert.equal(log.version_drained,true);
    assert.equal(log.status,'equal','parity runs in the same pass');
    await parity(db,'P1 version drain');
  });

  await t.test('P1: later writes above the watermark keep the soft budget',async()=>{
    await db.exec('UPDATE race_results SET points_earned=coalesce(points_earned,0)+1;');
    const watermark=(await db.query<{v:{max_id:string}}>('SELECT get_ranking_shadow_metrics() v')).rows[0].v.max_id;
    // A newer statement after the claim: not part of version 8.
    const c=client(db);const rpc=c.rpc;let elapsed=0,applies=0;const logs:Array<Record<string,unknown>>=[];
    c.rpc=async(name,args)=>{
      if(name==='get_ranking_shadow_metrics'){
        const r=await rpc(name,args);
        await db.exec('UPDATE race_results SET prize_money=coalesce(prize_money,0)+1;');
        return r;
      }
      if(name==='apply_ranking_deltas'){elapsed+=5000;applies++;}
      return rpc(name,args);
    };
    await runRankingShadowPass(c,{ownerToken:token,targetVersion:'8',now:MORNING,clock:()=>elapsed,
      logger:{info:(_m,d)=>{logs.push(d);}},renewLease:async()=>true});
    assert.equal(applies,5,'the version (900 items) needs five batches, the newer work waits');
    assert.equal(logs[0].version_drained,true);assert.equal(logs[0].status,'pending');
    const head=(await db.query<{n:string}>('SELECT min(id)::text n FROM ranking_dirty_log')).rows[0].n;
    assert.ok(BigInt(head)>BigInt(watermark),'only work newer than the watermark is still queued');
    await drain(db); await refreshLegacy(db); await parity(db,'after newer work');
  });

  await t.test('P2: a rebuild marker only expands into durable race items and one sweep per season',async()=>{
    // Orphans: summary rows with no contribution behind them, in a real season and the NULL season.
    await db.exec(`INSERT INTO ranking_rider_season SELECT season_id,fid(777),1,1,0,0,0,0,0,0,0,0,0,0,0,0
      FROM (SELECT DISTINCT season_id FROM ranking_rider_season) s;`);
    const seasons=await count(db,'(SELECT DISTINCT season_id FROM ranking_rider_season UNION SELECT season_id FROM ranking_youth_rider_season UNION SELECT season_id FROM ranking_team_season_ext) s');
    assert.ok(seasons>=4,'fixture covers three seasons and the NULL season');
    await db.exec("INSERT INTO ranking_dirty_log(kind) VALUES('rebuild');");
    const r=await apply(db,1);
    assert.equal(r.processed,1);assert.equal(r.seasons,0);
    assert.ok(r.rebuild_from&&r.rebuild_through&&BigInt(r.rebuild_through)>BigInt(r.rebuild_from));
    const q=await queue(db);
    assert.equal(q.filter(i=>i.kind==='race').length,RACES);
    assert.equal(q.filter(i=>i.kind==='season').length,seasons,'one durable sweep per summary season');
    assert.ok(q.findIndex(i=>i.kind==='season')>q.map(i=>i.kind).lastIndexOf('race'),'sweeps run after every race is rebuilt');
    assert.ok(q.some(i=>i.kind==='season'&&i.season_id===null),'the NULL season is swept too');
    assert.ok(await count(db,'ranking_rider_season WHERE rider_id=fid(777)')>0,'the marker call itself does no whole-history sweep');
  });

  await t.test('P2: a failed call rolls back with the remaining rebuild work still queued',async()=>{
    const before=await count(db,'ranking_dirty_log');
    await db.exec('BEGIN;');
    await db.query('SELECT apply_ranking_deltas(200)');
    await db.exec('ROLLBACK;');
    assert.equal(await count(db,'ranking_dirty_log'),before,'progress survives the failed call');
  });

  await t.test('P2: a batch holds at most one season sweep',async()=>{
    // Process the race items, then the sweeps arrive one per call.
    let r:Applied;
    do { r=await apply(db); } while((r.seasons??0)===0&&r.pending);
    assert.equal(r.seasons,1);
    const left=await count(db,"ranking_dirty_log WHERE kind='season'");
    assert.ok(left>0,'other sweeps stay queued');
    while(r.pending){ r=await apply(db); assert.ok((r.seasons??0)<=1); }
    assert.equal(await count(db,'ranking_rider_season WHERE rider_id=fid(777)'),0,'season sweeps removed every orphan');
    await refreshLegacy(db); await parity(db,'after rebuild');
  });

  await t.test('P1+P2: a rebuild queued with the version is drained by the leased pass',async()=>{
    await db.exec('TRUNCATE race_results;');
    assert.deepEqual((await queue(db)).map(i=>i.kind),['rebuild']);
    await refreshLegacy(db);
    const {log}=await pass();
    assert.equal(await count(db,'ranking_dirty_log'),0,'the expansion counts as version work');
    assert.equal(log.version_drained,true);
    await parity(db,'truncate rebuild under a lease');
  });

  await t.test('replay is a no-op for output and queue; older functions stay safe with season items',async()=>{
    await db.exec("INSERT INTO ranking_dirty_log(kind,season_id) VALUES('season',NULL),('season',fid(2001));");
    const before=await queue(db);
    await db.exec(p1p2);
    assert.deepEqual(await queue(db),before);
    await db.exec(m15);
    await drain(db);
    await db.exec(p1p2);
    await refreshLegacy(db); await parity(db,'replay');
  });

  await t.test('grants: client roles denied, service_role allowed',async()=>{
    for(const role of ['anon','authenticated']){
      await db.exec('SET ROLE '+role);
      await assert.rejects(db.query('SELECT apply_ranking_deltas(200)'),/permission denied/);
      await assert.rejects(db.query('SELECT get_ranking_shadow_metrics()'),/permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    await db.query('SELECT apply_ranking_deltas(200)');
    await db.query('SELECT get_ranking_shadow_metrics()');
    await db.exec('RESET ROLE');
  });
});
