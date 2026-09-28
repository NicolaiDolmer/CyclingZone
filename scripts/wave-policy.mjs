#!/usr/bin/env node
// Shared admission for both runtimes. Files are coordination state, not a lease.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { admissionOwnerProcess, assertWaveOwnership, ownershipSnapshot } from './wave-ownership.mjs';
import { measureBootIdentity, sameBoot } from './wave-boot-identity.mjs';

export const REPO = 'NicolaiDolmer/CyclingZone';
const reserved = ['docs/now.md', '.claude/run', '.claude/launch.json'];
const normalize = p => p.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
const slugOf = branch => branch.replaceAll('/', '-').toLowerCase();
// #5562: rullende optag - maks saa mange spor kan staa i koe til en koerende boelge.
export const MAX_PENDING_TRACKS = 12;

// Ownership as a prefix (#5562 rule 3). Shared by admission (validateTracks),
// rolling intake (enqueue) and the merge gate, so the three can never disagree.
// A directory or a glob that stops at a '/' is a CLOSED prefix: it covers
// itself and its descendants. A glob that stops mid-segment ('scripts/wave-*.mjs'
// -> 'scripts/wave-') is OPEN: it covers every path that starts with the same
// string. Before #5562 the open case was treated as closed and missed
// 'scripts/wave-policy.mjs'.
export function ownershipPrefix(raw) {
  if (typeof raw !== 'string') throw Error('Invalid ownership path');
  const p = normalize(raw);
  if (!p || p.startsWith('/') || p.includes(':') || p.split('/').some(s => ['.', '..', ''].includes(s))) throw Error('Invalid ownership path');
  const head = p.split('*')[0];
  const prefix = head.replace(/\/$/, '');
  if (!prefix) throw Error('Ownership path too broad');
  return { prefix, open: p.includes('*') && !head.endsWith('/') };
}

const covers = (x, y) => x.open ? y.prefix.startsWith(x.prefix) : (y.prefix === x.prefix || y.prefix.startsWith(x.prefix + '/'));

// Conservative and symmetric: two entries overlap if either could contain the other.
export function ownershipOverlaps(a, b) {
  const x = typeof a === 'string' ? ownershipPrefix(a) : a;
  const y = typeof b === 'string' ? ownershipPrefix(b) : b;
  return covers(x, y) || covers(y, x);
}

export function validateTracks(tracks) {
  if (!Array.isArray(tracks) || !tracks.length || tracks.length > 12) throw Error('Expected 1-12 tracks');
  const issues = new Set(), branches = new Set(), slugs = new Set(), files = [];
  for (const t of tracks) {
    if (!Number.isSafeInteger(t.issue) || t.issue < 1) throw Error('Invalid issue');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]+$/.test(t.branch || '') || t.branch.includes('//')) throw Error('Invalid branch');
    const slug = slugOf(t.branch);
    if (issues.has(t.issue) || branches.has(t.branch) || slugs.has(slug)) throw Error('duplicate issue, branch or worktree slug');
    issues.add(t.issue); branches.add(t.branch); slugs.add(slug);
    if (!Array.isArray(t.ownership) || !t.ownership.length) throw Error('Explicit ownership required');
    for (const raw of t.ownership) {
      // Directory/glob prefixes conservatively conflict with descendants.
      const own = ownershipPrefix(raw);
      if (reserved.some(r => ownershipOverlaps(own, { prefix: r, open: false }))) throw Error(`reserved ownership: ${raw}`);
      for (const f of files) {
        if (f.issue !== t.issue && ownershipOverlaps(own, f.own)) throw Error(`ownership overlap: ${raw}`);
      }
      files.push({ issue: t.issue, own });
    }
  }
  if (tracks.filter(t => t.tier === 'FULL').length > 1) throw Error('Only one FULL verification track');
  return tracks;
}

// The wave's ACTIVE set (#5562): admitted/intaken tracks minus finished
// branches, plus tracks waiting in the queue. Anything malformed fails closed:
// the merge gate must never read a broken marker as "nothing is owned".
export function activeTracks(wave) {
  if (!Array.isArray(wave?.tracks)) throw Error('Wave marker has no track ownership; merge blocked');
  if (wave.pendingTracks !== undefined && !Array.isArray(wave.pendingTracks)) throw Error('Wave marker has malformed pendingTracks; merge blocked');
  if (wave.finishedBranches !== undefined && !Array.isArray(wave.finishedBranches)) throw Error('Wave marker has malformed finishedBranches; merge blocked');
  const finished = new Set(wave.finishedBranches || []);
  const active = [...wave.tracks.filter(t => !finished.has(t?.branch)), ...(wave.pendingTracks || [])];
  for (const t of active) {
    if (!t || !Array.isArray(t.ownership) || !t.ownership.length) throw Error('Wave marker has a track without ownership; merge blocked');
  }
  return active;
}

