import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CZ_READINESS_PGLITE_MODULE || '@electric-sql/pglite');
import * as readiness from './seasonTransitionReadiness.js';

const now = new Date('2026-10-25T19:00:00Z'); // 20:00 Copenhagen, after DST.
const season = { id: 's4', number: 4, end_date: '2026-10-25' };
let db;
// Actual local PostgreSQL predicates and pagination, exposed through the read-only
// subset of the Supabase builder used by this gate. No network or credentials.
function client(failTable = null) {
  return { from(table) {
    const filters = [], params = [], orders = [];
    let columns = '*';
    const bind = value => { params.push(value); return `$${params.length}`; };
    const chain = {
      select(value) { columns = value; return chain; },
      eq(key, value) { filters.push(`${key} = ${bind(value)}`); return chain; },
      in(key, values) { filters.push(`${key} = ANY(${bind(values)}::text[])`); return chain; },
      is(key, value) { assert.equal(value, null); filters.push(`${key} IS NULL`); return chain; },
      not(key, op, value) { assert.equal(op, 'is'); assert.equal(value, null); filters.push(`${key} IS NOT NULL`); return chain; },
      order(key) { orders.push(key); return chain; },
      async range(from, to) {
        if (table === failTable) return { data: null, error: { message: 'fixture read failure' } };
        const result = await db.query(`SELECT ${columns} FROM ${table}${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''}${orders.length ? ` ORDER BY ${orders.join(',')}` : ''} LIMIT ${to - from + 1} OFFSET ${from}`, params);
        return { data: result.rows, error: null };
      },
    };
    return chain;
  } };
}
before(async () => {
  db = new PGlite();
  const version = (await db.query('SHOW server_version')).rows[0].server_version;
  assert.match(version, /^(17|18)\./, 'embedded fixture PostgreSQL version');
  console.log(`Readiness fixture PostgreSQL ${version}`);
  await db.exec(`
    CREATE TABLE teams(id text PRIMARY KEY, league_division_id text DEFAULT 'd1', u23_league_division_id text, junior_league_division_id text, is_ai boolean DEFAULT false, parked_at timestamptz, assistant_autopick_enabled boolean, is_bank boolean DEFAULT false, is_frozen boolean DEFAULT false, is_test_account boolean DEFAULT false, created_at timestamptz, comeback_at timestamptz);
    CREATE TABLE riders(id text PRIMARY KEY, team_id text, is_retired boolean DEFAULT false, created_at timestamptz, acquired_at timestamptz);
    CREATE TABLE training_date_work(team_id text, season_id text, tick_date text, status text, PRIMARY KEY(team_id,season_id,tick_date));
    CREATE TABLE training_day_runs(id text PRIMARY KEY, team_id text, tick_date text, game_day integer, report jsonb);
  `);
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec(`TRUNCATE teams,riders,training_date_work,training_day_runs;
    INSERT INTO teams(id) VALUES('a'),('b');
    INSERT INTO riders(id,team_id) VALUES('ra','a'),('rb','b');
    INSERT INTO training_date_work VALUES('a','s4','2026-10-25','complete'),('b','s4','2026-10-25','complete');`);
});
const assess = (supabase = client(), extra = {}) => readiness.assessFinalTrainingDateSettlement({ supabase, season, now, ...extra });

