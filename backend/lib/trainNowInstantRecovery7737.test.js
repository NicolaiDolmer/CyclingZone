import test from "node:test";
import assert from "node:assert/strict";
import { simulateStageByIndex } from "./raceRunner.js";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { recoverInstantTrainingBeforeStage } from "./trainNowInstantRecovery7737.js";
import { applyStageStartFatigue, fatigueOutlookForTeam, ridersWithFatigueNow, riderFatigueNow } from "./riderFatigueNow.js";
import { createFake, seedState, press, enter, finishRace, sweep, TEAM, SEASON, RACE, DIVISION } from "./__fixtures__/trainNowInstant7737Harness.js";

const STAGE_AT = new Date("2026-11-09T14:30:00Z");
const FLAGS = { training_train_now_instant: "on", condition_model_v2: "on", fatigue_now_7801: "on" };
const args = (s, f, team = s.teams[0]) => ({ supabase: f.supabase, team, seasonId: SEASON.id, conditions: s.rider_condition, now: STAGE_AT });

function forecastCalendar(s) {
  s.races.push({ id: "previous", season_id: SEASON.id, league_division_id: DIVISION, stages_completed: 1 },
    { id: "last-slot", season_id: SEASON.id, league_division_id: DIVISION, stages_completed: 0 },
    { id: "tomorrow", season_id: SEASON.id, league_division_id: DIVISION, stages_completed: 0 });
  s.race_stage_schedule.push({ race_id: "previous", stage_number: 1, game_day: 40, scheduled_at: "2026-11-08T15:00:00Z" },
    { race_id: "last-slot", stage_number: 1, game_day: 45, scheduled_at: "2026-11-09T18:00:00Z" },
    { race_id: "tomorrow", stage_number: 1, game_day: 46, scheduled_at: "2026-11-10T12:00:00Z" });
  for (const row of s.race_stage_schedule) Object.assign(row, { "races.season_id": SEASON.id, "races.league_division_id": DIVISION });
  s.race_entry_days.push({ rider_id: "r1", race_id: RACE, game_day: 43, season_id: SEASON.id },
    { rider_id: "r1", race_id: "tomorrow", game_day: 46, season_id: SEASON.id });
  s.race_stage_profiles = [{ race_id: RACE, stage_number: 1, profile_type: "flat" }];
}

