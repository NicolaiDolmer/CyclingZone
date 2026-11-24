// #8606 (22/11): en rytter, der kommer til holdet efter at datoen er registreret, mister ikke
// datoen. Mod en rigtig Postgres (PGlite = PostgreSQL 17) med prods afregnings-kæde
// (commit_training_date_tick som efter 2026-11-21-7947):
//   1. admit_late_training_date_riders (database/2026-11-24-8606-late-rider-training-date.sql)
//      tager kun en rytter ind, som ingen anden har paa datoen; den rigtige commit afregner ham
//      bagefter alle fem sessioner, og holdets oevrige kvitteringer roeres ikke.
//   2. runNormalizedTrainingDateSweep med de rigtige RPC'er: akademirytteren hentet efter
//      datoens registrering traenes ved aftenkoerslen; en rytter hentet efter aftenkoerslen
//      findes af samme proces; en rytter i et andet holds trup traener dér (#6439).
//   3. Rapport 2: en loebssession afregnet for en del af holdet (#7982) lader datoen staa
//      aaben, og aftenkoerslen afregner resten. Ingen session tabes.
// Aliaser og opdigtede id'er, ingen prod-data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import {
  runNormalizedTrainingDateSweep, registerTrainingDateWork, admitLateTrainingDateRiders, lateRiderIds,
  ridersJoinedOnDate, __resetNormalizedTrainingDateCacheForTests,
} from './trainingDateClose.js';