// New tracks against the running wave: no duplicate issue/branch/slug, no
// ownership overlap (same helper as admission), and still max ONE FULL.
export function assertCompatibleWithActive(active, incoming) {
  const issues = new Set(active.map(t => t.issue));
  const branches = new Set(active.map(t => t.branch));
  const slugs = new Set(active.map(t => slugOf(String(t.branch))));
  for (const t of incoming) {
    if (issues.has(t.issue) || branches.has(t.branch) || slugs.has(slugOf(t.branch))) throw Error(`duplicate issue, branch or worktree slug in the running wave: #${t.issue}`);
    for (const raw of t.ownership) {
      for (const a of active) {
        const hit = a.ownership.find(other => ownershipOverlaps(raw, other));
        if (hit !== undefined) throw Error(`ownership overlap with running #${a.issue}: ${raw} vs ${hit}`);
      }
    }
  }
  if ([...active, ...incoming].filter(t => t.tier === 'FULL').length > 1) throw Error('Only one FULL verification track');
}

// Ejer-beslutning 22/9 (variant B, #5510): PR-loftet paa 8 er fjernet helt.
// Optaellingen bevares som info til planen (lanerne (4) og
// verifikations-semaforen (2) er fortsat bremsen). Fail-closed bevares: en
// uhentbar PR-liste maa aldrig stiltiende tillade en boelge - en GitHub-fejl
// skal opdages, ikke maskeres som "ingen aabne PR'er".
export function checkCapacity(prs, tracks) {
  if (!Array.isArray(prs)) throw Error('PR count unavailable');
  const branches = new Set(prs.map(p => p.headRefName));
  const additional = tracks.filter(t => t.kind !== 'investigate' && !branches.has(t.branch)).length;
  const projected = prs.length + additional;
  return { open: prs.length, additional, projected };
}

export function getOpenPrs() {
  return JSON.parse(execFileSync('gh', ['pr', 'list', '--repo', REPO, '--state', 'open', '--limit', '1000', '--json', 'number,headRefName,isDraft,url'], { encoding: 'utf8', timeout: 30000 }));
}

export function sharedRunDir(cwd) {
  const common = execFileSync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
  return path.join(path.dirname(common), '.claude', 'run');
}

export function readWave(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'wave-active.json'), 'utf8'));
}

let cachedBootIdentity;
function hostBootIdentity() {
  if (!cachedBootIdentity?.bootId) cachedBootIdentity = measureBootIdentity();
  return cachedBootIdentity;
}

// Normalized (#5533): raw Windows ticks drift within one boot.
export function hostBootId() {
  return hostBootIdentity().bootId;
}

// #5562: merges may now hold the state lock DURING a wave (the merge call and
// its gh retries). Default callers still give up after ~5 s; the writers a
// running wave depends on wait long enough to outlast one merge. The hook's
// first-dispatch write stays inside the 90 s hook timeout.
export const LONG_LOCK_ATTEMPTS = 2400; // ~120 s: intake, enqueue, release, watch CLI (#5602)
export const HOOK_LOCK_ATTEMPTS = 1200; // ~60 s: first dispatch and the PostToolUse run binding (#5602)

// Keyed on a clock-independent boot identity (#5533), so every process in
// one boot shares the lock even across a clock correction. Shared with
// acquireMergeLock (#5677) so the merge gate's own fallback attempt locks
// the SAME directory as every other caller - never a second, divergent lock.
function waveLockPath(dir) {
  const lockKey = hostBootIdentity().lockKey;
  if (!lockKey) throw Error('Cannot identify host boot for wave state lock');
  const key = createHash('sha256').update(lockKey).digest('hex').slice(0, 16);
  return path.join(dir, `wave-state-${key}.lock`);
}

