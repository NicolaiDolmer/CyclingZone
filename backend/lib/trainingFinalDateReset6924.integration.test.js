// #6924 (Codex P1 on PR #7143): the season-start hooks reset form and fatigue. A final
// date whose work was registered BEFORE the transition keeps its pre-reset opening
// snapshot, and commit_training_date_tick then quarantines every reset rider as
// unsafe_current_state. That is why the season-end gate only defers a final date with
// no registered work (seasonTransitionReadiness.assessFinalTrainingDateSettlement):
// work registered by the evening run after the transition opens from the reset state.
// Runs the live RPC bodies on PGlite, no injected writers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const file = name => readFile(new URL(`../../database/${name}`, import.meta.url), 'utf8');
const TEAM = '00000000-0000-0000-0000-000000000001', SEASON = '00000000-0000-0000-0000-000000000003';
const RIDERS = ['00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004'];
const DATE = '2026-10-25', DAYS = [5, 6, 7, 8, 9];

async function database() {
  const db = new PGlite();
  await db.exec(await readFile(new URL('./__fixtures__/trainingHeldSchema.sql', import.meta.url), 'utf8'));
  for (const name of ['2026-09-29-5928-training-condition-date.sql', '2026-09-29-5928-training-condition-partial.sql',
    '2026-09-29-5928-training-condition-recovery.sql', '2026-09-29-5928-training-condition-initialization.sql']) await db.exec(await file(name));
  await db.exec('ALTER TABLE race_results ADD COLUMN rider_id uuid; ALTER TABLE training_day_runs ADD COLUMN id uuid DEFAULT gen_random_uuid()');
  for (const name of ['2026-09-30-5860-shared-race-day-recovery.sql', '2026-10-10-6439-training-follows-rider.sql',
    '2026-10-12-6490-rider-training-seen.sql']) await db.exec(await file(name));
  for (const id of RIDERS) {
    await db.query('INSERT INTO riders VALUES($1,$2)', [id, TEAM]);
    await db.query("INSERT INTO rider_derived_abilities VALUES($1,50,'{}')", [id]);
    await db.query('INSERT INTO rider_condition(rider_id,form,fatigue) VALUES($1,50,60)', [id]);
  }
  return db;
}

const register = (db, at) => db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6) AS work',
  [TEAM, SEASON, DATE, DAYS, RIDERS, at]).then(result => result.rows[0].work);

async function commit(db, day, at) {
  const final = day === DAYS.at(-1);
  const current = (await db.query('SELECT * FROM rider_condition WHERE rider_id=ANY($1)', [RIDERS])).rows;
  const reports = RIDERS.map(id => {
    const observed = current.find(row => row.rider_id === id);
    return { rider_id: id, game_day: day, intensity: 'normal', condition_before_date: { form: observed.form, fatigue: observed.fatigue },
      condition_observed: observed, form: observed.form + 3, fatigue: observed.fatigue + 5, missing_evidence: [] };
  });
  const abilities = RIDERS.map(id => ({ riderId: id, patch: { climbing: 50 + day } }));
  const conditions = final ? reports.map(row => ({ ...row.condition_observed, rider_id: row.rider_id, form: row.form, fatigue: row.fatigue })) : [];
  const values = [TEAM, SEASON, 'senior', day, DATE, DAYS, 'assistant', JSON.stringify({ riders: reports, condition_per_date: true, condition_settled: final }),
    JSON.stringify(abilities), JSON.stringify(conditions), '[]', '[]', '[]', '[]', false, at];
  return (await db.query(`SELECT commit_training_date_tick(${values.map((_, i) => `$${i + 1}`).join(',')}) AS result`, values)).rows[0].result;
}

// Stand-in for seasonFatigueReset/seasonFormReset: both rewrite rider_condition.
const seasonStartReset = db => db.exec('UPDATE rider_condition SET form = 40, fatigue = 0');
const work = async db => (await db.query('SELECT status, quarantined_rider_ids FROM training_date_work WHERE team_id=$1', [TEAM])).rows[0];
const ticks = async db => (await db.query('SELECT count(*)::int AS n FROM training_rider_ticks')).rows[0].n;

test('#6924 PGlite: work registered before the transition loses its last race day to the reset', async () => {
  const db = await database();
  // A manager press before the season ends registers the date and settles four race days.
  await register(db, '2026-10-25T15:00:00Z');
  for (const day of DAYS.slice(0, -1)) await commit(db, day, '2026-10-25T15:30:00Z');
  await seasonStartReset(db);
  const result = await commit(db, DAYS.at(-1), '2026-10-25T19:30:00Z');
  assert.deepEqual([...result.quarantined_rider_ids].sort(), [...RIDERS].sort());
  assert.deepEqual([...(await work(db)).quarantined_rider_ids].sort(), [...RIDERS].sort());
  assert.equal(await ticks(db), RIDERS.length * (DAYS.length - 1), 'the final race day never ticks');
  await db.close();
});

test('#6924 PGlite: work first registered by the evening run after the reset settles every race day', async () => {
  const db = await database();
  await seasonStartReset(db);
  const registered = await register(db, '2026-10-25T19:00:00Z'); // 20:00 Copenhagen, after the transition
  assert.equal(registered.opening_conditions[RIDERS[0]].fatigue, 0, 'opening snapshot is the reset state');
  for (const day of DAYS) await commit(db, day, '2026-10-25T19:30:00Z');
  const settled = await work(db);
  assert.equal(settled.status, 'complete');
  assert.deepEqual(settled.quarantined_rider_ids, []);
  assert.equal(await ticks(db), RIDERS.length * DAYS.length);
  await db.close();
});
