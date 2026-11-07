// #7832 (ejer 7/11): et hold maa aldrig miste en traeningsdato, heller ikke et helt nyt
// hold oprettet efter aftenkoerslen. To lag mod en rigtig Postgres (PGlite):
//   1. register_late_training_date_work (database/2026-11-07-7832-late-team-training-date.sql)
//      gemmer starttilstanden for en almindelig dato registreret efter fristen, kun naar
//      intet har flyttet rytternes tilstand siden; rettidige registreringer er uaendrede.
//   2. runNormalizedTrainingDateSweep med de rigtige RPC'er: hold oprettet foer
//      aftenkoerslen, efter den (samme aften) og efter fristen faar alle datoen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { runNormalizedTrainingDateSweep, loadTrainingDateIndex, registerTrainingDateWork, __resetNormalizedTrainingDateCacheForTests } from './trainingDateClose.js';
import { loadTrainingDateContext, loadTrainingDateTeams } from './trainingDateReadiness.js';

const file = name => readFile(new URL(`../../database/${name}`, import.meta.url), 'utf8');
const LATE_MIGRATION = '2026-11-07-7832-late-team-training-date.sql';
const SEASON = '00000000-0000-0000-0000-0000000000f5';
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
// Hold A er gammelt; B, C og D oprettes 5/11 efter aftenkoerslen (aliaser, ingen prod-data).
const TEAM = { A: id(1), B: id(2), C: id(3), D: id(4) };
const RIDERS = { A: [id(11), id(12)], B: [id(21), id(22)], C: [id(31), id(32)], D: [id(41), id(42)] };
const DAYS = [10, 11, 12, 13, 14];
const DATE = '2026-11-05';
// November: dansk tid = UTC+1. Datoen 5/11 slutter 22:59:59Z; fristen er 6/11 kl. 02 = 01:00Z.
const EVENING_RUN = new Date('2026-11-05T19:00:00Z'); // 20:00 dansk tid
const DEADLINE = '2026-11-06T01:00:00.000Z';

async function database({ withLateMigration = true } = {}) {
  const db = new PGlite();
  await db.exec(await readFile(new URL('./__fixtures__/trainingHeldSchema.sql', import.meta.url), 'utf8'));
  for (const name of ['2026-09-29-5928-training-condition-date.sql', '2026-09-29-5928-training-condition-partial.sql',
    '2026-09-29-5928-training-condition-recovery.sql', '2026-09-29-5928-training-condition-initialization.sql']) await db.exec(await file(name));
  await db.exec('ALTER TABLE race_results ADD COLUMN rider_id uuid; ALTER TABLE training_day_runs ADD COLUMN id uuid DEFAULT gen_random_uuid()');
  for (const name of ['2026-09-30-5860-shared-race-day-recovery.sql', '2026-10-10-6439-training-follows-rider.sql',
    '2026-10-12-6490-rider-training-seen.sql', '2026-10-27-7282-bridge-date-registration.sql']) await db.exec(await file(name));
  if (withLateMigration) await applyLateMigration(db);
  return db;
}

async function applyLateMigration(db) {
  const migration = await file(LATE_MIGRATION);
  await db.exec(migration); await db.exec(migration); // idempotent
}

// Et hold faar sine ryttere med starttilstand ved oprettelsen (prods trigger gør det samme).
async function createTeam(db, state, key, createdAt) {
  state.teams.push({ id: TEAM[key], league_division_id: 'd1', is_ai: false, parked_at: null, is_bank: false, is_frozen: false,
    is_test_account: false, assistant_autopick_enabled: false, created_at: createdAt, comeback_at: null });
  for (const rider of RIDERS[key]) {
    state.riders.push({ id: rider, team_id: TEAM[key], squad: 'senior', is_academy: false, is_retired: false, pending_team_id: null, created_at: createdAt, acquired_at: null });
    await db.exec(`INSERT INTO riders VALUES('${rider}','${TEAM[key]}'); INSERT INTO rider_condition(rider_id,form,fatigue) VALUES('${rider}',50,0);`);
  }
}