export function withWaveStateLock(dir, action, attempts = 100) {
  const lock = waveLockPath(dir);
  let acquired = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { fs.mkdirSync(lock); acquired = true; break; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  // #5602 fund 1: a merge may hold the lock for a while, so "busy" is normally
  // just contention. Say so first; the reboot advice is only for a crashed owner.
  if (!acquired) throw Error(`Wave state lock busy after ~${Math.round((attempts * 50) / 1000)} s (another wave command or a merge holds it); retry. Only if its owner crashed: restart Windows before recovery`);
  try { return action(); }
  finally { fs.rmdirSync(lock); } // Only this invocation's empty lock directory.
}

export function withIdleWaveLock(dir, action) {
  fs.mkdirSync(dir, { recursive: true });
  return withWaveStateLock(dir, () => {
    if (fs.existsSync(path.join(dir, 'wave-active.json'))) throw Error('Wave marker exists; merge blocked');
    return action();
  });
}

export function requireModernWave(wave) {
  if (typeof wave?.waveId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(wave.waveId) || !wave.owner || !['claude', 'codex'].includes(wave.runtime)) {
    throw Error('Legacy wave marker: missing waveId/runtime/owner. Let the original Claude wave finish; do not overwrite or automatically recover it.');
  }
  return wave;
}

export function updateWave(dir, waveId, transform, attempts) {
  return withWaveStateLock(dir, () => updateWaveLocked(dir, waveId, transform), attempts);
}

function updateWaveLocked(dir, waveId, transform) {
  const wave = requireModernWave(readWave(dir));
  if (wave.waveId !== waveId) throw Error('Wave owner mismatch');
  const identity = JSON.stringify([wave.waveId, wave.owner, wave.runtime, wave.pid, wave.bootId, wave.ownerProcess, wave.admissionToolUseId]);
  const dispatched = wave.dispatchStarted === true;
  const boundRun = wave.workflowRunId;
  const next = transform(wave);
  if (JSON.stringify([next.waveId, next.owner, next.runtime, next.pid, next.bootId, next.ownerProcess, next.admissionToolUseId]) !== identity) throw Error('Cannot change wave ownership');
  if (boundRun && next.workflowRunId !== boundRun) throw Error('Cannot change admitted workflow run');
  if (dispatched && next.dispatchStarted !== true) throw Error('Cannot erase wave dispatch history');
  const target = path.join(dir, 'wave-active.json');
  const temporary = path.join(dir, `.wave-${waveId}-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { flag: 'wx' });
    if (readWave(dir).waveId !== waveId) throw Error('Wave owner changed during update');
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return next;
}

function claudeOwnerPid(sessionId) {
  const registry = path.join(os.homedir(), '.claude', 'sessions');
  if (!fs.existsSync(registry)) return undefined;
  const matches = fs.readdirSync(registry).filter(name => name.endsWith('.json')).flatMap(name => {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(registry, name), 'utf8'));
      return entry.sessionId === sessionId && Number.isSafeInteger(entry.pid) && entry.pid > 0 ? [entry.pid] : [];
    } catch { return []; } // Registry churn is expected; unknown identity blocks recovery.
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export async function acquireWave(dir, request, readPrs = getOpenPrs) {
  validateTracks(request.tracks);
  if (!['claude', 'codex'].includes(request.runtime) || !request.owner || !Number.isFinite(request.now)) throw Error('runtime, owner and now required');
  fs.mkdirSync(dir, { recursive: true });
  const ownerProcess = admissionOwnerProcess(request.pid ?? process.pid);
  const wave = { ...request, ownerProcess, waveId: randomUUID(), startedAt: new Date(request.now).toISOString(), verifyMax: 2, state: 'admitting' };
  const file = path.join(dir, 'wave-active.json');
  try { withWaveStateLock(dir, () => fs.writeFileSync(file, JSON.stringify(wave, null, 2), { flag: 'wx' })); }
  catch (e) { if (e.code === 'EEXIST') throw Error('wave-active.json exists; inspect owner, never expire or overwrite it'); throw e; }
  try {
    wave.capacity = checkCapacity(await readPrs(), request.tracks);
    wave.state = 'running';
    updateWave(dir, wave.waveId, () => wave);
    return wave;
  } catch (e) {
    releaseWave(dir, wave.waveId, true);
    throw e;
  }
}

export function releaseWave(dir, waveId, childrenStopped, snapshot = ownershipSnapshot, attempts) {
  return withWaveStateLock(dir, () => releaseWaveLocked(dir, waveId, childrenStopped, snapshot), attempts);
}

const trackRef = t => ({ issue: t?.issue, branch: t?.branch });

function releaseWaveLocked(dir, waveId, childrenStopped, snapshot) {
  if (!childrenStopped) throw Error('All children must be observed stopped before release');
  const wave = requireModernWave(readWave(dir));
  if (!waveId || wave.waveId !== waveId) throw Error('Wave owner mismatch; marker retained');
  assertWaveOwnership(wave, snapshot());
  // #5562: queued-but-never-taken tracks are reported, never dropped silently.
  const pendingNeverTaken = (Array.isArray(wave.pendingTracks) ? wave.pendingTracks : []).map(trackRef);
  const tracks = (Array.isArray(wave.tracks) ? wave.tracks : []).map(trackRef);
  stopWaveWatch(wave);
  fs.unlinkSync(path.join(dir, 'wave-active.json'));
  return { released: true, waveId: wave.waveId, pendingNeverTaken, tracks };
}

// ---------------------------------------------------------------- rolling intake (#5562)
// Only one marker exists and the hook rejects a new wave while it does, so the
// next wave's tracks join the RUNNING wave instead: the orchestrator enqueues,
// wave.js' idle lanes take them via `intake`. Same ownership proof as
// release/watch; every rejection leaves the marker untouched.
function assertIntakeOwner(wave, snapshot) {
  if (wave.runtime !== 'claude') throw Error('Rolling intake is only for Claude waves');
  if (wave.state !== 'running') throw Error('Wave is not running; rolling intake refused');
  assertWaveOwnership(wave, snapshot());
}

export function readTracksFile(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tracks = Array.isArray(data) ? data : data?.tracks;
  if (!Array.isArray(tracks)) throw Error('Tracks file must be an array or {"tracks":[...]}');
  return tracks;
}

// #5602: the models wave.js' normalizeTrack accepts (missing = sonnet).
export const INTAKE_MODELS = ['opus', 'sonnet'];

// #5602 fund 3 + 6: checks that only rolling intake needs. A track wave.js
// would reject (unknown model) is taken, skipped and still holds its ownership
// until release. An ownNodeModules track runs `npm ci` during setup, which can
// outlast the intake agent's time limit and turn rolling intake off for the
// rest of the wave. Both are refused before the marker is touched.
export function assertEnqueueable(tracks) {
  for (const t of tracks) {
    if (t.model !== undefined && !INTAKE_MODELS.includes(t.model)) throw Error(`Invalid model for #${t.issue}: ${JSON.stringify(t.model)} (use ${INTAKE_MODELS.join(' or ')})`);
    if (t.ownNodeModules === true) throw Error(`ownNodeModules track #${t.issue} cannot join a running wave (its npm ci can outlast intake); start it in its own wave`);
  }
}

export function enqueueTracks(dir, waveId, tracks, snapshot = ownershipSnapshot) {
  validateTracks(tracks);
  assertEnqueueable(tracks);
  const next = updateWave(dir, waveId, wave => {
    assertIntakeOwner(wave, snapshot);
    if (wave.rollingIntake !== true) throw Error('Rolling intake is disabled for this wave');
    const pending = Array.isArray(wave.pendingTracks) ? wave.pendingTracks : [];
    if (pending.length + tracks.length > MAX_PENDING_TRACKS) throw Error(`At most ${MAX_PENDING_TRACKS} pending tracks`);
    assertCompatibleWithActive(activeTracks(wave), tracks);
    // #5602 fund 7: activeTracks() drops finished branches, so a finished
    // branch queued again would pass the check above. Its second copy would
    // then be filtered out as finished too, and the merge gate would not
    // protect its ownership. Every branch the wave ever held is refused.
    const ran = new Set((Array.isArray(wave.tracks) ? wave.tracks : []).map(t => slugOf(String(t?.branch))));
    for (const t of tracks) if (ran.has(slugOf(t.branch))) throw Error(`branch already ran in this wave (finished or active): ${t.branch}`);
    return { ...wave, pendingTracks: [...pending, ...tracks] };
  }, LONG_LOCK_ATTEMPTS);
  return { enqueued: tracks.map(trackRef), pending: next.pendingTracks.map(trackRef) };
}

// Marks finished branches (only admitted ones) and moves ALL pending tracks
// into marker.tracks in one locked write, so a track can be taken only once.
// #5602: with { peek: true } it only marks finished branches and COUNTS the
// queue; nothing moves. wave.js' cheap intake check uses that form, so a
// check that answers wrongly can delay a track but never lose one.
export function intakeTracks(dir, waveId, finished = [], snapshot = ownershipSnapshot, { peek = false } = {}) {
  let taken = [], ignoredFinished = [], pending = 0;
  const next = updateWave(dir, waveId, wave => {
    assertIntakeOwner(wave, snapshot);
    if (!Array.isArray(wave.tracks)) throw Error('Wave marker has no tracks');
    const known = new Set(wave.tracks.map(t => t?.branch));
    const done = new Set(Array.isArray(wave.finishedBranches) ? wave.finishedBranches : []);
    ignoredFinished = finished.filter(b => !known.has(b));
    for (const b of finished) if (known.has(b)) done.add(b);
    const queued = Array.isArray(wave.pendingTracks) ? wave.pendingTracks : [];
    if (peek) {
      pending = queued.length;
      return { ...wave, finishedBranches: [...done] };
    }
    taken = queued;
    return { ...wave, tracks: [...wave.tracks, ...taken], pendingTracks: [], finishedBranches: [...done] };
  }, LONG_LOCK_ATTEMPTS);
  return { taken, pending, finishedBranches: next.finishedBranches, ignoredFinished, ...(peek ? { peek: true } : {}) };
}

// ---------------------------------------------------------------- merge gate (#5562)
// A merge during a running wave is allowed only when NONE of the PR's files
// overlap the wave's active ownership. Everything unknown blocks (fail-closed).
function ghJson(args) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
    } catch (e) {
      lastError = e;
      if (attempt < 3) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    }
  }
  throw lastError;
}

