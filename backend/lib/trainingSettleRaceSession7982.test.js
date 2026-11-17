// #7982 (afregning efter etapen): beviserne 2-5 for serverdelen. Facit (bevis 1) staar i
// trainingSettleRaceSession7982.facit.test.js.
//
// Del A koerer migrationen mod PostgreSQL (PGlite = PostgreSQL 17, én forbindelse): trin 1 og 1b
// anvendes, saa denne migration ovenpaa. Trin 1b's funktion publiceres ved siden af under sit eget
// navn som den FROSNE udgave, og med kontakten slukket skal de to give samme svar, samme raekker og
// samme fejl. Ingen database ud over den lokale PGlite roeres.
// Del B er rene funktioner og delkoerslen med injicerede laesere (fast ur, regel 16).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { resolveRaceSessionReadiness, resolveTrainingDateReadiness } from "./trainingDateReadiness.js";
import {
  planRaceSessionSettlement, runRaceSessionSettlement, startRaceSessionSettlementAfterStages,
  evaluateTrainingSettleRaceSessionFlag, __resetRaceSessionSettlementForTests,
} from "./trainingSettleRaceSession7982.js";
import { startTrainingDayCloseAfterStages, __resetTrainingDayCloseStateForTests } from "./trainingDayCloseTrigger.js";
import { STAGE_FLAGS } from "./stageFlagCatalog.js";
import {
  seedState, finishRace, press, sweep, RACE, rider as hRider,
} from "./trainNowSameResult7982.harness.js";
import { fakeWithRaceSessionRule, settle, placeRace, finishStage1, STAGE_DONE_AT } from "./trainingSettleRaceSession7982.facit.test.js";