const file = async name => (await readFile(new URL(`../../database/${name}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const MIGRATION = '2026-11-24-8606-late-rider-training-date.sql';
const SIGNATURE = 'public.admit_late_training_date_riders(uuid,uuid,date,uuid[],timestamptz)';
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const SEASON = id(900);
const TEAM = { A: id(1), B: id(2) };
const OLD = [id(11), id(12)];
const NEWCOMER = id(21), LATER = id(22), BOUGHT = id(23), B_RIDER = id(31);
const DATE = '2026-11-22', NEXT = '2026-11-23', DAYS = [125, 126, 127, 128, 129];
// November: dansk tid = UTC+1. Datoen slutter 22:59:59Z; fristen er 23/11 kl. 02 = 01:00Z.
const REGISTERED = '2026-11-22T10:00:00Z'; // 11:00 dansk tid: dagens foerste etape (#7982)
const SIGNED = '2026-11-22T18:13:00Z'; // 19:13 dansk tid
const EVENING = '2026-11-22T19:00:00Z'; // 20:00 dansk tid
const DEADLINE = '2026-11-23T01:00:00Z';
const j = x => `'${JSON.stringify(x).replace(/'/g, "''")}'::jsonb`;
const arr = ids => `'{${ids.join(',')}}'::uuid[]`;

async function applyTrin1(db) {
  const sql = await file('2026-11-12-7982-commit-training-date-tick-samlet-tjek.sql');
  const commit = sql.indexOf('\nCOMMIT;\n') + '\nCOMMIT;\n'.length;
  const heal = sql.indexOf('END $$;', commit) + 'END $$;'.length;
  const tail = sql.slice(heal).replace(/^\s*--.*$/gm, '').trim();
  const [, wait, index] = tail.match(/^(SET lock_timeout = '\d+s';)\s*(CREATE INDEX CONCURRENTLY IF NOT EXISTS [^;]+;)$/) ?? [];
  await db.exec(sql.slice(0, commit)); await db.exec(sql.slice(commit, heal)); await db.exec(wait); await db.exec(index);
}

// Same chain as trainingEffortLevels.pr24.test.js: prods commit_training_date_tick after 21/11.
async function database({ withMigration = true } = {}) {
  const db = new PGlite();
  await db.exec(await readFile(new URL('./__fixtures__/trainingHeldSchema.sql', import.meta.url), 'utf8'));
  for (const name of ['2026-09-29-5928-training-condition-date.sql', '2026-09-29-5928-training-condition-partial.sql', '2026-09-29-5928-training-condition-recovery.sql', '2026-09-29-5928-training-condition-initialization.sql']) await db.exec(await file(name));
  await db.exec('ALTER TABLE race_results ADD COLUMN rider_id uuid; ALTER TABLE training_day_runs ADD COLUMN id uuid DEFAULT gen_random_uuid(); ALTER TABLE app_config ADD COLUMN description text');
  for (const name of ['2026-09-30-5860-shared-race-day-recovery.sql', '2026-10-10-6439-training-follows-rider.sql', '2026-10-01-traen-nu-locks.sql']) await db.exec(await file(name));
  await db.exec('CREATE TABLE race_entries(race_id uuid,rider_id uuid,team_id uuid,race_role text, PRIMARY KEY(race_id,rider_id))');
  await db.exec(await file('2026-11-09-7737-train-now-instant.sql'));
  await applyTrin1(db);
  for (const name of ['2026-11-13-7982-commit-training-date-tick-opslag-pr-rytter.sql', '2026-11-15-7982-settle-race-session.sql', '2026-11-18-7982-race-session-no-provisional.sql', '2026-11-21-7947-effort-executed-level.sql']) await db.exec(await file(name));
  // Prods riders har begge tidsstempler; fixturen har dem ikke.
  await db.exec('ALTER TABLE riders ADD COLUMN created_at timestamptz, ADD COLUMN acquired_at timestamptz');
  if (withMigration) { await db.exec(await file(MIGRATION)); await db.exec(await file(MIGRATION)); } // idempotent
  return db;
}

async function addRider(db, rider, team, { at = '2026-11-01T10:00:00Z', form = 50, fatigue = 20 } = {}) {
  await db.exec(`INSERT INTO riders(id,team_id,created_at,acquired_at) VALUES('${rider}','${team}','${at}','${at}');
    INSERT INTO rider_derived_abilities VALUES('${rider}',50,'{}');
    INSERT INTO rider_condition(rider_id,form,fatigue,updated_at) VALUES('${rider}',${form},${fatigue},'${at}');`);
}

const register = async (db, team, riders, at = REGISTERED, date = DATE) => (await db.query(
  `SELECT register_training_date_work('${team}','${SEASON}','${date}','{${DAYS}}',${arr(riders)},NULL,'${at}') AS w`)).rows[0].w;
const admit = async (db, team, riders, at = EVENING, date = DATE) => (await db.query(
  `SELECT admit_late_training_date_riders('${team}','${SEASON}','${date}',${arr(riders)},'${at}') AS a`)).rows[0].a;
const workRow = async (db, team = TEAM.A, date = DATE) => (await db.query(
  'SELECT status,expected_rider_ids,opening_conditions FROM training_date_work WHERE team_id=$1 AND tick_date=$2', [team, date])).rows[0];
const ticks = async (db, rider) => (await db.query(
  'SELECT game_day FROM training_rider_ticks WHERE rider_id=$1 AND tick_date=$2 ORDER BY game_day', [rider, DATE])).rows.map(r => r.game_day);

// The real save for one race day: every rider's opening as observed, their condition on the
// date's last race day (settlement), nothing raced. Same shape as the engine's report.
async function commitDay(db, { team = TEAM.A, riders, day, at }) {
  const { opening_conditions: openings } = await workRow(db, team);
  const report = { condition_per_date: true, riders: riders.map(rider => ({
    rider_id: rider, game_day: day, intensity: 'normal', condition_before_date: openings[rider], condition_observed: openings[rider], missing_evidence: [],
  })) };
  const conditions = day === DAYS.at(-1) ? riders.map(rider => ({ ...openings[rider], rider_id: rider })) : [];
  return (await db.query(`SELECT commit_training_date_tick('${team}','${SEASON}','senior',${day},'${DATE}','{${DAYS}}','assistant',${j(report)},'[]',${j(conditions)},'[]','[]','[]','[]',false,'${at}') AS r`)).rows[0].r;
}

async function settleDate(db, riders, at) {
  const results = [];
  for (const day of DAYS) results.push(await commitDay(db, { riders, day, at }));
  return results;
}

// Hold A: to gamle ryttere, datoen registreret kl. 11 og afregnet (som Traen nu kl. 19:32).
async function settledTeamA(options) {
  const db = await database(options);
  for (const rider of OLD) await addRider(db, rider, TEAM.A);
  await register(db, TEAM.A, OLD);
  await settleDate(db, OLD, '2026-11-22T18:32:00Z');
  assert.equal((await workRow(db)).status, 'complete');
  return db;
}

// ── 1. RPC'en mod den rigtige afregning ─────────────────────────────────────

test('#8606 PGlite: akademirytter hentet efter registreringen kommer i truppen og afregnes af den rigtige commit', async () => {
  const db = await settledTeamA();
  await addRider(db, NEWCOMER, TEAM.A, { at: SIGNED });
  // Kontrol (fejlen): den frosne trup kender ham ikke, og commit afviser ham.
  await assert.rejects(commitDay(db, { riders: [NEWCOMER], day: DAYS[0], at: EVENING }), /Rider outside frozen date roster/);
  const result = await admit(db, TEAM.A, [NEWCOMER]);
  assert.deepEqual(result.admitted_rider_ids, [NEWCOMER]);
  assert.equal(result.work.status, 'partial', 'en afregnet dato aabnes igen for ham');
  const work = await workRow(db);
  assert.deepEqual([...work.expected_rider_ids].sort(), [...OLD, NEWCOMER].sort());
  assert.deepEqual([work.opening_conditions[NEWCOMER].form, work.opening_conditions[NEWCOMER].fatigue], [50, 20], 'starttilstanden er hans tilstand nu');
  for (const rider of OLD) assert.equal(work.opening_conditions[rider].form, 50, 'de andres starttilstand er uaendret');
  const saves = await settleDate(db, [...OLD, NEWCOMER], EVENING);
  assert.ok(saves.every(save => save.already_ran === false && JSON.stringify(save.applied_rider_ids) === JSON.stringify([NEWCOMER])), 'kun den nye rytter gemmes');
  assert.deepEqual(await ticks(db, NEWCOMER), DAYS, 'alle fem sessioner');
  for (const rider of OLD) assert.deepEqual(await ticks(db, rider), DAYS, 'ingen dobbelt-traening af de andre');
  assert.equal((await workRow(db)).status, 'complete');
  assert.equal((await db.query(`SELECT count(*)::int n FROM training_condition_settlements WHERE rider_id='${NEWCOMER}' AND tick_date='${DATE}'`)).rows[0].n, 1);
  // Idempotent: et nyt kald tager ingen ind og aendrer intet.
  const again = await admit(db, TEAM.A, [NEWCOMER], '2026-11-22T19:05:00Z');
  assert.deepEqual(again.admitted_rider_ids, []);
  assert.equal(again.work.status, 'complete');
});

test('#8606 PGlite: ingen optagelse naar en anden har rytteren paa datoen, eller noget har flyttet ham', async () => {
  const cases = {
    'i et andet holds trup (#6439 traener ham dér)': async db => {
      await addRider(db, BOUGHT, TEAM.B);
      await register(db, TEAM.B, [BOUGHT]);
      await db.exec(`UPDATE riders SET team_id='${TEAM.A}', acquired_at='${SIGNED}' WHERE id='${BOUGHT}'`);
      return BOUGHT;
    },
    'har en kvittering paa datoen': async db => {
      await addRider(db, BOUGHT, TEAM.A, { at: SIGNED });
      await db.exec(`INSERT INTO training_rider_ticks(rider_id,season_id,game_day,tick_date,team_id,report) VALUES('${BOUGHT}','${SEASON}',125,'${DATE}','${TEAM.B}','{}')`);
      return BOUGHT;
    },
    'har en Traen nu-laas paa datoen': async db => {
      await addRider(db, BOUGHT, TEAM.A, { at: SIGNED });
      await db.exec(`INSERT INTO training_train_now_locks(rider_id,tick_date,season_id,team_id) VALUES('${BOUGHT}','${DATE}','${SEASON}','${TEAM.B}')`);
      return BOUGHT;
    },
    'har en tilstands-afregning paa en senere dato': async db => {
      await addRider(db, BOUGHT, TEAM.A, { at: SIGNED });
      await db.exec(`INSERT INTO training_condition_settlements(rider_id,season_id,tick_date,team_id) VALUES('${BOUGHT}','${SEASON}','${NEXT}','${TEAM.B}')`);
      return BOUGHT;
    },
    'har en uafsluttet tidligere dato': async db => {
      await addRider(db, BOUGHT, TEAM.B);
      await db.query(`SELECT register_training_date_work('${TEAM.B}','${SEASON}','2026-11-21','{120,121,122,123,124}',${arr([BOUGHT])},NULL,'2026-11-21T10:00:00Z')`);
      await db.exec(`UPDATE riders SET team_id='${TEAM.A}', acquired_at='${SIGNED}' WHERE id='${BOUGHT}'`);
      return BOUGHT;
    },
    'er ikke paa holdet': async db => { await addRider(db, BOUGHT, TEAM.B, { at: SIGNED }); return BOUGHT; },
    'er pensioneret': async db => {
      await addRider(db, BOUGHT, TEAM.A, { at: SIGNED });
      await db.exec(`UPDATE riders SET is_retired=true WHERE id='${BOUGHT}'`);
      return BOUGHT;
    },
    'kom til holdet efter datoens slutning': async db => { await addRider(db, BOUGHT, TEAM.A, { at: '2026-11-22T23:30:00Z' }); return BOUGHT; },
  };
  for (const [label, arrange] of Object.entries(cases)) {
    const db = await settledTeamA();
    const rider = await arrange(db);
    const result = await admit(db, TEAM.A, [rider]);
    assert.deepEqual(result.admitted_rider_ids, [], label);
    const work = await workRow(db);
    assert.equal(work.status, 'complete', `${label}: datoen er uaendret`);
    assert.deepEqual([...work.expected_rider_ids].sort(), [...OLD].sort(), label);
    await db.close();
  }
});

test('#8606 PGlite: efter fristen, uden registreret dato eller ved afstemning tages ingen ind', async () => {
  let db = await settledTeamA();
  await addRider(db, NEWCOMER, TEAM.A, { at: SIGNED });
  assert.deepEqual((await admit(db, TEAM.A, [NEWCOMER], DEADLINE)).admitted_rider_ids, [], 'fristen er passeret');
  assert.deepEqual(await admit(db, TEAM.A, [NEWCOMER], EVENING, NEXT), { admitted_rider_ids: [], work: null }, 'ingen dato registreret');
  await db.exec(`UPDATE training_date_work SET status='needs_reconciliation'`);
  assert.deepEqual((await admit(db, TEAM.A, [NEWCOMER])).admitted_rider_ids, [], 'sendt til afstemning');
  await db.close();
  db = await database();
  await assert.rejects(db.query(`SELECT admit_late_training_date_riders('${TEAM.A}','${SEASON}','${DATE}',ARRAY[NULL]::uuid[],'${EVENING}')`), /Verified late rider list required/);
  await db.close();
});

test('#8606 PGlite: kun service_role maa kalde funktionen, og migrationen sletter intet', async () => {
  const db = await database();
  const { rows } = await db.query(`SELECT has_function_privilege('anon','${SIGNATURE}','EXECUTE') anon,
    has_function_privilege('authenticated','${SIGNATURE}','EXECUTE') auth, has_function_privilege('service_role','${SIGNATURE}','EXECUTE') service`);
  assert.deepEqual(rows[0], { anon: false, auth: false, service: true });
  const sql = await file(MIGRATION);
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /POLICY|SECURITY DEFINER|DROP |DELETE |TRUNCATE|ALTER TABLE/i);
  await db.close();
});

