// #8089 · DOMMERENS PRØVER (AGENTS regel 40) · databasen: en ny rytters starttilstand.
//
// Skrevet FØR første kodelinje ud fra ejerens ord (regler.md). Byggeren må flytte
// filen til backend/lib/ og rette stien til repo-roden, men ALDRIG ændre et
// forventet udfald. Prøverne er røde i dag og skal bestå på en korrekt bygning.
//
// Sådan læser prøven databasen:
//   1. Dagens tilstand: de tre funktioner, der i dag skriver en frisk rytters
//      tilstand, hentes ordret fra database/2026-10-12-6490-rider-training-seen.sql
//      (= prod 13/11, bekræftet med pg_get_functiondef), plus triggeren på riders.
//   2. Byggerens migration: alle database/*.sql med "8089" i filnavnet, i
//      navneorden, kørt TO gange (idempotens). Findes ingen, er prøven rød.
//
// Kørsel i repoet (når filen ligger i backend/lib/testdb/):  node --test lib/testdb/nyRytterStarttilstand8089.integration.test.js
// Kørsel fra dommer-mappen: se til-byggeren.md (CZ_REPO_ROOT peger på et checkout).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

// ── Ejerens tal (regler.md R1/R2) ────────────────────────────────────────────
const START_FORM = 50;      // "form som i dag"
const START_FATIGUE = 20;   // "fast lav træthed"; dommerens tal, ejeren ser det før merge
const TODAY_FATIGUE = 0;    // sådan er det i dag (det, der rettes)

const ROOT = process.env.CZ_REPO_ROOT
  ? pathToFileURL(resolve(process.env.CZ_REPO_ROOT) + '/')
  : new URL('../../../', import.meta.url);
const dbFile = (name) => new URL(`database/${name}`, ROOT);
const BASELINE_FILE = '2026-10-12-6490-rider-training-seen.sql';
const BASELINE_FUNCTIONS = [
  'public.initialize_first_use_rider_condition()',
  'public.register_training_date_work(',
  'public.apply_training_compensation_6061(',
];

const uid = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const TEAM_A = uid(0xa1), TEAM_B = uid(0xb1), SEASON = uid(0x5e);
const T0 = '2026-11-14T08:00:00Z';

// Ryttere der fandtes FØR rettelsen (R4: ingen bagudrettelse).
const HIT_A = uid(0x101);   // allerede ramt: frisk rytter fra i dag, står på 50/0
const HIT_B = uid(0x102);   // allerede ramt, er kommet lidt i gang
const VETERAN = uid(0x103); // gammel rytter med skade og egen tilstand
const NO_ROW = uid(0x104);  // har hold, men ingen tilstand (må ikke få en ved udrulning)

let db;
let migrationFiles = [];
let witnessBefore;