// `gh api --paginate --slurp` gives one array per page. The count must match
// the PR's changed_files: the files endpoint stops at 3000, and a short list
// would let an overlapping file through unseen.
export function flattenPrFilePages(pages, changedFiles) {
  if (!Array.isArray(pages) || !pages.length || pages.some(p => !Array.isArray(p))) throw Error('PR file list is not an array; merge blocked');
  const files = pages.flat();
  if (!Number.isSafeInteger(changedFiles) || files.length !== changedFiles) throw Error(`PR file list is incomplete (${files.length} of ${changedFiles}); merge blocked`);
  return files;
}

export function readPrFilesFromGitHub(pr, repo = REPO) {
  const pull = ghJson(['api', `repos/${repo}/pulls/${pr}`]);
  return flattenPrFilePages(ghJson(['api', `repos/${repo}/pulls/${pr}/files`, '--paginate', '--slurp']), pull?.changed_files);
}

export function readPrHeadFromGitHub(pr, repo = REPO) {
  return ghJson(['pr', 'view', String(pr), '--repo', repo, '--json', 'headRefOid'])?.headRefOid;
}

// ---------------------------------------------------------------- ownership release (#5677)
// A track's reserved files stop blocking a merge once it is no longer
// genuinely contested: its own PR is already merged (#5652, #5665 - a
// finished track kept blocking others until the wave's own intake got
// around to marking its branch finished), or it was admitted but never
// actually started (#5632 - no worktree ever created for it, holding files
// indefinitely). Both are real signals here for the CLI; every test injects
// its own fake instead (see mergeIo() in wave-policy.test.mjs), so an
// ordinary `node --test` run never shells out to `gh` or touches the
// filesystem for either check.
export function readMergedBranches(repo = REPO) {
  return new Set(ghJson(['pr', 'list', '--repo', repo, '--state', 'merged', '--json', 'headRefName', '--limit', '200']).map(p => p.headRefName));
}

