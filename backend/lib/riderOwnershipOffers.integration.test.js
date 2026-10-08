import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migrationUrl = new URL('../../database/2026-10-03-6115-withdraw-offers-on-owner-change.sql', import.meta.url);
// Use #6119's canonical migration once it lands; until then its exact a6b09da15
// SQL is pinned in our own fixture, without modifying the parallel track.
const conditionSql = await readFile(new URL('../../database/2026-10-03-6061-first-use-rider-condition.sql', import.meta.url), 'utf8')
  .catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return readFile(new URL('./testFixtures/6115-first-use-condition-6119.sql', import.meta.url), 'utf8');
  });
const migration = await readFile(migrationUrl, 'utf8');
const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-000000000002';
const R = '10000000-0000-0000-0000-000000000001';
const OTHER = '10000000-0000-0000-0000-000000000002';
const NOW = '2026-10-03T12:00:00Z';
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE riders(id uuid PRIMARY KEY,team_id uuid,pending_team_id uuid,
      acquired_at timestamptz,created_at timestamptz,is_retired boolean DEFAULT false,
      is_academy boolean DEFAULT false,squad text DEFAULT 'senior',updated_at timestamptz);
    CREATE TABLE transfer_offers(id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,rider_id uuid,status text);
    CREATE TABLE swap_offers(id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,offered_rider_id uuid,requested_rider_id uuid,status text);
    CREATE TABLE rider_condition(rider_id uuid PRIMARY KEY,form int,fatigue int,injured_until date,updated_at timestamptz);
    CREATE TABLE app_config(key text PRIMARY KEY,value jsonb);
    CREATE TABLE training_condition_settlements(rider_id uuid);
    CREATE TABLE training_rider_ticks(rider_id uuid);
    CREATE TABLE training_race_loads(rider_id uuid);
    CREATE TABLE training_day_runs(report jsonb);
    CREATE TABLE offer_updates(kind text,id int);
    CREATE FUNCTION audit_offer_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO offer_updates VALUES(TG_TABLE_NAME,NEW.id); RETURN NEW; END; $$;
    CREATE TRIGGER audit_transfer AFTER UPDATE ON transfer_offers FOR EACH ROW EXECUTE FUNCTION audit_offer_update();
    CREATE TRIGGER audit_swap AFTER UPDATE ON swap_offers FOR EACH ROW EXECUTE FUNCTION audit_offer_update();
    ALTER TABLE riders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE transfer_offers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE swap_offers ENABLE ROW LEVEL SECURITY;
    CREATE POLICY riders_read ON riders FOR SELECT USING(true);
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
    GRANT SELECT,UPDATE ON riders TO anon,authenticated;
    GRANT SELECT ON transfer_offers,swap_offers TO anon,authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
  `);
  await db.exec(migration);
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`DROP TRIGGER IF EXISTS trg_initialize_first_use_rider_condition ON riders;
    DROP POLICY IF EXISTS test_owner_write ON riders;
    TRUNCATE riders,transfer_offers,swap_offers,rider_condition,app_config,offer_updates RESTART IDENTITY;
    INSERT INTO riders(id,team_id,created_at) VALUES('${R}','${A}','${NOW}'),('${OTHER}','${B}','${NOW}');
    INSERT INTO transfer_offers(rider_id,status) VALUES('${R}','pending');
    INSERT INTO swap_offers(offered_rider_id,requested_rider_id,status) VALUES('${R}','${OTHER}','pending');`);
});
async function move(patch = `team_id='${B}'`) {
  await db.exec(`SET ROLE service_role; UPDATE riders SET ${patch} WHERE id='${R}'; RESET ROLE;`);
}
async function statuses(table) { return (await db.query(`SELECT status FROM ${table} ORDER BY id`)).rows.map(row => row.status); }
async function owner() { return (await db.query('SELECT team_id FROM riders WHERE id=$1', [R])).rows[0].team_id; }

test('AI acquisition withdraws both offer types in the ownership statement', async () => {
  await move(`team_id='${B}',pending_team_id=null,acquired_at='${NOW}'`);
  assert.deepEqual(await statuses('transfer_offers'), ['withdrawn']);
  assert.deepEqual(await statuses('swap_offers'), ['withdrawn']);
});

// These are the actual SQL ownership-write boundaries used by the audited JS
// paths. Higher-level balances/notifications keep their existing unit suites.
const boundaries = [
  ['auction (senior/youth/bank)', `team_id='${B}',pending_team_id=null,acquired_at='${NOW}'`],
  ['direct transfer', `team_id='${B}',pending_team_id=null,acquired_at='${NOW}'`],
  ['swap offered leg', `team_id='${B}',pending_team_id=null,acquired_at='${NOW}'`],
  ['manual release', 'team_id=null,pending_team_id=null'],
  ['contract expiry', 'team_id=null,pending_team_id=null'],
  ['retirement release', 'team_id=null,pending_team_id=null,is_retired=true'],
  ['legacy retirement', 'team_id=null,is_retired=true'],
  ['academy intake expiry / rejection', "team_id=null,is_academy=false,squad='senior'"],
  ['economy return to AI', `team_id='${B}',pending_team_id=null`],
  ['squad enforcement return / acquisition', `team_id='${B}',pending_team_id=null`],
  ['beta reset return to AI / release', `team_id='${B}',pending_team_id=null`],
  ['academy signing RPC', `team_id='${B}',is_academy=true,squad='junior'`],
  ['starter squad assignment / AI allocation of existing riders', `team_id='${B}'`],
  ['admin rider reassignment', `team_id='${B}',pending_team_id=null,is_academy=false,acquired_at='${NOW}'`],
];
for (const [path,patch] of boundaries) {
  test(`${path}: SQL write boundary withdraws open deals`, async () => {
    await move(patch);
    assert.deepEqual(await statuses('transfer_offers'), ['withdrawn']);
    assert.deepEqual(await statuses('swap_offers'), ['withdrawn']);
  });
}

test('actual requested swap leg also withdraws a deal referencing that rider', async () => {
  await db.exec(`SET ROLE service_role; UPDATE riders SET team_id='${A}' WHERE id='${OTHER}'; RESET ROLE;`);
  assert.deepEqual(await statuses('swap_offers'), ['withdrawn']);
  assert.deepEqual(await statuses('transfer_offers'), ['pending']);
});

for (const initial of [A, null]) {
  test(`unchanged owner ${initial === null ? 'null' : 'team'} preserves all offers`, async () => {
    if (initial === null) await db.exec(`ALTER TABLE riders DISABLE TRIGGER trg_withdraw_open_offers_on_rider_owner_change;
      UPDATE riders SET team_id=null WHERE id='${R}'; ALTER TABLE riders ENABLE TRIGGER trg_withdraw_open_offers_on_rider_owner_change;`);
    await move(`team_id=${initial === null ? 'null' : `'${A}'`},updated_at='${NOW}'`);
    assert.deepEqual(await statuses('transfer_offers'), ['pending']);
    assert.deepEqual(await statuses('swap_offers'), ['pending']);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM offer_updates')).rows[0].n, 0);
  });
}

test('all three open statuses withdrawn; terminal and unrelated offers preserved', async () => {
  const terminal = ['accepted','rejected','withdrawn','window_pending'];
  const all = ['pending','countered','awaiting_confirmation',...terminal];
  await db.exec('TRUNCATE transfer_offers,swap_offers RESTART IDENTITY');
  for (const status of all) {
    await db.query('INSERT INTO transfer_offers(rider_id,status) VALUES($1,$2)', [R,status]);
    await db.query('INSERT INTO swap_offers(offered_rider_id,requested_rider_id,status) VALUES($1,$2,$3)', [OTHER,R,status]);
  }
  await db.query("INSERT INTO transfer_offers(rider_id,status) VALUES($1,'pending')", [OTHER]);
  await db.query("INSERT INTO swap_offers(offered_rider_id,requested_rider_id,status) VALUES($1,$1,'pending')", [OTHER]);
  await move();
  const expected = ['withdrawn','withdrawn','withdrawn',...terminal,'pending'];
  assert.deepEqual(await statuses('transfer_offers'), expected);
  assert.deepEqual(await statuses('swap_offers'), expected);
});

test('defer only preserves offers; actual flush cancels even null-to-team; repeat is inert', async () => {
  await move('team_id=null');
  await db.exec(`UPDATE transfer_offers SET status='pending'; UPDATE swap_offers SET status='pending'; TRUNCATE offer_updates;`);
  await move(`pending_team_id='${B}',updated_at='${NOW}'`);
  assert.deepEqual(await statuses('transfer_offers'), ['pending']);
  await move(`team_id=pending_team_id,pending_team_id=null,acquired_at='${NOW}'`);
  await move();
  assert.deepEqual(await statuses('transfer_offers'), ['withdrawn']);
  assert.deepEqual(await statuses('swap_offers'), ['withdrawn']);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM offer_updates')).rows[0].n, 2);
});

test('terminal execution step can mark current transfer/swap accepted after movement', async () => {
  await move();
  await db.exec(`UPDATE transfer_offers SET status='accepted' WHERE id=1;
    UPDATE riders SET team_id='${A}' WHERE id='${OTHER}'; UPDATE swap_offers SET status='accepted' WHERE id=1;`);
  await move(`team_id='${A}'`);
  assert.deepEqual(await statuses('transfer_offers'), ['accepted']);
  assert.deepEqual(await statuses('swap_offers'), ['accepted']);
});

test('both riders in one statement cancel their shared swap exactly once', async () => {
  await db.exec(`UPDATE riders SET team_id=CASE WHEN id='${R}' THEN '${B}'::uuid ELSE '${A}'::uuid END;`);
  assert.deepEqual(await statuses('swap_offers'), ['withdrawn']);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM offer_updates WHERE kind='swap_offers'")).rows[0].n, 1);
});

test('transaction rollback restores ownership, both deals and audit effects', async () => {
  await db.exec('BEGIN');
  await move();
  assert.deepEqual(await statuses('swap_offers'), ['withdrawn']);
  await db.exec('ROLLBACK');
  assert.equal(await owner(), A);
  assert.deepEqual(await statuses('transfer_offers'), ['pending']);
  assert.deepEqual(await statuses('swap_offers'), ['pending']);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM offer_updates')).rows[0].n, 0);
});

test('swap write failure rolls back rider and earlier transfer withdrawal atomically', async () => {
  await db.exec("ALTER TABLE swap_offers ADD CONSTRAINT test_reject_withdraw CHECK(status<>'withdrawn')");
  try {
    await assert.rejects(move(), /test_reject_withdraw/);
    await db.exec('RESET ROLE');
    assert.equal(await owner(), A);
    assert.deepEqual(await statuses('transfer_offers'), ['pending']);
    assert.deepEqual(await statuses('swap_offers'), ['pending']);
  } finally { await db.exec('ALTER TABLE swap_offers DROP CONSTRAINT test_reject_withdraw'); }
});

test('invoker privileges and fixed search_path; no public function endpoint', async () => {
  const p = (await db.query(`SELECT prosecdef,proconfig,
    has_function_privilege('anon',oid,'EXECUTE') AS anon,
    has_function_privilege('authenticated',oid,'EXECUTE') AS authenticated,
    has_function_privilege('service_role',oid,'EXECUTE') AS service
    FROM pg_proc WHERE proname='withdraw_open_offers_on_rider_owner_change'`)).rows[0];
  assert.equal(p.prosecdef, false);
  assert.deepEqual(p.proconfig, ['search_path=public, pg_temp']);
  assert.equal(p.anon, false); assert.equal(p.authenticated, false); assert.equal(p.service, true);
});

for (const role of ['anon','authenticated']) {
  test(`${role}: live rider RLS prevents ownership writes`, async () => {
    await db.exec(`SET ROLE ${role}; UPDATE riders SET team_id='${B}' WHERE id='${R}'; RESET ROLE;`);
    assert.equal(await owner(), A);
    assert.deepEqual(await statuses('transfer_offers'), ['pending']);
  });
  test(`${role}: even with a rider write policy, missing offer grants fail closed`, async () => {
    await db.exec('CREATE POLICY test_owner_write ON riders FOR UPDATE USING(true) WITH CHECK(true)');
    await assert.rejects(db.exec(`SET ROLE ${role}; UPDATE riders SET team_id='${B}' WHERE id='${R}';`), /permission denied for table transfer_offers/);
    await db.exec('RESET ROLE');
    assert.equal(await owner(), A);
    assert.deepEqual(await statuses('transfer_offers'), ['pending']);
  });
}

test('a BEFORE trigger changing team_id through another column is also covered', async () => {
  await db.exec(`CREATE FUNCTION test_owner_before() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.squad='junior' THEN NEW.team_id='${B}'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_owner_before BEFORE UPDATE OF squad ON riders FOR EACH ROW EXECUTE FUNCTION test_owner_before();`);
  try {
    await move("squad='junior'");
    assert.equal(await owner(), B);
    assert.deepEqual(await statuses('transfer_offers'), ['withdrawn']);
  } finally { await db.exec('DROP TRIGGER test_owner_before ON riders; DROP FUNCTION test_owner_before()'); }
});

for (const order of ['6115 then 6061','6061 then 6115']) {
  test(`real #6119 SQL coexists, ${order}; retries preserve condition/injury and avoid double effects`, async () => {
    await db.exec(order === '6115 then 6061' ? migration + conditionSql : conditionSql + migration);
    // Reapply both to prove migration idempotency and preservation of both triggers.
    await db.exec(migration + conditionSql);
    await db.exec(`INSERT INTO app_config VALUES('training_condition_per_date','"on"'),('training_tick_per_race_day','"on"');`);
    await move();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n, 1);
    await db.exec(`UPDATE rider_condition SET form=64,fatigue=17,injured_until='2026-10-20' WHERE rider_id='${R}';`);
    const condition = (await db.query('SELECT * FROM rider_condition')).rows;
    await move(`team_id='${A}'`); await move('team_id=null'); await move(); await move();
    assert.deepEqual((await db.query('SELECT * FROM rider_condition')).rows, condition);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM offer_updates')).rows[0].n, 2);
    const names = (await db.query("SELECT tgname FROM pg_trigger WHERE tgrelid='riders'::regclass AND NOT tgisinternal")).rows.map(row => row.tgname);
    assert.ok(names.includes('trg_initialize_first_use_rider_condition'));
    assert.ok(names.includes('trg_withdraw_open_offers_on_rider_owner_change'));
  });
}

