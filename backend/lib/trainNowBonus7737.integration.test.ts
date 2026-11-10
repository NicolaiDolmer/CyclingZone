import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const file = name => readFile(new URL(`../../database/${name}`, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const TEAM = id(1), SEASON = id(900), A = id(11), B = id(12), C = id(13);
const DATE = '2026-11-09', DAYS = [41,42,43,44,45], AT = '2026-11-09T06:00:00Z';
const lit = value => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;

test('bonus migration and real atomic commit enforce immutable first choices', async t => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('./__fixtures__/trainingHeldSchema.sql', import.meta.url), 'utf8'));
    for (const name of ['2026-09-29-5928-training-condition-date.sql','2026-09-29-5928-training-condition-partial.sql','2026-09-29-5928-training-condition-recovery.sql','2026-09-29-5928-training-condition-initialization.sql']) await db.exec(await file(name));
    await db.exec('ALTER TABLE race_results ADD COLUMN rider_id uuid; ALTER TABLE training_day_runs ADD COLUMN id uuid DEFAULT gen_random_uuid(); ALTER TABLE app_config ADD COLUMN description text');
    for (const name of ['2026-09-30-5860-shared-race-day-recovery.sql','2026-10-10-6439-training-follows-rider.sql','2026-10-01-traen-nu-locks.sql']) await db.exec(await file(name));
    await db.exec('CREATE TABLE race_entries(race_id uuid,rider_id uuid,team_id uuid,race_role text, PRIMARY KEY(race_id,rider_id))');
    await db.exec(await file('2026-11-09-7737-train-now-instant.sql'));
    const migration = await file('2026-11-10-7737-train-now-bonus.sql');
    await db.exec(migration);
    await db.exec(migration);
    const scalar = async sql => Object.values((await db.query(sql)).rows[0])[0];
    assert.equal(await scalar("SELECT value #>> '{}' FROM app_config WHERE key='training_train_now_bonus'"), 'off');
    await db.exec(`INSERT INTO riders VALUES('${A}','${TEAM}'),('${B}','${TEAM}'),('${C}','${TEAM}');
      INSERT INTO rider_derived_abilities VALUES('${A}',50,'{}'),('${B}',50,'{}'),('${C}',50,'{}');
      INSERT INTO rider_condition(rider_id,form,fatigue,updated_at) VALUES('${A}',50,32,'2026-11-08T20:00:00Z'),('${B}',50,32,'2026-11-08T20:00:00Z'),('${C}',50,32,'2026-11-08T20:00:00Z');`);
    const work = await scalar(`SELECT register_training_date_work('${TEAM}','${SEASON}','${DATE}','{${DAYS}}','{${A},${B},${C}}',NULL,'${AT}')`);
    const lock = (rider, bonus) => `INSERT INTO training_train_now_locks(rider_id,tick_date,season_id,team_id,pressed_at,train_now_bonus) VALUES('${rider}','${DATE}','${SEASON}','${TEAM}','${AT}',${bonus}) ON CONFLICT(rider_id,tick_date) DO NOTHING`;
    await db.exec(lock(B,false));
    await db.exec("INSERT INTO app_config(key,value) VALUES('training_condition_per_date','\"on\"'),('training_train_now_bonus','\"on\"'),('training_train_now_instant','\"on\"') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value");
    const publish = `SELECT publish_train_now_bonus_press('${TEAM}','${SEASON}','${DATE}','{${A},${B},${C}}','{${A}}','${AT}')`;
    await t.test('failure between the first insert and freeze rolls back the entire publication',async()=>{
      await db.exec("CREATE FUNCTION test_reject_bonus_freeze() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic freeze failure'; END $$; CREATE TRIGGER test_reject_bonus_freeze BEFORE UPDATE OF instant_entry_snapshot ON training_train_now_locks FOR EACH ROW EXECUTE FUNCTION test_reject_bonus_freeze()");
      await assert.rejects(db.query(publish),/synthetic freeze failure/);
      assert.equal(await scalar(`SELECT count(*)::int FROM training_train_now_locks WHERE rider_id IN('${A}','${C}')`),0);
      await db.exec('DROP TRIGGER test_reject_bonus_freeze ON training_train_now_locks; DROP FUNCTION test_reject_bonus_freeze()');
    });
    // This is the production first-press RPC. Discard its response to model a lost
    // response; automatic engine commits below need no second manager request.
    await db.query(publish);
    await db.exec(lock(B,true));
    assert.equal(await scalar(`SELECT train_now_bonus FROM training_train_now_locks WHERE rider_id='${A}'`), true);
    assert.equal(await scalar(`SELECT train_now_bonus FROM training_train_now_locks WHERE rider_id='${B}'`), false);
    await assert.rejects(db.exec(`UPDATE training_train_now_locks SET train_now_bonus=true WHERE rider_id='${B}'`), /immutable/);
    assert.ok(await scalar(`SELECT instant_at FROM training_train_now_locks WHERE rider_id='${A}'`),'freeze publishes the CAS stamp atomically even if its response is lost');
    const commit = (day, bonus, expected = [], patch = 0.25) => {
      const report = { condition_per_date: true, riders: [{ rider_id: A, intensity:'normal', condition_before_date: work.opening_conditions[A], condition_observed: work.opening_conditions[A], missing_evidence:[], expected_date_receipt_days: expected, ...(bonus ? { train_now_bonus:true } : {}) }] };
      return db.query(`SELECT commit_training_date_tick('${TEAM}','${SEASON}','senior',${day},'${DATE}','{${DAYS}}','assistant',${lit(report)},${lit([{ riderId:A,patch:{ability_progress:{climbing:patch}} }])},'[]','[]','[]','[]','[]',false,'${AT}') AS result`);
    };
    await t.test('stale choice rolls back the complete ability transaction', async () => {
      await assert.rejects(commit(41,false), /bonus decision/);
      assert.deepEqual(await scalar(`SELECT ability_progress FROM rider_derived_abilities WHERE rider_id='${A}'`), {});
      assert.equal(await scalar('SELECT count(*)::int FROM training_rider_ticks'), 0);
    });
    await t.test('OFF after publication retains award and CAS rejects different-slot stale development', async () => {
      await db.exec("UPDATE app_config SET value='\"off\"' WHERE key IN('training_train_now_bonus','training_train_now_instant')");
      await commit(41,true);
      await assert.rejects(commit(42,true), /receipt snapshot changed/);
      await commit(42,true,[41],0.5);
      assert.equal((await commit(42,true,[41],0.9)).rows[0].result.already_ran,true);
      assert.equal(await scalar(`SELECT (ability_progress->>'climbing')::numeric FROM rider_derived_abilities WHERE rider_id='${A}'`), '0.5');
    });
    await t.test('prior automatic receipt cannot receive retroactive bonus', async () => {
      await db.exec(`DELETE FROM training_train_now_locks WHERE rider_id='${C}'`);
      await db.exec(`INSERT INTO training_rider_ticks(rider_id,season_id,game_day,tick_date,team_id,report,created_at) VALUES('${C}','${SEASON}',41,'${DATE}','${TEAM}','{}','${AT}')`);
      await db.exec("UPDATE app_config SET value='\"on\"' WHERE key IN('training_train_now_bonus','training_train_now_instant')");
      await db.exec(lock(C,true));
      assert.equal(await scalar(`SELECT train_now_bonus FROM training_train_now_locks WHERE rider_id='${C}'`),false);
    });
    await t.test('new functions and bonus data are not accessible to player roles', async () => {
      await db.exec('SET ROLE authenticated');
      await assert.rejects(db.query('SELECT train_now_bonus FROM training_train_now_locks'), /permission denied/);
      await assert.rejects(db.query('SELECT training_train_now_bonus_choice()'), /permission denied/);
      await assert.rejects(db.query(publish), /permission denied/);
      await db.exec('RESET ROLE');
    });
  } finally { await db.close(); }
});
