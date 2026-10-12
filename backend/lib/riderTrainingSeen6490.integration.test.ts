// #6490 · rider_training_seen erstatter GIN-opslaget i training_day_runs.
//
// Del 1 (PGlite, kører altid, også i CI): migrationen
// database/2026-10-12-6490-rider-training-seen.sql er idempotent, backfill =
// rebuild, triggeren dækker INSERT + UPDATE OF report for dato- og legacy-
// rapporter og springer ugyldige rider_id over uden at fejle skrivningen, de
// tre læsere bruger tabellen med uændret first-use-semantik, PARITET mod det
// gamle JSON-prædikat på fixture-data, og rollback-blokken i filhovedet virker.
//
// Del 2 (rigtig PostgreSQL 17, opt-in): samtidige skrivere med overlappende
// nye ryttere (pgbench, flere klienter) uden deadlock, og - hvis
// RIDER_SEEN_BENCH_OUT er sat - WAL/latens for 100 commit_training_date_tick-kald
// før migrationen (GIN), efter (GIN) og efter uden GIN. Kræver
// RANKING_TEST_PG_BIN (PG17-binærer) + RANKING_TEST_SCRATCH (lanens scratch),
// samme mønster som backend/routes/rankings.5692.test.ts. Uden dem skippes del 2
// med en tydelig begrundelse; CI har ingen PG17-binærer.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { PGlite } from '@electric-sql/pglite';

const migrationUrl = new URL('../../database/2026-10-12-6490-rider-training-seen.sql', import.meta.url);
const dbFile = (name: string) => new URL(`../../database/${name}`, import.meta.url);
// Prod-rækkefølgen for de berørte funktioner før #6490.
const PRIOR_MIGRATIONS = [
  '2026-09-29-5928-training-condition-date.sql',
  '2026-09-29-5928-training-condition-partial.sql',
  '2026-10-10-6439-training-follows-rider.sql',
  '2026-10-03-6061-first-use-rider-condition.sql',
  '2026-10-11-academy-sign-latency.sql',
];

// Syntetiske uuid'er (fixture), aldrig prod-id'er.
const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const SEASON = uid(0x5e);
const TEAM_A = uid(0xa1);
const TEAM_B = uid(0xb1);

const BASE_SCHEMA = `
  CREATE TABLE app_config(key text PRIMARY KEY,value jsonb,updated_at timestamptz DEFAULT now());
  CREATE TABLE riders(id uuid PRIMARY KEY,team_id uuid,is_retired boolean DEFAULT false,acquired_at timestamptz,created_at timestamptz DEFAULT now(),primary_type text,secondary_type text,potentiale numeric,birthdate date,firstname text,lastname text,is_academy boolean DEFAULT false,squad text);
  CREATE TABLE teams(id uuid PRIMARY KEY,name text,user_id uuid,league_division_id integer,u23_league_division_id integer,junior_league_division_id integer);
  CREATE TABLE races(id uuid PRIMARY KEY,season_id uuid,league_division_id integer,race_type text);
  CREATE TABLE race_stage_schedule(race_id uuid,stage_number integer,game_day integer,scheduled_at timestamptz);
  CREATE TABLE race_results(rider_id uuid,race_id uuid,stage_number integer,result_type text);
  CREATE TABLE race_incidents(rider_id uuid,race_id uuid,stage_number integer,kind text,outcome text,injury_days integer);
  CREATE TABLE race_simulation_runs(id uuid PRIMARY KEY,race_id uuid,stage_number integer,seed bigint,engine_version integer,entrant_snapshot jsonb,input_checksum bigint,source text,salt_version text,UNIQUE(race_id,stage_number));
  CREATE TABLE race_simulation_rider_scores(run_id uuid,rider_id uuid,rank integer,components jsonb);
  CREATE TABLE race_entry_days(rider_id uuid,season_id uuid,game_day integer,race_id uuid);
  CREATE TABLE race_stage_profiles(race_id uuid,stage_number integer,profile_type text);
  CREATE TABLE rider_derived_abilities(rider_id uuid PRIMARY KEY,climbing integer,ability_progress jsonb);
  CREATE TABLE rider_condition(rider_id uuid PRIMARY KEY,form smallint,fatigue smallint,injured_until date,injury_cause text,updated_at timestamptz,injury_end_game_day integer,injury_season_id uuid,injury_race_days_left integer);
  CREATE TABLE training_day_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),team_id uuid NOT NULL,tick_date date NOT NULL,executed_by text NOT NULL DEFAULT 'assistant',bonus_applied boolean NOT NULL DEFAULT false,report jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),season_id uuid,game_day integer,squad text NOT NULL DEFAULT 'senior');
  CREATE UNIQUE INDEX uniq_training_day_runs_team_season_squad_game_day ON training_day_runs(team_id,season_id,COALESCE(squad,'senior'),game_day) WHERE game_day IS NOT NULL;
  CREATE INDEX idx_training_day_runs_team_date ON training_day_runs(team_id,tick_date DESC);
  CREATE INDEX idx_training_day_runs_report_riders ON training_day_runs USING gin((report->'riders') jsonb_path_ops);
  CREATE TABLE rider_derived_ability_history(rider_id uuid,snapshot_date date,source text,season_number integer,abilities jsonb,created_at timestamptz DEFAULT now(),UNIQUE(rider_id,snapshot_date,source));
  CREATE TABLE rider_ability_race_day_history(rider_id uuid,season_id uuid,game_day integer,source text,season_number integer,snapshot_date date,abilities jsonb,UNIQUE(rider_id,season_id,game_day,source));
  CREATE TABLE rider_training_scores(rider_id uuid,team_id uuid,season_id uuid,tick_date date,game_day integer,score integer,session text,day_type text,was_race_day boolean,intention text,contributions jsonb);
  CREATE TABLE training_plans(rider_id uuid,team_id uuid,season_id uuid,focus text,intensity text,updated_at timestamptz);
  CREATE TABLE training_week_plans(team_id uuid,rider_id uuid,days jsonb,updated_at timestamptz);
  CREATE TABLE team_staff(id uuid,team_id uuid,role text,status text,fired_season integer,created_at timestamptz);
  CREATE TABLE staff_derived_abilities(staff_id uuid,updated_at timestamptz);
  CREATE TABLE team_facilities(id uuid,team_id uuid,track text,tier integer,updated_at timestamptz);
  CREATE TABLE finance_transactions(team_id uuid,idempotency_key text,created_at timestamptz);
  CREATE TABLE training_compensation_receipts(rider_id uuid NOT NULL,season_id uuid NOT NULL,game_day integer NOT NULL,tick_date date NOT NULL,team_id uuid NOT NULL,plan_hash text NOT NULL,payload jsonb NOT NULL,applied_at timestamptz NOT NULL,PRIMARY KEY(rider_id,season_id,game_day));
`;