/** Henter én CREATE OR REPLACE FUNCTION-blok ordret fra baseline-filen. */
function extractFunction(sql, marker) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${marker}`);
  assert.notEqual(start, -1, `baseline mangler ${marker}`);
  const end = sql.indexOf('$function$;', start);
  assert.notEqual(end, -1, `baseline: ${marker} har ingen afslutning`);
  return sql.slice(start, end + '$function$;'.length);
}

async function findMigrations() {
  if (process.env.CZ_8089_MIGRATION) return [pathToFileURL(resolve(process.env.CZ_8089_MIGRATION))];
  const names = (await readdir(new URL('database/', ROOT))).filter((n) => /8089/.test(n) && n.endsWith('.sql')).sort();
  return names.map(dbFile);
}

const witness = async () => (await db.query(
  'SELECT rider_id,form,fatigue,injured_until,injury_cause,updated_at FROM rider_condition WHERE rider_id = ANY($1) ORDER BY rider_id',
  [[HIT_A, HIT_B, VETERAN, NO_ROW]])).rows;

const condition = async (riderId) => (await db.query('SELECT form,fatigue,updated_at FROM rider_condition WHERE rider_id=$1', [riderId])).rows[0] ?? null;
const insertRider = (id, teamId, extra = {}) => db.query(
  'INSERT INTO riders(id,team_id,created_at,acquired_at,is_academy,squad) VALUES($1,$2,$3,$4,$5,$6)',
  [id, teamId, T0, teamId ? T0 : null, extra.is_academy ?? false, extra.squad ?? 'senior']);

before(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE app_config(key text PRIMARY KEY,value jsonb,updated_at timestamptz DEFAULT now());
    CREATE TABLE riders(id uuid PRIMARY KEY,team_id uuid,is_retired boolean DEFAULT false,acquired_at timestamptz,created_at timestamptz DEFAULT now(),is_academy boolean DEFAULT false,squad text DEFAULT 'senior',pending_team_id uuid);
    -- Kolonne-defaults som i prod 13/11 (information_schema): form 50, fatigue 0.
    CREATE TABLE rider_condition(rider_id uuid PRIMARY KEY REFERENCES riders(id),form smallint NOT NULL DEFAULT 50,fatigue smallint NOT NULL DEFAULT 0,injured_until date,injury_cause text,updated_at timestamptz NOT NULL DEFAULT now(),injury_end_game_day integer,injury_season_id uuid,injury_race_days_left integer);
    CREATE TABLE training_race_loads(rider_id uuid,consumed_at timestamptz);
    CREATE TABLE training_rider_ticks(rider_id uuid);
    CREATE TABLE training_condition_settlements(rider_id uuid);
    CREATE TABLE rider_training_seen(rider_id uuid PRIMARY KEY,first_seen_date date,first_team_id uuid,first_run_id uuid);
    CREATE TABLE training_day_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),team_id uuid,tick_date date,report jsonb);
    CREATE TABLE training_compensation_receipts(rider_id uuid,season_id uuid,game_day integer,tick_date date,team_id uuid,plan_hash text,payload jsonb,applied_at timestamptz);
    CREATE TABLE training_date_work(team_id uuid,season_id uuid,tick_date date,game_days integer[],expected_rider_ids uuid[],deadline_at timestamptz,status text,missing_evidence jsonb,opening_conditions jsonb,quarantined_rider_ids uuid[] NOT NULL DEFAULT '{}',quarantine_evidence jsonb NOT NULL DEFAULT '[]',created_at timestamptz,updated_at timestamptz,PRIMARY KEY(team_id,season_id,tick_date));
    INSERT INTO app_config(key,value) VALUES('training_condition_per_date','"on"'),('training_tick_per_race_day','"on"');`);

  // Ryttere fra FØR rettelsen. Indsat før triggeren findes, så deres tilstand er præcis den skrevne.
  await insertRider(HIT_A, TEAM_A);
  await insertRider(HIT_B, TEAM_A);
  await insertRider(VETERAN, TEAM_B);
  await insertRider(NO_ROW, TEAM_B);
  await db.query(`INSERT INTO rider_condition(rider_id,form,fatigue,injured_until,injury_cause,updated_at) VALUES
    ($1,50,0,NULL,NULL,'2026-11-10T08:00:00Z'),($2,48,11,NULL,NULL,'2026-11-11T20:00:00Z'),($3,64,73,'2026-11-20','race_crash','2026-11-12T20:00:00Z')`,
    [HIT_A, HIT_B, VETERAN]);

  // Dagens tilstand (prod 13/11).
  const baseline = await readFile(dbFile(BASELINE_FILE), 'utf8');
  for (const marker of BASELINE_FUNCTIONS) await db.exec(extractFunction(baseline, marker));
  await db.exec(`CREATE TRIGGER trg_initialize_first_use_rider_condition AFTER INSERT OR UPDATE OF team_id ON public.riders
    FOR EACH ROW EXECUTE FUNCTION public.initialize_first_use_rider_condition();`);
  witnessBefore = await witness();

  // Byggerens migration, to gange.
  migrationFiles = await findMigrations();
  for (let round = 0; round < 2; round++) {
    for (const file of migrationFiles) await db.exec(await readFile(file, 'utf8'));
  }
});
after(async () => db?.close());

test('#8089 forudsætning: der findes en migration for opgaven (filnavn med 8089)', () => {
  assert.ok(migrationFiles.length > 0, 'Ingen database/*8089*.sql fundet: rettelsen er ikke bygget endnu');
});

// ── R1 + R2: hver af de tre veje giver form 50 og den faste starttræthed ─────
test('R1/R2 køb fra puljen: rytter uden hold og uden tilstand får form 50 og starttræthed 20', async () => {
  const rider = uid(0x201);
  await insertRider(rider, null);
  assert.equal(await condition(rider), null, 'en rytter uden hold har ingen tilstand');
  await db.query('UPDATE riders SET team_id=$1,acquired_at=$2 WHERE id=$3', [TEAM_A, '2026-11-14T12:00:00Z', rider]);
  const got = await condition(rider);
  assert.deepEqual({ form: got?.form, fatigue: got?.fatigue }, { form: START_FORM, fatigue: START_FATIGUE });
});