// ── Del A: databasefunktionen ─────────────────────────────────────────────────────────────────
const file = async (name) => (await readFile(new URL(`../../database/${name}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const TRIN1 = "2026-11-12-7982-commit-training-date-tick-samlet-tjek.sql";
const TRIN1B = "2026-11-13-7982-commit-training-date-tick-opslag-pr-rytter.sql";
const MIGRATION = "2026-11-15-7982-settle-race-session.sql";
// Fable 15/11 (TRAINING_RULES 13.5): ingen foreloebig kondition og aabningstjekket for loebssessionen.
const MIGRATION_1118 = "2026-11-18-7982-race-session-no-provisional.sql";
const SIGNATURE = "(uuid,uuid,text,integer,date,integer[],text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,timestamptz)";
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const TEAM = id(1), SEASON = id(900), RACE_ID = id(800);
const RIDERS = [11, 12, 13, 14].map(id);
const DATE = "2026-11-09", DAYS = [41, 42, 43, 44, 45];
const AT = (minute) => `2026-11-09T${String(14 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00Z`;
const arr = (ids) => `'{${ids.join(",")}}'::uuid[]`;
const j = (x) => `'${JSON.stringify(x).replace(/'/g, "''")}'::jsonb`;

async function frozenSql(name = TRIN1B, as = "commit_training_date_tick_frozen") {
  const source = await file(name);
  const start = source.indexOf("CREATE OR REPLACE FUNCTION public.commit_training_date_tick(");
  const end = source.indexOf("$$;", start) + 3;
  return source.slice(start, end).replace("public.commit_training_date_tick(", `public.${as}(`);
}

// Trin 1 som auto-migrate koerer den (samme opdeling som commitTrainingDateTick7982b), saa 1b, saa denne.
async function applyTrin1(db) {
  const sql = await file(TRIN1);
  const commit = sql.indexOf("\nCOMMIT;\n") + "\nCOMMIT;\n".length;
  const heal = sql.indexOf("END $$;", commit) + "END $$;".length;
  const tail = sql.slice(heal).replace(/^\s*--.*$/gm, "").trim();
  const [, wait, index] = tail.match(/^(SET lock_timeout = '\d+s';)\s*(CREATE INDEX CONCURRENTLY IF NOT EXISTS [^;]+;)$/) ?? [];
  await db.exec(sql.slice(0, commit)); await db.exec(sql.slice(commit, heal)); await db.exec(wait); await db.exec(index);
}

async function newDb() {
  const db = new PGlite();
  await db.exec(await readFile(new URL("./__fixtures__/trainingHeldSchema.sql", import.meta.url), "utf8"));
  for (const name of ["2026-09-29-5928-training-condition-date.sql", "2026-09-29-5928-training-condition-partial.sql", "2026-09-29-5928-training-condition-recovery.sql", "2026-09-29-5928-training-condition-initialization.sql"]) await db.exec(await file(name));
  await db.exec("ALTER TABLE race_results ADD COLUMN rider_id uuid; ALTER TABLE training_day_runs ADD COLUMN id uuid DEFAULT gen_random_uuid(); ALTER TABLE app_config ADD COLUMN description text");
  for (const name of ["2026-09-30-5860-shared-race-day-recovery.sql", "2026-10-10-6439-training-follows-rider.sql", "2026-10-01-traen-nu-locks.sql"]) await db.exec(await file(name));
  await db.exec("CREATE TABLE race_entries(race_id uuid,rider_id uuid,team_id uuid,race_role text, PRIMARY KEY(race_id,rider_id))");
  await db.exec(await file("2026-11-09-7737-train-now-instant.sql"));
  await applyTrin1(db);
  await db.exec(await file(TRIN1B));
  await db.exec(await frozenSql());
  await db.exec(await file(MIGRATION));
  await db.exec(await file(MIGRATION)); // idempotent
  // 15/11-udgaven publiceres FROSSET ved siden af, foer 18/11-rettelsen laegges ovenpaa.
  await db.exec(await frozenSql(MIGRATION, "commit_training_date_tick_1115"));
  await db.exec(await file(MIGRATION_1118));
  await db.exec(await file(MIGRATION_1118)); // idempotent
  await db.exec(`INSERT INTO riders(id,team_id) VALUES ${RIDERS.map((r) => `('${r}','${TEAM}')`).join(",")};
    INSERT INTO rider_derived_abilities VALUES ${RIDERS.map((r) => `('${r}',50,'{}')`).join(",")};
    INSERT INTO rider_condition(rider_id,form,fatigue,updated_at) VALUES ${RIDERS.map((r) => `('${r}',50,32,'2026-11-08T20:00:00Z')`).join(",")};
    INSERT INTO races(id,season_id,status,stages_completed,stages,race_type) VALUES('${RACE_ID}','${SEASON}','completed',1,1,'single');`);
  return db;
}

const scalar = async (db, sql) => Object.values((await db.query(sql)).rows[0])[0];
const setSwitch = (db, value) => db.exec(`UPDATE app_config SET value=${j(value)} WHERE key='training_settle_race_session'`);
const register = async (db, riders = RIDERS) => (await db.query(`SELECT register_training_date_work('${TEAM}','${SEASON}','${DATE}','{${DAYS}}',${arr(riders)},NULL,'${AT(0)}') AS w`)).rows[0].w;
const load = (db, r, day = 43) => db.exec(`INSERT INTO training_race_loads(rider_id,race_id,stage_number,season_id,game_day,tick_date,load) VALUES('${r}','${RACE_ID}',1,'${SEASON}',${day},'${DATE}',9)`);

async function dump(db) {
  const out = {};
  for (const [table, order] of [["training_rider_ticks", "rider_id,game_day"], ["training_condition_settlements", "rider_id,tick_date"], ["rider_condition", "rider_id"], ["training_date_work", "team_id,season_id,tick_date"], ["training_day_runs", "team_id,game_day"], ["training_race_loads", "rider_id"]]) {
    out[table] = (await db.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows.map(({ id: _id, settled_at: _s, ...row }) => row);
  }
  return out;
}

const settledCondition = (r) => ({ rider_id: r, form: 51, fatigue: 25, injured_until: null, injury_cause: null, updated_at: AT(5) });
async function call(db, fn, { day, riders, openings, conditions = [], raceSession = [], receipts = {}, raceLoads = [], at = AT(1) }) {
  const report = { condition_per_date: true, riders: riders.map((r) => ({
    rider_id: r, game_day: day, intensity: raceSession.includes(r) ? "race" : "normal",
    condition_before_date: openings[r] ?? null, condition_observed: openings[r] ?? null, missing_evidence: [],
    ...(raceSession.includes(r) ? { race_session_7982: true } : {}),
    ...(receipts[r] ? { expected_date_receipt_days: receipts[r] } : {}),
  })) };
  // Hvert kald i sit eget savepoint: en fejl ruller kun kaldet tilbage, ikke tilfaeldets transaktion.
  await db.exec("SAVEPOINT c");
  try {
    const result = (await db.query(`SELECT ${fn}('${TEAM}','${SEASON}','senior',${day},'${DATE}','{${DAYS}}','assistant',${j(report)},'[]',${j(conditions)},'[]','[]','[]',${j(raceLoads)},false,'${at}') AS r`)).rows[0].r;
    await db.exec("RELEASE SAVEPOINT c");
    return { result, rows: await dump(db) };
  } catch (e) {
    await db.exec("ROLLBACK TO SAVEPOINT c");
    return { error: { code: e.code, message: e.message } };
  }
}
async function both(db, args) {
  const out = {};
  for (const fn of ["commit_training_date_tick_frozen", "commit_training_date_tick"]) {
    await db.exec("SAVEPOINT eq"); out[fn] = await call(db, fn, args); await db.exec("ROLLBACK TO SAVEPOINT eq");
  }
  assert.deepEqual(out.commit_training_date_tick, out.commit_training_date_tick_frozen);
  return out.commit_training_date_tick;
}
async function inCase(db, fn) { await db.exec("BEGIN"); try { return await fn(); } finally { await db.exec("ROLLBACK"); } }

describe("databasefunktionen (PGlite)", () => {
  let db;
  test("opsaetning: kontakten er seedet off, rettigheder og laase som trin 1b", async () => {
    db = await newDb();
    assert.equal(await scalar(db, "SELECT value #>> '{}' FROM app_config WHERE key='training_settle_race_session'"), "off");
    const proc = (await db.query(`SELECT prosecdef,proconfig FROM pg_proc WHERE oid='public.commit_training_date_tick${SIGNATURE}'::regprocedure`)).rows[0];
    assert.equal(proc.prosecdef, false);
    assert.deepEqual(proc.proconfig, ["search_path=public, pg_temp"]);
    for (const [role, allowed] of [["service_role", true], ["anon", false], ["authenticated", false]]) {
      assert.equal(await scalar(db, `SELECT has_function_privilege('${role}','public.commit_training_date_tick${SIGNATURE}','EXECUTE')`), allowed, role);
    }
    // Samtidighed: samme laase i samme raekkefoelge som i dag (holdlaasen giver Traen nu 409 under delkoerslen).
    const frozen = await scalar(db, "SELECT prosrc FROM pg_proc WHERE proname='commit_training_date_tick_frozen'");
    const v1115 = await scalar(db, "SELECT prosrc FROM pg_proc WHERE proname='commit_training_date_tick_1115'");
    const migrated = await scalar(db, "SELECT prosrc FROM pg_proc WHERE proname='commit_training_date_tick'");
    const locks = (src) => src.split("\n").filter((line) => /pg_advisory|FOR UPDATE/.test(line)).map((line) => line.trim());
    assert.deepEqual(locks(v1115), locks(frozen));
    assert.deepEqual(locks(migrated), locks(frozen));
    assert.match(locks(migrated)[1], /pg_advisory_xact_lock\(hashtextextended\('training-date:'\|\|p_team_id/);
    // Uden for #7982-linjerne er 15/11-kroppen trin 1b's tekst.
    const strip = (src) => src.replace(/;v_race_session uuid\[\]:='\{\}'/, "")
      .replace(/ {2}-- #7982: a race session settled[\s\S]*?v_instant:=v_instant\|\|v_race_session;\n/, "")
      .replace(/ {2}-- #7982: settled_at is the actual time[^\n]*\n/, "")
      .replace(/ {2}-- #7982: a race session rider writes[\s\S]*?Condition writes only at date settlement'; END IF;\n/, "")
      .replace(",created_at,settled_at)", ",created_at)").replace("r,p_now,clock_timestamp() FROM", "r,p_now FROM");
    assert.equal(strip(v1115), frozen);
    // 18/11 (Fable 15/11): uden for de fire rettelser er kroppen 15/11's tekst. Rettelserne: v_stamped
    // (stemplet alene), aabningstjekket og foreloebig kondition foelger v_stamped, den foreloebige
    // skrivning roerer kun stemplede, og loebssessionens foreloebige kondition afvises.
    const strip1118 = (src) => src.replace(";v_stamped uuid[]:='{}'", "")
      .replace(/ {2}-- #7982 \(Fable 15\/11\): v_stamped is[\s\S]*?v_stamped:=v_instant;\n/, "")
      .replace(/ {4}-- #7982: a race session rider keeps the check[^\n]*\n/, "")
      .replace(/ {2}-- #7982 \(Fable 15\/11\): a race session rider never writes[\s\S]*?'Race session writes no provisional condition'; END IF;\n/, "")
      .replace(" AND c.rider_id=ANY(v_stamped);", ";")
      .replaceAll("ANY(v_stamped)", "ANY(v_instant)");
    const strip1115 = (src) => src.replace(/ {2}-- #7982: a race session rider writes[\s\S]*?Condition writes only at date settlement'; END IF;\n/, "");
    assert.notEqual(migrated, v1115, "18/11-rettelsen er anvendt");
    assert.equal(strip1118(migrated), strip1115(v1115));
    for (const name of [MIGRATION, MIGRATION_1118]) assert.doesNotMatch(await file(name), /POLICY|ROW LEVEL SECURITY|SECURITY DEFINER/i);
  });

  test("bevis 5 (RPC): kontakten slukket = samme svar, raekker og fejl som trin 1b for en hel dato", async () => {
    await inCase(db, async () => {
      const { opening_conditions: openings } = await register(db);
      await load(db, RIDERS[0]); await load(db, RIDERS[1]);
      for (const day of DAYS) {
        const conditions = day === 45 ? RIDERS.map(settledCondition) : [];
        const raceLoads = day === 45 ? [RIDERS[0], RIDERS[1]].map((r) => ({ rider_id: r, race_id: RACE_ID, stage_number: 1, game_day: 43, load: 9 })) : [];
        const out = await both(db, { day, riders: RIDERS, openings, conditions, raceLoads, at: AT(day) });
        assert.ok(!out.error, JSON.stringify(out.error));
        await call(db, "commit_training_date_tick", { day, riders: RIDERS, openings, conditions, raceLoads, at: AT(day) });
      }
    });
    await inCase(db, async () => {
      const { opening_conditions: openings } = await register(db);
      await load(db, RIDERS[0]);
      const outOfOrder = await both(db, { day: 43, riders: [RIDERS[0]], openings });
      assert.match(outOfOrder.error.message, /Earlier rider date ticks must commit first/);
    });
  });

  test("kontakten slukket: et loebssessions-maerke afvises (ingen sti uden kontakt)", async () => {
    await inCase(db, async () => {
      const { opening_conditions: openings } = await register(db);
      await load(db, RIDERS[0]);
      const out = await call(db, "commit_training_date_tick", { day: 43, riders: [RIDERS[0]], openings, raceSession: [RIDERS[0]], receipts: { [RIDERS[0]]: [] } });
      assert.match(out.error.message, /Race session settlement requires the switch and the stage load/);
    });
  });

  test("bevis 2: loebssessionen gemmes uden for raekkefoelgen, UDEN kondition, og lukker aldrig datoen for tidligt", async () => {
    await inCase(db, async () => {
      await setSwitch(db, "on");
      const { opening_conditions: openings } = await register(db);
      const [a, b] = RIDERS;
      await load(db, a); await load(db, b);
      // Uden belastning paa netop denne loebsdag er det ikke rytterens loebssession.
      const noLoad = await call(db, "commit_training_date_tick", { day: 44, riders: [a], openings, raceSession: [a], receipts: { [a]: [] } });
      assert.match(noLoad.error.message, /requires the switch and the stage load/);
      // En endelig kondition ved loebssessionen, naar den ikke er rytterens sidste, afvises.
      const closing = await call(db, "commit_training_date_tick", { day: 43, riders: [a], openings, raceSession: [a], receipts: { [a]: [] }, conditions: [settledCondition(a)] });
      assert.match(closing.error?.message ?? JSON.stringify(closing.result), /Condition writes only at date settlement/);
      // Fable 15/11: foreloebig form og traethed afvises for en loebssession (15/11-udgaven tog dem).
      const provisional = { day: 43, riders: [a], openings, raceSession: [a], receipts: { [a]: [] }, conditions: [{ rider_id: a, form: 47, fatigue: 44, provisional: true }], at: AT(30) };
      const rejected = await call(db, "commit_training_date_tick", provisional);
      assert.match(rejected.error?.message ?? JSON.stringify(rejected.result), /Race session writes no provisional condition/);
      await db.exec("SAVEPOINT old");
      const old = await call(db, "commit_training_date_tick_1115", provisional);
      await db.exec("ROLLBACK TO SAVEPOINT old");
      assert.ok(!old.error, "15/11-udgaven tillod den (det er hullet, der lukkes)");
      // Uden kondition: gemt, ingen afregning, belastningen er ikke brugt, rider_condition er aabningen.
      const ok = await call(db, "commit_training_date_tick", { day: 43, riders: [a], openings, raceSession: [a], receipts: { [a]: [] }, at: AT(30) });
      assert.ok(!ok.error, JSON.stringify(ok.error));
      assert.equal(ok.result.already_ran, false);
      assert.deepEqual(ok.rows.training_condition_settlements, []);
      const cond = ok.rows.rider_condition.find((r) => r.rider_id === a);
      assert.equal(cond.form, openings[a].form); assert.equal(cond.fatigue, openings[a].fatigue);
      assert.equal(String(cond.updated_at), String(new Date("2026-11-08T20:00:00Z")), "skade-felter og updated_at er uroerte");
      assert.equal(ok.rows.training_race_loads.find((r) => r.rider_id === a).consumed_at, null);
      // Rigtigt tidsstempel: settled_at er sat, created_at er kaldets tid som i dag.
      const stamp = (await db.query(`SELECT created_at,settled_at FROM training_rider_ticks WHERE rider_id='${a}' AND game_day=43`)).rows[0];
      assert.ok(stamp.settled_at instanceof Date && Number.isFinite(stamp.settled_at.getTime()));
      assert.equal(stamp.created_at.toISOString(), new Date(AT(30)).toISOString());
      // Aftenen: de tidligere sessioner gemmes uden for raekkefoelgen (kvitteringen afgoer, ikke kontakten),
      // med snapshot-tjekket og aabningstjekket, og rytteren karantaeneres ikke (hans raekke er aabningen).
      await setSwitch(db, "off");
      const stale = await call(db, "commit_training_date_tick", { day: 41, riders: [a], openings, receipts: { [a]: [] } });
      assert.match(stale.error.message, /Training receipt snapshot changed/);
      for (const [day, seen] of [[41, [43]], [42, [41, 43]], [44, [41, 42, 43]]]) {
        const r = await call(db, "commit_training_date_tick", { day, riders: [a], openings, receipts: { [a]: seen }, at: AT(300 + day) });
        assert.ok(!r.error, `${day}: ${JSON.stringify(r.error)}`);
        assert.deepEqual(r.rows.training_condition_settlements, [], `loebsdag ${day} lukker ikke datoen`);
        assert.deepEqual(JSON.parse(JSON.stringify(r.rows.training_date_work[0].quarantined_rider_ids)), []);
      }
      // Sidste manglende session lukker datoen præcis én gang, med belastningen.
      const last = await call(db, "commit_training_date_tick", { day: 45, riders: [a], openings, receipts: { [a]: [41, 42, 43, 44] },
        conditions: [settledCondition(a)], raceLoads: [{ rider_id: a, race_id: RACE_ID, stage_number: 1, game_day: 43, load: 9 }], at: AT(345) });
      assert.ok(!last.error, JSON.stringify(last.error));
      assert.equal(last.rows.training_condition_settlements.filter((s) => s.rider_id === a).length, 1);
      assert.ok(last.rows.training_race_loads.find((r) => r.rider_id === a).consumed_at != null);
    });
  });

  test("bevis 2: loebssessionen lukker datoen, naar den er rytterens sidste manglende session", async () => {
    await inCase(db, async () => {
      await setSwitch(db, "on");
      const { opening_conditions: openings } = await register(db);
      const a = RIDERS[0];
      await load(db, a);
      // Stemplet af Traen nu: de frie sessioner er gemt; loebssessionen er den sidste.
      await db.exec(`INSERT INTO training_train_now_locks(rider_id,team_id,season_id,tick_date,pressed_at,instant_at) VALUES('${a}','${TEAM}','${SEASON}','${DATE}','${AT(0)}','${AT(0)}')`);
      for (const [day, seen] of [[41, []], [42, [41]], [44, [41, 42]], [45, [41, 42, 44]]]) {
        const r = await call(db, "commit_training_date_tick", { day, riders: [a], openings, receipts: { [a]: seen } });
        assert.ok(!r.error, `${day}: ${JSON.stringify(r.error)}`);
      }
      const provisionalAtLast = await call(db, "commit_training_date_tick", { day: 43, riders: [a], openings, raceSession: [a], receipts: { [a]: [41, 42, 44, 45] }, conditions: [{ rider_id: a, form: 47, fatigue: 44, provisional: true }] });
      assert.match(provisionalAtLast.error.message, /Provisional condition cannot settle a date/);
      const r = await call(db, "commit_training_date_tick", { day: 43, riders: [a], openings, raceSession: [a], receipts: { [a]: [41, 42, 44, 45] },
        conditions: [settledCondition(a)], raceLoads: [{ rider_id: a, race_id: RACE_ID, stage_number: 1, game_day: 43, load: 9 }] });
      assert.ok(!r.error, JSON.stringify(r.error));
      assert.equal(r.rows.training_condition_settlements.length, 1);
    });
  });

  test("bevis 3: aftenkoerslen springer en session med kvittering over (already_ran, intet skrives)", async () => {
    await inCase(db, async () => {
      await setSwitch(db, "on");
      const { opening_conditions: openings } = await register(db);
      const a = RIDERS[0];
      await load(db, a);
      const first = await call(db, "commit_training_date_tick", { day: 43, riders: [a], openings, raceSession: [a], receipts: { [a]: [] } });
      assert.ok(!first.error, JSON.stringify(first.error));
      const before = await dump(db);
      const again = await call(db, "commit_training_date_tick", { day: 43, riders: [a], openings });
      assert.equal(again.result.already_ran, true);
      assert.deepEqual(again.rows, before);
    });
  });

  // Fable 15/11 (TRAINING_RULES 13.5): loebssessions-rytteren beholder aabningstjekket. Hans
  // rider_condition skal vaere datoens aabning; ellers karantaene som for enhver anden rytter.
  test("aabningstjekket gaelder loebssessionen: en aendret kondition giver karantaene (15/11 lod den passere)", async () => {
    await inCase(db, async () => {
      await setSwitch(db, "on");
      const { opening_conditions: openings } = await register(db);
      const a = RIDERS[0];
      await load(db, a);
      await db.exec(`UPDATE rider_condition SET fatigue=fatigue+7 WHERE rider_id='${a}'`);
      const args = { day: 43, riders: [a], openings, raceSession: [a], receipts: { [a]: [] }, at: AT(30) };
      await db.exec("SAVEPOINT old");
      const old = await call(db, "commit_training_date_tick_1115", args);
      await db.exec("ROLLBACK TO SAVEPOINT old");
      assert.ok(!old.error && old.result.applied_rider_ids?.includes(a), "15/11 sprang aabningstjekket over");
      const out = await call(db, "commit_training_date_tick", args);
      assert.ok(!out.error, JSON.stringify(out.error));
      assert.deepEqual(out.result.quarantined_rider_ids, [a]);
      assert.deepEqual(out.rows.training_rider_ticks, [], "ingen kvittering for en rytter i karantaene");
      assert.equal(out.rows.training_date_work[0].quarantine_evidence[0]?.reason ?? "unsafe_current_state", "unsafe_current_state");
    });
  });

  test("stemplet rytter (Traen nu): samme svar, raekker og fejl som 15/11 for hele datoen, ogsaa med loebssession", async () => {
    await inCase(db, async () => {
      await setSwitch(db, "on");
      const { opening_conditions: openings } = await register(db);
      const [a, b] = RIDERS;
      await load(db, a); await load(db, b);
      await db.exec(`INSERT INTO training_train_now_locks(rider_id,team_id,season_id,tick_date,pressed_at,instant_at) VALUES('${a}','${TEAM}','${SEASON}','${DATE}','${AT(0)}','${AT(0)}')`);
      const same = async (args) => {
        const out = {};
        for (const fn of ["commit_training_date_tick_1115", "commit_training_date_tick"]) {
          await db.exec("SAVEPOINT eq"); out[fn] = await call(db, fn, args); await db.exec("ROLLBACK TO SAVEPOINT eq");
        }
        assert.deepEqual(out.commit_training_date_tick, out.commit_training_date_tick_1115);
        return call(db, "commit_training_date_tick", args);
      };
      const steps = [
        { day: 41, riders: [a], receipts: { [a]: [] } },
        { day: 42, riders: [a], receipts: { [a]: [41] } },
        { day: 44, riders: [a], receipts: { [a]: [41, 42] } },
        // Sidste frie felt: stemplet rytter regner form og traethed foreloebigt (tilladt som foer).
        { day: 45, riders: [a], receipts: { [a]: [41, 42, 44] }, conditions: [{ rider_id: a, form: 47, fatigue: 44, provisional: true }] },
        // Loebssessionen lukker datoen; rider_condition er foreloebig, aabningstjekket springes over for ham.
        { day: 43, riders: [a, b], raceSession: [a, b], receipts: { [a]: [41, 42, 44, 45], [b]: [] },
          conditions: [settledCondition(a)], raceLoads: [{ rider_id: a, race_id: RACE_ID, stage_number: 1, game_day: 43, load: 9 }] },
      ];
      for (const step of steps) {
        const r = await same({ openings, at: AT(step.day), ...step });
        assert.ok(!r.error, `${step.day}: ${JSON.stringify(r.error)}`);
      }
      // b (ikke stemplet) fik ingen kondition; a's dato er lukket praecis een gang.
      const rows = await dump(db);
      assert.equal(rows.training_condition_settlements.filter((s) => s.rider_id === a).length, 1);
      assert.equal(rows.training_condition_settlements.filter((s) => s.rider_id === b).length, 0);
      assert.equal(rows.rider_condition.find((r) => r.rider_id === b).fatigue, openings[b].fatigue);
    });
  });

  // Fable 15/11 punkt 3: datoen fryses ved foerste etape (loebssessionen registrerer holdets dato).
  // En rytter, der derefter skifter hold, foelger traeningen i det gamle holds frosne trup (#6439):
  // det nye hold kan ikke registrere eller traene ham paa datoen, og hans dato lukkes praecis een gang.
  test("rytter skifter hold efter foerste etape: det gamle hold lukker datoen een gang, det nye roerer ham ikke", async () => {
    await inCase(db, async () => {
      await setSwitch(db, "on");
      const TEAM2 = id(2);
      const { opening_conditions: openings } = await register(db);
      const [a, b] = RIDERS;
      await load(db, a);
      const session = await call(db, "commit_training_date_tick", { day: 43, riders: [a], openings, raceSession: [a], receipts: { [a]: [] }, at: AT(30) });
      assert.ok(!session.error, JSON.stringify(session.error));
      // Salget efter etapen: rytteren staar nu paa det nye hold.
      await db.exec(`UPDATE riders SET team_id='${TEAM2}' WHERE id='${a}'`);
      const work2 = (await db.query(`SELECT register_training_date_work('${TEAM2}','${SEASON}','${DATE}','{${DAYS}}',${arr([a])},NULL,'${AT(60)}') AS w`)).rows[0].w;
      assert.deepEqual(work2.expected_rider_ids, [], "det nye hold faar ham ikke paa samme dato");
      await db.exec("SAVEPOINT t2");
      const report2 = { condition_per_date: true, riders: [{ rider_id: a, game_day: 41, intensity: "normal", condition_before_date: openings[a], condition_observed: openings[a], missing_evidence: [] }] };
      await assert.rejects(db.query(`SELECT commit_training_date_tick('${TEAM2}','${SEASON}','senior',41,'${DATE}','{${DAYS}}','assistant',${j(report2)},'[]','[]','[]','[]','[]','[]',false,'${AT(61)}')`), /Rider outside frozen date roster/);
      await db.exec("ROLLBACK TO SAVEPOINT t2");
      // Aftenen paa det gamle hold: de andre sessioner gemmes, og den sidste lukker datoen.
      for (const [day, seen] of [[41, [43]], [42, [41, 43]], [44, [41, 42, 43]]]) {
        const r = await call(db, "commit_training_date_tick", { day, riders: [a, b].filter((x) => x === a || day < 43), openings, receipts: { [a]: seen }, at: AT(300 + day) });
        assert.ok(!r.error, `${day}: ${JSON.stringify(r.error)}`);
        assert.deepEqual(JSON.parse(JSON.stringify(r.rows.training_date_work.find((w) => w.team_id === TEAM).quarantined_rider_ids)), [], `loebsdag ${day}: ingen karantaene`);
      }
      const last = await call(db, "commit_training_date_tick", { day: 45, riders: [a], openings, receipts: { [a]: [41, 42, 43, 44] },
        conditions: [settledCondition(a)], raceLoads: [{ rider_id: a, race_id: RACE_ID, stage_number: 1, game_day: 43, load: 9 }], at: AT(345) });
      assert.ok(!last.error, JSON.stringify(last.error));
      const settled = last.rows.training_condition_settlements.filter((s) => s.rider_id === a);
      assert.equal(settled.length, 1);
      assert.equal(settled[0].team_id, TEAM, "afregnet paa holdet, der aabnede datoen");
      assert.equal(last.rows.training_rider_ticks.filter((t) => t.rider_id === a).length, 5);
      assert.ok(last.rows.training_rider_ticks.filter((t) => t.rider_id === a).every((t) => t.team_id === TEAM));
    });
  });
});

// ── Del B: klarhed pr. session, planen og delkoerslen ─────────────────────────────────────────
describe("klarhed pr. session", () => {
  const races = [{ id: "r1", stages_completed: 1, finalize_state: null }, { id: "r2", stages_completed: 2, finalize_state: { stage_index: 1 } }, { id: "r3", stages_completed: 0, finalize_state: null }];
  const stages = [{ race_id: "r1", stage_number: 1, game_day: 43 }, { race_id: "r2", stage_number: 2, game_day: 44 }, { race_id: "r3", stage_number: 1, game_day: 45 }];
  const runs = [{ race_id: "r1", stage_number: 1, entrant_snapshot: ["a", "b", "x"] }, { race_id: "r2", stage_number: 2, entrant_snapshot: ["c"] }];
  const loads = [{ rider_id: "a", race_id: "r1", stage_number: 1, game_day: 43 }, { rider_id: "c", race_id: "r2", stage_number: 2, game_day: 44 }, { rider_id: "x", race_id: "r1", stage_number: 1, game_day: 43 }];

  test("kun lukkede etaper med startliste og belastning; bevis 4: finalize_state sat afregnes aldrig", () => {
    const ready = resolveRaceSessionReadiness({ riderIds: ["a", "b", "c", "d"], stages, races, runs, loads });
    assert.deepEqual([...ready], [[43, ["a"]]]); // b uden belastning, c i halv afslutning, x ikke vores, r3 ikke koert
    assert.equal(resolveRaceSessionReadiness({ riderIds: ["a"], stages, races, runs: [], loads }).size, 0, "uden startliste intet");
  });

  test("to etaper samme dato: hver session er klar for sig", () => {
    const two = [{ id: "s", stages_completed: 2, finalize_state: null }];
    const st = [{ race_id: "s", stage_number: 1, game_day: 43 }, { race_id: "s", stage_number: 2, game_day: 44 }];
    const rn = [{ race_id: "s", stage_number: 1, entrant_snapshot: ["a"] }, { race_id: "s", stage_number: 2, entrant_snapshot: ["a"] }];
    const ld = [{ rider_id: "a", race_id: "s", stage_number: 1, game_day: 43 }, { rider_id: "a", race_id: "s", stage_number: 2, game_day: 44 }];
    assert.deepEqual([...resolveRaceSessionReadiness({ riderIds: ["a"], stages: st, races: two, runs: rn, loads: ld })], [[43, ["a"]], [44, ["a"]]]);
    two[0].stages_completed = 1;
    assert.deepEqual([...resolveRaceSessionReadiness({ riderIds: ["a"], stages: st, races: two, runs: rn, loads: ld })], [[43, ["a"]]]);
    // Hele-datoens klarhed er uaendret: rytteren venter stadig paa etape 2 dér.
    assert.deepEqual(resolveTrainingDateReadiness({ tickDate: "2026-11-09", now: new Date("2026-11-09T16:00:00Z"), riderIds: ["a"], stages: st, races: two, runs: rn, loads: ld }).eligibleRiderIds, []);
  });

  test("planen: kvittering springes over, lukket dato og hold uden pulje roeres ikke, frossen trup afgoer", () => {
    const teams = [{ id: "T1", league_division_id: "D" }, { id: "T2", league_division_id: "D" }, { id: "T3", league_division_id: null }, { id: "T4", league_division_id: "D", is_bank: true }];
    const riders = [{ id: "a", team_id: "T1" }, { id: "b", team_id: "T1" }, { id: "c", team_id: "T2" }, { id: "d", team_id: "T3" }, { id: "e", team_id: "T4" }, { id: "late", team_id: "T1", acquired_at: "2026-11-10T01:00:00Z" }];
    const readyByDay = new Map([[43, ["a", "b", "c", "d", "e", "late"]]]);
    const plan = planRaceSessionSettlement({
      teams, riders, readyByDay, receiptKeys: new Set(["b#43"]),
      workByTeam: new Map([["T2", { team_id: "T2", status: "complete", game_days: [41, 42, 43, 44, 45], expected_rider_ids: ["c"] }]]),
      gameDaysByDivision: new Map([["D", [41, 42, 43, 44, 45]]]), dateEnd: new Date("2026-11-09T23:00:00Z"),
    });
    assert.deepEqual(plan, [{ teamId: "T1", gameDay: 43, days: [41, 42, 43, 44, 45], riderIds: ["a"] }]);
    const moved = planRaceSessionSettlement({
      teams: [{ id: "T1", league_division_id: "D" }], riders: [{ id: "a", team_id: "T9" }], readyByDay: new Map([[43, ["a"]]]), receiptKeys: new Set(),
      workByTeam: new Map([["T1", { team_id: "T1", status: "partial", game_days: [41, 42, 43, 44, 45], expected_rider_ids: ["a"], quarantined_rider_ids: [] }]]),
      gameDaysByDivision: new Map(), dateEnd: new Date("2026-11-09T23:00:00Z"),
    });
    assert.equal(moved.length, 1, "traeningen foelger rytteren i datoens frosne trup");
  });
});

describe("delkoerslen", () => {
  const noRead = { from() { throw new Error("must not read"); }, rpc() { throw new Error("must not call"); } };
  test("kontakten: kun den eksakte streng on taender; slukket laeser intet ud over kontakten", async () => {
    for (const v of ["off", "beta", true, "ON", null, undefined]) assert.equal(evaluateTrainingSettleRaceSessionFlag(v), false, String(v));
    assert.equal(evaluateTrainingSettleRaceSessionFlag("on"), true);
    const out = await runRaceSessionSettlement({ supabase: noRead, now: new Date(), isEnabled: async () => false });
    assert.deepEqual(out.skipped, "flag_off");
    assert.ok(STAGE_FLAGS.some((f) => f.key === "training_settle_race_session"));
  });

  test("hovedkontakten for daglig traening stopper ogsaa delkoerslen (Codex P1 15/11)", async () => {
    const out = await runRaceSessionSettlement({ supabase: noRead, now: new Date(), isEnabled: async () => true, isDailyTraining: async () => false });
    assert.equal(out.skipped, "daily_training_off");
  });

  test("saesonens sidste dato og en dato efter saesonen afregnes ikke her", async () => {
    const season = { id: "S", number: 5, end_date: "2026-12-20", status: "active" };
    const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: season, error: null }) }) }) }) };
    const base = { supabase, isEnabled: async () => true, isDailyTraining: async () => true, isConditionPerDate: async () => true, loadContext: async () => { throw new Error("must not load"); } };
    assert.equal((await runRaceSessionSettlement({ ...base, now: new Date("2026-12-20T15:00:00Z"), loadFinalDate: async () => "2026-12-20" })).skipped, "final_season_date");
    assert.equal((await runRaceSessionSettlement({ ...base, now: new Date("2026-12-21T15:00:00Z"), loadFinalDate: async () => "2026-12-20" })).skipped, "after_season_end");
  });

  test("et holds fejl stopper ikke de andre og kastes aldrig", async () => {
    const state = seedState({ count: 6, entered: [1, 2], flags: { training_settle_race_session: "on" } });
    state.teams.push({ ...state.teams[0], id: "00000000-0000-4000-8000-000000000003" });
    finishRace(state);
    const fake = fakeWithRaceSessionRule(state);
    let calls = 0;
    const out = await runRaceSessionSettlement({ supabase: fake.supabase, now: STAGE_DONE_AT, logger: { error() {} },
      loadDaySpans: async () => new Map(), loadFinalDate: async () => "2026-12-20",
      loadContext: async () => ({ ...(await (await import("./trainingSettleRaceSession7982.facit.test.js")).contextOf(state)()),
        riders: state.riders.map((r, i) => ({ ...r, team_id: i === 2 ? "00000000-0000-4000-8000-000000000003" : r.team_id })) }),
      runDay: async () => { calls++; if (calls === 1) throw new Error("boom"); return { alreadyRan: false }; } });
    assert.equal(out.failed, 1); assert.equal(out.settled, 1); assert.equal(calls, 2);
  });

  test("bevis 4: en etape med finalize_state sat afregnes aldrig (hele vejen gennem delkoerslen)", async () => {
    const state = seedState({ count: 6, entered: [1, 2], flags: { training_settle_race_session: "on" } });
    finishRace(state);
    state.races.find((r) => r.id === RACE).finalize_state = { stage_index: 0 };
    const fake = fakeWithRaceSessionRule(state);
    const out = await settle(state, fake);
    assert.equal(out.skipped, "no_closed_stage");
    assert.deepEqual(state.training_rider_ticks, []);
  });

  test("bevis 3: Traen nu under delkoerslen giver 409 som i dag (holdlaasen), og intet skrives af trykket", async () => {
    const state = seedState({ count: 8, entered: [1, 4], flags: { training_settle_race_session: "on" } });
    placeRace(state, 43); finishStage1(state);
    const fake = fakeWithRaceSessionRule(state);
    const rpc = fake.supabase.rpc;
    let pressAnswer = null, inFlight = false;
    // Holdlaasen modelleres som i databasen: delkoerslens register/commit holder den; trykkets
    // try_-kald faar "held", mens den holdes.
    fake.supabase.rpc = async (name, args) => {
      if (name === "try_register_training_date_work" && inFlight) return { data: { held: true }, error: null };
      if (name === "commit_training_date_tick" && args.p_report?.riders?.some((r) => r.race_session_7982) && pressAnswer === null) {
        inFlight = true;
        const tables = () => JSON.stringify([state.training_rider_ticks, state.rider_condition, state.rider_derived_abilities, state.training_condition_settlements]);
        const before = tables();
        pressAnswer = await press(state, fake, { now: new Date("2026-11-09T16:31:00Z") });
        pressAnswer.unchanged = tables() === before;
        const out = await rpc(name, args); inFlight = false; return out;
      }
      return rpc(name, args);
    };
    const out = await settle(state, fake);
    assert.equal(pressAnswer.status, 409);
    assert.equal(pressAnswer.body.error, "training_in_progress");
    assert.equal(pressAnswer.unchanged, true, "trykket skrev ingen traening (laasene som i dag)");
    assert.equal(out.settled, 1);
    // Aftenkoerslen springer de gemte loebssessioner over: én kvittering pr. rytter og session.
    fake.supabase.rpc = rpc;
    const evening = await sweep(state, fake);
    assert.ok(evening.every((r) => !r.error), JSON.stringify(evening));
    const keys = state.training_rider_ticks.map((t) => `${t.rider_id}#${t.game_day}`);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(state.training_rider_ticks.filter((t) => t.game_day === 43 && [hRider(1), hRider(4)].includes(t.rider_id) && t.report.race_session_7982).length, 2);
    assert.equal(state.training_condition_settlements.length, 8);
  });
});

describe("krogen i lukningens start", () => {
  test("startes kun med afviklede etaper, aldrig oven i sig selv, og kaster aldrig", async () => {
    __resetRaceSessionSettlementForTests();
    assert.equal(startRaceSessionSettlementAfterStages({ supabase: { from() {} }, stagesRan: 0, run: async () => ({}) }), null);
    let release;
    const p = startRaceSessionSettlementAfterStages({ supabase: { from() {} }, stagesRan: 1, logger: { log() {}, error() {} }, run: () => new Promise((r) => { release = r; }) });
    assert.ok(p);
    await new Promise((r) => setImmediate(r));
    assert.equal(startRaceSessionSettlementAfterStages({ supabase: { from() {} }, stagesRan: 1, run: async () => ({}) }), null, "overlap-vagt");
    release({ ran: true, settled: 1, failed: 0 }); await p;
    const errors = [];
    const failing = await startRaceSessionSettlementAfterStages({ supabase: { from() {} }, stagesRan: 1, logger: { log() {}, error: (...a) => errors.push(a) }, run: async () => { throw new Error("db down"); } });
    assert.equal(failing, null); assert.equal(errors.length, 1);
  });

  test("stage-schedulerens krog starter delkoerslen foer kl. 20, men ikke aftenkoerslen", async () => {
    __resetTrainingDayCloseStateForTests();
    const started = [];
    const res = startTrainingDayCloseAfterStages({ supabase: { from() {} }, stagesRan: 2, clock: () => new Date("2026-11-09T14:00:00Z"),
      runSweep: async () => { throw new Error("no evening run before 20"); }, settleRaceSession: (a) => started.push(a), logger: { log() {}, error() {} } });
    assert.equal(res, null);
    assert.equal(started.length, 1);
    assert.equal(started[0].stagesRan, 2);
    assert.equal(typeof started[0].loadDaySpans, "function");
  });
});
