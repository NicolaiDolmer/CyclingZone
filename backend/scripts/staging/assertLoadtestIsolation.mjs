// #5904 · Fail-closed isolationstjek foer en backend-proces maa koere mod load-test-staging.
//
// Koeres af scripts/staging/with-loadtest-staging.ps1 FOER selve kommandoen. Exit 0 kun hvis:
//   1) SUPABASE_URL er praecis staging-origin og ingen DB/URL-variabel naevner prod-ref'en
//   2) INGEN udgaaende kanal-noegle findes i miljoeet (Resend, Discord, Alunta/betaling,
//      Sentry, LLM, ops-webhooks) - fravaer er den haandhaevede tilstand, ikke et flag
//   3) staging-DB'en selv er renset: 0 DB-gemte Discord-webhooks, tomme outbox-tabeller,
//      ingen ikke-syntetiske e-mails i public.users, og miljoe-markoeren
//      app_config.cz_environment = "loadtest-staging" findes (en prod-DB har den aldrig)
// Printer kun faste koder - aldrig vaerdier, URL'er med noegler eller raa serverfejl.
import { pathToFileURL } from 'node:url';

export const STAGING_REF = 'pywxpnynzmbukdvoiazp';
export const PROD_REF = 'ghwvkxzhsbbltzfnuhhz';
const ORIGIN = `https://${STAGING_REF}.supabase.co`;
const TIMEOUT_MS = 15_000;

// Navne-moenstre for udgaaende sideeffekter. Matcher noeglens NAVN, aldrig vaerdien.
export const FORBIDDEN_ENV = /^(RESEND_|DISCORD_|ALUNTA_|STRIPE_|SENTRY_DSN$|ANTHROPIC_|OPENAI_|EMAIL_REPLY_FORWARD_TO$|SMTP_|POSTHOG_|SLACK_|TWILIO_|VAPID_)/;
const DB_URL_VARS = ['SUPABASE_URL', 'SUPABASE_DB_URL', 'DATABASE_URL', 'STAGING_DB_URL', 'STAGING_SUPABASE_URL'];

export function checkEnv(env) {
  const blockers = [];
  if (env.SUPABASE_URL !== ORIGIN) blockers.push('ENV_SUPABASE_URL_NOT_STAGING');
  if (!env.SUPABASE_SERVICE_KEY) blockers.push('ENV_SERVICE_KEY_MISSING');
  for (const k of DB_URL_VARS) if (env[k] && String(env[k]).includes(PROD_REF)) blockers.push(`ENV_${k}_MENTIONS_PROD`);
  if (env.CZ_TARGET_ENV !== 'loadtest-staging') blockers.push('ENV_TARGET_NOT_LOADTEST_STAGING');
  const forbidden = Object.keys(env).filter(k => FORBIDDEN_ENV.test(k) && String(env[k] ?? '').length > 0).sort();
  for (const k of forbidden) blockers.push(`ENV_SIDE_EFFECT_KEY_PRESENT:${k}`);
  return blockers;
}

// [kode, tabel, select, ekstra-filtre, forventet count]
export const DB_PROBES = [
  ['DB_DISCORD_WEBHOOKS_PRESENT', 'discord_settings', 'id', {}, 0],
  ['DB_DISCORD_OUTBOX_NOT_EMPTY', 'discord_webhook_outbox', 'id', {}, 0],
  ['DB_RACE_NOTIFY_OUTBOX_NOT_EMPTY', 'race_notify_outbox', 'id', {}, 0],
  ['DB_DM_OUTBOX_NOT_EMPTY', 'discord_dm_outbox', 'id', {}, 0],
  ['DB_REAL_EMAILS_IN_USERS', 'users', 'id', { email: 'not.like.*@loadtest.invalid' }, 0],
  ['DB_DISCORD_IDS_IN_USERS', 'users', 'id', { discord_id: 'not.is.null' }, 0],
  // PostgREST caster filterværdien til kolonnens type (jsonb), så værdien skal matche præcist.
  ['DB_ENV_MARKER_MISSING', 'app_config', 'key', { key: 'eq.cz_environment', value: 'eq."loadtest-staging"' }, 1],
];

export async function checkDb(env, fetchImpl = fetch) {
  const blockers = [];
  for (const [code, table, select, filters, expected] of DB_PROBES) {
    const url = new URL(`/rest/v1/${table}`, ORIGIN);
    url.searchParams.set('select', select);
    url.searchParams.set('limit', '0');
    for (const [k, v] of Object.entries(filters)) url.searchParams.set(k, v);
    try {
      const res = await fetchImpl(url, {
        method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, Prefer: 'count=exact' },
      });
      if (!res.ok) { blockers.push(`${code}:HTTP_${res.status}`); continue; }
      const m = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '');
      if (!m) { blockers.push(`${code}:COUNT_UNKNOWN`); continue; }
      if (Number(m[1]) !== expected) blockers.push(code);
    } catch {
      blockers.push(`${code}:REQUEST_FAILED`);
    }
  }
  return blockers;
}

export async function assertIsolation(env = process.env, fetchImpl = fetch) {
  const envBlockers = checkEnv(env);
  // Uden et sikkert miljoe sendes INGEN noegle over netvaerket.
  if (envBlockers.length) return { status: 'BLOCKED', stagingRef: STAGING_REF, blockers: envBlockers };
  const dbBlockers = await checkDb(env, fetchImpl);
  return { status: dbBlockers.length ? 'BLOCKED' : 'ISOLATED', stagingRef: STAGING_REF, blockers: dbBlockers };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await assertIsolation();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === 'ISOLATED' ? 0 : 1;
}
