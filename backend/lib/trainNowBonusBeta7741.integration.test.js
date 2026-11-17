// #7741 (ejer 16/11): bonus-kontakten training_train_now_bonus kan staa paa "beta".
// Triggeren training_train_now_bonus_choice afgoer foerste tryks bonus i databasen; foer
// 2026-11-16-7741-train-now-bonus-beta.sql godkendte den kun "on" for bonus-kontakten, saa et
// beta-testers tryk blev stille nedgraderet til ingen bonus. Proeven koerer repoets migrationer
// mod en rigtig PostgreSQL 17 (PGlite) og viser foer- og efter-tilstanden. Serveren afgoer,
// om trykket er en beta-testers (isTrainNowBonusEnabled, trainNowBonus7737.test.ts); triggeren
// regner kun, naar serveren har valgt bonus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const file = async (name) => (await readFile(new URL(`../../database/${name}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const TEAM = id(1), SEASON = id(900), A = id(11), DATE = "2026-11-09", AT = "2026-11-09T06:00:00Z";

async function newDb() {
  const db = new PGlite();
  await db.exec(await readFile(new URL("./__fixtures__/trainingHeldSchema.sql", import.meta.url), "utf8"));
  for (const name of ["2026-09-29-5928-training-condition-date.sql", "2026-09-29-5928-training-condition-partial.sql", "2026-09-29-5928-training-condition-recovery.sql", "2026-09-29-5928-training-condition-initialization.sql"]) await db.exec(await file(name));
  await db.exec("ALTER TABLE race_results ADD COLUMN rider_id uuid; ALTER TABLE training_day_runs ADD COLUMN id uuid DEFAULT gen_random_uuid(); ALTER TABLE app_config ADD COLUMN description text");
  for (const name of ["2026-09-30-5860-shared-race-day-recovery.sql", "2026-10-10-6439-training-follows-rider.sql", "2026-10-01-traen-nu-locks.sql"]) await db.exec(await file(name));
  await db.exec("CREATE TABLE race_entries(race_id uuid,rider_id uuid,team_id uuid,race_role text,PRIMARY KEY(race_id,rider_id))");
  for (const name of ["2026-10-25-6461-train-now-whole-day.sql", "2026-11-09-7737-train-now-instant.sql", "2026-11-10-7737-train-now-bonus.sql", "2026-11-10-7737-train-now-instant-beta.sql"]) await db.exec(await file(name));
  await db.exec(`INSERT INTO riders VALUES('${A}','${TEAM}'); INSERT INTO rider_derived_abilities VALUES('${A}',50,'{}');
    INSERT INTO rider_condition(rider_id,form,fatigue,updated_at) VALUES('${A}',50,32,'2026-11-08T20:00:00Z');`);
  await db.query(`SELECT register_training_date_work('${TEAM}','${SEASON}','${DATE}','{41,42,43,44,45}','{${A}}',NULL,'${AT}')`);
  return db;
}

// Foerste tryk med serverens bonusvalg = ja; svaret er det, databasen gemmer.
async function firstPressBonus(db, { bonus, instant }) {
  await db.exec(`INSERT INTO app_config(key,value) VALUES('training_condition_per_date','"on"'),
      ('training_train_now_instant','${JSON.stringify(instant)}'),('training_train_now_bonus','${JSON.stringify(bonus)}')
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value; DELETE FROM training_train_now_locks;`);
  await db.exec(`INSERT INTO training_train_now_locks(rider_id,tick_date,season_id,team_id,pressed_at,train_now_bonus)
    VALUES('${A}','${DATE}','${SEASON}','${TEAM}','${AT}',true)`);
  return (await db.query("SELECT train_now_bonus FROM training_train_now_locks")).rows[0].train_now_bonus;
}

const CASES = [
  { bonus: "on", instant: "on", before: true, after: true },
  { bonus: "on", instant: "beta", before: true, after: true },
  { bonus: "beta", instant: "on", before: false, after: true },
  { bonus: "beta", instant: "beta", before: false, after: true },
  { bonus: "off", instant: "on", before: false, after: false },
  { bonus: "off", instant: "beta", before: false, after: false },
  { bonus: "beta", instant: "off", before: false, after: false },
  { bonus: "on", instant: "off", before: false, after: false },
];

test("#7741: triggeren godkender bonus-kontakten paa beta efter migrationen, resten uaendret", async () => {
  const db = await newDb();
  try {
    for (const c of CASES) assert.equal(await firstPressBonus(db, c), c.before, `foer: bonus=${c.bonus} instant=${c.instant}`);
    const migration = await file("2026-11-16-7741-train-now-bonus-beta.sql");
    await db.exec(migration);
    await db.exec(migration); // idempotent
    for (const c of CASES) assert.equal(await firstPressBonus(db, c), c.after, `efter: bonus=${c.bonus} instant=${c.instant}`);
    // Datoafregningen skal stadig vaere "on"; "beta" godkendes ikke dér.
    await db.exec(`UPDATE app_config SET value='"beta"' WHERE key='training_condition_per_date'`);
    await db.exec("DELETE FROM training_train_now_locks");
    await db.exec(`INSERT INTO training_train_now_locks(rider_id,tick_date,season_id,team_id,pressed_at,train_now_bonus)
      VALUES('${A}','${DATE}','${SEASON}','${TEAM}','${AT}',true)`);
    assert.equal((await db.query("SELECT train_now_bonus FROM training_train_now_locks")).rows[0].train_now_bonus, false);
    // Et tryk uden serverens bonusvalg opgraderes aldrig, heller ikke paa beta.
    await db.exec(`UPDATE app_config SET value='"on"' WHERE key='training_condition_per_date'`);
    await db.exec(`UPDATE app_config SET value='"beta"' WHERE key IN ('training_train_now_bonus','training_train_now_instant')`);
    await db.exec("DELETE FROM training_train_now_locks");
    await db.exec(`INSERT INTO training_train_now_locks(rider_id,tick_date,season_id,team_id,pressed_at,train_now_bonus)
      VALUES('${A}','${DATE}','${SEASON}','${TEAM}','${AT}',false)`);
    assert.equal((await db.query("SELECT train_now_bonus FROM training_train_now_locks")).rows[0].train_now_bonus, false);
    const description = (await db.query("SELECT description FROM app_config WHERE key='training_train_now_bonus'")).rows[0].description;
    assert.match(description, /"beta" = only beta testers/);
  } finally {
    await db.close();
  }
});