test("#7737 recovery: a real interrupted press completes automatically before the stage, without another manager request", async () => {
  const s = seedState({ riderIds: ["r1"], flags: FLAGS });
  enter(s, ["r1"]);
  const f = createFake(s);
  const rpc = f.supabase.rpc;
  let disconnected = true;
  f.supabase.rpc = async (name, input) => {
    if (disconnected && name.replace(/^try_/, "") === "commit_training_date_tick" && input.p_game_day === 44) {
      throw new Error("connection interrupted after two committed slots");
    }
    return rpc(name, input);
  };
  await assert.rejects(press(s, f), /connection interrupted/);
  assert.deepEqual(s.training_rider_ticks.map(r => r.game_day), [41, 42]);
  assert.ok(s.training_train_now_locks[0].instant_at);
  disconnected = false;
  s.app_config.find(r => r.key === "training_train_now_instant").value = "off";
  const beforeStage = structuredClone(s);
  const partial = await fatigueOutlookForTeam(args(s, f));
  assert.equal(partial.get("r1").fatigue, s.rider_condition[0].fatigue);
  assert.equal(partial.get("r1").form, s.rider_condition[0].form);
  assert.equal(partial.get("r1").fatigueAtStart, null);
  assert.deepEqual(s, beforeStage, "GET remains read-only");
  const automaticStage = async () => {
    await recoverInstantTrainingBeforeStage({ supabase: f.supabase, raceId: RACE, stageNumber: 1,
      seasonId: SEASON.id, seasonNumber: SEASON.number, now: STAGE_AT });
    const entrants = [{ rider_id: "r1", ...s.rider_condition[0] }];
    await applyStageStartFatigue({ supabase: f.supabase, raceId: RACE, stageNumber: 1, entrants });
    return entrants;
  };
  const entrants = await automaticStage();
  const recovered = structuredClone(s.rider_derived_abilities);
  await automaticStage();
  assert.deepEqual(s.rider_derived_abilities, recovered, "automatic retry cannot credit growth twice");
  await applyStageStartFatigue({ supabase: f.supabase, raceId: RACE, stageNumber: 1, entrants });
  assert.deepEqual(s.training_rider_ticks.map(r => r.game_day), [41, 42, 44, 45], "automatic path resumes free slots before 20:00");
  assert.ok(!s.training_rider_ticks.some(r => r.game_day === 43), "reserved stage never trains");
  const abilities = structuredClone(s.rider_derived_abilities);
  const live = await ridersWithFatigueNow({ supabase: f.supabase, riders: [{ rider_id: "r1", ...s.rider_condition[0] }], now: STAGE_AT });
  assert.equal(live[0].fatigue, entrants[0].fatigue);
  assert.equal(live[0].form, entrants[0].form);
  finishRace(s, ["r1"]);
  await sweep(s, f);
  await sweep(s, f);
  assert.equal(s.training_rider_ticks.length, 5);
  assert.equal(new Set(s.training_rider_ticks.map(r => r.game_day)).size, 5);
  assert.equal(s.training_condition_settlements.length, 1);
  assert.notDeepEqual(s.rider_derived_abilities, abilities, "stage closes its own development slot");
  const reference = seedState({ riderIds: ["r1"], flags: FLAGS });
  enter(reference, ["r1"]);
  const clean = createFake(reference);
  await press(reference, clean);
  finishRace(reference, ["r1"]);
  await sweep(reference, clean);
  assert.deepEqual(s.rider_derived_abilities, reference.rider_derived_abilities, "interruption grants exactly the uninterrupted development");
  assert.deepEqual(s.rider_condition, reference.rider_condition);
  assert.equal(f.log.filter(row => row.rpc === "freeze_train_now_date_entries").length, 1, "OFF recovery never freezes again");
});

test("#7737 full outlook: tomorrow forecast follows a real pressed rider's frozen opening after transfer", async () => {
  const s = seedState({ riderIds: ["r1"], flags: FLAGS });
  forecastCalendar(s);
  enter(s, ["r1"]);
  const f = createFake(s);
  await press(s, f);
  finishRace(s, ["r1"]);
  const before = await fatigueOutlookForTeam(args(s, f));
  assert.ok(Number.isFinite(before.get("r1").fatigueAtStart), "full forecast loader must run");
  const buyer = { ...s.teams[0], id: "buyer" };
  s.teams.push(buyer);
  s.riders[0].team_id = "buyer";
  const after = await fatigueOutlookForTeam(args(s, f, buyer));
  assert.deepEqual(after.get("r1"), before.get("r1"), "transfer must not replay receipts on provisional condition");
  s.training_date_work.push({ team_id: "buyer", season_id: SEASON.id, tick_date: "2026-11-09", status: "complete",
    game_days: [41, 42, 43, 44, 45], expected_rider_ids: [], opening_conditions: {} });
  const completedBuyer = await fatigueOutlookForTeam(args(s, f, buyer));
  assert.deepEqual(completedBuyer.get("r1"), before.get("r1"), "the buyer's closed roster cannot settle the transferred rider's original open date");
});

test("#7737 OFF mixed roster: only stamped riders receive outlook fields", async () => {
  const s = seedState({ riderIds: ["r1"], flags: { ...FLAGS, fatigue_now_7801: "off" } });
  enter(s, ["r1"]);
  const f = createFake(s);
  await press(s, f);
  s.riders.push({ ...s.riders[0], id: "newcomer" });
  s.rider_condition.push({ rider_id: "newcomer", form: 50, fatigue: 30 });
  s.race_entry_days.push({ rider_id: "newcomer", race_id: RACE, game_day: 43, season_id: SEASON.id });
  const out = await fatigueOutlookForTeam(args(s, f));
  assert.equal(out.has("r1"), true);
  assert.equal(out.has("newcomer"), false, "unstamped teammate retains absent fields with switch OFF");
});

