// #8244: managers maa kun aendre laest-status paa egne notifikationer. Koeres mod
// en rigtig Postgres (PGlite) og den RIGTIGE migration. Udgangspunktet spejler
// Supabase' rettigheder og RLS-politikker paa notifications, saa testen viser
// forskellen foer og efter. Brugere er aliaser (A/B), ingen prod-data.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = new URL('../../database/2026-11-16-8244-notifications-update-only-read.sql', import.meta.url);
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const USER_A = id(1);
const USER_B = id(2);
const NOTIF_A1 = id(21);
const NOTIF_A2 = id(22);
const NOTIF_B = id(23);

const SCHEMA = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text,
  is_read boolean NOT NULL DEFAULT false,
  related_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own notifications" ON public.notifications FOR SELECT
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can delete own notifications" ON public.notifications FOR DELETE
  USING ((SELECT auth.uid()) = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.notifications TO anon, authenticated, service_role;

INSERT INTO public.notifications(id, user_id, type, title, related_id, metadata) VALUES
  ('${NOTIF_A1}', '${USER_A}', 'squad_below_minimum', 'A1', '${id(31)}', '{"dedupeKey":"team-a"}'),
  ('${NOTIF_A2}', '${USER_A}', 'race_result', 'A2', NULL, NULL),
  ('${NOTIF_B}', '${USER_B}', 'squad_below_minimum', 'B', '${id(32)}', '{"dedupeKey":"team-b"}');
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

const asUserA = (db, sql) => asRole(db, 'authenticated', sql, { sub: USER_A });
const denied = err => err.code === '42501' && /permission denied for table notifications/.test(err.message);
const snapshot = async db => (await db.query(
  'SELECT id, user_id, type, title, message, is_read, related_id, metadata FROM public.notifications ORDER BY id')).rows;

// Hver kolonne en manager IKKE maa roere efter #8244.
const forbiddenWrites = [
  ['type', `type = 'admin_notice'`],
  ['related_id', `related_id = '${id(99)}'`],
  ['metadata', `metadata = '{"dedupeKey":"team-b"}'::jsonb`],
  ['user_id', `user_id = '${USER_B}'`],
  ['title', `title = 'forfalsket'`],
  ['message', `message = 'forfalsket'`],
  ['created_at', `created_at = now() - interval '1 year'`],
];

test('kontrol: foer migrationen kan en manager omskrive metadata paa sin egen notifikation', async () => {
  const db = await database({ migrate: false });
  const { rows } = await asUserA(db,
    `UPDATE public.notifications SET metadata = '{"dedupeKey":"team-b"}'::jsonb WHERE id = '${NOTIF_A1}' RETURNING id`);
  assert.equal(rows.length, 1);
});

for (const [column, assignment] of forbiddenWrites) {
  test(`authenticated afvises ved UPDATE af ${column} paa egen notifikation`, async () => {
    const db = await database();
    const before = await snapshot(db);
    await assert.rejects(asUserA(db, `UPDATE public.notifications SET ${assignment} WHERE id = '${NOTIF_A1}'`), denied);
    assert.deepEqual(await snapshot(db), before);
  });
}

test('authenticated afvises ogsaa naar is_read blandes med en forbudt kolonne', async () => {
  const db = await database();
  const before = await snapshot(db);
  await assert.rejects(asUserA(db,
    `UPDATE public.notifications SET is_read = true, metadata = '{}'::jsonb WHERE id = '${NOTIF_A1}'`), denied);
  assert.deepEqual(await snapshot(db), before);
});

test('anon kan slet ikke opdatere', async () => {
  const db = await database();
  await assert.rejects(asRole(db, 'anon', `UPDATE public.notifications SET is_read = true WHERE id = '${NOTIF_A1}'`), denied);
});

test('"markér som laest": en manager kan saette is_read paa sin egen notifikation', async () => {
  const db = await database();
  const { rows } = await asUserA(db,
    `UPDATE public.notifications SET is_read = true WHERE id = '${NOTIF_A1}' RETURNING id, is_read`);
  assert.deepEqual(rows, [{ id: NOTIF_A1, is_read: true }]);
});

test('"markér alle som laest": samme filter som appen (user_id + is_read=false) virker', async () => {
  const db = await database();
  const { rows } = await asUserA(db,
    `UPDATE public.notifications SET is_read = true WHERE user_id = '${USER_A}' AND is_read = false RETURNING id`);
  assert.equal(rows.length, 2);
});

test('RLS gaelder stadig: en manager kan ikke markere en andens notifikation som laest', async () => {
  const db = await database();
  const { rows } = await asUserA(db,
    `UPDATE public.notifications SET is_read = true WHERE id = '${NOTIF_B}' RETURNING id`);
  assert.equal(rows.length, 0);
  const { rows: b } = await db.query(`SELECT is_read FROM public.notifications WHERE id = '${NOTIF_B}'`);
  assert.equal(b[0].is_read, false);
});

test('"slet": en manager kan stadig slette sine egne notifikationer, ikke andres', async () => {
  const db = await database();
  const own = await asUserA(db, `DELETE FROM public.notifications WHERE id = '${NOTIF_A2}' RETURNING id`);
  assert.equal(own.rows.length, 1);
  const other = await asUserA(db, `DELETE FROM public.notifications WHERE id = '${NOTIF_B}' RETURNING id`);
  assert.equal(other.rows.length, 0);
});

test('service_role (backend) kan fortsat opdatere alle kolonner', async () => {
  const db = await database();
  const { rows } = await asRole(db, 'service_role',
    `UPDATE public.notifications SET type = 'admin_notice', metadata = '{"x":1}'::jsonb, related_id = NULL, is_read = true
     WHERE id = '${NOTIF_B}' RETURNING type, is_read`);
  assert.deepEqual(rows, [{ type: 'admin_notice', is_read: true }]);
});

test('laesning er uaendret for manageren', async () => {
  const before = await database({ migrate: false });
  const after = await database();
  const select = 'SELECT id, user_id, type, title, is_read, related_id, metadata FROM public.notifications ORDER BY id';
  const expected = await asUserA(before, select);
  const actual = await asUserA(after, select);
  assert.equal(actual.rows.length, 2);
  assert.deepEqual(actual.rows, expected.rows);
});

test('migrationen er idempotent og lader de oevrige rettigheder staa', async () => {
  const db = await database();
  const acl = async () => (await db.query(
    `SELECT relacl::text AS acl, (SELECT array_agg(attacl::text ORDER BY attnum) FROM pg_attribute
       WHERE attrelid = 'public.notifications'::regclass AND attnum > 0) AS cols
     FROM pg_class WHERE oid = 'public.notifications'::regclass`)).rows[0];
  const first = await acl();
  await db.exec(await readFile(MIGRATION, 'utf8'));
  assert.deepEqual(await acl(), first);

  const has = async (role, privilege) => (await db.query(
    `SELECT has_table_privilege($1, 'public.notifications', $2) AS ok`, [role, privilege])).rows[0].ok;
  for (const role of ['anon', 'authenticated']) {
    assert.equal(await has(role, 'UPDATE'), false, `${role} table UPDATE`);
    assert.equal(await has(role, 'SELECT'), true, `${role} SELECT`);
    assert.equal(await has(role, 'DELETE'), true, `${role} DELETE`);
  }
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    assert.equal(await has('service_role', privilege), true, `service_role ${privilege}`);
  }
});