const pgError = error => ({ code: error.code, message: error.message });

// PostgREST-lignende klient: seasons/app_config/teams/riders fra state, training_date_work
// og alle RPC'er fra PGlite.
function client(db, state) {
  return {
    async rpc(name, args) {
      try {
        const { rows } = await db.query(`SELECT public.${name}($1::uuid,$2::uuid,$3::date,$4::int[],$5::uuid[],$6::timestamptz,$7::timestamptz) AS w`,
          [args.p_team_id, args.p_season_id, args.p_tick_date, `{${args.p_game_days.join(',')}}`, `{${args.p_expected_rider_ids.join(',')}}`, args.p_deadline_at, args.p_registered_at]);
        return { data: rows[0].w, error: null };
      } catch (error) { return { data: null, error: pgError(error) }; }
    },
    from(table) {
      const filters = [];
      const rows = async () => {
        if (table === 'training_date_work') {
          return (await db.query("SELECT team_id,season_id,tick_date::text,status FROM training_date_work WHERE status IN ('pending','partial')")).rows;
        }
        const base = state[table] ?? [];
        return ['seasons', 'app_config'].includes(table)
          ? base.filter(row => filters.every(([col, value]) => String(row[col]) === String(value)))
          : base;
      };
      const result = async () => ({ data: await rows(), error: null });
      return {
        select() { return this; },
        eq(col, value) { filters.push([col, value]); return this; },
        in() { return this; }, not() { return this; }, is() { return this; },
        gte() { return this; }, lt() { return this; }, order() { return this; },
        limit() { return this; }, contains() { return this; },
        range() { return result(); },
        async maybeSingle() { return { data: (await rows())[0] ?? null, error: null }; },
        single() { return this.maybeSingle(); },
        then(ok, fail) { return result().then(ok, fail); },
      };
    },
  };
}

function scenario(db) {
  const state = {
    seasons: [{ id: SEASON, number: 5, start_date: '2026-11-01', end_date: '2026-12-31', status: 'active' }],
    app_config: [{ key: 'training_condition_activation_date', value: DATE }],
    teams: [], riders: [], races: [], race_stage_schedule: [], training_race_loads: [],
  };
  const ran = [], registrations = [], quarantined = [];
  let teamReads = 0;
  const supabase = client(db, state);
  const options = {
    supabase, elapsedClock: () => 0, logger: { error() {}, warn() {} },
    loadIndex: loadTrainingDateIndex,
    loadContext: loadTrainingDateContext,
    loadTeams: async s => { teamReads++; return loadTrainingDateTeams(s); },
    loadDaySpans: async () => new Map([['d1', { gameDays: DAYS }]]),
    loadWorkRows: async ({ tickDate }) => (await db.query(
      'SELECT team_id,game_days,expected_rider_ids,status,opening_conditions,quarantined_rider_ids FROM training_date_work WHERE season_id=$1 AND tick_date=$2 ORDER BY team_id',
      [SEASON, tickDate])).rows,
    registerWork: async args => {
      registrations.push({ teamId: args.teamId, tickDate: args.tickDate, lateDate: Boolean(args.lateDate), lateBridge: Boolean(args.lateBridge) });
      return registerTrainingDateWork(args);
    },
    quarantineRiders: async ({ teamId, tickDate, riderIds, reason }) => { quarantined.push({ teamId, tickDate, riderIds, reason }); },
    runDay: async ({ teamId, tickDateOverride, gameDay, eligibleRiderIds }) => {
      ran.push({ teamId, tickDate: tickDateOverride, gameDay, eligibleRiderIds: [...eligibleRiderIds].sort() });
      if (gameDay === DAYS.at(-1)) await db.query("UPDATE training_date_work SET status='complete' WHERE team_id=$1 AND tick_date=$2", [teamId, tickDateOverride]);
      return { alreadyRan: false };
    },
    refreshRankings: async () => {},
    dispatchAlarms: async () => ({ dates: 0, failed: 0 }),
  };
  const sweep = at => runNormalizedTrainingDateSweep({ ...options, now: new Date(at) });
  const daysFor = (key, tickDate = DATE) => ran.filter(r => r.teamId === TEAM[key] && r.tickDate === tickDate).map(r => r.gameDay);
  const work = async (key, tickDate = DATE) => (await db.query(
    'SELECT status,opening_conditions,created_at FROM training_date_work WHERE team_id=$1 AND tick_date=$2', [TEAM[key], tickDate])).rows[0];
  return { state, ran, registrations, quarantined, options, sweep, daysFor, work, teamReads: () => teamReads };
}