test("#7737 wiring: automatic recovery precedes entrant loading never writes during dry-run", async () => {
  const source = await readFile(new URL("./raceRunner.js", import.meta.url), "utf8");
  const start = source.indexOf("const persistEntries =");
  const recovery = source.indexOf("await recoverInstantTrainingBeforeStage(", start);
  const entrants = source.indexOf("entrants = await loadEntrantsForRace(", start);
  assert.ok(recovery > start && recovery < entrants);
  assert.match(source.slice(recovery - 65, recovery), /trainingOwnsRecovery && !dryRun/);
});

// The existing PR1 engine harness supplies ordinary read models. The actual
// registration/freeze/commit RPCs below execute the shipped SQL on PGlite.
async function persistedEngine(s) {
  const db = new PGlite();
  const sql = name => readFile(new URL("../../database/" + name, import.meta.url), "utf8");
  await db.exec(await readFile(new URL("./__fixtures__/trainingHeldSchema.sql", import.meta.url), "utf8"));
  for (const name of ["2026-09-29-5928-training-condition-date.sql", "2026-09-29-5928-training-condition-partial.sql",
    "2026-09-29-5928-training-condition-recovery.sql", "2026-09-29-5928-training-condition-initialization.sql"]) await db.exec(await sql(name));
  await db.exec("ALTER TABLE race_results ADD COLUMN rider_id uuid; ALTER TABLE training_day_runs ADD COLUMN id uuid DEFAULT gen_random_uuid(); ALTER TABLE app_config ADD COLUMN description text");
  for (const name of ["2026-09-30-5860-shared-race-day-recovery.sql", "2026-10-10-6439-training-follows-rider.sql", "2026-10-01-traen-nu-locks.sql"]) await db.exec(await sql(name));
  await db.exec("CREATE TABLE race_entries(race_id uuid,rider_id uuid,team_id uuid,race_role text,PRIMARY KEY(race_id,rider_id))");
  await db.exec(await sql("2026-11-09-7737-train-now-instant.sql"));
  for (const key of Object.keys(s.rider_derived_abilities[0]).filter(key => !["rider_id", "climbing", "ability_progress"].includes(key))) {
    await db.exec("ALTER TABLE rider_derived_abilities ADD COLUMN " + key + (key === "ability_caps" ? " jsonb" : " integer"));
  }
  const ids = new Map([TEAM, SEASON.id, RACE, ...s.riders.map(r => r.id)].map((value, i) => [value, "00000000-0000-0000-0000-" + String(i + 1).padStart(12, "0")]));
  const reverse = new Map([...ids].map(([key, value]) => [value, key]));
  const translate = (value, map) => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") return map.get(value) ?? value;
    if (Array.isArray(value)) return value.map(v => translate(v, map));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [map.get(k) ?? k, v instanceof Date && (k.endsWith("_date") || k === "injured_until") ? v.toISOString().slice(0, 10) : translate(v, map)]));
    return value;
  };
  const insert = async (table, values, conflict = "") => {
    await db.query("INSERT INTO " + table + " SELECT * FROM jsonb_populate_recordset(NULL::" + table + ",$1::jsonb)" + conflict,
      [JSON.stringify(translate(values, ids))]);
  };
  await insert("riders", s.riders.map(r => ({ id: r.id, team_id: r.team_id, is_retired: false })));
  await insert("rider_derived_abilities", s.rider_derived_abilities);
  await insert("rider_condition", s.rider_condition);
  await insert("races", s.races.map(r => ({ id: r.id, season_id: r.season_id, status: "scheduled", stages_completed: 0, stages: 1, race_type: "single" })));
  await insert("race_stage_schedule", s.race_stage_schedule);
  await insert("race_entries", s.race_entries);
  const f = createFake(s);
  const fakeRpc = f.supabase.rpc;
  const synchronize = async () => {
    for (const table of ["training_date_work", "training_rider_ticks", "training_condition_settlements", "training_day_runs", "training_race_loads"]) {
      s[table] = translate((await db.query("SELECT * FROM " + table)).rows, reverse);
    }
    for (const table of ["rider_derived_abilities", "rider_condition"]) {
      const rows = translate((await db.query("SELECT * FROM " + table)).rows, reverse);
      for (const row of rows) Object.assign(s[table].find(r => r.rider_id === row.rider_id), row);
    }
  };
  f.supabase.rpc = async (requested, input) => {
    const name = requested.replace(/^try_/, "");
    if (!["register_training_date_work", "freeze_train_now_date_entries", "commit_training_date_tick"].includes(name)) return fakeRpc(requested, input);
    f.log.push({ rpc: requested, args: input });
    for (const lock of s.training_train_now_locks) {
      await db.query("INSERT INTO training_train_now_locks(rider_id,tick_date,season_id,team_id,pressed_at,instant_at,instant_entry_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(rider_id,tick_date) DO UPDATE SET instant_at=EXCLUDED.instant_at,instant_entry_snapshot=COALESCE(EXCLUDED.instant_entry_snapshot,training_train_now_locks.instant_entry_snapshot)",
        [ids.get(lock.rider_id), lock.tick_date, ids.get(lock.season_id), ids.get(lock.team_id), lock.pressed_at, lock.instant_at ?? null, lock.instant_entry_snapshot == null ? null : JSON.stringify(translate(lock.instant_entry_snapshot, ids))]);
    }
    const signature = (await db.query("SELECT p.proargnames, ARRAY(SELECT format_type(t,NULL) FROM unnest(p.proargtypes::oid[]) t) types FROM pg_proc p WHERE p.proname=$1", [name])).rows[0];
    const entries = Object.entries(translate(input, ids));
    const params = entries.map(([key, value]) => {
      const type = signature.types[signature.proargnames.indexOf(key)];
      return type === "jsonb" ? JSON.stringify(value) : type.endsWith("[]") && value != null ? "{" + value.join(",") + "}" : value;
    });
    const call = entries.map(([key], i) => key + "=>$" + (i + 1) + "::" + signature.types[signature.proargnames.indexOf(key)]).join(",");
    const data = translate((await db.query("SELECT " + name + "(" + call + ") result", params)).rows[0].result, reverse);
    await synchronize();
    if (name === "freeze_train_now_date_entries") {
      assert.equal(data.length, input.p_rider_ids.length, JSON.stringify({ input, data, locks: s.training_train_now_locks }));
      const locks = translate((await db.query("SELECT * FROM training_train_now_locks")).rows, reverse);
      for (const lock of locks) Object.assign(s.training_train_now_locks.find(r => r.rider_id === lock.rider_id), lock);
    }
    return { data, error: null };
  };
  return { ...f, db, ids, synchronize, insert };
}