/** Det gamle prædikat, ordret som i de tre læsere før #6490. */
const OLD_JSON_PREDICATE = `EXISTS(SELECT 1 FROM training_day_runs WHERE report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',$1::uuid)))`;
const NEW_PREDICATE = 'EXISTS(SELECT 1 FROM rider_training_seen WHERE rider_id=$1::uuid)';
const READERS = [
  'public.initialize_first_use_rider_condition()',
  'public.register_training_date_work(uuid,uuid,date,integer[],uuid[],timestamptz,timestamptz)',
  'public.apply_training_compensation_6061(text,text,timestamptz)',
];

const entry = (riderId: unknown, extra: Record<string, unknown> = {}) => ({ rider_id: riderId, intensity: 'normal', ...extra });
const reportOf = (riders: unknown) => JSON.stringify({ riders, condition_per_date: true });

function rollbackBlock(source: string) {
  const start = source.indexOf('-- ROLLBACK-BEGIN');
  const end = source.indexOf('-- ROLLBACK-END');
  assert.ok(start > 0 && end > start, 'rollback block markers present in the migration header');
  return source.slice(start, end).split('\n').slice(1)
    .map(line => line.replace(/^-- ?/, ''))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Del 1: PGlite
// ---------------------------------------------------------------------------
let db: PGlite;
let migration: string;

async function exists(predicate: string, riderId: string) {
  return (await db.query<{ v: boolean }>(`SELECT ${predicate} AS v`, [riderId])).rows[0].v;
}
async function seenRows() {
  return (await db.query<{ rider_id: string; first_seen_date: string; first_team_id: string | null; first_run_id: string | null }>(
    "SELECT rider_id,to_char(first_seen_date,'YYYY-MM-DD') AS first_seen_date,first_team_id,first_run_id FROM rider_training_seen ORDER BY rider_id")).rows;
}
async function insertRun(team: string, tickDate: string, riders: unknown, gameDay: number | null = null) {
  const row = await db.query<{ id: string }>(
    'INSERT INTO training_day_runs(team_id,season_id,tick_date,game_day,report) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [team, SEASON, tickDate, gameDay, typeof riders === 'string' ? riders : reportOf(riders)]);
  return row.rows[0].id;
}

before(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE codex_readonly;');
  await db.exec(BASE_SCHEMA);
  for (const file of PRIOR_MIGRATIONS) await db.exec(await readFile(dbFile(file), 'utf8'));
  migration = await readFile(migrationUrl, 'utf8');
});
after(async () => { await db?.close(); });

// Historik FØR migrationen (backfill skal finde den), inkl. alle former.
const HIST = {
  perDate: [uid(1), uid(2), uid(3)],
  legacy: [uid(3), uid(4)], // uid(3) også i dato-rapporten
  validInMixed: uid(5),
  objectRiders: uid(6), // riders er et objekt, ikke et array: hverken gammelt eller nyt prædikat matcher
  tickOnly: uid(8),
  loadOnly: uid(9),
  never: uid(10),
};

test('migrationen er idempotent og backfill dækker dato-, legacy- og kvitteringshistorik', async () => {
  await insertRun(TEAM_A, '2026-10-01', HIST.perDate.map(id => entry(id)), 5);
  await insertRun(TEAM_B, '2026-09-20', HIST.legacy.map(id => entry(id)), null);
  await insertRun(TEAM_B, '2026-09-21', [entry('not-a-uuid'), entry(42), 'string-element', [1], { other: 1 }, entry(null), entry(HIST.validInMixed)], null);
  await insertRun(TEAM_B, '2026-09-22', JSON.stringify({ riders: { rider_id: HIST.objectRiders } }), null);
  await insertRun(TEAM_B, '2026-09-23', JSON.stringify({ condition_per_date: false }), null);
  await db.query('INSERT INTO riders(id,team_id) VALUES($1,NULL),($2,NULL)', [HIST.tickOnly, HIST.loadOnly]);
  await db.query('INSERT INTO races(id,season_id) VALUES($1,$2)', [uid(0x7a), SEASON]);
  await db.query("INSERT INTO training_rider_ticks(rider_id,season_id,game_day,tick_date,team_id,report) VALUES($1,$2,4,'2026-09-30',$3,'{}')", [HIST.tickOnly, SEASON, TEAM_A]);
  await db.query("INSERT INTO training_race_loads(rider_id,race_id,stage_number,season_id,game_day,tick_date,load) VALUES($1,$2,1,$3,4,'2026-09-29',10)", [HIST.loadOnly, uid(0x7a), SEASON]);

  await db.exec(migration);
  const first = await seenRows();
  await db.exec(migration); // genkørsel = no-op
  assert.deepEqual(await seenRows(), first, 'idempotent re-run');

  const ids = first.map(r => r.rider_id);
  assert.deepEqual(ids, [uid(1), uid(2), uid(3), uid(4), uid(5), uid(8), uid(9)].sort());
  const r3 = first.find(r => r.rider_id === uid(3))!;
  assert.equal(r3.first_seen_date, '2026-09-20', 'tidligste rapport vinder');
  assert.equal(r3.first_team_id, TEAM_B);
  const tick = first.find(r => r.rider_id === HIST.tickOnly)!;
  assert.equal(tick.first_run_id, null, 'kvittering har ingen rapport-id');
  assert.equal(tick.first_team_id, TEAM_A);
  assert.equal(first.find(r => r.rider_id === HIST.loadOnly)!.first_team_id, null);

  const rls = (await db.query<{ r: boolean }>("SELECT relrowsecurity AS r FROM pg_class WHERE oid='public.rider_training_seen'::regclass")).rows[0].r;
  assert.equal(rls, true, 'RLS slået til');
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await db.query<{ v: boolean }>(`SELECT has_table_privilege('${role}','public.rider_training_seen','SELECT') AS v`)).rows[0].v, false);
    assert.equal((await db.query<{ v: boolean }>(`SELECT has_function_privilege('${role}','public.rebuild_rider_training_seen()','EXECUTE') AS v`)).rows[0].v, false);
  }
  assert.equal((await db.query<{ v: boolean }>("SELECT has_table_privilege('service_role','public.rider_training_seen','INSERT') AS v")).rows[0].v, true);
  assert.equal((await db.query<{ v: boolean }>("SELECT has_table_privilege('codex_readonly','public.rider_training_seen','SELECT') AS v")).rows[0].v, true);
  assert.equal((await db.query<{ v: boolean }>("SELECT has_function_privilege('service_role','public.rebuild_rider_training_seen()','EXECUTE') AS v")).rows[0].v, true);
});