// ── 2. Aftenkoerslen med de rigtige RPC'er ──────────────────────────────────

// PostgREST-lignende klient: teams/riders fra state, RPC'erne fra PGlite.
function client(db) {
  return {
    async rpc(name, args) {
      try {
        if (name === 'admit_late_training_date_riders') {
          const { rows } = await db.query('SELECT public.admit_late_training_date_riders($1::uuid,$2::uuid,$3::date,$4::uuid[],$5::timestamptz) AS r',
            [args.p_team_id, args.p_season_id, args.p_tick_date, `{${args.p_rider_ids.join(',')}}`, args.p_now]);
          return { data: rows[0].r, error: null };
        }
        const { rows } = await db.query(`SELECT public.${name}($1::uuid,$2::uuid,$3::date,$4::int[],$5::uuid[],$6::timestamptz,$7::timestamptz) AS w`,
          [args.p_team_id, args.p_season_id, args.p_tick_date, `{${args.p_game_days.join(',')}}`, `{${args.p_expected_rider_ids.join(',')}}`, args.p_deadline_at, args.p_registered_at]);
        return { data: rows[0].w, error: null };
      } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    },
  };
}

async function sweepScenario({ withMigration = true } = {}) {
  __resetNormalizedTrainingDateCacheForTests();
  const db = await database({ withMigration });
  const teams = [TEAM.A, TEAM.B].map(team => ({ id: team, league_division_id: 'd1', is_ai: false, parked_at: null, is_bank: false, is_frozen: false,
    is_test_account: false, assistant_autopick_enabled: false, created_at: '2026-11-01T10:00:00Z', comeback_at: null }));
  const riders = [];
  const sign = async (rider, team, at, opts) => { await addRider(db, rider, team, { at, ...opts }); riders.push({ id: rider, team_id: team, squad: 'senior', is_academy: false, is_retired: false, pending_team_id: null, created_at: at, acquired_at: at }); };
  for (const rider of OLD) await sign(rider, TEAM.A, '2026-11-01T10:00:00Z');
  await sign(B_RIDER, TEAM.B, '2026-11-01T10:00:00Z');
  const ran = [], admissions = [];
  const supabase = client(db);
  // The real save per race day, for the riders the sweep hands over (the engine's job).
  const runDay = async ({ teamId, gameDay, eligibleRiderIds, now }) => {
    ran.push({ teamId, gameDay, riderIds: [...eligibleRiderIds].sort() });
    const result = await commitDay(db, { team: teamId, riders: eligibleRiderIds, day: gameDay, at: now.toISOString() });
    return { alreadyRan: result.already_ran === true };
  };
  const options = {
    supabase, elapsedClock: () => 0, logger: { error() {}, warn() {} },
    loadIndex: async ({ now }) => ({ jobs: [{ season: { id: SEASON, number: 5 }, tickDate: DATE }], today: DATE, activeSeasonId: SEASON, now }),
    loadContext: async () => ({ tickDate: DATE, teams: teams.map(team => ({ ...team })), riders: riders.map(rider => ({ ...rider })),
      races: [], stages: [], runs: [], entries: [], results: [], incidents: [], loads: [], frozenEntries: [], candidateRiderIdsByRace: new Map(),
      gameDaysByDivision: new Map([['d1', DAYS]]) }),
    loadTeams: async () => teams.map(team => ({ ...team })),
    loadJoinedRiders: async ({ tickDate }) => ridersJoinedOnDate(riders, tickDate),
    loadWorkRows: async ({ tickDate }) => (await db.query(
      'SELECT team_id,game_days,expected_rider_ids,status,opening_conditions,quarantined_rider_ids FROM training_date_work WHERE season_id=$1 AND tick_date=$2 ORDER BY team_id',
      [SEASON, tickDate])).rows,
    registerWork: registerTrainingDateWork,
    admitRiders: async args => { admissions.push({ teamId: args.teamId, riderIds: [...args.riderIds] }); return admitLateTrainingDateRiders(args); },
    quarantineRiders: async () => { throw new Error('no rider in these scenarios is unavailable'); },
    departRiders: async () => [],
    runDay, refreshRankings: async () => {}, dispatchAlarms: async () => ({ dates: 0, failed: 0 }),
  };
  const sweep = at => runNormalizedTrainingDateSweep({ ...options, now: new Date(at) });
  const daysFor = (team, rider) => ran.filter(r => r.teamId === team && (!rider || r.riderIds.includes(rider))).map(r => r.gameDay);
  return { db, supabase, riders, sign, ran, admissions, sweep, daysFor };
}