test("#7737 persisted recovery: actual PR1 press commits, automatic pre-stage recovery, ledger and final GET agree exactly once", async () => {
  const s = seedState({ riderIds: ["r1"], flags: FLAGS });
  enter(s, ["r1"]);
  const f = await persistedEngine(s);
  try {
    const rpc = f.supabase.rpc;
    let disconnected = true;
    f.supabase.rpc = async (name, input) => {
      if (disconnected && name.replace(/^try_/, "") === "commit_training_date_tick" && input.p_game_day === 44) throw new Error("native connection interrupted");
      return rpc(name, input);
    };
    await assert.rejects(press(s, f), /native connection interrupted/);
    assert.deepEqual((await f.db.query("SELECT game_day FROM training_rider_ticks ORDER BY game_day")).rows.map(r => r.game_day), [41, 42]);
    disconnected = false;
    s.app_config.find(r => r.key === "training_train_now_instant").value = "off";
    const automatic = () => recoverInstantTrainingBeforeStage({ supabase: f.supabase, raceId: RACE, stageNumber: 1,
      seasonId: SEASON.id, seasonNumber: SEASON.number, now: STAGE_AT });
    const partial = await fatigueOutlookForTeam(args(s, f));
    assert.equal(partial.get("r1").fatigue, s.rider_condition[0].fatigue);
    await automatic();
    const abilities = structuredClone(s.rider_derived_abilities);
    await automatic();
    assert.deepEqual(s.rider_derived_abilities, abilities);
    assert.deepEqual(s.training_rider_ticks.map(r => r.game_day).sort((a, b) => a - b), [41, 42, 44, 45]);
    const entrant = [{ ...s.rider_condition[0] }];
    await applyStageStartFatigue({ supabase: f.supabase, raceId: RACE, stageNumber: 1, entrants: entrant });
    const current = await ridersWithFatigueNow({ supabase: f.supabase, riders: s.rider_condition, now: STAGE_AT });
    assert.equal(current[0].fatigue, entrant[0].fatigue);
    assert.equal(current[0].form, entrant[0].form);
    finishRace(s, ["r1"]);
    await f.db.query("INSERT INTO race_simulation_runs(race_id,stage_number,entrant_snapshot,condition_load_snapshot) VALUES($1,1,$2::jsonb,$3::jsonb)",
      [f.ids.get(RACE), JSON.stringify([f.ids.get("r1")]), JSON.stringify([{ rider_id: f.ids.get("r1"), load: 9 }])]);
    await f.db.query("SELECT record_training_race_load($1,1,$2::jsonb)", [f.ids.get(RACE), JSON.stringify([{ rider_id: f.ids.get("r1"), load: 9 }])]);
    await f.db.query("UPDATE races SET stages_completed=1 WHERE id=$1", [f.ids.get(RACE)]);
    await f.db.query("INSERT INTO race_results(race_id,rider_id,stage_number,result_type) VALUES($1,$2,1,'stage')", [f.ids.get(RACE), f.ids.get("r1")]);
    await f.synchronize();
    await sweep(s, f);
    const final = structuredClone(s.rider_derived_abilities);
    await sweep(s, f);
    assert.deepEqual(s.rider_derived_abilities, final);
    assert.equal(s.training_rider_ticks.length, 5);
    assert.equal(s.training_condition_settlements.length, 1);
    assert.equal(s.training_race_loads.length, 1);
    assert.ok(s.training_race_loads[0].consumed_at);
    const after = await fatigueOutlookForTeam(args(s, f));
    assert.equal(after.get("r1").fatigue, s.rider_condition[0].fatigue);
    assert.equal(after.get("r1").form, s.rider_condition[0].form);
    const next = await ridersWithFatigueNow({ supabase: f.supabase, riders: s.rider_condition, now: new Date("2026-11-10T08:00:00Z") });
    assert.deepEqual(next, s.rider_condition, "old ledger cannot spill into the next date");
  } finally { await f.db.close(); }
});

