import assert from 'node:assert/strict';
import test from 'node:test';
import { findFunctionSettings } from './lint-migration-function-settings.mjs';

test('flags a custom setting in a function header (#8668)', () => {
  const sql = `CREATE OR REPLACE FUNCTION public.f() RETURNS void
LANGUAGE plpgsql
SET search_path = ''
SET cyclingzone.season_squad_promotion = 'on'
AS $$ BEGIN NULL; END $$;`;
  const findings = findFunctionSettings(sql);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].setting, 'cyclingzone.season_squad_promotion');
  assert.equal(findings[0].line, 4);
});

test('flags ALTER FUNCTION/ROLE/DATABASE ... SET custom TO', () => {
  assert.equal(findFunctionSettings(`ALTER FUNCTION public.f() SET app.x TO 'y';`).length, 1);
  assert.equal(findFunctionSettings(`ALTER ROLE authenticator SET app.jwt = 'x';`).length, 1);
  assert.equal(findFunctionSettings(`ALTER DATABASE postgres SET "app"."x" = '1';`).length, 1);
});

test('flags SET ... FROM CURRENT and survives an earlier E-string', () => {
  assert.equal(findFunctionSettings(`ALTER FUNCTION public.f() SET cyclingzone.x FROM CURRENT;`).length, 1);
  const sql = `COMMENT ON TABLE public.t IS E'it\\'s fine';
CREATE FUNCTION public.g() RETURNS void LANGUAGE sql SET cyclingzone.y = 'on' AS $$ SELECT 1 $$;`;
  assert.equal(findFunctionSettings(sql).length, 1);
});

test('allows built-in settings, body set_config and session SET', () => {
  const sql = `SET lock_timeout = '3s';
SET cyclingzone.session_only = 'on';
CREATE OR REPLACE FUNCTION public.f() RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM set_config('cyclingzone.x', 'on', true);
  -- SET cyclingzone.y = 'on'
END $$;
ALTER FUNCTION public.f() SET search_path = '';
UPDATE public.riders SET squad = 'senior' WHERE id IS NULL;`;
  assert.deepEqual(findFunctionSettings(sql), []);
});

test('ignores the pattern inside comments and strings', () => {
  const sql = `-- CREATE FUNCTION g() SET a.b = 1
COMMENT ON FUNCTION public.f() IS 'CREATE FUNCTION SET a.b = 1';
/* ALTER ROLE x SET a.b = 1; */`;
  assert.deepEqual(findFunctionSettings(sql), []);
});