test('#8606 sweep: akademirytter hentet kl. 19:13 efter Traen nu traenes ved aftenkoerslen kl. 20', async () => {
  const s = await sweepScenario();
  // 11:00: datoen registreres med de to gamle ryttere; 19:32: Traen nu afregner dem.
  await registerTrainingDateWork({ supabase: s.supabase, teamId: TEAM.A, seasonId: SEASON, tickDate: DATE, gameDays: DAYS, riderIds: OLD, now: new Date(REGISTERED) });
  await registerTrainingDateWork({ supabase: s.supabase, teamId: TEAM.B, seasonId: SEASON, tickDate: DATE, gameDays: DAYS, riderIds: [B_RIDER], now: new Date(REGISTERED) });
  await s.sign(NEWCOMER, TEAM.A, SIGNED);
  await settleDate(s.db, OLD, '2026-11-22T18:32:00Z');
  const summary = await s.sweep(EVENING);
  assert.equal(summary.failed, 0);
  assert.equal(summary.admitted, 1);
  assert.deepEqual(s.admissions, [{ teamId: TEAM.A, riderIds: [NEWCOMER] }]);
  assert.deepEqual(s.daysFor(TEAM.A, NEWCOMER), DAYS, 'han faar alle fem sessioner samme aften');
  assert.deepEqual(await ticks(s.db, NEWCOMER), DAYS);
  for (const rider of OLD) assert.deepEqual(await ticks(s.db, rider), DAYS, 'de andre traenes ikke to gange');
  assert.equal((await workRow(s.db)).status, 'complete');
  // Naeste tick: intet nyt, intet koeres igen.
  const before = s.ran.length;
  await s.sweep('2026-11-22T19:05:00Z');
  assert.equal(s.ran.length, before);
  assert.equal(s.admissions.length, 1);
});