test('R1/R2 fri agent: samme vej i databasen (hold sættes på en ejerløs rytter), samme starttilstand', async () => {
  const rider = uid(0x202);
  await insertRider(rider, null);
  await db.query('UPDATE riders SET team_id=$1,pending_team_id=NULL,acquired_at=$2 WHERE id=$3', [TEAM_B, '2026-11-14T13:00:00Z', rider]);
  const got = await condition(rider);
  assert.deepEqual({ form: got?.form, fatigue: got?.fatigue }, { form: START_FORM, fatigue: START_FATIGUE });
});

test('R1/R2 akademi-optag: ung rytter der skrives ind på holdets akademi får samme starttilstand', async () => {
  for (const [n, squad] of [[0x203, 'junior'], [0x204, 'u23']]) {
    const rider = uid(n);
    await insertRider(rider, null, { squad });
    await db.query('UPDATE riders SET team_id=$1,is_academy=true,squad=$2,acquired_at=$3 WHERE id=$4', [TEAM_A, squad, '2026-11-14T14:00:00Z', rider]);
    const got = await condition(rider);
    assert.deepEqual({ form: got?.form, fatigue: got?.fatigue }, { form: START_FORM, fatigue: START_FATIGUE }, `akademi ${squad}`);
  }
});

test('R1 "ens": de tre veje ender på præcis samme tal', async () => {
  const rows = (await db.query('SELECT DISTINCT form,fatigue FROM rider_condition WHERE rider_id = ANY($1)',
    [[uid(0x201), uid(0x202), uid(0x203), uid(0x204)]])).rows;
  assert.deepEqual(rows, [{ form: START_FORM, fatigue: START_FATIGUE }]);
});

// Spørgsmål S1 til ejeren (regler.md): en ny managers starttrup oprettes med hold sat fra start.
// Forsigtig læsning: samme regel som de tre veje (ét sted i databasen, og "træning fra dag ét, også for en ny spiller").
test('R1 (S1, forsigtig læsning) rytter der oprettes direkte på et hold (ny managers starttrup) får samme starttilstand', async () => {
  const rider = uid(0x205);
  await insertRider(rider, TEAM_A);
  const got = await condition(rider);
  assert.deepEqual({ form: got?.form, fatigue: got?.fatigue }, { form: START_FORM, fatigue: START_FATIGUE });
});

test('R1 reservevejen: rytter uden tilstand, der først opdages når holdets dato åbnes, får samme starttilstand, og datoen åbner på den', async () => {
  const rider = uid(0x206);
  await db.exec('ALTER TABLE riders DISABLE TRIGGER trg_initialize_first_use_rider_condition');
  await insertRider(rider, TEAM_B);
  await db.exec('ALTER TABLE riders ENABLE TRIGGER trg_initialize_first_use_rider_condition');
  assert.equal(await condition(rider), null);
  const team = uid(0xb1);
  const work = (await db.query('SELECT register_training_date_work($1,$2,$3,$4,$5,NULL,$6) AS work',
    [team, SEASON, '2026-11-14', [61, 62, 63, 64, 65], [rider], '2026-11-14T18:00:00Z'])).rows[0].work;
  const got = await condition(rider);
  assert.deepEqual({ form: got?.form, fatigue: got?.fatigue }, { form: START_FORM, fatigue: START_FATIGUE });
  assert.equal(Number(work.opening_conditions[rider]?.fatigue), START_FATIGUE);
  assert.equal(Number(work.opening_conditions[rider]?.form), START_FORM);
});

