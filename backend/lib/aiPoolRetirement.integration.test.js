import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { retireAiTeam } from './aiTeamRetirement.js';
import { runAiTeamTrimHealSweep } from './aiTeamTrimHealSweep.js';
import { reconcileAiTeamsForPool, generateAndAllocateAiTeams, deleteAiTeamById } from './aiTeamGenerator.js';
import { previewSql } from '../scripts/preview-ai-pool-retirement-sql.mjs';
import { planRetirements, applyOneRetirement } from '../scripts/retire-stuck-ai-teams.js';

const NOW = '2026-09-09T12:00:00Z';
const AI = '00000000-0000-0000-0000-000000000001';
const RIDER = '10000000-0000-0000-0000-000000000001';
let db;
before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./testFixtures/aiPoolRetirement.sql', import.meta.url),'utf8'));
  // Execute the actual migration, not a JavaScript imitation of its SQL.
  await db.exec(await readFile(new URL('../../database/2026-09-09-4753-ai-pool-retirement.sql', import.meta.url), 'utf8'));
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`TRUNCATE race_stage_claims,notifications,rider_watchlist,auctions,swap_offers,transfer_listings,
    transfer_offers,race_results,race_entries,riders,races,teams,league_divisions CASCADE;
    INSERT INTO league_divisions VALUES (13,4,5,'Division 4 F');
    INSERT INTO teams(name,league_division_id) SELECT 'Manager '||i,13 FROM generate_series(1,23) i;
    INSERT INTO teams(id,name,is_ai,league_division_id) VALUES ('${AI}','AI',true,13);
    INSERT INTO riders(id,team_id,firstname,lastname) VALUES ('${RIDER}','${AI}','Test','Rider');`);
});
async function excess() { await db.exec("INSERT INTO teams(name,league_division_id) VALUES ('New manager',13)"); }
async function retire(id = AI) {
  return (await db.query('SELECT retire_ai_pool_team($1,$2) AS result', [id, NOW])).rows[0].result;
}
async function team() { return (await db.query('SELECT * FROM teams WHERE id=$1',[AI])).rows[0]; }
async function count() { return Number((await db.query('SELECT count(*) AS n FROM teams WHERE league_division_id=13')).rows[0].n); }

// Only the transport is adapted; planning, mutations and constraints run in SQL.
function client() {
  return {
    async rpc(name, args) {
      const keys=Object.keys(args);
      try {
        const call=`${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')})`;
        const set=name==='plan_ai_pool_retirements';
        const result=await db.query(set ? `SELECT * FROM ${call}` : `SELECT ${call} AS result`,Object.values(args));
        return { data:set ? result.rows : result.rows[0].result,error:null };
      } catch(error) { return {data:null,error}; }
    },
    from(table) {
      const clauses=[],values=[];
      const q={
        select(){return q;},order(){return q;},
        eq(key,value){values.push(value);clauses.push(`${key}=$${values.length}`);return q;},
        neq(key,value){values.push(value);clauses.push(`${key}<>$${values.length}`);return q;},
        gt(key,value){values.push(value);clauses.push(`${key}>$${values.length}`);return q;},
        async result(){return {data:(await db.query(`SELECT * FROM ${table}${clauses.length?' WHERE '+clauses.join(' AND '):''}`,values)).rows,error:null};},
        async range(from,to){const r=await q.result();return {...r,data:r.data.slice(from,to+1)};},
        async maybeSingle(){const r=await q.result();return {...r,data:r.data[0]??null};},
        then(resolve,reject){return q.result().then(resolve,reject);},
      };
      return q;
    },
  };
}

test('signup commits an AI retirement reservation in the same transaction', async () => {
  await excess();
  assert.ok((await team()).pending_removal_at);
  assert.equal(await count(),25);
});

