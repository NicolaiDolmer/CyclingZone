// #7282: register_training_bridge_date_work mod en rigtig Postgres (PGlite). En brodato
// der indhentes efter sin frist skal faa rytternes starttilstand med, men kun naar intet
// har flyttet tilstanden siden; ellers er svaret praecis register_training_date_work's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const file = name => readFile(new URL(`../../database/${name}`, import.meta.url), 'utf8');
const TEAM = '00000000-0000-0000-0000-000000000001', RIDER = '00000000-0000-0000-0000-000000000002', SEASON = '00000000-0000-0000-0000-000000000003';
const DAYS = 'ARRAY[-10,-9,-8,-7,-6]';
// 26/10 indhentes 27/10 kl. 21 dansk tid, efter fristen 27/10 kl. 02.
const LATE = "'2026-10-27T20:00:00Z'";

async function database() {
  const db = new PGlite();
  await db.exec(await readFile(new URL('./__fixtures__/trainingHeldSchema.sql', import.meta.url), 'utf8'));
  for (const name of ['2026-09-29-5928-training-condition-date.sql', '2026-09-29-5928-training-condition-partial.sql',
    '2026-09-29-5928-training-condition-recovery.sql', '2026-09-29-5928-training-condition-initialization.sql']) await db.exec(await file(name));
  await db.exec('ALTER TABLE race_results ADD COLUMN rider_id uuid; ALTER TABLE training_day_runs ADD COLUMN id uuid DEFAULT gen_random_uuid()');
  for (const name of ['2026-09-30-5860-shared-race-day-recovery.sql', '2026-10-10-6439-training-follows-rider.sql',
    '2026-10-12-6490-rider-training-seen.sql']) await db.exec(await file(name));
  const migration = await file('2026-10-27-7282-bridge-date-registration.sql');
  await db.exec(migration); await db.exec(migration); // idempotent
  await db.exec(`INSERT INTO riders VALUES('${RIDER}','${TEAM}'); INSERT INTO rider_condition(rider_id,form,fatigue) VALUES('${RIDER}',61,37);`);
  return db;
}

const call = (fn, date, days = DAYS, at = LATE) =>
  `SELECT ${fn}('${TEAM}','${SEASON}','${date}',${days},ARRAY['${RIDER}']::uuid[],NULL,${at}) AS w`;

test('#7282 PGlite: sen brodato faar starttilstanden via bro-RPC\'en', async () => {
  const db = await database();
  // Kontrol: den almindelige registrering efter fristen gemmer intet snapshot (fejlen).
  const plain = (await db.query(call('register_training_date_work', '2026-10-25', 'ARRAY[-15,-14,-13,-12,-11]', "'2026-10-26T20:00:00Z'"))).rows[0].w;
  assert.deepEqual(plain.opening_conditions, {});
  await db.exec("DELETE FROM training_date_work");
  const work = (await db.query(call('register_training_bridge_date_work', '2026-10-26'))).rows[0].w;
  assert.equal(work.status, 'pending');
  assert.equal(work.opening_conditions[RIDER].form, 61);
  assert.equal(work.opening_conditions[RIDER].fatigue, 37);
  // Gentaget kald: datoen er frosset, intet aendres.
  await db.exec(`UPDATE rider_condition SET fatigue=5 WHERE rider_id='${RIDER}'`);
  const again = (await db.query(call('register_training_bridge_date_work', '2026-10-26', DAYS, "'2026-10-27T20:05:00Z'"))).rows[0].w;
  assert.equal(again.opening_conditions[RIDER].fatigue, 37);
});

test('#7282 PGlite: arbejde paa en senere dato => intet snapshot (kronologien kan ikke bevises)', async () => {
  const db = await database();
  await db.query(call('register_training_bridge_date_work', '2026-10-27', 'ARRAY[-5,-4,-3,-2,-1]', "'2026-10-27T19:00:00Z'"));
  const work = (await db.query(call('register_training_bridge_date_work', '2026-10-26'))).rows[0].w;
  assert.deepEqual(work.opening_conditions, {});
});

test('#7282 PGlite: bro-RPC\'en afviser loebsdage (>= 0)', async () => {
  const db = await database();
  await assert.rejects(db.query(call('register_training_bridge_date_work', '2026-10-28', 'ARRAY[0,1,2,3,4]')), /negative game days/);
  assert.equal((await db.query('SELECT count(*)::int n FROM training_date_work')).rows[0].n, 0);
});