// ── 1. RPC'en ────────────────────────────────────────────────────────────────

const call = (fn, { team = TEAM.A, riders = RIDERS.A, date = DATE, at }) =>
  `SELECT ${fn}('${team}','${SEASON}','${date}',ARRAY[${DAYS}],ARRAY['${riders.join("','")}']::uuid[],NULL,'${at}') AS w`;

async function seededDatabase(options) {
  const db = await database(options);
  for (const rider of RIDERS.A) await db.exec(`INSERT INTO riders VALUES('${rider}','${TEAM.A}'); INSERT INTO rider_condition(rider_id,form,fatigue) VALUES('${rider}',61,37);`);
  return db;
}

test('#7832 PGlite: en almindelig dato registreret efter fristen faar starttilstanden', async () => {
  const db = await seededDatabase();
  // Kontrol: den almindelige registrering efter fristen gemmer intet snapshot (fejlen).
  const plain = (await db.query(call('register_training_date_work', { at: '2026-11-06T07:25:00Z' }))).rows[0].w;
  assert.deepEqual(plain.opening_conditions, {});
  await db.exec('DELETE FROM training_date_work');
  const work = (await db.query(call('register_late_training_date_work', { at: '2026-11-06T07:25:00Z' }))).rows[0].w;
  assert.equal(work.status, 'pending');
  assert.equal(work.deadline_at.slice(0, 19), DEADLINE.slice(0, 19));
  for (const rider of RIDERS.A) assert.deepEqual([work.opening_conditions[rider].form, work.opening_conditions[rider].fatigue], [61, 37]);
  // Gentaget kald: datoen er frosset, intet aendres.
  await db.exec(`UPDATE rider_condition SET fatigue=5 WHERE rider_id='${RIDERS.A[0]}'`);
  const again = (await db.query(call('register_late_training_date_work', { at: '2026-11-06T07:30:00Z' }))).rows[0].w;
  assert.equal(again.opening_conditions[RIDERS.A[0]].fatigue, 37);
});

test('#7832 PGlite: en rettidig registrering er praecis som foer', async () => {
  const late = await seededDatabase(), plain = await seededDatabase();
  const at = '2026-11-05T22:40:00Z'; // 23:40 dansk tid, foer fristen
  const a = (await late.query(call('register_late_training_date_work', { at }))).rows[0].w;
  const b = (await plain.query(call('register_training_date_work', { at }))).rows[0].w;
  assert.deepEqual(a, b);
  assert.equal(a.opening_conditions[RIDERS.A[0]].form, 61);
});