test('the deployed legacy flag cannot activate the new SQL release', async () => {
  await db.exec("DELETE FROM app_config WHERE key='ai_pool_retirement_v2_enabled'");
  try {
    await excess();
    assert.equal((await team()).pending_removal_at,null);
    assert.equal((await retire()).reason,'disabled');
    assert.equal(await count(),25);
    assert.equal((await reconcileAiTeamsForPool({supabase:client(),poolId:13,now:new Date(NOW)})).removed,0);
    await db.query('UPDATE teams SET pending_removal_at=$1 WHERE id=$2',[NOW,AI]);
    await db.query("INSERT INTO transfer_offers(rider_id,seller_team_id,status) VALUES ($1,$2,'pending')",[RIDER,AI]);
    await db.query("INSERT INTO transfer_listings(rider_id,seller_team_id,status) VALUES ($1,$2,'open')",[RIDER,AI]);
    await db.query("INSERT INTO swap_offers(offered_rider_id,proposing_team_id,status) VALUES ($1,$2,'pending')",[RIDER,AI]);
    await db.query("INSERT INTO auctions(rider_id,seller_team_id,status) VALUES ($1,$2,'active')",[RIDER,AI]);
    const race=(await db.query('INSERT INTO races DEFAULT VALUES RETURNING id')).rows[0].id;
    await db.query('INSERT INTO race_entries VALUES ($1,$2,$3)',[race,RIDER,AI]);
    await db.query('INSERT INTO race_stage_claims(race_id,stage_index) VALUES ($1,1)',[race]);
    assert.equal(await count(),25);
  } finally {
    await db.exec("INSERT INTO app_config VALUES ('ai_pool_retirement_v2_enabled',to_jsonb('on'::text)) ON CONFLICT (key) DO UPDATE SET value=excluded.value");
  }
});
test('failed signup rolls back its retirement reservation too', async () => {
  await assert.rejects(db.transaction(async tx => {
    await tx.exec("INSERT INTO teams(name,league_division_id) VALUES ('New',13)");
    throw new Error('signup interrupted');
  }), /signup interrupted/);
  assert.equal((await team()).pending_removal_at,null);
  assert.equal(await count(),24);
});
test('terminal offers survive atomic retirement, together with rider and team history', async () => {
  for (const status of ['withdrawn','accepted','rejected']) {
    await db.query('INSERT INTO transfer_offers(rider_id,seller_team_id,status) VALUES ($1,$2,$3)',[RIDER,AI,status]);
  }
  await excess();
  const result = await retire();
  assert.equal(result.retired,true);
  assert.equal(await count(),24);
  assert.ok((await team()).retired_at);
  assert.equal(Number((await db.query('SELECT count(*) n FROM transfer_offers')).rows[0].n),3);
  const rider=(await db.query('SELECT * FROM riders WHERE id=$1',[RIDER])).rows[0];
  assert.equal(rider.is_retired,true);
  assert.equal(rider.team_id,null);
});
for (const status of ['pending','countered','awaiting_confirmation']) {
  test(`${status} deal defers retirement; completing it permits retry`, async () => {
    await db.query('INSERT INTO transfer_offers(rider_id,seller_team_id,status) VALUES ($1,$2,$3)',[RIDER,AI,status]);
    await excess();
    assert.equal((await retire()).retired,false);
    assert.equal(await count(),25);
    await db.exec("UPDATE transfer_offers SET status='withdrawn'");
    assert.equal((await retire()).retired,true);
  });
}
test('a failure after rider changes rolls back the entire retirement', async () => {
  await db.query('INSERT INTO rider_watchlist(user_id,rider_id) VALUES ($1,$2)',[AI,RIDER]);
  await excess();
  await db.exec(`CREATE FUNCTION fail_retirement_4753() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.retired_at IS NOT NULL THEN RAISE EXCEPTION 'injected interruption'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_retirement_4753 BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION fail_retirement_4753();`);
  try {
    await assert.rejects(retire(),/injected interruption/);
    assert.equal(await count(),25);
    assert.equal((await team()).retired_at,null);
    assert.equal((await db.query('SELECT team_id FROM riders WHERE id=$1',[RIDER])).rows[0].team_id,AI);
    assert.equal(Number((await db.query('SELECT count(*) n FROM notifications')).rows[0].n),0);
    assert.equal(Number((await db.query('SELECT count(*) n FROM rider_watchlist')).rows[0].n),1);
  } finally { await db.exec('DROP TRIGGER fail_retirement_4753 ON teams; DROP FUNCTION fail_retirement_4753()'); }
});
test('repeated retirement never reduces a pool below 24', async () => {
  await excess();
  assert.equal((await retire()).retired,true);
  assert.equal((await retire()).retired,false);
  assert.equal(await count(),24);
});
test('planner discovers excess even if every reservation was lost', async () => {
  await excess();
  await db.exec('UPDATE teams SET pending_removal_at=NULL');
  const before = await team();
  const rows = (await db.query('SELECT * FROM plan_ai_pool_retirements(13,$1)',[NOW])).rows;
  assert.equal(rows.length,1);
  assert.equal(rows[0].team_id,AI);
  assert.deepEqual(await team(),before,'dry-run cannot write');
  assert.equal((await retire()).retired,true);
});
test('draining prevents new deals but allows the existing deal to finish', async () => {
  await db.query("INSERT INTO transfer_offers(rider_id,status) VALUES ($1,'pending')",[RIDER]);
  await excess();
  await assert.rejects(db.query("INSERT INTO transfer_offers(rider_id,status) VALUES ($1,'pending')",[RIDER]),/draining/);
  await db.exec("UPDATE transfer_offers SET status='accepted'");
});
test('draining keeps ongoing race entries and clears future entries', async () => {
  const ongoing=(await db.query("INSERT INTO races(stages_completed) VALUES (1) RETURNING id")).rows[0].id;
  const future=(await db.query('INSERT INTO races DEFAULT VALUES RETURNING id')).rows[0].id;
  for (const race of [ongoing,future]) await db.query('INSERT INTO race_entries VALUES ($1,$2,$3)',[race,RIDER,AI]);
  await excess();
  assert.deepEqual((await db.query('SELECT race_id FROM race_entries')).rows.map(r=>r.race_id),[ongoing]);
  assert.equal((await retire()).reason,'inflight_entries');
  await assert.rejects(db.query('INSERT INTO race_entries VALUES ($1,$2,$3)',[future,RIDER,AI]),/draining/);
  await db.query("UPDATE races SET status='completed' WHERE id=$1",[ongoing]);
  assert.equal((await retire()).retired,true);
});
test('retirement RPC is unavailable to anon and authenticated',async () => {
  for (const role of ['anon','authenticated']) {
    assert.equal((await db.query("SELECT has_function_privilege($1,'retire_ai_pool_team(uuid,timestamp with time zone)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  }
});

test('service-role retirement works with RLS enabled while authenticated cannot invoke it', async () => {
  await excess();
  await db.exec('ALTER TABLE teams ENABLE ROW LEVEL SECURITY; ALTER TABLE riders ENABLE ROW LEVEL SECURITY');
  try {
    await assert.rejects(db.transaction(async tx => {
      await tx.exec('SET LOCAL ROLE authenticated');
      await tx.query('SELECT retire_ai_pool_team($1,$2)',[AI,NOW]);
    }), /permission denied/);
    const result = await db.transaction(async tx => {
      await tx.exec('SET LOCAL ROLE service_role');
      return tx.query('SELECT retire_ai_pool_team($1,$2) AS result',[AI,NOW]);
    });
    assert.equal(result.rows[0].result.retired,true);
    assert.equal(await count(),24);
  } finally {
    await db.exec('ALTER TABLE teams DISABLE ROW LEVEL SECURITY; ALTER TABLE riders DISABLE ROW LEVEL SECURITY');
  }
});

test('actual periodic sweep repairs an unmarked pool using the transaction',async () => {
  await excess();
  await db.exec('UPDATE teams SET pending_removal_at=NULL');
  const result=await runAiTeamTrimHealSweep({supabase:client(),now:new Date(NOW)});
  assert.equal(result.healed,1);
  assert.equal(result.failed,0);
  assert.equal(await count(),24);
});
test('signup reconcile uses the same retirement path and preserves dead offers',async () => {
  await db.query("INSERT INTO transfer_offers(rider_id,status) VALUES ($1,'accepted')",[RIDER]);
  await excess();
  const result=await reconcileAiTeamsForPool({supabase:client(),poolId:13,now:new Date(NOW)});
  assert.equal(result.removed,1);
  assert.equal(await count(),24);
  assert.equal(Number((await db.query('SELECT count(*) n FROM transfer_offers')).rows[0].n),1);
});
test('RPC wrapper propagates a deferred result instead of claiming success',async () => {
  await db.query("INSERT INTO transfer_offers(rider_id,status) VALUES ($1,'pending')",[RIDER]);
  await excess();
  assert.equal((await retireAiTeam(client(),AI,{now:new Date(NOW)})).retired,false);
  assert.equal(await count(),25);
});
test('a claimed first stage is protected even before stages_completed increments',async () => {
  const race=(await db.query('INSERT INTO races DEFAULT VALUES RETURNING id')).rows[0].id;
  await db.query('INSERT INTO race_entries VALUES ($1,$2,$3)',[race,RIDER,AI]);
  await db.query('INSERT INTO race_stage_claims VALUES ($1,0,$2,\'test\')',[race,NOW]);
  await excess();
  assert.equal(Number((await db.query('SELECT count(*) n FROM race_entries')).rows[0].n),1);
  assert.equal((await retire()).retired,false);
});
for (const flag of ['is_frozen','is_test_account']) {
  test(`${flag} AI cannot be selected or retired`,async()=>{
    await db.exec(`UPDATE teams SET ${flag}=true WHERE is_ai`);
    await excess();
    assert.equal((await retire()).retired,false);
    assert.equal(await count(),25);
  });
}
test('a draining team cannot join an existing auction as a new bidder',async()=>{
  const auction=(await db.query("INSERT INTO auctions(status) VALUES ('active') RETURNING id")).rows[0].id;
  await excess();
  await assert.rejects(db.query('UPDATE auctions SET current_bidder_id=$1 WHERE id=$2',[AI,auction]),/draining/);
});
test('a reservation persists when another team becomes unblocked',async()=>{
  await db.exec('DELETE FROM teams WHERE NOT is_ai AND id IN (SELECT id FROM teams WHERE NOT is_ai LIMIT 1)');
  const second=(await db.query("INSERT INTO teams(name,is_ai,league_division_id) VALUES ('AI 2',true,13) RETURNING id")).rows[0].id;
  await db.query("INSERT INTO transfer_offers(seller_team_id,status) VALUES ($1,'pending'),($2,'pending')",[AI,second]);
  await excess();
  assert.ok((await team()).pending_removal_at);
  await db.query("UPDATE transfer_offers SET status='withdrawn' WHERE seller_team_id=$1",[second]);
  await db.query('SELECT reserve_ai_pool_retirements(13,$1)',[NOW]);
  assert.ok((await team()).pending_removal_at);
});

test('pre-release read-only SQL and CLI use the actual retirement planner',async()=>{
  await excess();
  const direct=(await db.query('SELECT * FROM plan_ai_pool_retirements(13,$1)',[NOW])).rows;
  assert.deepEqual((await db.query(previewSql())).rows,direct);
  const plan=await planRetirements({supabase:client(),now:new Date(NOW)});
  assert.equal(plan.total_candidates,1);
  assert.equal(plan.pools[0].candidates[0].id,AI);
  await assert.rejects(applyOneRetirement({supabase:client(),plan,teamId:AI,ownerGo:false,now:new Date(NOW)}),/owner go/);
  await assert.rejects(applyOneRetirement({supabase:client(),plan,teamId:'missing',ownerGo:true,now:new Date(NOW)}),/no longer/);
  await applyOneRetirement({supabase:client(),plan,teamId:AI,ownerGo:true,now:new Date(NOW)});
  await assert.rejects(applyOneRetirement({supabase:client(),plan,teamId:AI,ownerGo:true,now:new Date(NOW)}),/not retired/);
});

test('draining closes an open listing and rejects reopening it',async()=>{
  await db.query("INSERT INTO transfer_listings(rider_id,seller_team_id,status) VALUES ($1,$2,'open')",[RIDER,AI]);
  await excess();
  assert.equal((await db.query('SELECT status FROM transfer_listings')).rows[0].status,'withdrawn');
  await assert.rejects(db.exec("UPDATE transfer_listings SET status='open'"),/draining/);
});

test('existing swap can re-counter with a new cash adjustment while draining',async()=>{
  await db.query("INSERT INTO swap_offers(proposing_team_id,status,cash_adjustment) VALUES ($1,'countered',10)",[AI]);
  await excess();
  await db.exec("UPDATE swap_offers SET status='pending',cash_adjustment=20");
  assert.equal((await retire()).reason,'live_swap_offers');
});

test('global reconciliation and dormant pool retirement preserve history',async()=>{
  await excess();
  assert.equal((await generateAndAllocateAiTeams({supabase:client(),now:new Date(NOW)})).removed,1);
  await db.exec("INSERT INTO teams(name,is_ai,league_division_id) VALUES ('Dormant AI',true,13); DELETE FROM teams WHERE NOT is_ai");
  assert.equal((await generateAndAllocateAiTeams({supabase:client(),now:new Date(NOW)})).removed,1);
  assert.equal(await count(),0);
  assert.equal(Number((await db.query('SELECT count(*) n FROM teams WHERE is_ai')).rows[0].n),2);
});

test('a frozen manager still occupies a slot during both top-up paths',async()=>{
  await db.exec('UPDATE teams SET is_frozen=true WHERE id=(SELECT id FROM teams WHERE NOT is_ai LIMIT 1)');
  const sb=client();
  assert.equal((await reconcileAiTeamsForPool({supabase:sb,poolId:13,now:new Date(NOW)})).created,0);
  assert.equal((await generateAndAllocateAiTeams({supabase:sb,now:new Date(NOW)})).created,0);
  assert.equal(await count(),24);
});

test('disabled flag pauses every automatic removal path, with no hard-delete fallback',async()=>{
  await excess();
  await db.exec("UPDATE app_config SET value=to_jsonb('off'::text)");
  try {
    assert.equal((await deleteAiTeamById(client(),AI,{now:new Date(NOW)})).deleted,false);
    assert.equal((await reconcileAiTeamsForPool({supabase:client(),poolId:13,now:new Date(NOW)})).removed,0);
    assert.equal((await runAiTeamTrimHealSweep({supabase:client(),now:new Date(NOW)})).paused,true);
    assert.equal(await count(),25);
  } finally { await db.exec("UPDATE app_config SET value=to_jsonb('on'::text)"); }
});

test('AI result history creates no cash entitlement and cannot block retirement',async()=>{
  const race=(await db.query("INSERT INTO races(status) VALUES ('completed') RETURNING id")).rows[0].id;
  await db.query('INSERT INTO race_results(race_id,rider_id,team_id,prize_money) VALUES ($1,$2,$3,1)',[race,RIDER,AI]);
  await excess();
  assert.equal((await retire()).retired,true);
  assert.equal((await db.query('SELECT team_id FROM race_results')).rows[0].team_id,AI);
});

test('sweep reports obsolete reservation cleanup instead of a permanent zero',async()=>{
  await db.query('UPDATE teams SET pending_removal_at=$1 WHERE id=$2',[NOW,AI]);
  const result=await runAiTeamTrimHealSweep({supabase:client(),now:new Date(NOW)});
  assert.equal(result.cleared,1);
  assert.equal(result.guard[0].reason,'obsolete_reservations');
  assert.equal((await team()).pending_removal_at,null);
});

test('a blocked reservation yields after 120 hours, but not before or on a new blocker',async()=>{
  const replacement='00000000-0000-0000-0000-000000000002';
  await db.query("INSERT INTO transfer_offers(rider_id,seller_team_id,status) VALUES ($1,$2,'pending')",[RIDER,AI]);
  await db.query("INSERT INTO teams(id,name,is_ai,league_division_id) VALUES ($1,'Replacement',true,13)",[replacement]);
  const plan=async()=> (await db.query('SELECT * FROM plan_ai_pool_retirements(13,$1)',[NOW])).rows[0];
  await db.query("UPDATE teams SET pending_removal_at=$1,pending_removal_blocked_since=$1,pending_removal_blocked_reason='live_transfer_offers' WHERE id=$2",['2026-09-04T12:00:01Z',AI]);
  assert.equal((await plan()).team_id,AI);
  await db.query("UPDATE teams SET pending_removal_blocked_since=$1 WHERE id=$2",['2026-09-04T12:00:00Z',AI]);
  assert.equal((await plan()).team_id,replacement);
  await db.query("UPDATE teams SET pending_removal_blocked_reason='live_auctions' WHERE id=$1",[AI]);
  assert.equal((await plan()).team_id,AI,'a different current blocker gets its own grace clock');
  await db.query("UPDATE teams SET pending_removal_blocked_reason='live_transfer_offers' WHERE id=$1",[AI]);
  assert.equal((await retire(replacement)).retired,true);
  assert.equal(await count(),24);
  assert.equal((await team()).retired_at,null);
  assert.equal((await team()).pending_removal_at,null);
  assert.equal(Number((await db.query('SELECT count(*) n FROM transfer_offers')).rows[0].n),1);
});

test('pending ownership handover must finish before retirement',async()=>{
  await db.query('UPDATE riders SET pending_team_id=(SELECT id FROM teams WHERE NOT is_ai LIMIT 1) WHERE id=$1',[RIDER]);
  await excess();
  assert.equal((await retire()).reason,'pending_transfer');
  await db.exec('UPDATE riders SET team_id=pending_team_id,pending_team_id=NULL');
  assert.equal((await retire()).retired,true);
  assert.equal((await db.query('SELECT is_retired FROM riders')).rows[0].is_retired,false);
});

test('watchlist notification and cleanup commit only with retirement and are retry-safe',async()=>{
  await db.query('INSERT INTO rider_watchlist(user_id,rider_id) VALUES ($1,$2)',[AI,RIDER]);
  await excess();
  assert.equal((await retire()).retired,true);
  await retire();
  assert.equal(Number((await db.query('SELECT count(*) n FROM notifications')).rows[0].n),1);
  assert.equal(Number((await db.query('SELECT count(*) n FROM rider_watchlist')).rows[0].n),0);
});