test('#8606 sweep: en rytter hentet efter aftenkoerslen findes af samme proces (ingen genstart)', async () => {
  const s = await sweepScenario();
  const first = await s.sweep(EVENING);
  assert.equal(first.failed, 0);
  assert.deepEqual(s.daysFor(TEAM.A), DAYS);
  assert.equal(s.admissions.length, 0, 'ingen sene ryttere ved foerste gennemloeb');
  await s.sign(LATER, TEAM.A, '2026-11-22T20:30:00Z'); // 21:30 dansk tid
  const summary = await s.sweep('2026-11-22T20:35:00Z');
  assert.equal(summary.failed, 0);
  assert.equal(summary.admitted, 1);
  assert.deepEqual(await ticks(s.db, LATER), DAYS);
  assert.equal((await workRow(s.db)).status, 'complete');
  // Efter datoens slutning lukkes tjekket; en rytter hentet efter midnat hoerer til naeste dato.
  await s.sign(id(24), TEAM.A, '2026-11-22T23:10:00Z');
  const before = s.ran.length;
  await s.sweep('2026-11-22T23:15:00Z');
  assert.equal(s.ran.length, before);
  assert.deepEqual(await ticks(s.db, id(24)), []);
});

test('#8606 sweep: en rytter i et andet holds trup traener dér, og det nye hold aabnes ikke for ham (#6439)', async () => {
  const s = await sweepScenario();
  await s.sweep(EVENING);
  // 21:30: holdet koeber B's rytter, som allerede staar i B's trup paa datoen.
  s.riders.find(rider => rider.id === B_RIDER).team_id = TEAM.A;
  s.riders.find(rider => rider.id === B_RIDER).acquired_at = '2026-11-22T20:30:00Z';
  await s.db.exec(`UPDATE riders SET team_id='${TEAM.A}', acquired_at='2026-11-22T20:30:00Z' WHERE id='${B_RIDER}'`);
  const before = s.ran.length;
  const summary = await s.sweep('2026-11-22T20:35:00Z');
  assert.equal(summary.failed, 0);
  assert.equal(summary.admitted, undefined);
  assert.equal(s.admissions.length, 0, 'han er ingen kandidat: B har ham');
  assert.equal(s.ran.length, before);
  assert.deepEqual(await ticks(s.db, B_RIDER), DAYS, 'B afregnede ham ved aftenkoerslen');
});