// dir is the shared run dir (<repoRoot>/.claude/run, see sharedRunDir);
// worktrees live as a SIBLING of the repo root, in `<repoRoot>-worktrees`
// (new-worktree.ps1's own convention - see also DEFAULT_WORKTREE_ROOT in
// report-orphan-worktree-dirs.mjs).
function defaultWorktreeRoot(dir) {
  const repoRoot = path.dirname(path.dirname(dir));
  return path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-worktrees`);
}

export function branchHasWorktree(dir, branch) {
  return fs.existsSync(path.join(defaultWorktreeRoot(dir), slugOf(branch)));
}

// Renames count with their previous path too.
// #5677: `release` optionally narrows which active tracks still hold their
// files - `mergedBranches` (a Set of branches whose PR is already merged)
// and `hasWorktree(branch)` (false = never started). Omitting either (the
// default `{}`) preserves the pre-#5677 behaviour of every existing caller
// unchanged: every active track still holds every one of its files.
export function findOwnershipConflicts(wave, files, release = {}) {
  if (!Array.isArray(files)) throw Error('PR file list is not an array; merge blocked');
  const { mergedBranches, hasWorktree } = release;
  const owned = activeTracks(wave)
    .filter(t => !mergedBranches?.has(t?.branch))
    .filter(t => !hasWorktree || hasWorktree(t?.branch))
    .flatMap(t => t.ownership.map(raw => ({ issue: t.issue, raw, own: ownershipPrefix(raw) })));
  const conflicts = [];
  for (const f of files) {
    if (typeof f?.filename !== 'string' || !f.filename) throw Error('PR file entry without filename; merge blocked');
    const names = [f.filename];
    if (f.previous_filename !== undefined && f.previous_filename !== null) {
      if (typeof f.previous_filename !== 'string' || !f.previous_filename) throw Error('PR file entry with malformed previous_filename; merge blocked');
      names.push(f.previous_filename);
    }
    for (const name of names) {
      const own = ownershipPrefix(name);
      for (const o of owned) if (ownershipOverlaps(o.own, own)) conflicts.push({ file: name, issue: o.issue, ownership: o.raw });
    }
  }
  return conflicts;
}

function conflictError(pr, conflicts) {
  const first = conflicts[0];
  const more = conflicts.length > 1 ? ` (+${conflicts.length - 1} more)` : '';
  return Error(`Merge blocked: PR #${pr} file ${first.file} overlaps running wave track #${first.issue} (${first.ownership})${more}`);
}

function modernMarkerOrBlock(dir) {
  let wave;
  try { wave = requireModernWave(readWave(dir)); }
  catch (e) { throw Error(`Wave marker exists but is legacy or malformed; merge blocked (${e.message})`); }
  activeTracks(wave);
  return wave;
}

// Pre-check for merge-queue.ps1. The authoritative check is guardedMerge.
// `release` (#5677): see findOwnershipConflicts; defaults to the pre-#5677
// "every active track still holds its files" behaviour.
export function assertMergeAllowed(dir, pr, readFiles = readPrFilesFromGitHub, repo = REPO, release = {}) {
  if (!fs.existsSync(path.join(dir, 'wave-active.json'))) return { allowed: true, wave: null };
  const wave = modernMarkerOrBlock(dir);
  if (pr === undefined || pr === null) return { allowed: true, wave: wave.waveId };
  let files;
  try { files = readFiles(pr, repo); }
  catch (e) { throw Error(`PR file list unavailable; merge blocked (${e.message})`); }
  const conflicts = findOwnershipConflicts(wave, files, release);
  if (conflicts.length) throw conflictError(pr, conflicts);
  return { allowed: true, wave: wave.waveId, pr: Number(pr), files: files.length };
}

