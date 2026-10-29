// #6461 (hard rule 36): local before/after baseline of the Train now press's DB part.
// In-process PGlite (PostgreSQL 17, WASM): relative before/after on identical data,
// not a production SLA. Synthetic IDs only; nothing external.
//   before: the press commits race days 1-4 (no condition write), today's rule.
//   after:  variant B for a rider whose date is known: race days 1-5, the fifth
//           carrying the date's one condition settlement.
// Both run the real commit_training_date_tick from the migrations, one full squad.
//
//   pwsh -File scripts/verify-lock.ps1 -Max 2 -- node backend/scripts/benchTrainNowWholeDay6461.mjs
// --quick runs one repetition.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const root = resolve(import.meta.dirname, '../..');
const quick = process.argv.includes('--quick');
const RIDERS = 28;
const REPS = quick ? 1 : 5;
const read = (path) => readFileSync(join(root, path), 'utf8');
const MIGRATIONS = [
  'database/2026-09-29-5928-training-condition-date.sql',
  'database/2026-09-29-5928-training-condition-partial.sql',
  'database/2026-09-29-5928-training-condition-recovery.sql',
  'database/2026-09-29-5928-training-condition-initialization.sql',
];
const uuid = (prefix, n) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`;

async function freshDb() {
  const db = await PGlite.create();
  await db.exec(read('backend/lib/__fixtures__/trainingHeldSchema.sql'));
  for (const name of MIGRATIONS) await db.exec(read(name));
  await db.exec('ALTER TABLE race_results ADD COLUMN rider_id uuid');
  await db.exec(read('database/2026-09-30-5860-shared-race-day-recovery.sql'));
  await db.exec(read('database/2026-10-10-6439-training-follows-rider.sql'));
  return db;
}

async function runScenario({ days, rep }) {
  const db = await freshDb();
  const team = uuid('00000000', 1);
  const season = uuid('00000000', 2);
  const riders = Array.from({ length: RIDERS }, (_, i) => uuid('10000000', i + 1));
  const tickDate = '2026-10-26';
  for (const id of riders) {
    await db.exec(`INSERT INTO riders VALUES('${id}','${team}'); INSERT INTO rider_derived_abilities VALUES('${id}',50,'{}');
      INSERT INTO rider_condition(rider_id,form,fatigue) VALUES('${id}',50,40);`);
  }
  const idList = `ARRAY[${riders.map((id) => `'${id}'`).join(',')}]::uuid[]`;
  const { rows: [{ work }] } = await db.query(`SELECT register_training_date_work('${team}','${season}','${tickDate}',ARRAY[1,2,3,4,5],${idList},NULL,'2026-10-26T08:00:00Z') AS work`);
  const opening = work.opening_conditions;
  const timings = [];
  for (const day of days) {
    const final = day === 5;
    const report = { condition_per_date: true, riders: riders.map((id) => ({
      rider_id: id, game_day: day, intensity: 'normal', condition_before_date: opening[id], condition_observed: opening[id], missing_evidence: [],
    })) };
    const conditions = final ? riders.map((id) => ({ rider_id: id, form: 51, fatigue: 38, injured_until: null, injury_cause: null, updated_at: '2026-10-26T08:00:00Z' })) : [];
    const abilities = riders.map((id) => ({ riderId: id, patch: { climbing: 50 + day, ability_progress: { climbing: day / 10 } } }));
    const started = performance.now();
    await db.query(`SELECT commit_training_date_tick($1,$2,'senior',$3,$4,ARRAY[1,2,3,4,5],'manager',$5,$6,$7,'[]','[]','[]','[]',false,'2026-10-26T08:00:00Z')`,
      [team, season, day, tickDate, JSON.stringify(report), JSON.stringify(abilities), JSON.stringify(conditions)]);
    timings.push(performance.now() - started);
  }
  const { rows: [{ ticks }] } = await db.query('SELECT count(*)::int AS ticks FROM training_rider_ticks');
  const { rows: [{ settled }] } = await db.query('SELECT count(*)::int AS settled FROM training_condition_settlements');
  const { rows: [{ status }] } = await db.query('SELECT status FROM training_date_work');
  assert.equal(ticks, RIDERS * days.length);
  assert.equal(settled, days.includes(5) ? RIDERS : 0);
  await db.close();
  return { rep, total: timings.reduce((a, b) => a + b, 0), perDay: timings, status };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const out = {};
for (const [name, days] of [['before_4_days', [1, 2, 3, 4]], ['after_5_days_with_condition', [1, 2, 3, 4, 5]]]) {
  const runs = [];
  for (let rep = 0; rep < REPS; rep++) runs.push(await runScenario({ days, rep }));
  out[name] = {
    riders: RIDERS, reps: REPS, status: runs[0].status,
    total_ms_median: +median(runs.map((r) => r.total)).toFixed(1),
    per_day_ms_median: days.map((_, i) => +median(runs.map((r) => r.perDay[i])).toFixed(1)),
  };
}
console.log(JSON.stringify(out, null, 2));