test('#7832 PGlite: intet snapshot naar noget har flyttet tilstanden siden datoen', async () => {
  const at = '2026-11-06T19:30:00Z';
  // Holdet har arbejde paa en senere dato.
  let db = await seededDatabase();
  await db.query(call('register_training_date_work', { date: '2026-11-06', at: '2026-11-06T19:00:00Z' }));
  assert.deepEqual((await db.query(call('register_late_training_date_work', { at }))).rows[0].w.opening_conditions, {});
  // En rytter har et tick paa en senere dato (fx under et andet hold).
  db = await seededDatabase();
  await db.exec(`INSERT INTO training_rider_ticks(rider_id,season_id,game_day,tick_date,team_id,report) VALUES('${RIDERS.A[0]}','${SEASON}',15,'2026-11-06','${TEAM.B}','{}')`);
  assert.deepEqual((await db.query(call('register_late_training_date_work', { at }))).rows[0].w.opening_conditions, {});
  // En rytter har en tilstands-afregning paa en senere dato.
  db = await seededDatabase();
  await db.exec(`INSERT INTO training_condition_settlements(rider_id,season_id,tick_date,team_id) VALUES('${RIDERS.A[1]}','${SEASON}','2026-11-06','${TEAM.B}')`);
  assert.deepEqual((await db.query(call('register_late_training_date_work', { at }))).rows[0].w.opening_conditions, {});
});

test('#7832 PGlite: kun service_role maa kalde den nye funktion', async () => {
  const db = await database();
  const { rows } = await db.query(`SELECT has_function_privilege('anon','public.register_late_training_date_work(uuid,uuid,date,integer[],uuid[],timestamptz,timestamptz)','EXECUTE') anon,
    has_function_privilege('authenticated','public.register_late_training_date_work(uuid,uuid,date,integer[],uuid[],timestamptz,timestamptz)','EXECUTE') auth,
    has_function_privilege('service_role','public.register_late_training_date_work(uuid,uuid,date,integer[],uuid[],timestamptz,timestamptz)','EXECUTE') service`);
  assert.deepEqual(rows[0], { anon: false, auth: false, service: true });
});

// ── 2. Sweepen ───────────────────────────────────────────────────────────────

test('#7832 sweep: hold oprettet foer aftenkoerslen traener datoen ved aftenkoerslen', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const db = await database();
  const s = scenario(db);
  await createTeam(db, s.state, 'A', '2026-11-01T10:00:00Z');
  const summary = await s.sweep(EVENING_RUN);
  assert.equal(summary.failed, 0);
  assert.deepEqual(s.daysFor('A'), DAYS);
  assert.ok(s.ran.every(r => r.eligibleRiderIds.join() === [...RIDERS.A].sort().join()));
  assert.deepEqual(s.registrations, [{ teamId: TEAM.A, tickDate: DATE, lateDate: false, lateBridge: false }]);
  assert.equal((await s.work('A')).status, 'complete');
  assert.deepEqual(s.quarantined, []);
});

test('#7832 sweep: hold oprettet efter aftenkoerslen samme aften findes af samme proces (ingen genstart)', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const db = await database();
  const s = scenario(db);
  await createTeam(db, s.state, 'A', '2026-11-01T10:00:00Z');
  await s.sweep(EVENING_RUN);
  assert.equal(s.teamReads(), 0, 'foerste gennemloeb laeser ikke holdene ekstra');
  // 23:39 dansk tid: et nyt hold. Foer #7832 sprang cachen datoen over til naeste genstart.
  await createTeam(db, s.state, 'B', '2026-11-05T22:39:00Z');
  const summary = await s.sweep('2026-11-05T22:40:00Z');
  assert.equal(summary.failed, 0);
  assert.deepEqual(s.daysFor('B'), DAYS, 'det nye hold traener sin foerste dato');
  assert.deepEqual(s.daysFor('A'), DAYS, 'det gamle hold traener ikke to gange');
  assert.ok(s.ran.filter(r => r.teamId === TEAM.B).every(r => r.eligibleRiderIds.join() === [...RIDERS.B].sort().join()));
  // Rettidig registrering (foer fristen) med starttilstand, ikke den sene RPC.
  assert.deepEqual(s.registrations.at(-1), { teamId: TEAM.B, tickDate: DATE, lateDate: false, lateBridge: false });
  assert.equal(Object.keys((await s.work('B')).opening_conditions).length, RIDERS.B.length);
  assert.deepEqual(s.quarantined, []);
  // Ingen nye hold: datoen springes over. Efter datoens slut lukkes tjekket, og
  // sweepen laeser ikke holdene igen for den dato.
  const before = s.ran.length;
  await s.sweep('2026-11-05T22:45:00Z');
  await s.sweep('2026-11-05T23:05:00Z');
  const reads = s.teamReads();
  await s.sweep('2026-11-05T23:10:00Z');
  await s.sweep('2026-11-06T07:25:00Z');
  assert.equal(s.ran.length, before);
  assert.equal(s.teamReads(), reads);
});