const mergeScript = () => fileURLToPath(new URL('./lib/merge-pr-owned.ps1', import.meta.url));
const defaultMergeIo = {
  readHead: readPrHeadFromGitHub,
  readFiles: readPrFilesFromGitHub,
  // fileURLToPath handles Windows drive paths; no shell-built command string.
  merge: (pr, repo, headSha) => execFileSync('pwsh', ['-NoProfile', '-File', mergeScript(), '-Pr', String(pr), '-Repo', repo, ...(headSha ? ['-HeadSha', headSha] : [])], { stdio: 'inherit' }),
  // #5677: real ownership-release signals for the CLI path only.
  readMergedBranches,
  hasWorktree: branchHasWorktree,
};

// #5677: builds findOwnershipConflicts' `release` from an `io` bundle. A
// failure of either signal falls back to "unknown" (never releases, i.e.
// the pre-#5677 fail-closed default) rather than aborting the whole merge -
// losing the optimisation is safe; losing the file-list read (readFiles)
// is not, and that one still hard-blocks as before.
function mergeReleaseInfo(dir, repo, io) {
  const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
  return {
    mergedBranches: io.readMergedBranches ? safe(() => io.readMergedBranches(repo), undefined) : undefined,
    hasWorktree: io.hasWorktree ? branch => safe(() => io.hasWorktree(dir, branch), true) : undefined,
  };
}

function mergeAction(dir, marker, pinned, pr, repo, io) {
  if (!fs.existsSync(marker)) return pinned ? io.merge(pr, repo, pinned.head) : io.merge(pr, repo);
  const wave = modernMarkerOrBlock(dir);
  if (!pinned) throw Error('A wave started while the merge was being prepared; merge blocked, run the queue again');
  const conflicts = findOwnershipConflicts(wave, pinned.files, mergeReleaseInfo(dir, repo, io));
  if (conflicts.length) throw conflictError(pr, conflicts);
  return io.merge(pr, repo, pinned.head);
}

// #5677: the merge gate's own lock attempt - same lock file as
// withWaveStateLock (waveLockPath), but with backoff up to
// MERGE_LOCK_FALLBACK_MS (default 30 s). Every OTHER caller (admission,
// intake, release, watch) is untouched; only guardedMerge degrades to a
// lock-free read past this point instead of failing outright (#5654, #5668:
// a merge from the main session must not starve just because the running
// wave's own writes hold the lock for a while).
export const MERGE_LOCK_FALLBACK_MS = 30000;
function acquireMergeLock(dir, timeoutMs) {
  const lock = waveLockPath(dir);
  const deadline = Date.now() + timeoutMs;
  let wait = 50;
  for (;;) {
    try { fs.mkdirSync(lock); return lock; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(wait, remaining));
    wait = Math.min(wait * 2, 1000);
  }
}

function defaultWarnLockFallback(timeoutMs) {
  console.error(`wave-policy: Wave state lock busy after ~${Math.round(timeoutMs / 1000)} s; falling back to a lock-free ownership read (racy - another writer may be mid-update). Re-run once the lock clears if this merge looks wrong.`);
}

// Head, files, head again: the file list belongs to exactly that head.
function readPinnedPrFiles(pr, repo, io) {
  const head = io.readHead(pr, repo);
  if (typeof head !== 'string' || !/^[0-9a-f]{40}$/i.test(head)) throw Error('PR head unavailable; merge blocked');
  let files;
  try { files = io.readFiles(pr, repo); }
  catch (e) { throw Error(`PR file list unavailable; merge blocked (${e.message})`); }
  if (io.readHead(pr, repo) !== head) throw Error('PR head changed during the overlap check; merge blocked');
  return { head, files };
}

// Without a marker this is exactly the old idle merge. With a marker: read
// head, files and head again, then - under the SAME state lock as admission
// and intake - re-read the marker, check overlap and merge pinned to that head
// (--match-head-commit), so a push after the check cannot smuggle new files
// in. The GitHub reads happen BEFORE the lock (CodeRabbit, this PR): the pin
// keeps them valid, and a lock held through network retries would starve
// intake, enqueue and release in the running wave. Only the merge call and
// its gh retries run under the lock, as before.
// #5677: `lockTimeoutMs` bounds how long a busy state lock is waited out
// before this degrades to a lock-free read (see acquireMergeLock);
// production default 30 s, tests inject a short one to stay fast.
export function guardedMerge(dir, pr, repo = REPO, io = defaultMergeIo, lockTimeoutMs = MERGE_LOCK_FALLBACK_MS) {
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(dir, 'wave-active.json');
  let pinned = null;
  if (fs.existsSync(marker)) {
    modernMarkerOrBlock(dir); // a legacy/malformed marker blocks before any GitHub read
    pinned = readPinnedPrFiles(pr, repo, io);
  }
  const lock = acquireMergeLock(dir, lockTimeoutMs);
  if (lock) {
    try { return mergeAction(dir, marker, pinned, pr, repo, io); }
    finally { fs.rmdirSync(lock); }
  }
  // Lock stayed busy past the fallback wait: warn loudly, then re-read the
  // marker WITHOUT the lock (mergeAction re-reads it fresh) rather than
  // refusing the merge outright. Every existing safety check still runs -
  // a real ownership conflict still blocks, just on a possibly-stale read.
  (io.warnLockFallback || defaultWarnLockFallback)(lockTimeoutMs);
  return mergeAction(dir, marker, pinned, pr, repo, io);
}

