import { readFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ALL_CRON_MONITORS } from '../../backend/lib/cronMonitorRegistry.js';
import { blankStringsAndComments } from '../lib/js-source-scan.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE_MAP = JSON.parse(readFileSync(new URL('./cron-source-map.json', import.meta.url), 'utf8'));
const units = { minute: 60, hour: 3600, day: 86400 };
const stamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|\+00:00)$/.test(value) ? Date.parse(value) : NaN;

// Includes injected callback/initializer roots from the reviewed map. Loader/
// from syntax includes exports, require and literal dynamic imports. Unknown
// or unresolvable graphs always require proof for that job. Unmapped runtime
// files and common triggers widen to ALL.
// cron.js is a shared trigger, never a per-job traversal root.
export function affectedCronJobs(files, { monitors = ALL_CRON_MONITORS, map = SOURCE_MAP,
  read = path => readFileSync(resolve(ROOT, path), 'utf8'),
  exists = path => existsSync(resolve(ROOT, path)) && statSync(resolve(ROOT, path)).isFile() } = {}) {
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
  const unknown = new Set();
  const sources = new Map();
  for (const slug of all) {
    const seen = new Set();
    try {
      const visit = path => {
        if (seen.has(path) || map.commonSourcePaths.includes(path)) return;
        if (!exists(path)) { unknown.add(slug); return; }
        seen.add(path);
        if (!sources.has(path)) sources.set(path, read(path));
        const source = sources.get(path);
        const code = blankStringsAndComments(source);
        // The shared scanner blanks template expressions as well. Such a
        // loader cannot safely be narrowed, so explicitly widen instead.
        for (const template of source.matchAll(/`(?:\\[\s\S]|[^`\\])*`/g)) {
          if (template[0].includes('${') && /\b(?:import|require)\s*\(/.test(template[0])) unknown.add(slug);
        }
        // Nonliteral loaders cannot be resolved statically, so never narrow.
        if (/(?<![\w$-])(?:import|require)\s*\(\s*[^'"\s]/.test(code)) unknown.add(slug);
        for (const match of code.matchAll(/(?<![\w$-])(?:from\s*|import\s*|(?:import|require)\s*\(\s*)(['"])([^'"]*)\1/g)) {
          // Masking preserves offsets and quotes: recover only the literal
          // specifier, never a path mentioned in prose or another string.
          const start = match.index + match[0].indexOf(match[1]) + 1;
          const specifier = source.slice(start, start + match[2].length);
          if (!/^\.{1,2}\//.test(specifier)) continue;
          const base = posix.normalize(posix.join(posix.dirname(path), specifier));
          if (base.startsWith('../')) { unknown.add(slug); continue; }
          const target = [base, `${base}.js`, `${base}.ts`, `${base}/index.js`, `${base}/index.ts`].find(exists);
          if (target && /\.(?:js|mjs|cjs|ts)$/.test(target)) visit(target);
          else if (!target) unknown.add(slug);
          else seen.add(target); // declared JSON/data imports are impact edges too
        }
      };
      for (const path of map.sourcePathsBySlug[slug]) visit(path);
    } catch { unknown.add(slug); } // unresolved graph always requires this job's proof
    closures.set(slug, seen);
  }
  const runtime = [...changed].filter(path => !/^(?:docs\/|frontend\/|pr-screens\/|superpowers\/|\.claude\/|scripts\/|\.github\/)/.test(path)
    && !/^[^/]+\.md$/.test(path));
  if (runtime.some(path => ![...closures.values()].some(paths => paths.has(path)))) return all;
  return all.filter(slug => (runtime.length > 0 && unknown.has(slug))
    || [...changed].some(path => closures.get(slug).has(path)));
}

// An empty first page is returned as []: the caller must confirm emptiness
// against the target checkout before treating it as "no impact".
export async function changedFiles({ sha, repository, token, fetchFn }) {
  if (!/^[a-f0-9]{40}$/i.test(sha) || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !token) throw new Error('Missing GitHub evidence configuration');
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const response = await fetchFn(`https://api.github.com/repos/${repository}/commits/${sha}?per_page=100&page=${page}`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Changed-file GET failed (HTTP ${Number(response.status) || 'unknown'})`);
    const data = await response.json();
    if (data.sha !== sha || !Array.isArray(data.files)) throw new Error('Changed-file SHA/payload mismatch');
    files.push(...data.files);
    if (new Set(files.map(file => file.filename)).size !== files.length) throw new Error('Repeated changed-file page');
    if (data.files.length < 100) return files;
  }
  throw new Error('Changed-file list may be truncated');
}

// Railway impact for the target SHA. An empty API file list is only accepted
// when the checked-out commit itself is verifiably empty against its first
// parent (#6318 review): an empty commit deploys nothing and proves nothing.
export function deploymentImpact(files, { localChangedPaths, affected = affectedCronJobs } = {}) {
  if (Array.isArray(files) && files.length === 0) {
    if (!Array.isArray(localChangedPaths)) throw new Error('Empty changed-file evidence could not be confirmed locally');
    if (localChangedPaths.length > 0) throw new Error('Empty changed-file evidence disagrees with the target checkout');
    return { slugs: [], needRailway: false, empty: true };
  }
  const slugs = affected(files);
  const paths = files.flatMap(file => [file.filename, ...(file.status === 'renamed' ? [file.previous_filename] : [])]);
  return { slugs, needRailway: slugs.length > 0 || paths.some(path => path.startsWith('backend/')), empty: false };
}

// Railway keeps the previous process alive for drainingSeconds after the new
// deployment is READY; in-flight ticks there may still write check-ins. Proof
// must therefore start after boundary + drain (#6318 review).
export function railwayDrainSeconds(read = () => readFileSync(resolve(ROOT, 'backend/railway.json'), 'utf8')) {
  const value = JSON.parse(read())?.deploy?.drainingSeconds ?? 0;
  if (!Number.isSafeInteger(value) || value < 0 || value > 3600) throw new Error('Invalid Railway drainingSeconds');
  return value;
}

// Never print secrets: redact known secret values and cap the length.
export function safeReason(error, secrets = []) {
  // JSON parse errors quote fragments of the response body; never echo them.
  if (error?.name === 'SyntaxError') return 'SyntaxError: invalid JSON payload';
  let text = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
  for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 4) text = text.split(secret).join('[redacted]');
  return text.replace(/(Bearer\s+)\S+/gi, '$1[redacted]').replace(/[\r\n]+/g, ' ').slice(0, 300);
}

export const SHORT_CADENCE_SECONDS = 1800;

export function evaluateCheckins({ slugs, rows, since, now, monitors = ALL_CRON_MONITORS, excluded = new Set(), accepted = new Map(), drainSeconds = 0 }) {
  const ready = stamp(since), clock = stamp(now);
  if (!Number.isFinite(ready) || !Number.isFinite(clock) || clock < ready || !Array.isArray(rows)
    || !Number.isSafeInteger(drainSeconds) || drainSeconds < 0) throw new Error('Invalid heartbeat evidence');
  const boundary = ready + drainSeconds * 1000;
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
    // A partial prime may initially look unique. Revoke cached evidence if a
    // later snapshot reveals that its timestamp belongs to a boot cohort.
    if (accepted.has(slug) && excluded.has(stamp(accepted.get(slug).lastCheckin))) accepted.delete(slug);
    let state;
    if (!row || !Number.isFinite(time) || time > clock || row.expected_cadence_seconds !== cadence
      || clock - time > (cadence + margin) * 1000) state = 'failed';
    else if (accepted.has(slug)) state = 'verified';
    else if (time > boundary && time <= deadline && !excluded.has(time)) state = 'verified';
    else if (clock >= deadline) state = 'failed';
    else state = cadence > SHORT_CADENCE_SECONDS ? 'deferred' : 'waiting';
    const lastCheckin = state === 'verified' && accepted.has(slug) ? accepted.get(slug).lastCheckin
      : Number.isFinite(time) ? new Date(time).toISOString() : 'missing/unreadable';
    return { slug, state, lastCheckin, deadline: new Date(deadline).toISOString() };
  });
  const state = jobs.some(job => job.state === 'failed') ? 'failed' : jobs.some(job => job.state === 'waiting') ? 'waiting' : jobs.some(job => job.state === 'deferred') ? 'deferred' : 'verified';
  return { state, jobs };
}