test('#7832 sweep: hold oprettet efter aftenkoerslen, naaet foerst efter fristen, mister ikke datoen', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const db = await database();
  const s = scenario(db);
  await createTeam(db, s.state, 'A', '2026-11-01T10:00:00Z');
  await s.sweep(EVENING_RUN);
  // 23:58 dansk tid. Processen genstarter og naar foerst holdet 6/11 kl. 08:25 (prod 6/11).
  await createTeam(db, s.state, 'C', '2026-11-05T22:58:00Z');
  __resetNormalizedTrainingDateCacheForTests();
  const summary = await s.sweep('2026-11-06T07:25:00Z');
  assert.equal(summary.failed, 0);
  assert.deepEqual(s.registrations.at(-1), { teamId: TEAM.C, tickDate: DATE, lateDate: true, lateBridge: false });
  const work = await s.work('C');
  assert.ok(new Date(work.created_at) > new Date(DEADLINE), 'registreret efter fristen');
  assert.equal(Object.keys(work.opening_conditions).length, RIDERS.C.length);
  assert.deepEqual(s.daysFor('C'), DAYS);
  assert.ok(s.ran.filter(r => r.teamId === TEAM.C).every(r => r.eligibleRiderIds.join() === [...RIDERS.C].sort().join()));
  assert.equal(work.status, 'complete');
  assert.deepEqual(s.quarantined, [], 'ingen karantaene og dermed ingen alarm');
});

test('#7832 sweep: deploy-vinduet foer migrationen fryser ikke datoen tom; den indhentes bagefter', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const db = await database({ withLateMigration: false });
  const s = scenario(db);
  await createTeam(db, s.state, 'C', '2026-11-05T22:58:00Z');
  const summary = await s.sweep('2026-11-06T07:25:00Z');
  assert.equal(summary.failed, 0);
  assert.equal(await s.work('C'), undefined, 'ingen tom, frosset dato');
  assert.deepEqual(s.daysFor('C'), []);
  assert.deepEqual(s.quarantined, []);
  await applyLateMigration(db);
  await s.sweep('2026-11-06T07:30:00Z');
  assert.deepEqual(s.daysFor('C'), DAYS);
  assert.deepEqual(s.quarantined, []);
});

test('#7832 sweep: kan starttilstanden ikke bevises, gaar alarmen stadig (karantaene, ikke daempet)', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const db = await database();
  const s = scenario(db);
  await createTeam(db, s.state, 'D', '2026-11-05T22:58:00Z');
  // 6/11 registreres foer 5/11 er naaet (fx Traen nu), saa 5/11's starttilstand kan ikke bevises.
  await registerTrainingDateWork({ supabase: s.options.supabase, teamId: TEAM.D, seasonId: SEASON, tickDate: '2026-11-06',
    gameDays: [15, 16, 17, 18, 19], riderIds: RIDERS.D, now: new Date('2026-11-06T10:00:00Z') });
  await s.sweep('2026-11-06T19:00:00Z');
  assert.deepEqual(s.registrations[0], { teamId: TEAM.D, tickDate: DATE, lateDate: true, lateBridge: false });
  assert.deepEqual((await s.work('D')).opening_conditions, {});
  const q = s.quarantined.filter(row => row.tickDate === DATE);
  assert.equal(q.length, 1);
  assert.deepEqual([...q[0].riderIds].sort(), [...RIDERS.D].sort());
  assert.equal(q[0].reason, 'roster_or_opening_evidence_unavailable');
  assert.deepEqual(s.daysFor('D'), []);
});