export function stopWaveWatch(wave, observedBootId) {
  // Only a proven different boot skips the kill; sub-second drift is the same boot (#5533).
  if (wave.watchPid && !(observedBootId && wave.bootId && !sameBoot(observedBootId, wave.bootId))) {
    // PID reuse must never turn cleanup into a kill of somebody else's process.
    const pid = wave.watchPid;
    if (!Number.isSafeInteger(pid) || pid < 1 || !/^\d+$/.test(wave.watchStarted || '')) throw Error('Unverified watch identity; marker retained');
    execFileSync('pwsh', ['-NoProfile', '-Command',
      '$p = Get-Process -Id ' + pid + ' -ErrorAction SilentlyContinue; if ($p) { if ($p.StartTime.ToUniversalTime().Ticks.ToString() -ne ' + "'" + wave.watchStarted + "'" + ') { throw "Watch identity changed" }; Stop-Process -InputObject $p -ErrorAction Stop; $p.WaitForExit() }'], { timeout: 15000 });
  }
}

export async function handleHook(payload, dir, readPrs = getOpenPrs, now, captureBoot = () => undefined, resolveOwnerPid = claudeOwnerPid) {
  const input = payload.tool_input || {};
  if (payload.hook_event_name === 'PostToolUse') {
    if (payload.tool_name !== 'Workflow' || !fs.existsSync(path.join(dir, 'wave-active.json'))) return;
    const wave = requireModernWave(readWave(dir));
    const runId = payload.tool_response?.runId;
    // Only bind a run from the exact admitted invocation's harness response.
    // Missing metadata leaves resume disabled, never inferred from the caller.
    if (!wave.admissionToolUseId || wave.admissionToolUseId !== payload.tool_use_id || typeof runId !== 'string' || !runId) return;
    if (wave.runtime !== 'claude' || wave.owner !== payload.session_id) throw Error('Another session owns this wave');
    assertWaveOwnership(wave, ownershipSnapshot(), process.pid, payload.session_id);
    // #5602 fund 1: a merge may hold the lock at wave start; the default ~5 s
    // would leave resume unbound. HOOK_LOCK_ATTEMPTS stays inside the 90 s hook timeout.
    return updateWave(dir, wave.waveId, current => ({ ...current, workflowRunId: runId }), HOOK_LOCK_ATTEMPTS);
  }
  if (payload.tool_name === 'Workflow' && input.resumeFromRunId) {
    if (!fs.existsSync(path.join(dir, 'wave-active.json'))) throw Error('Workflow resume requires an existing wave admission');
    const wave = requireModernWave(readWave(dir));
    if (wave.runtime !== 'claude' || !payload.session_id || wave.owner !== payload.session_id) throw Error('Another session owns this wave');
    if (!wave.workflowRunId || wave.workflowRunId !== input.resumeFromRunId) throw Error('Workflow resume does not match the admitted run');
    assertWaveOwnership(wave, ownershipSnapshot(), process.pid, payload.session_id);
    return wave;
  }
  const isWave = payload.tool_name === 'Workflow' && (input.name === 'wave' || /(?:^|[\\/])wave\.js$/.test(input.scriptPath || ''));
  if (isWave) {
    const args = input.args || {};
    if (args.dryRun === true) return;
    if (fs.existsSync(path.join(dir, 'wave-active.json'))) throw Error('wave-active.json exists; inspect owner, never overwrite it');
    if (args.lanes !== undefined && (!Number.isInteger(args.lanes) || args.lanes < 1 || args.lanes > 4)) throw Error('Wave lanes must be an integer from 1 to 4');
    if (!payload.session_id) throw Error('Wave admission requires session_id');
    const pid = resolveOwnerPid(payload.session_id);
    if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Cannot verify admission owner process');
    // rollingIntake (#5562): wave.js takes enqueued tracks unless args.rollingIntake === false.
    // Only a marker that says so accepts `enqueue`; an older wave.js never would take them.
    return acquireWave(dir, { runtime: 'claude', owner: payload.session_id, pid, bootId: captureBoot(), admissionToolUseId: payload.tool_use_id ?? null, dispatchStarted: false, processTracking: 'owner-tree', rollingIntake: Array.isArray(args) || args.rollingIntake !== false, now, tracks: Array.isArray(args) ? args : args.tracks }, readPrs);
  }
  if (payload.tool_name !== 'Agent') return;
  const prompt = String(input.prompt || input.description || '').trimStart();
  if (/^READ-ONLY:/.test(prompt) || ['Explore', 'Plan'].includes(input.subagent_type)) return;
  if (!fs.existsSync(path.join(dir, 'wave-active.json'))) return;
  const wave = readWave(dir); // malformed markers fail closed
  if (wave.runtime === 'codex') throw Error('codex wave owns machine; Claude build dispatch blocked');
  if (wave.owner && payload.session_id !== wave.owner) throw Error('Another session owns this wave');
  // Write once (#5562): merges may now hold the state lock during a wave, and a
  // lane spawn must not fail on a busy lock just to repeat a flag already set.
  if (wave.waveId && /^WAVE-/.test(prompt) && wave.dispatchStarted !== true) updateWave(dir, wave.waveId, current => ({ ...current, dispatchStarted: true }), HOOK_LOCK_ATTEMPTS);
}