// Names the jobs still waiting for a check-in and the latest deadline among
// them; empty when nothing is waiting. Output only, never part of the proof.
export function waitingSummary(jobs) {
  const waiting = jobs.filter(job => job.state === 'waiting' && job.deadline);
  if (!waiting.length) return '';
  const latest = waiting.map(job => job.deadline).sort().at(-1);
  return `Waiting for check-in from ${waiting.map(job => job.slug).join(', ')}; latest deadline ${latest}`;
}

export async function verifyCronCheckins({ slugs, since, url, key, now, sleep, fetchFn, log = () => {}, monitors = ALL_CRON_MONITORS, drainSeconds = 0 }) {
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
  // Filter to registry slugs with a stable order (#6318 review): stale or
  // foreign rows can never push an affected row past the limit. Sibling
  // registry rows stay in the snapshot on purpose: boot-prime cohorts are only
  // recognisable across jobs, including when a single job is affected.
  const registrySlugs = monitors.map(([slug]) => slug);
  if (registrySlugs.some(slug => !/^[a-z0-9][a-z0-9_-]*$/.test(slug))) throw new Error('Invalid registry slug');
  endpoint.searchParams.set('select', 'job_slug,last_checkin_at,expected_cadence_seconds');
  endpoint.searchParams.set('job_slug', `in.(${registrySlugs.join(',')})`);
  endpoint.searchParams.set('order', 'job_slug.asc');
  endpoint.searchParams.set('limit', String(registrySlugs.length + 1));
  const excluded = new Set();
  const accepted = new Map();
  const lastLogged = new Map();
  let initial = true;
  let lastSummary = '';
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
      result = evaluateCheckins({ slugs, rows, since, now: now(), monitors, excluded, accepted, drainSeconds });
      for (const job of result.jobs) if (job.state === 'verified') accepted.set(job.slug, job);
    } catch {
      result = { state: 'failed', jobs: slugs.map(slug => ({ slug, state: 'failed', lastCheckin: 'unreadable' })) };
    }
    for (const job of result.jobs) {
      const line = `${job.slug}: ${job.state}; last check-in=${job.lastCheckin}; deadline=${job.deadline ?? 'unknown'}`;
      if (lastLogged.get(job.slug) !== line || result.state !== 'waiting') log(line);
      lastLogged.set(job.slug, line);
    }
    // #6318: one readable line naming what the run is waiting for (and until
    // when) instead of only per-job rows; printed once per change.
    const summary = waitingSummary(result.jobs);
    if (summary && summary !== lastSummary) log(summary);
    lastSummary = summary;
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
    // Only consulted for an empty API list; needs the full-history checkout.
    const localChangedPaths = () => {
      const parent = execFileSync('git', ['-C', ROOT, 'rev-parse', `${sha}^1`], { encoding: 'utf8' }).trim();
      return execFileSync('git', ['-C', ROOT, 'diff', '--name-only', '--no-renames', '-z', parent, sha, '--'], { encoding: 'utf8' })
        .split('\0').filter(Boolean);
    };
    const impact = deploymentImpact(files, { localChangedPaths: files.length === 0 ? localChangedPaths() : undefined });
    if (impact.empty) console.log('Empty commit: no changed files, no Railway deploy and no affected cron jobs.');
    output('affected_slugs', JSON.stringify(impact.slugs));
    output('need_railway', impact.needRailway ? 'true' : 'false');
    console.log(`Affected cron jobs: ${impact.slugs.length}; Railway required: ${impact.needRailway}`);
    return;
  }
  const slugs = JSON.parse(process.env.AFFECTED_SLUGS);
  if (process.argv.includes('--dry-run')) {
    console.log('Dry-run: no heartbeat request or mutation; not verified');
    return;
  }
  const result = await verifyCronCheckins({ slugs, since: process.env.CRON_SINCE, url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_KEY, now: () => new Date().toISOString(), drainSeconds: railwayDrainSeconds(),
    sleep: ms => new Promise(done => setTimeout(done, ms)), fetchFn: fetch, log: console.log });
  output('state', result.state);
  if (result.state === 'deferred') {
    const waiting = result.jobs.filter(job => job.state === 'deferred').map(job => job.slug);
    console.log(`AFVENTER CHECK-IN (non-blocking): ${waiting.join(', ')}. Short cadences (<= 30 min) are verified; long cadences are covered by the cron heartbeat watchdog.`);
  }
  if (result.state === 'failed') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const reason = safeReason(error, [process.env.SUPABASE_SERVICE_KEY, process.env.GH_TOKEN]);
    console.error(`Cron deploy proof failed (${reason}); no verification claimed`);
    process.exitCode = 1;
  });
}