test('25/10 20:00: all settled allows season-end (including needs_reconciliation)', async () => {
  await db.exec(`UPDATE training_date_work SET status='needs_reconciliation' WHERE team_id='b'`);
  const result = await assess();
  assert.equal(result.blocked, false);
  assert.equal(result.tick_date, '2026-10-25');
});
for (const status of ['pending', 'partial', 'unknown']) {
  test(`25/10 20:00: one ${status} blocks with date, team and status`, async () => {
    await db.query('UPDATE training_date_work SET status=$1 WHERE team_id=$2', [status, 'b']);
    const result = await assess();
    assert.equal(result.blocked, true);
    assert.match(result.detail, /2026-10-25/);
    assert.match(result.detail, new RegExp(`b.*${status}`));
  });
}
for (const allMissing of [false, true]) {
  test(`25/10 20:00: ${allMissing ? 'all registrations' : 'one registration'} missing blocks`, async () => {
    await db.exec(`DELETE FROM training_date_work${allMissing ? '' : " WHERE team_id='b'"}`);
    const result = await assess();
    assert.equal(result.blocked, true);
    assert.match(result.detail, /b.*missing_registration/);
  });
}
test('evidence for another season/date does not cover final date', async () => {
  await db.exec(`UPDATE training_date_work SET tick_date='2026-10-24' WHERE team_id='a'; UPDATE training_date_work SET season_id='s3' WHERE team_id='b'`);
  assert.equal((await assess()).blocked, true);
});
test('registered pending work still blocks after team is parked or loses all riders', async () => {
  await db.exec(`UPDATE teams SET parked_at='2026-10-25T18:00Z'; DELETE FROM riders; UPDATE training_date_work SET status='partial' WHERE team_id='b'`);
  assert.equal((await assess()).blocked, true);
});
test('missing work excludes inactive teams, teams not yet created/comeback and teams without riders', async () => {
  await db.exec(`DELETE FROM training_date_work; UPDATE teams SET parked_at='2026-10-24T10:00Z' WHERE id='a'; DELETE FROM riders WHERE team_id='b';
    INSERT INTO teams(id,is_bank) VALUES('bank',true);
    INSERT INTO teams(id,is_frozen) VALUES('frozen',true);
    INSERT INTO teams(id,is_test_account) VALUES('test',true);
    INSERT INTO teams(id,created_at) VALUES('new','2026-10-25T23:00Z');
    INSERT INTO teams(id,comeback_at) VALUES('return','2026-10-25T23:00Z');
    INSERT INTO riders(id,team_id) SELECT id,id FROM teams WHERE id NOT IN ('a','b');`);
  assert.equal((await assess()).blocked, false);
});
test('riders created/acquired after final date or retired do not require work', async () => {
  await db.exec(`DELETE FROM training_date_work; UPDATE riders SET is_retired=true WHERE team_id='a'; UPDATE riders SET acquired_at='2026-10-25T23:00Z' WHERE team_id='b'`);
  assert.equal((await assess()).blocked, false);
});
test('division-less fallback requires a finished report, not just a reservation', async () => {
  await db.exec(`UPDATE teams SET league_division_id=null WHERE id='b'; DELETE FROM training_date_work WHERE team_id='b';
    INSERT INTO training_day_runs VALUES('legacy','b','2026-10-25',null,'{"pending":true,"stage":"writing"}');`);
  assert.equal((await assess()).blocked, true);
  await db.exec(`UPDATE training_day_runs SET report='{"riders":[],"tick_date":"2026-10-25","game_day":null}'`);
  assert.equal((await assess()).blocked, false);
});
test('a legacy report cannot cover missing division-based work', async () => {
  await db.exec(`DELETE FROM training_date_work WHERE team_id='b'; INSERT INTO training_day_runs VALUES('legacy','b','2026-10-25',null,'{"riders":[],"tick_date":"2026-10-25","game_day":null}')`);
  assert.equal((await assess()).blocked, true);
});
for (const table of ['teams', 'riders', 'training_date_work', 'training_day_runs']) {
  test(`read failure on ${table} is fail-closed`, async () => {
    if (table === 'training_day_runs') await db.exec(`UPDATE teams SET league_division_id=null; DELETE FROM training_date_work`);
    await assert.rejects(() => assess(client(table)), /fixture read failure/);
  });
}
test('missing or future final date fails closed, season zero is exempt', async () => {
  assert.equal((await assess(client(), { season: { ...season, end_date: null } })).blocked, true);
  assert.equal((await assess(client(), { season: { ...season, end_date: '2026-10-26' } })).blocked, true);
  assert.equal((await assess(client(), { season: { id: 's0', number: 0 } })).blocked, false);
});
test('population and work pagination catch a missing registration after row 1000', async () => {
  await db.exec(`INSERT INTO teams(id) SELECT 'x'||lpad(n::text,4,'0') FROM generate_series(1,1001) n;
    INSERT INTO riders(id,team_id) SELECT id,id FROM teams WHERE id LIKE 'x%';
    INSERT INTO training_date_work SELECT id,'s4','2026-10-25','complete' FROM teams WHERE id LIKE 'x%' AND id != 'x1001';`);
  const result = await assess();
  assert.equal(result.blocked, true);
  assert.match(result.detail, /x1001.*missing_registration/);
});
test('season-end route checks settlement before claim and irreversible work', () => {
  const source = readFileSync(new URL('../routes/api.js', import.meta.url), 'utf8');
  const route = source.slice(source.indexOf('router.post("/admin/seasons/:id/end"'), source.indexOf('router.post("/admin/seasons/:id/end"') + 6500);
  assert.match(route, /assessFinalTrainingDateSettlement\(\{ supabase, season, now/);
  assert.ok(route.indexOf('if (trainingSettlement.blocked)') < route.indexOf('claimSeasonEndOrReject(supabase'));
  assert.ok(route.indexOf('if (trainingSettlement.blocked)') < route.indexOf('await processSeasonEnd(seasonId)'));
});



// Exercise the actual async route body with a fixed Date constructor, local SQL
// reads and a claim sentinel. A blocked request must never reach the first write.
for (const scenario of ['complete', 'pending', 'partial', 'missing', 'read_error']) {
  test(`season-end API at fixed 20:00: ${scenario} stops at the correct boundary`, async () => {
    if (scenario === 'pending' || scenario === 'partial') await db.query('UPDATE training_date_work SET status=$1 WHERE team_id=$2', [scenario, 'b']);
    if (scenario === 'missing') await db.exec('DELETE FROM training_date_work');
    const source = readFileSync(new URL('../routes/api.js', import.meta.url), 'utf8');
    const start = source.indexOf('router.post("/admin/seasons/:id/end"');
    const bodyStart = source.indexOf('async (req, res) => {', start) + 'async (req, res) => {'.length;
    const bodyEnd = source.indexOf('\n});', bodyStart);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const handler = new AsyncFunction('req', 'res', 'supabase', 'Date', 'assessSeasonEndBlockers', 'assessFinalTrainingDateSettlement', 'claimSeasonEndOrReject', 'captureApiRouteError', source.slice(bodyStart, bodyEnd));
    const fixture = client(scenario === 'read_error' ? 'riders' : null);
    const supabase = { from(table) {
      if (table === 'seasons') {
        const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: { ...season, status: 'active' }, error: null }) };
        return chain;
      }
      if (table === 'races') return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      return fixture.from(table);
    } };
    class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now.toISOString()])); } }
    let claimed = false, status = 200, response;
    const res = { status(value) { status = value; return res; }, json(value) { response = value; return res; } };
    await handler({ params: { id: season.id } }, res, supabase, FixedDate,
      async () => ({ blocked: false }), readiness.assessFinalTrainingDateSettlement,
      async () => { claimed = true; return false; }, () => {});
    assert.equal(claimed, scenario === 'complete');
    if (scenario !== 'complete') {
      assert.equal(status, scenario === 'read_error' ? 500 : 400);
      assert.match(response.error, scenario === 'read_error' ? /fixture read failure/ : /2026-10-25/);
    }
  });
}