test('R1 ingen funktion i databasen skriver længere den gamle friske start (50 og 0) til en ny rytter', async () => {
  const rows = (await db.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosrc ~* 'insert\\s+into\\s+(public\\.)?rider_condition\\s*\\(rider_id\\s*,\\s*form\\s*,\\s*fatigue\\s*,\\s*updated_at\\)[^;]*\\m50\\s*,\\s*${TODAY_FATIGUE}\\s*,'
    ORDER BY 1`)).rows.map((r) => r.proname);
  assert.deepEqual(rows, [], `skriver stadig 50/0: ${rows.join(', ')}`);
});

// ── R3: eksisterende ryttere røres ikke ──────────────────────────────────────
test('R3 rytter med egen tilstand (også skade) beholder den uændret ved nyt hold, også ved gentagelse', async () => {
  const beforeRow = (await db.query('SELECT * FROM rider_condition WHERE rider_id=$1', [VETERAN])).rows;
  await db.query('UPDATE riders SET team_id=$1,acquired_at=$2 WHERE id=$3', [TEAM_A, '2026-11-14T15:00:00Z', VETERAN]);
  await db.query('UPDATE riders SET team_id=$1 WHERE id=$2', [TEAM_A, VETERAN]);
  await db.query('UPDATE riders SET team_id=$1 WHERE id=$2', [TEAM_B, VETERAN]);
  assert.deepEqual((await db.query('SELECT * FROM rider_condition WHERE rider_id=$1', [VETERAN])).rows, beforeRow);
});

test('R3 rytter der sættes fri og købes igen kommer tilbage med sin egen tilstand, ikke en ny start', async () => {
  const rider = uid(0x207);
  await insertRider(rider, null);
  await db.query('UPDATE riders SET team_id=$1 WHERE id=$2', [TEAM_A, rider]);
  await db.query('UPDATE rider_condition SET form=61,fatigue=44 WHERE rider_id=$1', [rider]);
  await db.query('UPDATE riders SET team_id=NULL WHERE id=$1', [rider]);
  await db.query('UPDATE riders SET team_id=$1 WHERE id=$2', [TEAM_B, rider]);
  const got = await condition(rider);
  assert.deepEqual({ form: got.form, fatigue: got.fatigue }, { form: 61, fatigue: 44 });
});

for (const [index, table] of ['training_race_loads', 'training_rider_ticks', 'training_condition_settlements', 'rider_training_seen'].entries()) {
  test(`R3 rytter med gemt træningshistorik (${table}) men uden tilstand får IKKE automatisk en ny start`, async () => {
    const rider = uid(0x300 + index);
    await insertRider(rider, null);
    await db.query(`INSERT INTO ${table}(rider_id) VALUES($1)`, [rider]);
    await db.query('UPDATE riders SET team_id=$1 WHERE id=$2', [TEAM_A, rider]);
    assert.equal(await condition(rider), null);
  });
}

test('R3 pensioneret rytter får ingen tilstand', async () => {
  const rider = uid(0x208);
  await db.query('INSERT INTO riders(id,team_id,is_retired,created_at) VALUES($1,$2,true,$3)', [rider, TEAM_A, T0]);
  assert.equal(await condition(rider), null);
});

// ── R4: ingen bagudrettelse ──────────────────────────────────────────────────
test('R4 udrulningen (kørt to gange) ændrer ikke én eneste eksisterende rytters tilstand', async () => {
  // HIT_A/HIT_B = allerede ramte (50/0 og 48/11); NO_ROW = har hold men ingen tilstand.
  const now = (await db.query(
    'SELECT rider_id,form,fatigue,injured_until,injury_cause,updated_at FROM rider_condition WHERE rider_id = ANY($1) ORDER BY rider_id',
    [[HIT_A, HIT_B, NO_ROW]])).rows;
  assert.deepEqual(now, witnessBefore.filter((r) => r.rider_id !== VETERAN));
  assert.equal(await condition(NO_ROW), null, 'udrulningen må ikke oprette tilstand for ryttere, der allerede har et hold');
});

test('R4 en allerede ramt rytter (50 og 0) bliver stående, også når han skifter hold bagefter', async () => {
  await db.query('UPDATE riders SET team_id=$1 WHERE id=$2', [TEAM_B, HIT_A]);
  const got = await condition(HIT_A);
  assert.deepEqual({ form: got.form, fatigue: got.fatigue }, { form: 50, fatigue: TODAY_FATIGUE });
});

// ── Teknisk værn (ikke en ejer-regel): sikkerheden omkring funktionen er uændret ──
test('værn: kun serveren må køre starttilstands-funktionen; slukket træningskontakt giver stadig ingen tilstand', async () => {
  const fn = (await db.query(`SELECT proacl::text AS acl FROM pg_proc WHERE proname='initialize_first_use_rider_condition'`)).rows[0];
  assert.ok(!/(^|[{,])(anon|authenticated)=/.test(fn.acl ?? ''), `klientrolle har fået eksplicit adgang: ${fn.acl}`);
  await db.exec(`UPDATE app_config SET value='"off"' WHERE key='training_condition_per_date'`);
  try {
    const rider = uid(0x209);
    await insertRider(rider, TEAM_A);
    assert.equal(await condition(rider), null);
  } finally {
    await db.exec(`UPDATE app_config SET value='"on"' WHERE key='training_condition_per_date'`);
  }
});