test("#7737 API projection: OFF mixed roster keeps unstamped field absence", async () => {
  const s = seedState({ riderIds: ["r1"], flags: { ...FLAGS, fatigue_now_7801: "off" } });
  enter(s, ["r1"]);
  const f = createFake(s);
  await press(s, f);
  s.rider_condition.push({ rider_id: "newcomer", form: 50, fatigue: 30 });
  const source = await readFile(new URL("../routes/api.js", import.meta.url), "utf8");
  const start = source.indexOf("    const condition = {};", source.indexOf('router.get("/training/me"'));
  const end = source.indexOf("    // Byg progress-map:", start);
  assert.ok(start > 0 && end > start);
  // Execute the route's condition projection verbatim, with the real reader and fixed clock.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const project = new AsyncFunction("supabase", "req", "activeSeasonId", "conditionResult", "progressResult", "state",
    "primaryTypeByRider", "fatigueOutlookForTeam", "resolveProgram", "injuryRisk",
    source.slice(start, end) + "return condition;");
  const result = await project(f.supabase, { team: s.teams[0] }, SEASON.id, { data: s.rider_condition }, { data: [] },
    { plans: {} }, new Map(), input => fatigueOutlookForTeam({ ...input, now: STAGE_AT }),
    () => ({ intensity: "normal" }), () => 0);
  assert.equal(Object.hasOwn(result.r1, "fatigue_at_start"), true);
  assert.equal(Object.hasOwn(result.newcomer, "fatigue_at_start"), false);
  assert.equal(result.newcomer.fatigue, 30);
  assert.equal(result.newcomer.form, 50);
});

