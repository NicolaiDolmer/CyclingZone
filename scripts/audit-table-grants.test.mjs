import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSource, auditChangedSource } from './audit-table-grants.mjs';
const declaration = '-- data-api-access: {"table":"public.example","roles":{"anon":[],"authenticated":["SELECT"],"service_role":["SELECT","INSERT"]},"reason":"Owner reads; server writes"}\n';
const create = 'CREATE TABLE IF NOT EXISTS public.example (id uuid PRIMARY KEY, owner_id uuid);\nALTER TABLE public.example ENABLE ROW LEVEL SECURITY;\n';
const policy = 'CREATE POLICY owner_read ON public.example FOR SELECT TO authenticated USING (owner_id = auth.uid());\n';
const grants = 'GRANT SELECT ON TABLE public.example TO authenticated;\nGRANT SELECT, INSERT ON public.example TO service_role;\n';
const reset = "REVOKE ALL ON public.example FROM PUBLIC, anon, authenticated, service_role;\n";
const valid = declaration + create + policy + reset + grants;
test('new table with explicit roles, RLS and matching grants passes', () => assert.deepEqual(auditSource(valid), []));
test('new table without an access decision fails', () => assert.ok(auditSource(create).some(x=>x.includes('data-api-access'))));
test('SELECT is required even with an authenticated SELECT policy', () => assert.ok(auditSource(declaration+create+policy).some(x=>x.includes('authenticated SELECT'))));
test('service_role bypassing RLS does not replace its table privileges', () => assert.ok(auditSource(valid.replace('GRANT SELECT, INSERT ON public.example TO service_role;','')).some(x=>x.includes('service_role INSERT'))));
test('unexpected anonymous/public grants fail rather than broaden exposure', () => {
  for (const role of ['anon','PUBLIC']) assert.ok(auditSource(valid+'GRANT SELECT ON public.example TO '+role+';').some(x=>x.includes('undeclared')));
});
test('client grants require RLS and an applicable policy', () => {
  assert.ok(auditSource(valid.replace('ALTER TABLE public.example ENABLE ROW LEVEL SECURITY;','')).some(x=>x.includes('RLS')));
  assert.ok(auditSource(valid.replace(policy,'')).some(x=>x.includes('policy')));
});
test('revokes and disabling RLS are evaluated in statement order', () => {
  assert.ok(auditSource(valid+'REVOKE SELECT ON public.example FROM authenticated;').some(x=>x.includes('authenticated SELECT')));
  assert.ok(auditSource(valid+'ALTER TABLE public.example DISABLE ROW LEVEL SECURITY;').some(x=>x.includes('RLS')));
});
test('comments and grants on another table cannot satisfy a grant', () => {
  assert.ok(auditSource(declaration+create+policy+'-- '+grants.replaceAll('\n','\n-- ')).length);
  assert.ok(auditSource(valid.replaceAll('ON public.example TO service_role','ON public.other TO service_role')).length);
});
test('serial columns require an explicit sequence access decision', () => assert.ok(auditSource(valid.replace('id uuid','id serial')).some(x=>x.includes('sequence'))));
test('a service-only table needs no client policy and never gets client grants', () => {
  const source=valid.replace('"authenticated":["SELECT"]','"authenticated":[]').replace(policy,'').replace('GRANT SELECT ON TABLE public.example TO authenticated;','');
  assert.deepEqual(auditSource(source),[]);
});
test('malformed declarations and unsupported dynamic DDL fail closed', () => {
  assert.ok(auditSource('-- data-api-access: broken\n'+create).length);
  assert.ok(auditSource("DO $$ BEGIN CREATE TABLE public.example(id uuid); END $$;").some(x=>x.includes('dynamic')));
});
test('files without a new public table are outside the forward guard', () => assert.deepEqual(auditSource('ALTER TABLE public.old ADD COLUMN IF NOT EXISTS name text;'),[]));

test('inherited defaults must be reset explicitly', () => assert.ok(auditSource(valid.replace(reset,'' )).some(x=>x.includes('defaults are unknown'))));
test('a dropped policy cannot satisfy client access', () => assert.ok(auditSource(valid+'DROP POLICY owner_read ON public.example;').some(x=>x.includes('policy'))));
test('explicit serial-sequence access passes and a grant on another sequence cannot satisfy it', () => {
  const sequences={"public.example_id_seq":{anon:[],authenticated:[],service_role:["USAGE"]}};
  const declared=JSON.parse(declaration.split('data-api-access: ')[1]);
  declared.sequences=sequences;
  const body=valid.slice(declaration.length).replace('id uuid','id serial');
  const source='-- data-api-access: '+JSON.stringify(declared)+'\n'+body+
    'REVOKE ALL ON SEQUENCE public.example_id_seq FROM PUBLIC, anon, authenticated, service_role; GRANT USAGE ON SEQUENCE public.example_id_seq TO service_role;';
  assert.deepEqual(auditSource(source),[]);
  assert.ok(auditSource(source.replace('GRANT USAGE ON SEQUENCE public.example_id_seq','GRANT USAGE ON SEQUENCE public.other_id_seq')).some(x=>x.includes('USAGE')));
});
test('column grants do not silently masquerade as table-wide access', () => assert.ok(auditSource(valid.replace('GRANT SELECT ON TABLE','GRANT SELECT (id) ON TABLE')).some(x=>x.includes('authenticated SELECT'))));