test('#8606 sweep: deploy-vinduet foer migrationen er praecis som foer (ingen tages ind, ingen fejl)', async () => {
  const s = await sweepScenario({ withMigration: false });
  await registerTrainingDateWork({ supabase: s.supabase, teamId: TEAM.A, seasonId: SEASON, tickDate: DATE, gameDays: DAYS, riderIds: OLD, now: new Date(REGISTERED) });
  await s.sign(NEWCOMER, TEAM.A, SIGNED);
  await settleDate(s.db, OLD, '2026-11-22T18:32:00Z');
  const summary = await s.sweep(EVENING);
  assert.equal(summary.failed, 0);
  assert.equal(summary.admitted, undefined);
  assert.deepEqual(await ticks(s.db, NEWCOMER), []);
});

// ── 3. Rapport 2: loebssessionen kl. 19:01 lader resten af datoen staa aaben ──

test('#8606 sweep: en delvist afregnet dato (loebssession for nogle ryttere) afregnes helt af aftenkoerslen', async () => {
  const s = await sweepScenario();
  await registerTrainingDateWork({ supabase: s.supabase, teamId: TEAM.A, seasonId: SEASON, tickDate: DATE, gameDays: DAYS, riderIds: OLD, now: new Date(REGISTERED) });
  // Som efter 19:01: datoen er registreret og kun delvist afregnet (loebssessionen giver
  // kvitteringer for nogle ryttere paa nogle loebsdage); resten venter paa aftenkoerslen.
  await commitDay(s.db, { riders: [OLD[0]], day: DAYS[0], at: '2026-11-22T15:01:00Z' });
  assert.equal((await workRow(s.db)).status, 'partial');
  const summary = await s.sweep(EVENING);
  assert.equal(summary.failed, 0);
  for (const rider of OLD) assert.deepEqual(await ticks(s.db, rider), DAYS, 'ingen session tabes');
  assert.equal((await workRow(s.db)).status, 'complete');
});