test('læserne bruger kun tabellen; GUC, search_path og grants er bevaret', async () => {
  for (const sig of READERS) {
    const row = (await db.query<{ def: string; cfg: string[] | null }>(`SELECT pg_get_functiondef('${sig}'::regprocedure) AS def, proconfig AS cfg FROM pg_proc WHERE oid='${sig}'::regprocedure`)).rows[0];
    assert.match(row.def, /rider_training_seen/, sig);
    assert.doesNotMatch(row.def, /@> jsonb_build_array/, `${sig}: JSON-leddet er væk`);
    assert.ok((row.cfg ?? []).some(c => c.startsWith('search_path=')), `${sig}: search_path`);
    assert.equal((await db.query<{ v: boolean }>(`SELECT has_function_privilege('authenticated','${sig}','EXECUTE') AS v`)).rows[0].v, false, `${sig}: ingen klientgrant`);
    assert.equal((await db.query<{ v: boolean }>(`SELECT has_function_privilege('service_role','${sig}','EXECUTE') AS v`)).rows[0].v, true, `${sig}: service_role`);
  }
  const cfg = (await db.query<{ cfg: string[] }>("SELECT proconfig AS cfg FROM pg_proc WHERE oid='public.initialize_first_use_rider_condition()'::regprocedure")).rows[0].cfg;
  assert.ok(cfg.includes('enable_seqscan=off'), '#6450-GUC bevaret');
});

test('triggeren: INSERT og UPDATE OF report, legacy og dato, ugyldige id springes over', async () => {
  const runId = await insertRun(TEAM_A, '2026-10-02', [entry(uid(20)), entry(uid(21)), entry(uid(20))], 1);
  let rows = await seenRows();
  const r20 = rows.find(r => r.rider_id === uid(20))!;
  assert.deepEqual(r20, { rider_id: uid(20), first_seen_date: '2026-10-02', first_team_id: TEAM_A, first_run_id: runId });
  // UPDATE af rapporten (commit_training_date_tick's sti) tilføjer kun nye ryttere.
  await db.query('UPDATE training_day_runs SET report=$2 WHERE id=$1', [runId, reportOf([entry(uid(20)), entry(uid(21)), entry(uid(22))])]);
  rows = await seenRows();
  assert.ok(rows.some(r => r.rider_id === uid(22)), 'ny rytter fra UPDATE');
  assert.deepEqual(rows.find(r => r.rider_id === uid(20)), r20, 'eksisterende række røres ikke');
  // UPDATE af en anden kolonne fyrer ikke triggeren.
  await db.query("UPDATE training_day_runs SET executed_by='manual' WHERE id=$1", [runId]);
  // Legacy-stien (game_day IS NULL) via direkte skrivning, som dailyTrainingEngine/PostgREST.
  await insertRun(TEAM_B, '2026-10-02', [entry(uid(23))], null);
  assert.ok((await seenRows()).some(r => r.rider_id === uid(23)), 'legacy-rapport fanget');
  // Ugyldige elementer fejler aldrig skrivningen.
  const before = (await seenRows()).length;
  await insertRun(TEAM_B, '2026-10-03', [entry('ABC'), entry({ nested: true }), 'x', 7, null, entry('00000000-0000-4000-8000-00000000002')], null);
  await insertRun(TEAM_B, '2026-10-04', JSON.stringify({ riders: null }), null);
  await insertRun(TEAM_B, '2026-10-05', JSON.stringify({ riders: 'none' }), null);
  assert.equal((await seenRows()).length, before, 'intet indsat for ugyldige id');
});

