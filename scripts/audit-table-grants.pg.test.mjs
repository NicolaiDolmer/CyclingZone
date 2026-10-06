import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../backend/node_modules/@electric-sql/pglite/dist/index.js';

test('template is idempotent and enforces authenticated/anonymous/service access in PostgreSQL', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;`);
  const template = readFileSync(new URL('../database/templates/new-public-table.sql', import.meta.url), 'utf8');
  await db.exec(template);
  await db.exec(template);
  await db.exec(`SET ROLE service_role; INSERT INTO public.example_notes(owner_id,body) VALUES
    ('00000000-0000-0000-0000-000000000001','owned'), ('00000000-0000-0000-0000-000000000002','other'); RESET ROLE;`);
  await db.exec('SET ROLE authenticated;');
  assert.deepEqual((await db.query('SELECT body FROM public.example_notes')).rows, [{ body: 'owned' }]);
  await assert.rejects(db.exec("INSERT INTO public.example_notes(owner_id,body) VALUES ('00000000-0000-0000-0000-000000000001','blocked')"), /permission denied/);
  await db.exec('RESET ROLE; SET ROLE anon;');
  await assert.rejects(db.query('SELECT * FROM public.example_notes'), /permission denied/);
  await db.exec('RESET ROLE; SET ROLE service_role;');
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.example_notes')).rows[0].n, 2);
  await db.exec('RESET ROLE;');
  // The read-only catalog audit itself is valid SQL against the fixture DB.
  const reports = await db.exec(readFileSync(new URL('./audit-table-grants.sql', import.meta.url), 'utf8'));
  assert.ok(reports[0].rows.some(r => r.table_name === 'example_notes' && r.role_name === 'authenticated' && r.operation === 'SELECT' && r.table_granted));
});