test('season end_date accepts the existing timestamp representation', async () => {
  const result = await assess(client(), { season: { ...season, end_date: '2026-10-25T00:00:00+00:00' } });
  assert.equal(result.blocked, false);
  assert.equal(result.tick_date, '2026-10-25');
});
for (const status of ['active', 'completed']) {
  test(`direct/forced transition protects active source but preserves ${status} resume`, async () => {
    await db.exec('DELETE FROM training_date_work');
    const source = readFileSync(new URL('./seasonTransition.js', import.meta.url), 'utf8');
    const start = source.indexOf('export async function transitionToNextSeason(');
    const end = source.indexOf('  const log = [];', start);
    const prefix = source.slice(start, end).replace('export async function', 'async function');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const run = new AsyncFunction('buildTransitionPlan', 'assessFinalTrainingDateSettlement', 'args',
      prefix + '\nreturn { reachedFirstWrite: true };\n}\nreturn transitionToNextSeason(args);');
    const plan = { from_season: { ...season, status }, to_season: { id: 's5' } };
    const args = { supabase: client(), fromSeasonId: 's4', transitionAt: now, deps: { now } };
    if (status === 'active') {
      await assert.rejects(() => run(async () => plan, readiness.assessFinalTrainingDateSettlement, args), /2026-10-25.*missing_registration/);
      const preview = await run(async () => plan, readiness.assessFinalTrainingDateSettlement,
        { ...args, dryRun: true, deps: { now, carryOverManagerSetup: async () => ({}) } });
      assert.equal(preview.dryRun, true);
    } else {
      assert.deepEqual(await run(async () => plan, readiness.assessFinalTrainingDateSettlement, args), { reachedFirstWrite: true });
    }
  });
}
