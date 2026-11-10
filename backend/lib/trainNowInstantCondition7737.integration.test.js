import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { loadInstantConditions } from "./trainNowInstantCondition7737.js";
import { applyStageStartFatigue, ridersWithFatigueNow } from "./riderFatigueNow.js";
import { settleTrainingDateCondition } from "./trainingDateCondition.js";
import { buildTeamFatigueForecast } from "./trainingWeekPlanForecast.js";

// A thin PostgREST-shaped adapter executes the reader's real column/filter queries.
// No mocked date arithmetic, receipt filtering or settlement calculation.
function client(db) {
  const identifier = value => {
    if (!/^[a-z_]+$/.test(value)) throw new Error("Invalid test identifier");
    return value;
  };
  return { from(table) {
    const params = [], where = [], ordering = [];
    let projection = "*", limit = "";
    const bind = value => { params.push(value); return `$${params.length}`; };
    const q = {
      select(value) { projection = value === "*" ? value : value.split(",").map(v => identifier(v.trim())).join(","); return q; },
      eq(key, value) { where.push(`${identifier(key)}=${bind(value)}`); return q; },
      lt(key, value) { where.push(`${identifier(key)}<${bind(value)}`); return q; },
      is(key, value) { assert.equal(value, null); where.push(`${identifier(key)} IS NULL`); return q; },
      in(key, values) { where.push(`${identifier(key)} IN (${values.map(bind).join(",")})`); return q; },
      order(key) { ordering.push(identifier(key)); return q; },
      range(from, to) { limit = ` LIMIT ${to - from + 1} OFFSET ${from}`; return q; },
      async maybeSingle() { const result = await run(); return { ...result, data: result.data?.[0] ?? null }; },
      then(resolve, reject) { return run().then(resolve, reject); },
    };
    async function run() {
      try {
        const sql = `SELECT ${projection} FROM ${identifier(table)}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}${ordering.length ? ` ORDER BY ${ordering.join(",")}` : ""}${limit}`;
        return { data: (await db.query(sql, params)).rows, error: null };
      } catch (error) { return { data: null, error }; }
    }
    return q;
  } };
}

test("#7737: persisted receipts, ledger, stage input and next-date forecast share the frozen opening", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE app_config(key text PRIMARY KEY,value jsonb);
      CREATE TABLE training_train_now_locks(rider_id text,team_id text,season_id text,tick_date date,instant_at timestamptz,instant_entry_snapshot jsonb);
      CREATE TABLE training_date_work(team_id text,season_id text,tick_date date,game_days int[],opening_conditions jsonb);
      CREATE TABLE training_rider_ticks(rider_id text,season_id text,tick_date date,game_day int,report jsonb);
      CREATE TABLE training_race_loads(rider_id text,season_id text,tick_date date,game_day int,race_id text,stage_number int,load numeric,duplicate_of_race_id text,consumed_at timestamptz);
      CREATE TABLE training_condition_settlements(rider_id text,season_id text,tick_date date);
      CREATE TABLE rider_condition(rider_id text,form int,fatigue int);
      CREATE TABLE race_stage_schedule(race_id text,stage_number int,game_day int,scheduled_at timestamptz);
      CREATE TABLE team_facilities(team_id text,track text,tier int);
      CREATE TABLE team_staff(team_id text,id text,name text,role text,tier int,status text);
      INSERT INTO app_config VALUES('condition_model_v2','"on"'),('training_condition_per_date','"on"'),('training_tick_per_race_day','"on"'),('race_day_engine_enabled','"on"');
      INSERT INTO training_train_now_locks VALUES('r','t','s','2026-11-09','2026-11-09T06:00:00Z','{"slots":[{"gameDay":43}]}');
      INSERT INTO training_date_work VALUES('t','s','2026-11-09',ARRAY[41,42,43,44,45],'{"r":{"fatigue":48,"form":57}}');
      INSERT INTO training_rider_ticks SELECT 'r','s','2026-11-09',day,'{"intensity":"normal","recovery_before_date":61}' FROM unnest(ARRAY[41,42,44,45]) day;
      INSERT INTO race_stage_schedule VALUES('race',2,44,'2026-11-09T15:00:00Z');
    `);
    const supabase = client(db);
    const opening = { fatigue: 48, form: 57 };
    const intensities = ["normal", "normal", "race", "normal", "normal"];
    const count = load => settleTrainingDateCondition({ riderId: "r", dateStr: "2026-11-09", condition: opening,
      intensities, raceLoads: [0, 0, load, 0, 0], recoveryAbility: 61, modelV2: true });
    const provisional = count(0);
    await db.query("INSERT INTO rider_condition VALUES('r',$1,$2)", [provisional.form, provisional.fatigue]);
    await db.exec("INSERT INTO training_race_loads VALUES('r','s','2026-11-09',43,'prior',1,24,NULL,NULL)");
    const expected = count(24);
    const entrant = { rider_id: "r", form: provisional.form, fatigue: provisional.fatigue };
    await applyStageStartFatigue({ supabase, raceId: "race", stageNumber: 2, entrants: [entrant] });
    assert.deepEqual(entrant, { rider_id: "r", form: expected.form, fatigue: expected.fatigue });
    const live = await ridersWithFatigueNow({ supabase, riders: [{ rider_id: "r", ...provisional }], now: new Date("2026-11-09T14:00:00Z") });
    assert.equal(live[0].fatigue, entrant.fatigue);

    const receipts = (await db.query("SELECT * FROM training_rider_ticks ORDER BY game_day")).rows;
    const recordedLoads = (await db.query("SELECT * FROM training_race_loads")).rows;
    const forecast = buildTeamFatigueForecast({ tickDate: "2026-11-09", seasonId: "s", dateGameDays: [41,42,43,44,45],
      riders: [{ id: "r", primary_type: "gc" }], conditionByRider: new Map([["r", provisional]]),
      openingByRider: new Map([["r", opening]]), receipts, recordedLoads, conditionModelV2: true });
    assert.equal(forecast.r.fatigue, expected.fatigue, "next-date opening comes from the original date, never provisional condition");

    await db.exec("INSERT INTO training_condition_settlements VALUES('r','s','2026-11-09')");
    await db.query("UPDATE rider_condition SET form=$1,fatigue=$2", [expected.form, expected.fatigue]);
    const after = await loadInstantConditions({ supabase, riderIds: ["r"], tickDate: "2026-11-09" });
    assert.deepEqual(after.get("r"), { form: expected.form, fatigue: expected.fatigue });
    const nextDate = await ridersWithFatigueNow({ supabase, riders: [entrant], now: new Date("2026-11-10T09:00:00Z") });
    assert.deepEqual(nextDate[0], entrant, "settled prior-date loads cannot be counted on the following date");
  } finally { await db.close(); }
});