test("#7737 automatic stage runtime: an interrupted press resumes before the real entrant ability lookup", async () => {
  const s = seedState({ riderIds: ["r1", "r2", "r3", "r4", "r5", "r6"], flags: FLAGS });
  enter(s, s.riders.map(row => row.id));
  s.seasons = [SEASON];
  s.race_stage_profiles = [{ race_id: RACE, stage_number: 1, profile_type: "flat", demand_vector: { flat: 1 } }];
  const f = createFake(s);
  const rpc = f.supabase.rpc;
  let disconnected = true;
  f.supabase.rpc = async (name, input) => {
    if (disconnected && name.replace(/^try_/, "") === "commit_training_date_tick" && input.p_game_day === 44) throw new Error("connection interrupted");
    return rpc(name, input);
  };
  await assert.rejects(press(s, f), /connection interrupted/);
  disconnected = false;
  s.app_config.find(row => row.key === "training_train_now_instant").value = "off";
  const from = f.supabase.from;
  const entrantLookup = new Error("observed entrant ability read after automatic recovery");
  f.supabase.from = table => {
    if (table === "rider_derived_abilities" && s.training_rider_ticks.length === 24) throw entrantLookup;
    return from(table);
  };
  await assert.rejects(simulateStageByIndex({ supabase: f.supabase, race: { ...s.races[0] }, stageIndex: 0,
    now: STAGE_AT, checkV3Enabled: async () => false, checkV4Enabled: async () => false,
    checkFinalizeResumable: async () => true, readFinalizeStateFn: async () => null,
    writeFinalizeStateFn: async () => true }), error => error === entrantLookup);
  for (const rider of s.riders) assert.deepEqual(s.training_rider_ticks.filter(row => row.rider_id === rider.id).map(row => row.game_day), [41, 42, 44, 45]);
});

test("#7737 partial GET: zero/two committed free slots preserve condition and injuries, add only canonical prior-date loads", async () => {
  for (const failedDay of [41, 44]) {
    const s = seedState({ riderIds: ["r1"], flags: FLAGS });
    enter(s, ["r1"]);
    const f = createFake(s);
    const rpc = f.supabase.rpc;
    f.supabase.rpc = async (name, input) => {
      if (name.replace(/^try_/, "") === "commit_training_date_tick" && input.p_game_day === failedDay) throw new Error("partial press");
      return rpc(name, input);
    };
    await assert.rejects(press(s, f), /partial press/);
    const condition = s.rider_condition[0];
    Object.assign(condition, { injured_until: "2026-11-12", injury_cause: "race_crash" });
    finishRace(s, ["r1"]);
    const snapshot = structuredClone(s);
    const now = await ridersWithFatigueNow({ supabase: f.supabase, riders: s.rider_condition, now: STAGE_AT });
    assert.equal(now[0].form, condition.form);
    assert.equal(now[0].fatigue, riderFatigueNow({ openingFatigue: condition.fatigue, dateLoads: [9], recoveryAbility: 40 }));
    assert.equal(now[0].injured_until, condition.injured_until);
    assert.equal(now[0].injury_cause, condition.injury_cause);
    const before = await ridersWithFatigueNow({ supabase: f.supabase, riders: s.rider_condition, now: STAGE_AT, beforeGameDay: 43 });
    assert.equal(before[0].fatigue, condition.fatigue, "current/later stage loads are excluded");
    const tomorrow = await ridersWithFatigueNow({ supabase: f.supabase, riders: s.rider_condition, now: new Date("2026-11-10T08:00:00Z") });
    assert.deepEqual(tomorrow, s.rider_condition);
    assert.deepEqual(s, snapshot, "all partial condition reads are side-effect free");
  }
});