test('broad client grants fail even in files with no CREATE TABLE', () => {
  for (const source of [
    'GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;',
    'GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;',
    'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC;',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;',
    'GRANT SELECT ON TABLE public.other TO anon;',
    'GRANT SELECT ON public.other TO PUBLIC;',
  ]) assert.ok(auditSource(source).length, source);
  assert.ok(auditSource(valid + 'GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;').length);
});

test('ONLY names are parsed as table names and preserve access contracts', () => {
  assert.deepEqual(auditSource(valid.replace('ON TABLE public.example', 'ON TABLE ONLY public.example')), []);
});

test('new public tables through SELECT INTO and SET SCHEMA fail closed', () => {
  assert.ok(auditSource('SELECT id INTO public.created_from_select FROM private.old;').length);
  assert.ok(auditSource('ALTER TABLE staging.q SET SCHEMA public;').length);
});

test('legacy table edits do not require retroactive declarations but new exposures fail', () => {
  const legacy = 'CREATE TABLE public.old(id uuid); GRANT SELECT ON public.old TO anon;';
  assert.deepEqual(auditChangedSource(legacy + ' ALTER TABLE public.old ADD COLUMN name text;', legacy), []);
  assert.ok(auditChangedSource(legacy + ' GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;', legacy).length);
  assert.ok(auditChangedSource(legacy + ' GRANT INSERT ON public.old TO PUBLIC;', legacy).length);
  assert.ok(auditChangedSource('CREATE TABLE public.new_table(id uuid);').length);
});

test('new tables added to existing files require the full access contract', () => {
  const legacy = 'CREATE TABLE public.old(id uuid); GRANT SELECT ON public.old TO anon;\n';
  assert.ok(auditChangedSource(legacy + create, legacy).some(x => x.includes('data-api-access')));
  assert.deepEqual(auditChangedSource(legacy + valid, legacy), []);
  assert.deepEqual(auditChangedSource(legacy + 'ALTER TABLE public.old ADD COLUMN name text;', legacy), []);
});

test('a new table is checked against grants and RLS anywhere in the complete file', () => {
  const legacy = 'CREATE TABLE public.old(id uuid);\n' + declaration + policy + reset + grants;
  assert.deepEqual(auditChangedSource(legacy + create, legacy), []);
  assert.ok(auditChangedSource(legacy + create.replace('ENABLE ROW LEVEL SECURITY', 'DISABLE ROW LEVEL SECURITY'), legacy).some(x => x.includes('RLS')));
});

test('recreating an old table requires explicit review and cannot reuse its old contract', () => {
  assert.ok(auditChangedSource(valid + 'DROP TABLE public.example; ' + create, valid).some(x => x.includes('recreation')));
  assert.deepEqual(auditChangedSource(valid + 'DROP TABLE public.example;', valid), []);
});

test('unchanged unsupported legacy declarations do not block unrelated edits', () => {
  const legacy = 'CREATE TABLE public."Legacy"(id uuid);';
  assert.deepEqual(auditChangedSource(legacy + ' ALTER TABLE public."Legacy" ADD COLUMN note text;', legacy), []);
  const withRls = legacy + ' ALTER TABLE public."Legacy" ENABLE ROW LEVEL SECURITY;\n';
  assert.ok(auditChangedSource(withRls + create, withRls).some(x => x.includes('data-api-access')));
  assert.deepEqual(auditChangedSource(withRls + valid, withRls), []);
  assert.throws(() => auditChangedSource(legacy + ' CREATE TABLE public."New"(id uuid);', legacy), /Mixed-case/);
});

test('valid multi-target and qualified-role grants cannot bypass exposure checks', () => {
  for (const sql of [
    'GRANT SELECT ON TABLE public.a, public.b TO anon;',
    'GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon GRANTED BY postgres;',
    'GRANT SELECT ON ALL TABLES IN SCHEMA public TO GROUP anon;',
    'ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO GROUP authenticated;',
    'SELECT 1 INTO "public".created;',
    'WITH x AS (SELECT 1) SELECT * INTO public.created FROM x;',
  ]) assert.ok(auditSource(sql).length, sql);
});