// ── PUR ─────────────────────────────────────────────────────────────────────

test('#8606 lateRiderIds og ridersJoinedOnDate', () => {
  assert.deepEqual(lateRiderIds({ expected_rider_ids: ['b', 'a'] }, ['c', 'a', 'c', 'b', 'd']), ['c', 'd']);
  assert.deepEqual(lateRiderIds(null, ['b', 'a']), ['a', 'b']);
  const joined = ridersJoinedOnDate([
    { id: 'old', team_id: 't', created_at: '2026-11-01T10:00:00Z', acquired_at: null },
    { id: 'signed', team_id: 't', created_at: '2026-11-22T18:13:00Z', acquired_at: '2026-11-22T18:13:05Z' },
    { id: 'bought', team_id: 't', created_at: '2026-11-01T10:00:00Z', acquired_at: '2026-11-22T20:00:00Z' },
    { id: 'afterMidnight', team_id: 't', created_at: '2026-11-01T10:00:00Z', acquired_at: '2026-11-22T23:30:00Z' },
    { id: 'released', team_id: null, created_at: '2026-11-22T18:00:00Z', acquired_at: null },
    { id: 'retired', team_id: 't', is_retired: true, created_at: '2026-11-22T18:00:00Z', acquired_at: null },
  ], DATE);
  assert.deepEqual(joined.map(rider => rider.id), ['signed', 'bought']);
});