test('#6061 condition trigger failure rolls ownership and offers back together', async () => {
  await db.exec(conditionSql);
  await db.exec(`INSERT INTO app_config VALUES('training_condition_per_date','"on"'),('training_tick_per_race_day','"off"');`);
  await assert.rejects(move(), /requires training_tick_per_race_day/);
  await db.exec('RESET ROLE');
  assert.equal(await owner(), A);
  assert.deepEqual(await statuses('transfer_offers'), ['pending']);
  assert.deepEqual(await statuses('swap_offers'), ['pending']);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rider_condition')).rows[0].n, 0);
});

test('migration reapply never backfills the historical orphan awaiting confirmation', async () => {
  // This simulates the explicitly excluded historic null-owner offer.
  await db.exec(`ALTER TABLE riders DISABLE TRIGGER trg_withdraw_open_offers_on_rider_owner_change;
    UPDATE riders SET team_id=null WHERE id='${R}'; ALTER TABLE riders ENABLE TRIGGER trg_withdraw_open_offers_on_rider_owner_change;
    UPDATE transfer_offers SET status='awaiting_confirmation'; TRUNCATE offer_updates;`);
  await db.exec(migration); await db.exec(migration);
  assert.equal(await owner(), null);
  assert.deepEqual(await statuses('transfer_offers'), ['awaiting_confirmation']);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM offer_updates')).rows[0].n, 0);
});
