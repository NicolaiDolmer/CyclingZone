// #6450: akademi-signering tog 8-13 s, fordi first-use-triggeren på riders
// (trg_initialize_first_use_rider_condition) probede training_day_runs med en
// sekventiel scanning der detoaster hver rapport. Migrationen
// database/2026-10-11-academy-sign-latency.sql sætter enable_seqscan=off lokalt
// på trigger-funktionen, så proben bruger GIN-indekset på report->'riders'.
//
// Testene låser: (1) funktionen bærer den lokale GUC efter migrationen, også
// når den køres to gange; (2) under den GUC vælger planneren GIN-indekset for
// præcis triggerens probe, også som generisk plan (sådan plpgsql cacher den),
// mens standard-planen er den sekventielle scanning der var rod-årsagen; (3)
// first-use-semantikken er uændret (ny rytter får start-tilstand, en legacy-
// rapport under et andet hold forhindrer stadig en automatisk nulstilling).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const rider = '00000000-0000-0000-0000-000000006450';
const team = '00000000-0000-0000-0000-000000000002';
const acquired = '2026-10-11T08:00:00Z';
const PROBE = `SELECT EXISTS(SELECT 1 FROM training_day_runs
  WHERE report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',$1::uuid)))`;

let db;
let migration;

async function planText(sql) {
  // Simpel protokol (exec): GENERIC_PLAN med $1 kan ikke bindes via query().
  const results = await db.exec(`EXPLAIN (GENERIC_PLAN) ${sql}`);
  return results.at(-1).rows.map((r) => r['QUERY PLAN']).join('\n');
}

async function functionConfig() {
  const row = (await db.query(
    "SELECT proconfig FROM pg_proc WHERE oid='public.initialize_first_use_rider_condition()'::regprocedure",
  )).rows[0];
  return row?.proconfig ?? [];
}

before(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE TABLE app_config(key text PRIMARY KEY,value jsonb);
  CREATE TABLE riders(id uuid PRIMARY KEY,team_id uuid,is_retired boolean DEFAULT false,acquired_at timestamptz,created_at timestamptz);
  CREATE TABLE rider_condition(rider_id uuid PRIMARY KEY REFERENCES riders(id),form integer,fatigue integer,injured_until date,injury_cause text,updated_at timestamptz);
  CREATE TABLE training_race_loads(rider_id uuid,consumed_at timestamptz);
  CREATE TABLE training_rider_ticks(rider_id uuid);
  CREATE TABLE training_condition_settlements(rider_id uuid);
  CREATE TABLE training_day_runs(id bigserial PRIMARY KEY,report jsonb);
  CREATE INDEX idx_training_day_runs_report_riders ON training_day_runs USING gin ((report->'riders') jsonb_path_ops);
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
  GRANT INSERT,UPDATE ON riders,rider_condition TO service_role;`);
  // Store rapporter med mange ryttere, ligesom i prod: planneren skal have en
  // tabel hvor en sekventiel EXISTS-scanning ser billig ud.
  await db.exec(`INSERT INTO training_day_runs(report)
    SELECT jsonb_build_object('riders', (
      SELECT jsonb_agg(jsonb_build_object('rider_id', gen_random_uuid(), 'note', repeat('x', 40)))
      FROM generate_series(1, 25) WHERE g > 0))
    FROM generate_series(1, 4000) g;
    ANALYZE training_day_runs;`);
  await db.exec(await readFile(new URL('../../database/2026-10-03-6061-first-use-rider-condition.sql', import.meta.url), 'utf8'));
  migration = await readFile(new URL('../../database/2026-10-11-academy-sign-latency.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
});

after(async () => db?.close());

beforeEach(async () => {
  await db.exec(`TRUNCATE riders,rider_condition,training_race_loads,training_rider_ticks,training_condition_settlements CASCADE;
  DELETE FROM training_day_runs WHERE report->>'legacy_6450' = 'true';
  DELETE FROM app_config;
  INSERT INTO app_config VALUES('training_condition_per_date','"on"'),('training_tick_per_race_day','"on"');`);
});

test('trigger-funktionen bærer enable_seqscan=off og beholder search_path (idempotent)', async () => {
  const config = await functionConfig();
  assert.ok(config.includes('enable_seqscan=off'), `proconfig: ${JSON.stringify(config)}`);
  assert.ok(config.some((c) => c.startsWith('search_path=')), `proconfig: ${JSON.stringify(config)}`);
  assert.equal(config.filter((c) => c.startsWith('enable_seqscan=')).length, 1);
});

test('triggeren er uændret: AFTER INSERT OR UPDATE OF team_id, én pr. række', async () => {
  const def = (await db.query(
    "SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgname='trg_initialize_first_use_rider_condition'",
  )).rows.map((r) => r.def);
  assert.equal(def.length, 1);
  assert.match(def[0], /AFTER INSERT OR UPDATE OF team_id ON public\.riders FOR EACH ROW/);
});

test('under funktionens GUC bruger probens generiske plan GIN-indekset, ikke en seq scan', async () => {
  const config = await functionConfig();
  await db.exec('BEGIN');
  try {
    for (const entry of config.filter((c) => c.startsWith('enable_seqscan='))) {
      const [name, value] = entry.split('=');
      await db.exec(`SET LOCAL ${name} = ${value}`);
    }
    const plan = await planText(PROBE);
    assert.match(plan, /Bitmap Index Scan on idx_training_day_runs_report_riders/, plan);
    assert.doesNotMatch(plan, /Seq Scan on training_day_runs/, plan);
  } finally {
    await db.exec('ROLLBACK');
  }
});

test('rod-årsagen: standard-planen for samme EXISTS-probe er en sekventiel scanning', async () => {
  const plan = await planText(PROBE);
  assert.match(plan, /Seq Scan on training_day_runs/, plan);
});

test('ny rytter uden historik får stadig start-tilstand ved første hold', async () => {
  await db.query('INSERT INTO riders(id,team_id,created_at) VALUES($1,NULL,$2)', [rider, acquired]);
  await db.query('UPDATE riders SET team_id=$1,acquired_at=$2 WHERE id=$3', [team, acquired, rider]);
  const rows = (await db.query('SELECT form,fatigue FROM rider_condition WHERE rider_id=$1', [rider])).rows;
  assert.deepEqual(rows, [{ form: 50, fatigue: 0 }]);
});

test('legacy-rapport under et andet hold forhindrer stadig automatisk nulstilling', async () => {
  await db.query('INSERT INTO riders(id,team_id,created_at) VALUES($1,NULL,$2)', [rider, acquired]);
  await db.query('INSERT INTO training_day_runs(report) VALUES($1)', [
    JSON.stringify({ legacy_6450: 'true', riders: [{ rider_id: rider, note: 'legacy' }] }),
  ]);
  await db.query('UPDATE riders SET team_id=$1 WHERE id=$2', [team, rider]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n, 0);
});

test('GUC lækker ikke ud af triggeren til kalderens session', async () => {
  await db.query('INSERT INTO riders(id,team_id,created_at) VALUES($1,$2,$3)', [rider, team, acquired]);
  const setting = (await db.query("SELECT current_setting('enable_seqscan') AS v")).rows[0].v;
  assert.equal(setting, 'on');
});

test('public-roller har stadig ingen EXECUTE på trigger-funktionen', async () => {
  const grants = (await db.query(
    "SELECT has_function_privilege('authenticated','initialize_first_use_rider_condition()','EXECUTE') AS auth, has_function_privilege('anon','initialize_first_use_rider_condition()','EXECUTE') AS anon",
  )).rows[0];
  assert.deepEqual(grants, { auth: false, anon: false });
});
