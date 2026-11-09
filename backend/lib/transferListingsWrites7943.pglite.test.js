// #7943: adgangen til salgsannoncer mod en rigtig Postgres (PGlite) og den
// RIGTIGE migration. Udgangspunktet spejler rollernes rettigheder, saa testen
// kan vise forskellen foer og efter. Hold er aliaser (Hold A/B), ingen prod-data.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = new URL('../../database/2026-11-09-7943-transfer-listings-writes.sql', import.meta.url);
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const USER_A = id(1);
const TEAM_A = id(11);
const TEAM_B = id(12);
const LISTING_A = id(21);
const LISTING_B = id(22);
const CLIENT_WRITE_PRIVILEGES = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
const CLIENT_ROLES = ['anon', 'authenticated'];

const SCHEMA = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public.teams (id uuid PRIMARY KEY, user_id uuid);
GRANT SELECT ON public.teams TO anon, authenticated, service_role;
INSERT INTO public.teams(id, user_id) VALUES ('${TEAM_A}', '${USER_A}'), ('${TEAM_B}', '${id(2)}');

CREATE TABLE public.transfer_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL,
  seller_team_id uuid,
  asking_price bigint NOT NULL,
  status text NOT NULL DEFAULT 'open'
);
ALTER TABLE public.transfer_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read transfer_listings" ON public.transfer_listings FOR SELECT USING (true);
CREATE POLICY "Owners can insert listings" ON public.transfer_listings FOR INSERT
  WITH CHECK ((SELECT auth.uid()) IN (SELECT teams.user_id FROM public.teams WHERE teams.id = transfer_listings.seller_team_id));
CREATE POLICY "Owners can update listings" ON public.transfer_listings FOR UPDATE
  USING ((SELECT auth.uid()) IN (SELECT teams.user_id FROM public.teams WHERE teams.id = transfer_listings.seller_team_id));
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON public.transfer_listings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.transfer_listings TO service_role;
INSERT INTO public.transfer_listings(id, rider_id, seller_team_id, asking_price) VALUES
  ('${LISTING_A}', '${id(31)}', '${TEAM_A}', 100),
  ('${LISTING_B}', '${id(32)}', '${TEAM_B}', 200);
`;

const openDatabases = new Set();
afterEach(async () => {
  for (const db of openDatabases) await db.close();
  openDatabases.clear();
});

async function database({ migrate = true } = {}) {
  const db = new PGlite();
  openDatabases.add(db);
  await db.exec(SCHEMA);
  if (migrate) await db.exec(await readFile(MIGRATION, 'utf8'));
  return db;
}

// Koerer sql som rollen med samme JWT-kontekst som PostgREST giver.
async function asRole(db, role, sql, { sub = '' } = {}) {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [sub]);
  await db.exec(`SET ROLE ${role}`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec('RESET ROLE');
  }
}

const writes = [
  ['INSERT', `INSERT INTO public.transfer_listings(rider_id, seller_team_id, asking_price) VALUES ('${id(33)}', '${TEAM_A}', 300)`],
  ['UPDATE', `UPDATE public.transfer_listings SET asking_price = 1 WHERE id = '${LISTING_A}'`],
  ['DELETE', `DELETE FROM public.transfer_listings WHERE id = '${LISTING_A}'`],
  ['TRUNCATE', 'TRUNCATE public.transfer_listings'],
];

const denied = err => err.code === '42501' && /permission denied for table transfer_listings/.test(err.message);
const contextFor = role => (role === 'authenticated' ? { sub: USER_A } : {});

test('kontrol: foer migrationen kan ejeren skrive til sin egen annonce', async () => {
  const db = await database({ migrate: false });
  await asRole(db, 'authenticated', writes[0][1], { sub: USER_A });
  const updated = await asRole(db, 'authenticated',
    `UPDATE public.transfer_listings SET asking_price = 1 WHERE id = '${LISTING_A}' RETURNING id`, { sub: USER_A });
  assert.equal(updated.rows.length, 1);
});

for (const role of CLIENT_ROLES) {
  for (const [operation, sql] of writes) {
    test(`${role} afvises ved ${operation}`, async () => {
      const db = await database();
      await assert.rejects(asRole(db, role, sql, contextFor(role)), denied);
      const { rows } = await db.query('SELECT count(*)::int AS n, sum(asking_price)::int AS total FROM public.transfer_listings');
      assert.deepEqual(rows[0], { n: 2, total: 300 });
    });
  }
}

test('service_role kan fortsat oprette, aendre og slette', async () => {
  const db = await database();
  const inserted = await asRole(db, 'service_role',
    `INSERT INTO public.transfer_listings(rider_id, seller_team_id, asking_price) VALUES ('${id(34)}', '${TEAM_B}', 400) RETURNING id`);
  assert.equal(inserted.rows.length, 1);
  const updated = await asRole(db, 'service_role',
    `UPDATE public.transfer_listings SET status = 'withdrawn' WHERE id = '${LISTING_A}' RETURNING status`);
  assert.deepEqual(updated.rows, [{ status: 'withdrawn' }]);
  const removed = await asRole(db, 'service_role',
    `DELETE FROM public.transfer_listings WHERE id = '${LISTING_B}' RETURNING id`);
  assert.equal(removed.rows.length, 1);
});

test('laesning er uaendret for alle roller', async () => {
  const before = await database({ migrate: false });
  const after = await database();
  const select = 'SELECT id, rider_id, seller_team_id, asking_price, status FROM public.transfer_listings ORDER BY id';
  for (const role of [...CLIENT_ROLES, 'service_role']) {
    const expected = await asRole(before, role, select, contextFor(role));
    const actual = await asRole(after, role, select, contextFor(role));
    assert.equal(actual.rows.length, 2, role);
    assert.deepEqual(actual.rows, expected.rows, role);
  }
});

test('migrationen er idempotent og lader service_role og laeserettigheder staa', async () => {
  const db = await database();
  const acl = async () => (await db.query(`SELECT relacl::text AS acl FROM pg_class WHERE oid = 'public.transfer_listings'::regclass`)).rows[0].acl;
  const first = await acl();
  await db.exec(await readFile(MIGRATION, 'utf8'));
  assert.equal(await acl(), first);

  const has = async (role, privilege) => (await db.query(
    `SELECT has_table_privilege($1, 'public.transfer_listings', $2) AS ok`, [role, privilege])).rows[0].ok;
  for (const role of CLIENT_ROLES) {
    assert.equal(await has(role, 'SELECT'), true, `${role} SELECT`);
    for (const privilege of CLIENT_WRITE_PRIVILEGES) assert.equal(await has(role, privilege), false, `${role} ${privilege}`);
  }
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    assert.equal(await has('service_role', privilege), true, `service_role ${privilege}`);
  }
});