async function cli() {
  const [command, ...args] = process.argv.slice(2);
  const value = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
  const dir = value('--run-dir') || sharedRunDir(process.cwd());
  if (command === 'hook') {
    const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    await handleHook(payload, dir, getOpenPrs, Date.now(), hostBootId);
  } else if (command === 'inspect') {
    console.log(JSON.stringify(requireModernWave(readWave(dir))));
  } else if (command === 'assert-idle') {
    if (fs.existsSync(path.join(dir, 'wave-active.json'))) throw Error('Wave marker exists; merge blocked regardless of age or format');
    console.log(JSON.stringify({ idle: true, runDir: dir }));
  } else if (command === 'assert-merge-allowed') {
    // #5562: replaces assert-idle in merge-queue.ps1. No override of the file reader here.
    // #5677: same real release signals as guarded-merge, so the pre-check and
    // the authoritative merge never disagree about which tracks still hold files.
    const pr = value('--pr'), repo = value('--repo') || REPO;
    if ((pr !== undefined && !/^[1-9]\d*$/.test(pr)) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error('Valid PR and repository required');
    console.log(JSON.stringify(assertMergeAllowed(dir, pr, readPrFilesFromGitHub, repo, mergeReleaseInfo(dir, repo, defaultMergeIo))));
  } else if (command === 'guarded-merge') {
    const pr = value('--pr'), repo = value('--repo') || REPO;
    if (!/^[1-9]\d*$/.test(pr || '') || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error('Valid merge PR and repository required');
    // No override of the file reader or merge call from the CLI (#5562).
    guardedMerge(dir, pr, repo);
  } else if (command === 'enqueue') {
    const file = value('--tracks-file');
    if (!file) throw Error('--tracks-file required');
    console.log(JSON.stringify(enqueueTracks(dir, value('--wave-id'), readTracksFile(file))));
  } else if (command === 'intake') {
    const finished = (value('--finished') || '').split(',').map(s => s.trim()).filter(Boolean);
    // #5602: --peek counts the queue and marks finished branches, moves nothing.
    console.log(JSON.stringify(intakeTracks(dir, value('--wave-id'), finished, ownershipSnapshot, { peek: args.includes('--peek') })));
  } else if (command === 'recover') {
    if (args.includes('--owner-override')) {
      const { ownerOverride } = await import('./wave-owner-override.mjs');
      console.log(JSON.stringify(await ownerOverride(dir)));
      return;
    }
    const { recoverWave } = await import('./wave-recovery.mjs');
    console.log(JSON.stringify(recoverWave(dir, { waveId: value('--wave-id'), owner: value('--owner'), now: Date.now() })));
  } else if (command === 'release') {
    console.log(JSON.stringify(releaseWave(dir, value('--wave-id'), args.includes('--children-stopped'), ownershipSnapshot, LONG_LOCK_ATTEMPTS)));
  } else if (command === 'watch') {
    const wave = requireModernWave(readWave(dir));
    if (wave.waveId !== value('--wave-id')) throw Error('Wave owner mismatch');
    assertWaveOwnership(wave, ownershipSnapshot());
    const pid = Number(value('--pid'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Invalid watch PID');
    const info = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-Command',
      '$p = Get-CimInstance Win32_Process -Filter "ProcessId = ' + pid + '"; if (!$p -or $p.CommandLine -notmatch "wave-lane-watch[.]ps1") { throw "Not a lane watch" }; $s = Get-Process -Id ' + pid + '; @{ started = $s.StartTime.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json -Compress'], { encoding: 'utf8', timeout: 10000 }));
    wave.watchPid = pid;
    wave.watchStarted = info.started;
    // #5602 fund 1: phase 0 registers the watch while a merge may hold the lock.
    updateWave(dir, wave.waveId, current => ({ ...current, watchPid: pid, watchStarted: info.started }), LONG_LOCK_ATTEMPTS);
  } else throw Error('Usage: wave-policy.mjs hook|inspect|assert-idle|assert-merge-allowed|guarded-merge|enqueue|intake|release|watch|recover');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  cli().catch(e => { console.error(`wave-policy: ${e.message}`); process.exitCode = 2; });
}
