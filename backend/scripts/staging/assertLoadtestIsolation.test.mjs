import test from 'node:test';
import assert from 'node:assert/strict';
import { assertIsolation, checkEnv, DB_PROBES, STAGING_REF, PROD_REF } from './assertLoadtestIsolation.mjs';

const ORIGIN = `https://${STAGING_REF}.supabase.co`;
const GOOD_ENV = { SUPABASE_URL: ORIGIN, SUPABASE_SERVICE_KEY: 'k', CZ_TARGET_ENV: 'loadtest-staging' };

function fakeFetch(counts) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    const table = new URL(url).pathname.split('/').pop();
    const n = counts[table] ?? 0;
    return { ok: true, status: 200, headers: { get: () => `*/${n}` } };
  };
  return { impl, calls };
}

test('checkEnv: rent staging-miljoe giver ingen blockers', () => {
  assert.deepEqual(checkEnv(GOOD_ENV), []);
});

test('checkEnv: prod-URL, manglende maal og sideeffekt-noegler blokerer (kun navne rapporteres)', () => {
  const b = checkEnv({
    SUPABASE_URL: `https://${PROD_REF}.supabase.co`, SUPABASE_SERVICE_KEY: 'k',
    RESEND_API_KEY: 'secret-value', DISCORD_OPS_WEBHOOK_URL: 'https://x', ALUNTA_API_TOKEN: 't', EMPTY_IS_OK: '',
  });
  assert.ok(b.includes('ENV_SUPABASE_URL_NOT_STAGING'));
  assert.ok(b.includes('ENV_SUPABASE_URL_MENTIONS_PROD'));
  assert.ok(b.includes('ENV_TARGET_NOT_LOADTEST_STAGING'));
  assert.ok(b.includes('ENV_SIDE_EFFECT_KEY_PRESENT:RESEND_API_KEY'));
  assert.ok(b.includes('ENV_SIDE_EFFECT_KEY_PRESENT:DISCORD_OPS_WEBHOOK_URL'));
  assert.ok(b.includes('ENV_SIDE_EFFECT_KEY_PRESENT:ALUNTA_API_TOKEN'));
  assert.ok(!b.join(' ').includes('secret-value'));
});

test('assertIsolation: miljoe-fejl sender intet over netvaerket', async () => {
  const f = fakeFetch({});
  const r = await assertIsolation({ ...GOOD_ENV, DISCORD_BOT_TOKEN: 'x' }, f.impl);
  assert.equal(r.status, 'BLOCKED');
  assert.equal(f.calls.length, 0);
});

test('assertIsolation: renset DB med markoer = ISOLATED; kun HEAD mod staging-origin', async () => {
  const f = fakeFetch({ app_config: 1 });
  const r = await assertIsolation(GOOD_ENV, f.impl);
  assert.deepEqual(r, { status: 'ISOLATED', stagingRef: STAGING_REF, blockers: [] });
  assert.equal(f.calls.length, DB_PROBES.length);
  for (const c of f.calls) {
    assert.ok(c.url.startsWith(`${ORIGIN}/rest/v1/`));
    assert.equal(c.init.method, 'HEAD');
    assert.equal(c.init.redirect, 'error');
  }
});

test('assertIsolation: DB-gemte webhooks og manglende markoer blokerer', async () => {
  const f = fakeFetch({ discord_settings: 20, app_config: 0 });
  const r = await assertIsolation(GOOD_ENV, f.impl);
  assert.equal(r.status, 'BLOCKED');
  assert.ok(r.blockers.includes('DB_DISCORD_WEBHOOKS_PRESENT'));
  assert.ok(r.blockers.includes('DB_ENV_MARKER_MISSING'));
});

test('markoer-proben kraever praecis vaerdien loadtest-staging, ikke blot noeglen', async () => {
  const f = fakeFetch({ app_config: 1 });
  await assertIsolation(GOOD_ENV, f.impl);
  const marker = f.calls.map(c => new URL(c.url)).find(u => u.pathname.endsWith('/app_config'));
  assert.equal(marker.searchParams.get('key'), 'eq.cz_environment');
  assert.equal(marker.searchParams.get('value'), 'eq."loadtest-staging"');
});

test('assertIsolation: netvaerksfejl og ukendt count er blockers, ikke en pass', async () => {
  const r1 = await assertIsolation(GOOD_ENV, async () => { throw new Error('boom https://x?apikey=k'); });
  assert.equal(r1.status, 'BLOCKED');
  assert.ok(r1.blockers.every(b => b.endsWith(':REQUEST_FAILED')));
  assert.ok(!JSON.stringify(r1).includes('apikey'));
  const r2 = await assertIsolation(GOOD_ENV, async () => ({ ok: true, status: 200, headers: { get: () => null } }));
  assert.ok(r2.blockers.every(b => b.endsWith(':COUNT_UNKNOWN')));
});