test('PARITET: EXISTS(seen) ≡ det gamle JSON-prædikat på fixture-data', async () => {
  const candidates = [...Array.from({ length: 30 }, (_, i) => uid(i + 1)), uid(0xdead), uid(0xbeef)];
  const ticksOrLoads = new Set([HIST.tickOnly, HIST.loadOnly]);
  let deviations = 0;
  for (const id of candidates) {
    const oldJson = await exists(OLD_JSON_PREDICATE, id);
    const seen = await exists(NEW_PREDICATE, id);
    // Tabellen rummer bevidst også kvitterings-/belastningsryttere; for dem er
    // det de samlede first-use-vagter (kvittering ELLER belastning ELLER rapport)
    // der skal være ens, og de er det, fordi kvitteringsleddet allerede er sandt.
    if (ticksOrLoads.has(id)) { assert.equal(seen, true, id); assert.equal(oldJson, false, id); continue; }
    if (oldJson !== seen) deviations++;
  }
  assert.equal(deviations, 0);
  assert.equal(await exists(OLD_JSON_PREDICATE, HIST.objectRiders), false);
  assert.equal(await exists(NEW_PREDICATE, HIST.objectRiders), false);
  // Mængde-paritet over hele fixturen: alle rapportryttere er i tabellen, og
  // tabellen har ingen ryttere uden kilde.
  const missing = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM training_day_runs t
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.report->'riders')='array' THEN t.report->'riders' ELSE '[]' END) e
    WHERE jsonb_typeof(e)='object'
      AND e->>'rider_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND NOT EXISTS(SELECT 1 FROM rider_training_seen s WHERE s.rider_id=(e->>'rider_id')::uuid)`)).rows[0].n;
  assert.equal(missing, 0);
  const extra = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM rider_training_seen s WHERE NOT (
    EXISTS(SELECT 1 FROM training_day_runs WHERE report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',s.rider_id)))
    OR EXISTS(SELECT 1 FROM training_rider_ticks t WHERE t.rider_id=s.rider_id)
    OR EXISTS(SELECT 1 FROM training_race_loads l WHERE l.rider_id=s.rider_id))`)).rows[0].n;
  assert.equal(extra, 0);
});

test('ikke-kanonisk (versal) rider_id tælles som set: bevidst sikrere end det gamle prædikat', async () => {
  const upper = uid(0xabc).toUpperCase();
  await insertRun(TEAM_B, '2026-10-06', [entry(upper)], null);
  assert.equal(await exists(OLD_JSON_PREDICATE, uid(0xabc)), false, 'gammelt prædikat matchede kun kanonisk tekst');
  assert.equal(await exists(NEW_PREDICATE, uid(0xabc)), true, 'nyt værn nulstiller aldrig en rytter med historik');
  await db.query('DELETE FROM training_day_runs WHERE tick_date=$1', ['2026-10-06']);
  await db.exec('SELECT public.rebuild_rider_training_seen()');
});

test('rebuild = backfill, og rebuild glemmer slettede rapporter', async () => {
  const live = await seenRows();
  const rebuilt = (await db.query<{ r: { before: number; after: number } }>('SELECT public.rebuild_rider_training_seen() AS r')).rows[0].r;
  assert.equal(rebuilt.after, live.length);
  const afterRebuild = await seenRows();
  await db.exec('DELETE FROM rider_training_seen');
  await db.exec(migration); // backfill fra tom tabel
  assert.deepEqual(await seenRows(), afterRebuild, 'backfill og rebuild giver samme rækker');
  // Insert-only: sletning af rapporter fjerner ikke rækken før rebuild.
  await db.query("DELETE FROM training_day_runs WHERE team_id=$1 AND tick_date='2026-10-02' AND game_day IS NULL", [TEAM_B]);
  assert.ok((await seenRows()).some(r => r.rider_id === uid(23)));
  await db.exec('SELECT public.rebuild_rider_training_seen()');
  assert.ok(!(await seenRows()).some(r => r.rider_id === uid(23)), 'rebuild fjerner rytter uden kilde');
});

test('first-use-semantik er uændret i trigger og registrering', async () => {
  await db.exec(`DELETE FROM app_config; INSERT INTO app_config(key,value) VALUES('training_condition_per_date','"on"'),('training_tick_per_race_day','"on"')`);
  const legacyRider = HIST.legacy[1];
  // Rytter med legacy-rapport under et andet hold: ejerskifte nulstiller ikke.
  await db.query('INSERT INTO riders(id,team_id,created_at) VALUES($1,NULL,now())', [legacyRider]);
  await db.query('UPDATE riders SET team_id=$2 WHERE id=$1', [legacyRider, TEAM_A]);
  assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM rider_condition WHERE rider_id=$1', [legacyRider])).rows[0].n, 0);
  // Ny rytter uden historik får neutral starttilstand.
  const fresh = uid(0xf1);
  await db.query('INSERT INTO riders(id,team_id,created_at) VALUES($1,$2,now())', [fresh, TEAM_A]);
  assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM rider_condition WHERE rider_id=$1', [fresh])).rows[0].n, 1);
  // register_training_date_work: samme vagt på datoen.
  await db.exec('DELETE FROM rider_condition');
  const registeredAt = '2026-10-07T10:00:00Z';
  await db.query(
    "SELECT public.register_training_date_work($1,$2,'2026-10-07',ARRAY[1,2,3,4,5],ARRAY[$3,$4]::uuid[],NULL,$5)",
    [TEAM_A, SEASON, legacyRider, fresh, registeredAt]);
  const conditions = (await db.query<{ rider_id: string }>('SELECT rider_id FROM rider_condition ORDER BY rider_id')).rows.map(r => r.rider_id);
  assert.deepEqual(conditions, [fresh], 'kun rytteren uden historik initialiseres');
  await db.exec('DELETE FROM app_config');
});

test('rollback-blokken i filhovedet gendanner JSON-læserne; migrationen kan derefter køres igen', async () => {
  await db.exec(rollbackBlock(migration));
  for (const sig of READERS) {
    const def = (await db.query<{ def: string }>(`SELECT pg_get_functiondef('${sig}'::regprocedure) AS def`)).rows[0].def;
    assert.match(def, /@> jsonb_build_array/, `${sig}: JSON-prædikat tilbage`);
    assert.doesNotMatch(def, /rider_training_seen/, sig);
  }
  assert.equal((await db.query<{ t: string | null }>("SELECT to_regclass('public.rider_training_seen')::text AS t")).rows[0].t, null);
  const cfg = (await db.query<{ cfg: string[] }>("SELECT proconfig AS cfg FROM pg_proc WHERE oid='public.initialize_first_use_rider_condition()'::regprocedure")).rows[0].cfg;
  assert.ok(cfg.includes('enable_seqscan=off'), 'rollback bevarer GUC');
  await db.exec(migration);
  assert.ok((await seenRows()).length > 0, 'gen-apply efter rollback');
});

// ---------------------------------------------------------------------------
// Del 2: rigtig PostgreSQL 17 (opt-in)
// ---------------------------------------------------------------------------
const pgBin = process.env.RANKING_TEST_PG_BIN;
const scratch = process.env.RANKING_TEST_SCRATCH;
const benchOut = process.env.RIDER_SEEN_BENCH_OUT;
const exe = (name: string) => join(pgBin ?? '', process.platform === 'win32' ? `${name}.exe` : name);

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((done, fail) => server.close(err => err ? fail(err) : done()));
  return address.port;
}

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
};

test('#6490 PG17: samtidige skrivere med overlappende nye ryttere uden deadlock (+ valgfri WAL-måling)', {
  skip: !pgBin || !scratch ? 'requires RANKING_TEST_PG_BIN (PostgreSQL 17 binaries) and RANKING_TEST_SCRATCH (lane scratch)' : false,
  timeout: 1_800_000,
}, async t => {
  const version = execFileSync(exe('postgres'), ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
  assert.match(version, /PostgreSQL\) 17\./, 'do not substitute PGlite or another major version');
  const runDir = mkdtempSync(join(resolve(scratch!), 'rider-seen-6490-'));
  const cluster = join(runDir, 'cluster');
  const port = await freePort();
  execFileSync(exe('initdb'), ['-D', cluster, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'], { windowsHide: true });
  // autovacuum off: GIN-pending-listen tømmes kun ved indsættelse, som spidserne i
  // prod (målingen skal se dem, ikke en heldig baggrundsoprydning).
  const server = spawn(exe('postgres'), ['-D', cluster, '-h', '127.0.0.1', '-p', String(port), '-c', 'autovacuum=off', '-c', 'max_connections=40'], { windowsHide: true });
  const stopped = once(server, 'exit');
  stopped.catch(() => {}); // expected when the cluster is stopped below
  t.after(async () => {
    if (server.exitCode === null) execFileSync(exe('pg_ctl'), ['-D', cluster, 'stop', '-m', 'fast', '-w'], { windowsHide: true });
    await stopped;
  });
  const psqlArgs = (dbName: string) => ['-X', '-q', '-A', '-t', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', dbName, '-v', 'ON_ERROR_STOP=1'];
  // Migrationernes IF EXISTS-NOTICEs er forventede; kun advarsler og fejl vises.
  const psqlOptions = { encoding: 'utf8' as const, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } };
  const sql = (statement: string, dbName = 'postgres') => execFileSync(exe('psql'), [...psqlArgs(dbName), '-c', statement], psqlOptions).trim();
  const sqlFile = (file: string, dbName: string) => execFileSync(exe('psql'), [...psqlArgs(dbName), '-f', file], psqlOptions).trim();
  for (let attempt = 0; ; attempt++) {
    try { if (sql('SELECT 1') === '1') break; } catch { /* expected while the server starts */ }
    assert.ok(attempt < 200, 'PG17 did not start');
    await new Promise(r => setTimeout(r, 50));
  }
  const migrationFile = join(runDir, 'migration-6490.sql');
  writeFileSync(migrationFile, migration);
  const writeAndRun = (name: string, body: string, dbName: string) => { const f = join(runDir, name); writeFileSync(f, body); return sqlFile(f, dbName); };

  sql('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE codex_readonly NOLOGIN;');
  sql('CREATE DATABASE fixture');
  writeAndRun('base.sql', BASE_SCHEMA, 'fixture');
  for (const file of PRIOR_MIGRATIONS) {
    const path = join(runDir, file);
    writeFileSync(path, await readFile(dbFile(file), 'utf8'));
    sqlFile(path, 'fixture');
  }

  // ---- Samtidighed: 4 klienter x 60 transaktioner, hver én rapport-INSERT med
  // 20 ryttere fra et vindue på 60 nye id'er i tilfældig JSON-rækkefølge, og en
  // pause inde i transaktionen så uafsluttede nøgler overlapper.
  sql('CREATE DATABASE conc TEMPLATE fixture');
  sqlFile(migrationFile, 'conc');
  const benchScript = join(runDir, 'concurrent.sql');
  writeFileSync(benchScript, [
    '\\set base random(1, 40)',
    'BEGIN;',
    "INSERT INTO training_day_runs(team_id,tick_date,report) SELECT gen_random_uuid(), DATE '2026-10-12', jsonb_build_object('riders', jsonb_agg(jsonb_build_object('rider_id', ('00000000-0000-4000-8000-' || lpad(to_hex(1048576 + :base + g), 12, '0'))::uuid) ORDER BY random())) FROM generate_series(0, 19) g;",
    'SELECT pg_sleep(0.005);',
    'END;',
  ].join('\n'));
  const deadlocksBefore = Number(sql("SELECT deadlocks FROM pg_stat_database WHERE datname='conc'"));
  const bench = spawnSync(exe('pgbench'), ['-n', '-c', '4', '-j', '4', '-t', '60', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-f', benchScript, 'conc'], { encoding: 'utf8', windowsHide: true });
  assert.equal(bench.status, 0, `pgbench failed: ${bench.stderr}`);
  assert.doesNotMatch(`${bench.stdout}\n${bench.stderr}`, /deadlock|ERROR/i);
  assert.match(bench.stdout, /number of failed transactions: 0/);
  assert.equal(Number(sql("SELECT deadlocks FROM pg_stat_database WHERE datname='conc'")), deadlocksBefore, 'ingen deadlocks');
  const distinctReported = sql(`SELECT count(DISTINCT e->>'rider_id') FROM training_day_runs t CROSS JOIN LATERAL jsonb_array_elements(t.report->'riders') e`, 'conc');
  assert.equal(sql('SELECT count(*) FROM rider_training_seen', 'conc'), distinctReported, 'alle samtidigt rapporterede ryttere er set');
  assert.equal(sql("SELECT count(*) FROM rider_training_seen s WHERE NOT EXISTS(SELECT 1 FROM training_day_runs t WHERE t.report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',s.rider_id)))", 'conc'), '0');
  t.diagnostic(`${version}; pgbench 4x60 overlapping writers: 0 failed, 0 deadlocks, seen=${distinctReported}`);

  if (!benchOut) { t.diagnostic('RIDER_SEEN_BENCH_OUT not set: WAL/latency measurement skipped'); return; }

  // ---- Måling: 100 commit_training_date_tick-kald (20 hold x 5 løbsdage).
  // History ~ prod's run count. ANALYZE empties GIN's pending list, which prod
  // never gets between settlements, so each GIN variant first re-fills it to
  // PREFILL_PAGES (default 4 MB limit = 512 pages) by rewriting history reports:
  // the 100 measured calls then cross the limit once and one call pays the
  // flush, as an unlucky prod call does.
  const TEAMS = 20, PER_TEAM = 25, HISTORY_RUNS = Number(process.env.RIDER_SEEN_BENCH_HISTORY ?? 40000);
  const PREFILL_PAGES = Number(process.env.RIDER_SEEN_BENCH_PREFILL_PAGES ?? 480);
  writeAndRun('bench-fixture.sql', `
    INSERT INTO app_config(key,value) VALUES('training_condition_per_date','"on"'),('training_tick_per_race_day','"on"')
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;
    CREATE TABLE bench_team(n int PRIMARY KEY, id uuid NOT NULL);
    INSERT INTO bench_team SELECT n, ('00000000-0000-4000-9000-' || lpad(to_hex(n), 12, '0'))::uuid FROM generate_series(1, ${TEAMS}) n;
    INSERT INTO riders(id,team_id,created_at)
      SELECT ('00000000-0000-4000-a000-' || lpad(to_hex(t.n * 100 + k), 12, '0'))::uuid, t.id, now() FROM bench_team t, generate_series(1, ${PER_TEAM}) k;
    INSERT INTO rider_condition(rider_id,form,fatigue,updated_at) SELECT id, 50, 10, now() - interval '1 day' FROM riders
      ON CONFLICT(rider_id) DO UPDATE SET form=EXCLUDED.form, fatigue=EXCLUDED.fatigue, updated_at=EXCLUDED.updated_at;
    -- Historik: mange tidligere rapporter (legacy-form) med en pulje af ryttere,
    -- inkl. målingens ryttere, så de allerede er "set" som i prod.
    INSERT INTO training_day_runs(team_id,tick_date,report)
      SELECT ('00000000-0000-4000-b000-' || lpad(to_hex(h % 400), 12, '0'))::uuid, DATE '2026-06-01' + (h / 400),
        jsonb_build_object('riders', (SELECT jsonb_agg(jsonb_build_object(
          'rider_id', CASE WHEN h % 10 = 0 AND k <= ${PER_TEAM} THEN ('00000000-0000-4000-a000-' || lpad(to_hex(((h / 10) % ${TEAMS} + 1) * 100 + k), 12, '0'))::uuid
                           ELSE ('00000000-0000-4000-c000-' || lpad(to_hex((h * 7 + k * 13) % 20000), 12, '0'))::uuid END,
          'intensity','normal','focus','climbing','session','tempo','score', (random() * 100)::int,
          'deltas', jsonb_build_object('climbing', round(random()::numeric, 4), 'flat', round(random()::numeric, 4),
            'tempo', round(random()::numeric, 4), 'endurance', round(random()::numeric, 4)),
          'form', 40 + (random() * 30)::int, 'fatigue', (random() * 60)::int, 'notes', md5(random()::text))) FROM generate_series(1, 25) k))
      FROM generate_series(1, ${HISTORY_RUNS}) h;
    ANALYZE;
    CREATE EXTENSION IF NOT EXISTS pgstattuple;
    CREATE EXTENSION IF NOT EXISTS pg_walinspect;
    CREATE UNLOGGED TABLE bench_log(variant text, n int, phase text, wal_bytes numeric, ms numeric);
    CREATE FUNCTION bench_commit(p_team uuid, p_day int) RETURNS jsonb LANGUAGE plpgsql AS $bench$
    DECLARE v_report jsonb; v_cond jsonb := '[]';
    BEGIN
      SELECT jsonb_build_object('riders', jsonb_agg(jsonb_build_object('rider_id', c.rider_id, 'game_day', p_day, 'intensity', 'normal',
          'condition_observed', to_jsonb(c), 'missing_evidence', '[]'::jsonb, 'form', c.form, 'fatigue', c.fatigue,
          'focus', 'climbing', 'session', 'tempo', 'score', (random() * 100)::int,
          'deltas', jsonb_build_object('climbing', round(random()::numeric, 4), 'flat', round(random()::numeric, 4),
            'tempo', round(random()::numeric, 4), 'endurance', round(random()::numeric, 4)),
          'notes', md5(random()::text)) ORDER BY c.rider_id), 'condition_per_date', true, 'game_day', p_day)
        INTO v_report FROM rider_condition c JOIN riders r ON r.id = c.rider_id WHERE r.team_id = p_team;
      IF p_day = 5 THEN
        SELECT jsonb_agg(to_jsonb(c)) INTO v_cond FROM rider_condition c JOIN riders r ON r.id = c.rider_id WHERE r.team_id = p_team;
      END IF;
      RETURN public.commit_training_date_tick(p_team, '${SEASON}'::uuid, 'senior', p_day, DATE '2026-10-12', ARRAY[1,2,3,4,5],
        'assistant', v_report, '[]', v_cond, '[]', '[]', '[]', '[]', false, clock_timestamp());
    END $bench$;
  `, 'fixture');

  const callScript = (variant: string) => {
    const lines: string[] = [];
    const timed = (phase: string, n: number, statement: string) => {
      lines.push("SELECT pg_current_wal_insert_lsn() AS l0, clock_timestamp() AS t0 \\gset");
      lines.push(statement);
      lines.push(`INSERT INTO bench_log VALUES('${variant}', ${n}, '${phase}', pg_wal_lsn_diff(pg_current_wal_insert_lsn(), :'l0'::pg_lsn), extract(epoch FROM clock_timestamp() - :'t0'::timestamptz) * 1000);`);
    };
    for (let team = 1; team <= TEAMS; team++) {
      timed('register', team, `SELECT public.register_training_date_work((SELECT id FROM bench_team WHERE n=${team}), '${SEASON}', DATE '2026-10-12', ARRAY[1,2,3,4,5], ARRAY(SELECT id FROM riders WHERE team_id=(SELECT id FROM bench_team WHERE n=${team}) ORDER BY id), NULL, TIMESTAMPTZ '2026-10-12 10:00:00+02') IS NOT NULL;`);
    }
    let n = 0;
    for (let day = 1; day <= 5; day++) {
      for (let team = 1; team <= TEAMS; team++) {
        timed('commit', ++n, `SELECT (public.bench_commit((SELECT id FROM bench_team WHERE n=${team}), ${day})->>'already_ran') = 'false' AS ok \\gset`);
        lines.push("\\if :ok\n\\else\nSELECT 1/0;\n\\endif");
      }
    }
    return lines.join('\n');
  };

  const results: Record<string, unknown> = { pg: version, history_runs: HISTORY_RUNS, prefill_pending_pages: PREFILL_PAGES, teams: TEAMS, riders_per_team: PER_TEAM };
  const variants: Array<{ name: string; setup: string[] }> = [
    { name: 'before_gin', setup: [] },
    { name: 'after_gin', setup: ['migration'] },
    { name: 'after_no_gin', setup: ['migration', 'DROP INDEX idx_training_day_runs_report_riders'] },
  ];
  for (const variant of variants) {
    const dbName = `bench_${variant.name}`;
    sql(`CREATE DATABASE ${dbName} TEMPLATE fixture`);
    for (const step of variant.setup) {
      if (step === 'migration') {
        const t0 = Date.now();
        sqlFile(migrationFile, dbName);
        results[`${variant.name}_migration_ms`] = Date.now() - t0;
      } else sql(step, dbName);
    }
    const hasGin = sql("SELECT to_regclass('idx_training_day_runs_report_riders') IS NOT NULL", dbName) === 't';
    const pendingPages = () => Number(sql("SELECT pending_pages FROM pgstatginindex('idx_training_day_runs_report_riders')", dbName));
    const rewrite = (offset: number, count: number) => sql(`UPDATE training_day_runs SET report = report || jsonb_build_object('prefill', true)
        WHERE id IN (SELECT id FROM training_day_runs WHERE game_day IS NULL ORDER BY tick_date, id OFFSET ${offset} LIMIT ${count})`, dbName);
    // Steady state: fill the pending list to just under the flush limit (with
    // GIN), or rewrite the same number of history runs (without GIN).
    let prefilled = 0;
    if (hasGin) {
      while (pendingPages() < PREFILL_PAGES && prefilled < 20_000) { rewrite(prefilled, 10); prefilled += 10; }
      results.prefill_runs = prefilled;
    } else if (typeof results.prefill_runs === 'number') {
      rewrite(0, results.prefill_runs);
    }
    sql('CHECKPOINT', dbName);
    results[`${variant.name}_gin_bytes`] = Number(sql("SELECT COALESCE(pg_relation_size(to_regclass('idx_training_day_runs_report_riders')),0)", dbName));
    const pending = () => hasGin ? sql("SELECT pending_pages || ' pages/' || pending_tuples || ' tuples' FROM pgstatginindex('idx_training_day_runs_report_riders')", dbName) : 'none';
    results[`${variant.name}_gin_pending_before`] = pending();
    const f = join(runDir, `calls-${variant.name}.sql`);
    writeFileSync(f, callScript(variant.name));
    const startLsn = sql('SELECT pg_current_wal_insert_lsn()', dbName);
    sqlFile(f, dbName);
    const endLsn = sql('SELECT pg_current_wal_insert_lsn()', dbName);
    results[`${variant.name}_gin_pending_after`] = pending();
    // WAL fordelt på relation for hele kørslen (registrering + 100 afregninger).
    const byRel = sql(`SELECT rel || '=' || bytes FROM (
        SELECT COALESCE(c.relname, 'relfilenode:' || b.relfilenode) AS rel, sum(b.block_data_length + b.block_fpi_length) AS bytes
          FROM pg_get_wal_block_info('${startLsn}', '${endLsn}') b LEFT JOIN pg_class c ON c.relfilenode = b.relfilenode
         GROUP BY 1) x ORDER BY bytes DESC LIMIT 12`, dbName)
      .split('\n').filter(Boolean).map(line => { const at = line.lastIndexOf('='); return [line.slice(0, at), Number(line.slice(at + 1))] as const; });
    const totalWal = Number(sql(`SELECT pg_wal_lsn_diff('${endLsn}', '${startLsn}')`, dbName));
    results[`${variant.name}_wal_total_kb`] = Math.round(totalWal / 1000);
    results[`${variant.name}_wal_by_relation_kb`] = Object.fromEntries(byRel.map(([rel, bytes]) => [rel, Math.round(bytes / 1000)]));
    const ginBytes = byRel.find(([rel]) => rel === 'idx_training_day_runs_report_riders')?.[1] ?? 0;
    results[`${variant.name}_gin_wal_share_pct`] = Math.round(ginBytes / totalWal * 1000) / 10;
    for (const phase of ['register', 'commit']) {
      const rows = sql(`SELECT wal_bytes || ',' || ms FROM bench_log WHERE variant='${variant.name}' AND phase='${phase}' ORDER BY n`, dbName)
        .split('\n').filter(Boolean).map(line => line.split(',').map(Number));
      const wal = rows.map(r => r[0]), ms = rows.map(r => r[1]);
      results[`${variant.name}_${phase}`] = {
        calls: rows.length,
        wal_kb_mean: Math.round(wal.reduce((a, b) => a + b, 0) / rows.length / 100) / 10,
        wal_kb_p95: Math.round(quantile(wal, 0.95) / 100) / 10,
        wal_kb_max: Math.round(Math.max(...wal) / 100) / 10,
        ms_p50: Math.round(quantile(ms, 0.5) * 10) / 10,
        ms_p95: Math.round(quantile(ms, 0.95) * 10) / 10,
        ms_max: Math.round(Math.max(...ms) * 10) / 10,
      };
    }
    // Afregningen virkede ens i alle varianter: 500 kvitteringer, alle datoer komplette.
    assert.equal(sql('SELECT count(*) FROM training_rider_ticks', dbName), String(TEAMS * PER_TEAM * 5));
    assert.equal(sql("SELECT count(*) FROM training_date_work WHERE status='complete'", dbName), String(TEAMS));
    if (variant.setup.includes('migration')) {
      assert.equal(sql(`SELECT count(*) FROM training_day_runs t CROSS JOIN LATERAL jsonb_array_elements(t.report->'riders') e
        WHERE NOT EXISTS(SELECT 1 FROM rider_training_seen s WHERE s.rider_id=(e->>'rider_id')::uuid)`, dbName), '0', 'paritet efter måling');
    }
  }
  mkdirSync(dirname(resolve(benchOut)), { recursive: true });
  writeFileSync(resolve(benchOut), JSON.stringify(results, null, 2));
  t.diagnostic(`bench written to ${resolve(benchOut)}`);
});
