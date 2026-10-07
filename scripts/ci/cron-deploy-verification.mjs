import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ALL_CRON_MONITORS } from '../../backend/lib/cronMonitorRegistry.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE_MAP = JSON.parse(readFileSync(new URL('./cron-source-map.json', import.meta.url), 'utf8'));
const units = { minute: 60, hour: 3600, day: 86400 };
const stamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|\+00:00)$/.test(value) ? Date.parse(value) : NaN;

// Includes injected callback/initializer roots from the reviewed map. Relative
// string references deliberately overapproximate imports (also covers exports,
// require and literal dynamic imports). Unknown/unresolvable graphs widen to ALL.
// cron.js is a shared trigger, never a per-job traversal root.
export function affectedCronJobs(files, { monitors = ALL_CRON_MONITORS, map = SOURCE_MAP,
  read = path => readFileSync(resolve(ROOT, path), 'utf8'),
  exists = path => existsSync(resolve(ROOT, path)) } = {}) {
  const all = monitors.map(([slug]) => slug);
  if (!Array.isArray(files) || files.length === 0 || files.length >= 3000) throw new Error('Unknown changed-file evidence');
  if (Object.keys(map.sourcePathsBySlug).sort().join() !== [...all].sort().join()) throw new Error('Cron source map does not cover registry');
  const changed = new Set();
  for (const file of files) {
    if (!file || typeof file.filename !== 'string' || !['added', 'modified', 'removed', 'renamed', 'changed', 'copied'].includes(file.status)) throw new Error('Invalid changed-file evidence');
    for (const path of [file.filename, ...(file.status === 'renamed' ? [file.previous_filename] : [])]) {
      if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) throw new Error('Invalid changed-file path');
      changed.add(path);
    }
  }
  if ([...changed].some(path => map.commonSourcePaths.includes(path) || path.startsWith('database/'))) return all;
  const closures = new Map();
  try {
    for (const slug of all) {
      const seen = new Set();
      const visit = path => {
        if (seen.has(path) || map.commonSourcePaths.includes(path)) return;
        if (!exists(path)) throw new Error('Missing source root');
        seen.add(path);
        const source = read(path);
        // Nonliteral loaders cannot be resolved statically, so never narrow.
        if (/\b(?:import|require)\s*\(\s*[^'"\s]/.test(source)) throw new Error('Unknown dynamic dependency');
        for (const match of source.matchAll(/(['"])(\.{1,2}\/[^'"\r\n]+)\1/g)) {
          const base = posix.normalize(posix.join(posix.dirname(path), match[2]));
          if (base.startsWith('../')) throw new Error('Source outside repository');
          const target = [base, `${base}.js`, `${base}.ts`, `${base}/index.js`, `${base}/index.ts`].find(exists);
          if (target && /\.(?:js|mjs|cjs|ts)$/.test(target)) visit(target);
          else if (!target) throw new Error('Missing dependency');
        }
      };
      for (const path of map.sourcePathsBySlug[slug]) visit(path);
      closures.set(slug, seen);
    }
  } catch { return all; } // conservative all-job proof, never an empty impact
  const runtime = [...changed].filter(path => !/^(?:docs\/|frontend\/|pr-screens\/|superpowers\/|\.claude\/|scripts\/|\.github\/)/.test(path)
    && !/^[^/]+\.md$/.test(path));
  if (runtime.some(path => ![...closures.values()].some(paths => paths.has(path)))) return all;
  return all.filter(slug => [...changed].some(path => closures.get(slug).has(path)));
}

export async function changedFiles({ sha, repository, token, fetchFn }) {
  if (!/^[a-f0-9]{40}$/i.test(sha) || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !token) throw new Error('Missing GitHub evidence configuration');
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const response = await fetchFn(`https://api.github.com/repos/${repository}/commits/${sha}?per_page=100&page=${page}`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Changed-file GET failed');
    const data = await response.json();
    if (data.sha !== sha || !Array.isArray(data.files)) throw new Error('Changed-file SHA/payload mismatch');
    files.push(...data.files);
    if (new Set(files.map(file => file.filename)).size !== files.length) throw new Error('Repeated changed-file page');
    if (data.files.length < 100) {
      if (!files.length) throw new Error('Empty changed-file evidence');
      return files;
    }
  }
  throw new Error('Changed-file list may be truncated');
}

export function evaluateCheckins({ slugs, rows, since, now, monitors = ALL_CRON_MONITORS, excluded = new Set() }) {
  const boundary = stamp(since), clock = stamp(now);
  if (!Number.isFinite(boundary) || !Number.isFinite(clock) || clock < boundary || !Array.isArray(rows)) throw new Error('Invalid heartbeat evidence');
  const configs = new Map(monitors);
  const bySlug = new Map();
  const cohort = new Map();
  for (const row of rows) {
    if (!configs.has(row?.job_slug)) continue;
    if (bySlug.has(row.job_slug)) throw new Error('Duplicate heartbeat');
    bySlug.set(row.job_slug, row);
    const time = stamp(row.last_checkin_at);
    if (Number.isFinite(time)) cohort.set(time, (cohort.get(time) ?? 0) + 1);
  }
  // Boot priming writes one shared timestamp across jobs. Remember observed
  // cohorts across polls, even once later ticks overwrite some of those rows.
  for (const [time, count] of cohort) if (count > 1) excluded.add(time);
  const jobs = slugs.map(slug => {
    const config = configs.get(slug);
    if (!config) throw new Error('Unknown affected cron');
    const cadence = config.schedule.value * units[config.schedule.unit];
    const margin = (config.checkinMargin ?? 0) * 60;
    if (!(cadence > 0) || !(margin >= 0)) throw new Error('Invalid registry cadence');
    const row = bySlug.get(slug), time = stamp(row?.last_checkin_at);
    const deadline = boundary + (cadence + margin) * 1000;
    let state;
    if (!row || !Number.isFinite(time) || time > clock || row.expected_cadence_seconds !== cadence
      || clock - time > (cadence + margin) * 1000) state = 'failed';
    else if (time > boundary && time <= deadline && !excluded.has(time)) state = 'verified';
    else if (clock >= deadline) state = 'failed';
    else state = cadence > 1800 ? 'deferred' : 'waiting';
    return { slug, state, lastCheckin: Number.isFinite(time) ? new Date(time).toISOString() : 'missing/unreadable', deadline: new Date(deadline).toISOString() };
  });
  const state = jobs.some(job => job.state === 'failed') ? 'failed' : jobs.some(job => job.state === 'waiting') ? 'waiting' : jobs.some(job => job.state === 'deferred') ? 'deferred' : 'verified';
  return { state, jobs };
}

export async function verifyCronCheckins({ slugs, since, url, key, now, sleep, fetchFn, log = () => {}, monitors = ALL_CRON_MONITORS }) {
  if (!Array.isArray(slugs) || new Set(slugs).size !== slugs.length) throw new Error('Invalid affected cron list');
  if (slugs.length === 0) return { state: 'verified', jobs: [] };
  let endpoint;
  try {
    endpoint = new URL('/rest/v1/cron_checkins', url);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || !key) throw new Error('Missing heartbeat read configuration');
  } catch {
    // Fail closed with per-job diagnostics, never echo secret configuration.
    const jobs = slugs.map(slug => ({ slug, state: 'failed', lastCheckin: 'unreadable' }));
    for (const job of jobs) log(`${job.slug}: failed; last check-in=unreadable; deadline=unknown`);
    return { state: 'failed', jobs };
  }
  endpoint.searchParams.set('select', 'job_slug,last_checkin_at,expected_cadence_seconds');
  endpoint.searchParams.set('limit', String(monitors.length + 1));
  const excluded = new Set();
  let initial = true;
  for (;;) {
    let result;
    try {
      const response = await fetchFn(endpoint, { method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Heartbeat GET failed');
      const rows = await response.json();
      // A first snapshot may be a partially completed boot-prime cohort. It
      // never proves a tick; every affected row must advance after observation.
      if (initial && Array.isArray(rows)) {
        for (const row of rows) if (Number.isFinite(stamp(row?.last_checkin_at))) excluded.add(stamp(row.last_checkin_at));
        initial = false;
      }
      result = evaluateCheckins({ slugs, rows, since, now: now(), monitors, excluded });
    } catch {
      result = { state: 'failed', jobs: slugs.map(slug => ({ slug, state: 'failed', lastCheckin: 'unreadable' })) };
    }
    for (const job of result.jobs) log(`${job.slug}: ${job.state}; last check-in=${job.lastCheckin}; deadline=${job.deadline ?? 'unknown'}`);
    if (result.state !== 'waiting') return result;
    await sleep(15000);
  }
}

async function main() {
  const output = (name, value) => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
    else console.log(`${name}=${value}`);
  };
  if (process.argv.includes('--impact')) {
    const sha = process.env.SHA;
    const head = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (head !== sha) throw new Error('Checkout does not match target SHA');
    const files = await changedFiles({ sha, repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN, fetchFn: fetch });
    const slugs = affectedCronJobs(files);
    output('affected_slugs', JSON.stringify(slugs));
    const paths = files.flatMap(file => [file.filename, ...(file.status === 'renamed' ? [file.previous_filename] : [])]);
    output('need_railway', slugs.length > 0 || paths.some(path => path.startsWith('backend/')) ? 'true' : 'false');
    output('need_vercel', paths.some(path => path.startsWith('frontend/')) ? 'true' : 'false');
    return;
  }
  const slugs = JSON.parse(process.env.AFFECTED_SLUGS);
  if (process.argv.includes('--dry-run')) {
    console.log('Dry-run: no heartbeat request or mutation; not verified');
    return;
  }
  const result = await verifyCronCheckins({ slugs, since: process.env.CRON_SINCE, url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_KEY, now: () => new Date().toISOString(),
    sleep: ms => new Promise(done => setTimeout(done, ms)), fetchFn: fetch, log: console.log });
  output('state', result.state);
  if (result.state === 'failed') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Cron deploy proof failed: evidence/configuration unreadable; no verification claimed'); process.exitCode = 1; });
}
