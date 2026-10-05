import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSource } from './audit-table-grants.mjs';
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
