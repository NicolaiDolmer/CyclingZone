import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquireWave, releaseWave, checkCapacity, validateTracks, handleHook, updateWave, withIdleWaveLock, withWaveStateLock, stopWaveWatch,
  ownershipPrefix, ownershipOverlaps, activeTracks, enqueueTracks, intakeTracks, readTracksFile, assertMergeAllowed, guardedMerge,
  flattenPrFilePages, findOwnershipConflicts, MAX_PENDING_TRACKS } from './wave-policy.mjs';
import { assertWaveOwnership } from './wave-ownership.mjs';
import { normalizeBootId } from './wave-boot-identity.mjs';

const now = 1790000000000;
const track = (n) => ({ issue: n, branch: `codex/${n}-fixture`, ownership: [`fixtures/${n}.txt`], tier: 'TARGETED' });
const request = (runtime = 'codex') => ({ runtime, owner: 'fixture-owner', pid: process.pid, now, tracks: [track(1)] });
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cz-wave-policy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('exclusive admission: competing runtimes cannot overwrite a live marker', async (t) => {
  const dir = fixture(t);
  const results = await Promise.allSettled([
    acquireWave(dir, request(), async () => []),
    acquireWave(dir, request('claude'), async () => []),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const winner = results.find(r => r.status === 'fulfilled').value;
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'wave-active.json'))).waveId, winner.waveId);
});

test('foreign, malformed and expired markers remain untouched', async (t) => {
  const dir = fixture(t);
  const file = path.join(dir, 'wave-active.json');
  for (const body of ['{broken', JSON.stringify({ runtime: 'claude', expiresAt: '2000-01-01' })]) {
    writeFileSync(file, body);
    await assert.rejects(acquireWave(dir, request(), async () => []), /active|exists/i);
    assert.equal(readFileSync(file, 'utf8'), body);
  }
});

test('capacity includes drafts and reserves all planned new PRs as info, never rejects on count', () => {
  const prs = [1, 2, 3, 4, 5, 6, 7].map(n => ({ number: n, headRefName: `other/${n}`, isDraft: true }));
  assert.deepEqual(checkCapacity(prs, [track(10)]), { open: 7, additional: 1, projected: 8 });
  assert.deepEqual(checkCapacity(prs, [track(10), track(11)]), { open: 7, additional: 2, projected: 9 });
});

// Ejer-beslutning 22/9 (variant B, #5510): loftet paa 8 er fjernet. En boelge
// maa ikke afvises fordi der allerede er 8+ aabne PR'er - lanerne (4) og
// verifikations-semaforen (2) er fortsat bremsen.
test('a wave is not rejected at 8 or more open PRs', () => {
  const manyPrs = Array.from({ length: 12 }, (_, i) => ({ number: i, headRefName: `other/${i}`, isDraft: true }));
  assert.deepEqual(checkCapacity(manyPrs, [track(10), track(11), track(12)]), { open: 12, additional: 3, projected: 15 });
});

test('an unfetchable PR list still fails closed', () => {
  assert.throws(() => checkCapacity(null, [track(10)]), /PR/);
  assert.throws(() => checkCapacity(undefined, [track(10)]), /PR/);
});

test('network failure releases only our admission and no claim remains', async (t) => {
  const dir = fixture(t);
  await assert.rejects(acquireWave(dir, request(), async () => { throw Error('offline'); }), /offline/);
  assert.equal(existsSync(path.join(dir, 'wave-active.json')), false);
});

test('cleanup requires ownership and observed child termination', async (t) => {
  const dir = fixture(t);
  const wave = await acquireWave(dir, request(), async () => []);
  assert.throws(() => releaseWave(dir, 'foreign', true), /owner/);
  assert.throws(() => releaseWave(dir, wave.waveId, false), /stopped/);
  assert.equal(existsSync(path.join(dir, 'wave-active.json')), true);
  releaseWave(dir, wave.waveId, true);
  assert.equal(existsSync(path.join(dir, 'wave-active.json')), false);
});

test('path traversal, duplicate branches/issues and overlapping ownership fail before dispatch', () => {
  assert.throws(() => validateTracks([{ ...track(1), branch: '../main' }]), /branch/);
  assert.throws(() => validateTracks([track(1), track(1)]), /duplicate/);
  assert.throws(() => validateTracks([track(1), { ...track(2), ownership: ['fixtures'] }]), /overlap/);
  assert.throws(() => validateTracks([{ ...track(1), ownership: ['../outside'] }]), /path/);
  assert.throws(() => validateTracks([{ ...track(1), ownership: ['docs/NOW.md'] }]), /reserved/);
  assert.throws(() => validateTracks([{ ...track(1), ownership: ['docs'] }]), /reserved/);
  assert.throws(() => validateTracks([{ ...track(1), ownership: ['.'] }]), /path/);
  assert.throws(() => validateTracks([{ ...track(1), branch: 'codex/a-b' }, { ...track(2), branch: 'codex/a/b' }]), /duplicate/);
});

test('Claude Workflow admission uses the same code, no PR cap; dry-run never reserves', async (t) => {
  const dir = fixture(t);
  const payload = { session_id: 'claude-fixture', tool_name: 'Workflow', tool_input: {
    scriptPath: 'C:/Dev/CyclingZone/.claude/workflows/wave.js', args: { tracks: [track(1)] },
  } };
  // 8 already-open PRs (the old cap) must not block admission (ejer-beslutning 22/9, #5510).
  const full = async () => [1, 2, 3, 4, 5, 6, 7, 8].map(number => ({ number, headRefName: `other/${number}` }));
  payload.tool_input.args.dryRun = true;
  await handleHook(payload, dir, full, now);
  assert.equal(existsSync(path.join(dir, 'wave-active.json')), false);
  payload.tool_input.args.dryRun = false;
  const wave = await handleHook(payload, dir, full, now, () => undefined, () => process.pid);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'wave-active.json'))).runtime, 'claude');
  assert.equal(wave.capacity.open, 8);
});

test('Claude wave-prefixed agents cannot join a Codex wave', async (t) => {
  const dir = fixture(t);
  await acquireWave(dir, request(), async () => []);
  await assert.rejects(handleHook({ tool_name: 'Agent', tool_input: { prompt: 'WAVE-LANE: fixture' } }, dir, async () => [], now), /codex/);
  await handleHook({ tool_name: 'Agent', tool_input: { prompt: 'READ-ONLY: fixture' } }, dir, async () => [], now);
});

test('Claude lane override cannot exceed the machine budget', async (t) => {
  const dir = fixture(t);
  await assert.rejects(handleHook({ session_id: 'fixture', tool_name: 'Workflow', tool_input: { name: 'wave', args: { lanes: 5, tracks: [track(1)] } } }, dir, async () => [], now), /lanes/);
  assert.equal(existsSync(path.join(dir, 'wave-active.json')), false);
});

test('concurrent marker writers preserve every read-modify-write update', async t => {
  const dir = fixture(t);
  const wave = await acquireWave(dir, request(), async () => []);
  const moduleUrl = new URL('./wave-policy.mjs', import.meta.url).href;
  const worker = `import { updateWave } from ${JSON.stringify(moduleUrl)};
    for (let i=0;i<10;i++) updateWave(${JSON.stringify(dir)}, ${JSON.stringify(wave.waveId)}, wave => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,8);
      return {...wave, writes:(wave.writes || 0)+1};
    });`;
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', worker], { windowsHide: true });
    let error = '';
    child.stderr.on('data', chunk => { error += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(Error(error)));
  })));
  for (const result of results) assert.equal(result.status, 'fulfilled', result.reason?.message);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'wave-active.json'))).writes, 40);
});

test('pre-merge idle check refuses even expired or legacy markers', t => {
  const dir = fixture(t);
  const call = () => spawnSync(process.execPath, [fileURLToPath(new URL('./wave-policy.mjs', import.meta.url)), 'assert-idle', '--run-dir', dir], { encoding: 'utf8' });
  assert.equal(call().status, 0);
  writeFileSync(path.join(dir, 'wave-active.json'), '{"expiresAt":"2000-01-01"}');
  const blocked = call();
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /merge blocked/);
});

test('release CLI cannot remove another live session marker by knowing its waveId', t => {
  const dir = fixture(t);
  const marker = { waveId: 'foreign-live', runtime: 'codex', owner: 'another-session', pid: process.pid,
    ownerProcess: { pid: process.pid, createdAt: 'not-the-admitted-process', bootId: 'unknown' } };
  const file = path.join(dir, 'wave-active.json');
  writeFileSync(file, JSON.stringify(marker));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./wave-policy.mjs', import.meta.url)),
    'release', '--run-dir', dir, '--wave-id', marker.waveId, '--children-stopped'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Another session owns this wave/);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), marker);
});

test('same Claude session passes, another session is blocked, including resumeFromRunId', async t => {
  const dir = fixture(t);
  const wave = await acquireWave(dir, { ...request('claude'), workflowRunId: 'fixture-run' }, async () => []);
  const input = { tool_name: 'Agent', tool_input: { prompt: 'WAVE-LANE: fixture' } };
  await handleHook({ ...input, session_id: wave.owner }, dir);
  await assert.rejects(handleHook({ ...input, session_id: 'foreign-session' }, dir), /Another session owns this wave/);
  const resume = { tool_name: 'Workflow', tool_input: { resumeFromRunId: 'fixture-run' } };
  await handleHook({ ...resume, session_id: wave.owner }, dir);
  await assert.rejects(handleHook({ ...resume, session_id: wave.owner, tool_input: { resumeFromRunId: 'older-run' } }, dir), /does not match/);
  await assert.rejects(handleHook({ ...resume, session_id: 'foreign-session' }, dir), /Another session owns this wave/);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'wave-active.json'))).waveId, wave.waveId);
});

test('resume binding comes only from the admitted invocation response', async t => {
  const dir = fixture(t);
  const invocation = { session_id: 'fixture-owner', tool_use_id: 'fixture-invocation', tool_name: 'Workflow',
    tool_input: { name: 'wave', args: { tracks: [track(1)] } } };
  await handleHook(invocation, dir, async () => [], now, () => undefined, () => process.pid);
  const response = { ...invocation, hook_event_name: 'PostToolUse', tool_response: { runId: 'current-run' } };
  await handleHook({ ...response, tool_use_id: 'old-invocation' }, dir);
  const resume = { session_id: invocation.session_id, tool_name: 'Workflow', tool_input: { resumeFromRunId: 'current-run' } };
  await assert.rejects(handleHook(resume, dir), /does not match/);
  await handleHook(response, dir);
  await handleHook(resume, dir);
  await assert.rejects(handleHook({ ...response, tool_response: { runId: 'another-run' } }, dir), /Cannot change admitted/);
});

test('idle merge lock excludes admission through the whole merge callback', async t => {
  const dir = fixture(t);
  let admission;
  withIdleWaveLock(dir, () => { admission = acquireWave(dir, request(), async () => []); });
  await assert.rejects(admission, /Wave state lock busy/);
  assert.equal(existsSync(path.join(dir, 'wave-active.json')), false);
  const wave = await acquireWave(dir, request(), async () => []);
  assert.throws(() => withIdleWaveLock(dir, () => assert.fail('must not execute a merge')), /merge blocked/);
  releaseWave(dir, wave.waveId, true);
  assert.equal(withIdleWaveLock(dir, () => 'fixture-merge-complete'), 'fixture-merge-complete');
});

test('resumeFromRunId without an admitted wave is rejected', async t => {
  await assert.rejects(handleHook({ session_id: 'fixture-owner', tool_name: 'Workflow',
    tool_input: { resumeFromRunId: 'fixture-run' } }, fixture(t)), /resume.*admission/i);
});

test('process proof accepts the admitted tree and rejects foreign trees, PID reuse and session mismatch', () => {
  const wave = { owner: 'session-a', ownerProcess: { pid: 10, createdAt: '100', bootId: 'boot' } };
  const observed = { bootId: 'boot', processes: [{ pid: 10, ppid: 1, createdAt: '100' },
    { pid: 11, ppid: 10, createdAt: '110' }, { pid: 20, ppid: 1, createdAt: '120' }] };
  assertWaveOwnership(wave, observed, 10, 'session-a');
  assertWaveOwnership(wave, observed, 11, 'session-a');
  assert.throws(() => assertWaveOwnership(wave, observed, 20, 'session-a'), /Another session owns/);
  assert.throws(() => assertWaveOwnership(wave, observed, 11, 'session-b'), /Another session owns/);
  assert.throws(() => assertWaveOwnership(wave, { ...observed, bootId: 'new-boot' }, 11), /Another session owns/);
  assert.throws(() => assertWaveOwnership(wave, { ...observed, processes: observed.processes.map(p => p.pid === 10 ? {...p, createdAt: '105'} : p) }, 11), /Another session owns/);
});

// #5533: Windows LastBootUpTime drifts sub-ms within one boot (23/9: +0.772 ms).
const markerTicks = '639256957975000000';
const driftedTicks = '639256957975007720';
const minutesLater = (BigInt(markerTicks) + 5n * 60n * 10_000_000n).toString();

test('process proof treats sub-second boot drift as the same boot and a restart as a new one', () => {
  const wave = { owner: 'session-a', ownerProcess: { pid: 10, createdAt: '100', bootId: markerTicks } };
  const processes = [{ pid: 10, ppid: 1, createdAt: '100' }, { pid: 11, ppid: 10, createdAt: '110' }];
  assertWaveOwnership(wave, { bootId: driftedTicks, processes }, 11, 'session-a');
  assertWaveOwnership(wave, { bootId: normalizeBootId(driftedTicks), processes }, 11, 'session-a');
  assert.throws(() => assertWaveOwnership(wave, { bootId: minutesLater, processes }, 11, 'session-a'), /Another session owns/);
  assert.throws(() => assertWaveOwnership({ ...wave, ownerProcess: { ...wave.ownerProcess, bootId: undefined } }, { bootId: undefined, processes }, 11), /Another session owns/);
});

test('owned release succeeds after sub-second boot drift and refuses after a restart', t => {
  const dir = fixture(t);
  const file = path.join(dir, 'wave-active.json');
  // Marker as written before #5533: raw ticks, owner = this test process.
  const marker = { waveId: 'drift-wave', runtime: 'claude', owner: 'fixture-owner', pid: process.pid, bootId: markerTicks,
    ownerProcess: { pid: process.pid, createdAt: 'fixture-created', bootId: markerTicks } };
  const snapshot = bootId => () => ({ bootId, processes: [{ pid: process.pid, ppid: 1, createdAt: 'fixture-created' }] });
  writeFileSync(file, JSON.stringify(marker));
  assert.throws(() => releaseWave(dir, marker.waveId, true, snapshot(minutesLater)), /Another session owns this wave; marker retained/);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), marker);
  releaseWave(dir, marker.waveId, true, snapshot(normalizeBootId(driftedTicks)));
  assert.equal(existsSync(file), false);
});

test('watch cleanup is skipped only for a proven different boot, not for drift', () => {
  const wave = { watchPid: 424242, watchStarted: 'not-ticks', bootId: markerTicks };
  // Same boot: the watch must be stopped, so its identity is verified (and here rejected).
  assert.throws(() => stopWaveWatch(wave, normalizeBootId(driftedTicks)), /Unverified watch identity/);
  // Different boot: the old PID may belong to someone else; never touched.
  assert.doesNotThrow(() => stopWaveWatch(wave, minutesLater));
});

test('Windows release CLI frees a pre-#5533 marker whose raw boot ticks drifted', { skip: process.platform !== 'win32' }, async t => {
  const dir = fixture(t);
  const wave = await acquireWave(dir, request(), async () => []);
  assert.match(wave.ownerProcess.bootId, /^\d+0000000$/);
  // Rewrite as an old marker: raw ticks half a second into the boot second.
  const raw = (BigInt(wave.ownerProcess.bootId) + 5_000_000n).toString();
  const file = path.join(dir, 'wave-active.json');
  writeFileSync(file, JSON.stringify({ ...wave, bootId: raw, ownerProcess: { ...wave.ownerProcess, bootId: raw } }));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./wave-policy.mjs', import.meta.url)),
    'release', '--run-dir', dir, '--wave-id', wave.waveId, '--children-stopped'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(file), false);
});

test('process ownership and started dispatch cannot be rewritten into recoverable history', async t => {
  const dir = fixture(t);
  const wave = await acquireWave(dir, request(), async () => []);
  assert.throws(() => updateWave(dir, wave.waveId, current => ({ ...current, pid: 999 })), /Cannot change wave ownership/);
  assert.throws(() => updateWave(dir, wave.waveId, current => { current.ownerProcess.pid = 999; return current; }), /Cannot change wave ownership/);
  updateWave(dir, wave.waveId, current => ({ ...current, dispatchStarted: true }));
  assert.throws(() => updateWave(dir, wave.waveId, current => ({ ...current, dispatchStarted: false })), /Cannot erase/);
});

test('release CLI in the admitted process tree succeeds', async t => {
  const dir = fixture(t);
  const wave = await acquireWave(dir, request(), async () => []);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./wave-policy.mjs', import.meta.url)),
    'release', '--run-dir', dir, '--wave-id', wave.waveId, '--children-stopped'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(path.join(dir, 'wave-active.json')), false);
});

test('merge queue dry-run stops at an existing wave before GitHub checks', { skip: process.platform !== 'win32' }, t => {
  const root = fixture(t);
  const init = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const run = path.join(root, '.claude', 'run');
  mkdirSync(run, { recursive: true });
  writeFileSync(path.join(run, 'wave-active.json'), '{"fixture":true}');
  const result = spawnSync('pwsh', ['-NoProfile', '-File', fileURLToPath(new URL('./merge-queue.ps1', import.meta.url)),
    '-Pr', '1', '-DryRun'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /Wave marker exists|Aktiv boelgemarkoer/);
  assert.equal(existsSync(path.join(run, 'wave-active.json')), true);
});

// ===== #5562: ownership-helpers, rullende optag og merge under boelge =====

// A modern, running Claude marker owned by this test process. Ownership is
// proven with an injected snapshot (no OS process listing), like the
// boot-drift release test above.
const ownerProcess = { pid: process.pid, createdAt: 'fixture-created', bootId: 'fixture-boot' };
const ownSnapshot = () => ({ bootId: 'fixture-boot', processes: [{ pid: process.pid, ppid: 1, createdAt: 'fixture-created' }] });
const foreignSnapshot = () => ({ bootId: 'fixture-boot', processes: [{ pid: process.pid, ppid: 1, createdAt: 'another-process' }] });
const trackWith = (n, ownership, extra = {}) => ({ issue: n, branch: `feat/${n}-fixture`, ownership, tier: 'TARGETED', model: 'sonnet', ...extra });
const markerOf = dir => JSON.parse(readFileSync(path.join(dir, 'wave-active.json'), 'utf8'));
function runningWave(t, extra = {}) {
  const dir = fixture(t);
  const file = path.join(dir, 'wave-active.json');
  const marker = { waveId: 'rolling-wave', runtime: 'claude', owner: 'fixture-owner', pid: process.pid, bootId: 'fixture-boot', ownerProcess,
    state: 'running', rollingIntake: true, dispatchStarted: true, tracks: [trackWith(1, ['scripts/one.mjs'])], ...extra };
  writeFileSync(file, JSON.stringify(marker));
  return { dir, file };
}
const prFiles = (...names) => names.map(filename => ({ filename }));
const HEAD = 'a'.repeat(40);
function mergeIo(overrides = {}) {
  const calls = [];
  return { calls, readHead: () => HEAD, readFiles: () => prFiles('docs/other.md'), merge: (pr, repo, sha) => { calls.push({ pr, repo, sha }); return 'merged'; }, ...overrides };
}

test('#5562: a glob that stops mid-segment overlaps every path with the same prefix, both ways', () => {
  assert.deepEqual(ownershipPrefix('scripts/wave-*.mjs'), { prefix: 'scripts/wave-', open: true });
  assert.deepEqual(ownershipPrefix('scripts/*'), { prefix: 'scripts', open: false });
  assert.deepEqual(ownershipPrefix('Scripts\\X.ps1'), { prefix: 'scripts/x.ps1', open: false });
  assert.equal(ownershipOverlaps('scripts/wave-*.mjs', 'scripts/wave-policy.mjs'), true);
  assert.equal(ownershipOverlaps('scripts/wave-policy.mjs', 'scripts/wave-*.mjs'), true);
  assert.equal(ownershipOverlaps('scripts/wave-*.mjs', 'scripts'), true);
  assert.equal(ownershipOverlaps('scripts/wave-*.mjs', 'scripts/wa*'), true);
  assert.equal(ownershipOverlaps('scripts/wave-*.mjs', 'scripts/wavx.mjs'), false);
  assert.equal(ownershipOverlaps('scripts/wave-*.mjs', 'scripts/wav'), false);
  assert.equal(ownershipOverlaps('scripts/x', 'scripts/xy'), false, 'a closed prefix still stops at a / boundary');
  const glob = { ...track(1), ownership: ['scripts/wave-*.mjs'] };
  const file = { ...track(2), ownership: ['scripts/wave-policy.mjs'] };
  assert.throws(() => validateTracks([glob, file]), /ownership overlap/);
  assert.throws(() => validateTracks([file, glob]), /ownership overlap/);
  assert.throws(() => validateTracks([{ ...track(1), ownership: ['docs/n*'] }]), /reserved/);
  assert.throws(() => validateTracks([{ ...track(1), ownership: ['*.md'] }]), /too broad/);
});

test('#5562: enqueue rejects overlap, duplicates, a second FULL and a foreign owner, and leaves the marker untouched', t => {
  const { dir, file } = runningWave(t, { tracks: [trackWith(1, ['scripts/one.mjs'], { tier: 'FULL' })] });
  const before = readFileSync(file, 'utf8');
  const rejected = [
    [[trackWith(2, ['scripts/one.mjs'])], /ownership overlap/],
    [[trackWith(2, ['scripts/*'])], /ownership overlap/],
    [[trackWith(2, ['scripts/on*'])], /ownership overlap/],
    [[trackWith(1, ['docs/other.md'])], /duplicate/],
    [[{ ...trackWith(2, ['docs/other.md']), branch: 'feat/1-fixture' }], /duplicate/],
    [[{ ...trackWith(2, ['docs/other.md']), branch: 'feat-1/fixture' }], /duplicate/],
    [[trackWith(2, ['docs/other.md'], { tier: 'FULL' })], /FULL/],
    [[trackWith(2, ['docs/now.md'])], /reserved/],
  ];
  for (const [tracks, error] of rejected) {
    assert.throws(() => enqueueTracks(dir, 'rolling-wave', tracks, ownSnapshot), error);
    assert.equal(readFileSync(file, 'utf8'), before);
  }
  assert.throws(() => enqueueTracks(dir, 'rolling-wave', [trackWith(2, ['docs/other.md'])], foreignSnapshot), /Another session owns this wave/);
  assert.throws(() => enqueueTracks(dir, 'another-wave', [trackWith(2, ['docs/other.md'])], ownSnapshot), /owner mismatch/);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('#5562: enqueue checks the queue too, and needs a running Claude wave with rolling intake on', t => {
  const { dir } = runningWave(t);
  enqueueTracks(dir, 'rolling-wave', [trackWith(2, ['docs/two.md'], { tier: 'FULL' })], ownSnapshot);
  assert.throws(() => enqueueTracks(dir, 'rolling-wave', [trackWith(3, ['docs/two.md'])], ownSnapshot), /ownership overlap with running #2/);
  assert.throws(() => enqueueTracks(dir, 'rolling-wave', [trackWith(3, ['docs/three.md'], { tier: 'FULL' })], ownSnapshot), /FULL/);
  const many = Array.from({ length: MAX_PENDING_TRACKS - 1 }, (_, i) => trackWith(100 + i, [`docs/p${i}.md`]));
  enqueueTracks(dir, 'rolling-wave', many, ownSnapshot);
  assert.throws(() => enqueueTracks(dir, 'rolling-wave', [trackWith(200, ['docs/late.md'])], ownSnapshot), /pending/);
  for (const extra of [{ rollingIntake: false }, { rollingIntake: undefined }, { runtime: 'codex' }, { state: 'admitting' }]) {
    const other = runningWave(t, extra);
    const before = readFileSync(other.file, 'utf8');
    assert.throws(() => enqueueTracks(other.dir, 'rolling-wave', [trackWith(2, ['docs/two.md'])], ownSnapshot), /Rolling intake|Claude waves|not running/);
    assert.equal(readFileSync(other.file, 'utf8'), before);
  }
});

test('#5562: intake moves every pending track exactly once and marks only admitted branches finished', t => {
  const { dir, file } = runningWave(t);
  enqueueTracks(dir, 'rolling-wave', [trackWith(2, ['docs/two.md']), trackWith(3, ['docs/three.md'])], ownSnapshot);
  const before = readFileSync(file, 'utf8');
  assert.throws(() => intakeTracks(dir, 'rolling-wave', [], foreignSnapshot), /Another session owns this wave/);
  assert.equal(readFileSync(file, 'utf8'), before);
  const first = intakeTracks(dir, 'rolling-wave', ['feat/1-fixture', 'feat/999-unknown'], ownSnapshot);
  assert.deepEqual(first.taken.map(x => x.issue), [2, 3]);
  assert.deepEqual(first.ignoredFinished, ['feat/999-unknown']);
  assert.deepEqual(intakeTracks(dir, 'rolling-wave', [], ownSnapshot).taken, [], 'a second intake gets nothing');
  const marker = markerOf(dir);
  assert.deepEqual(marker.tracks.map(x => x.issue), [1, 2, 3]);
  assert.deepEqual(marker.pendingTracks, []);
  assert.deepEqual(marker.finishedBranches, ['feat/1-fixture']);
});

test('#5562: a finished track releases its ownership to the next enqueue', t => {
  const { dir } = runningWave(t);
  assert.throws(() => enqueueTracks(dir, 'rolling-wave', [trackWith(2, ['scripts/one.mjs'])], ownSnapshot), /ownership overlap/);
  intakeTracks(dir, 'rolling-wave', ['feat/1-fixture'], ownSnapshot);
  enqueueTracks(dir, 'rolling-wave', [trackWith(2, ['scripts/one.mjs'])], ownSnapshot);
  assert.deepEqual(activeTracks(markerOf(dir)).map(x => x.issue), [2]);
});

test('#5562: release reports queued tracks that were never taken', t => {
  const { dir } = runningWave(t);
  enqueueTracks(dir, 'rolling-wave', [trackWith(2, ['docs/two.md'])], ownSnapshot);
  const released = releaseWave(dir, 'rolling-wave', true, ownSnapshot);
  assert.deepEqual(released.pendingNeverTaken, [{ issue: 2, branch: 'feat/2-fixture' }]);
  assert.deepEqual(released.tracks, [{ issue: 1, branch: 'feat/1-fixture' }]);
  assert.equal(existsSync(path.join(dir, 'wave-active.json')), false);
});

test('#5562: readTracksFile accepts {tracks:[...]} and a bare array', t => {
  const dir = fixture(t);
  const wrapped = path.join(dir, 'wrapped.json'), bare = path.join(dir, 'bare.json'), bad = path.join(dir, 'bad.json');
  writeFileSync(wrapped, JSON.stringify({ tracks: [track(2)] }));
  writeFileSync(bare, JSON.stringify([track(3)]));
  writeFileSync(bad, JSON.stringify({ track: track(4) }));
  assert.deepEqual(readTracksFile(wrapped), [track(2)]);
  assert.deepEqual(readTracksFile(bare), [track(3)]);
  assert.throws(() => readTracksFile(bad), /array/);
});

test('#5562: enqueue, intake and release CLIs work in the admitted process tree', async t => {
  const dir = fixture(t);
  const wave = await acquireWave(dir, { ...request('claude'), rollingIntake: true }, async () => []);
  const cli = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('./wave-policy.mjs', import.meta.url)), ...args, '--run-dir', dir], { encoding: 'utf8' });
  const next = path.join(dir, 'wave-next.json');
  writeFileSync(next, JSON.stringify({ tracks: [track(2), track(3)] }));
  const queued = cli('enqueue', '--wave-id', wave.waveId, '--tracks-file', next);
  assert.equal(queued.status, 0, queued.stderr);
  const taken = cli('intake', '--wave-id', wave.waveId, '--finished', 'codex/1-fixture');
  assert.equal(taken.status, 0, taken.stderr);
  assert.deepEqual(JSON.parse(taken.stdout).taken.map(x => x.issue), [2, 3]);
  assert.deepEqual(JSON.parse(taken.stdout).finishedBranches, ['codex/1-fixture']);
  const released = cli('release', '--wave-id', wave.waveId, '--children-stopped');
  assert.equal(released.status, 0, released.stderr);
  assert.deepEqual(JSON.parse(released.stdout).pendingNeverTaken, []);
});

test('#5562: admission records whether the wave takes rolling intake', async t => {
  for (const [args, expected] of [[{ tracks: [track(1)] }, true], [{ tracks: [track(1)], rollingIntake: false }, false]]) {
    const dir = fixture(t);
    await handleHook({ session_id: 'claude-fixture', tool_name: 'Workflow', tool_input: { name: 'wave', args } }, dir, async () => [], now, () => undefined, () => process.pid);
    assert.equal(markerOf(dir).rollingIntake, expected);
  }
});

test('#5562: a lane spawn after the first dispatch does not touch the state lock', async t => {
  // Merges may now hold the lock during a wave; a spawn must not fail on it.
  const { dir } = runningWave(t, { dispatchStarted: true });
  const lane = { session_id: 'fixture-owner', tool_name: 'Agent', tool_input: { prompt: 'WAVE-LANE: fixture' } };
  await withWaveStateLock(dir, () => handleHook(lane, dir));
  const fresh = runningWave(t, { dispatchStarted: false });
  await handleHook(lane, fresh.dir);
  assert.equal(markerOf(fresh.dir).dispatchStarted, true);
});

test('#5562: disjoint files merge during a running wave, pinned to the checked head', t => {
  const { dir } = runningWave(t);
  const io = mergeIo();
  assert.equal(guardedMerge(dir, '42', 'owner/repo', io), 'merged');
  assert.deepEqual(io.calls, [{ pr: '42', repo: 'owner/repo', sha: HEAD }]);
  assert.deepEqual(assertMergeAllowed(dir, '42', () => prFiles('docs/other.md')), { allowed: true, wave: 'rolling-wave', pr: 42, files: 1 });
  assert.deepEqual(assertMergeAllowed(dir, undefined, () => assert.fail('no PR, no read')), { allowed: true, wave: 'rolling-wave' });
});

test('#5562: without a marker the merge is exactly the old idle merge', t => {
  const dir = fixture(t);
  const io = mergeIo({ readHead: () => assert.fail('no head read without a wave'), readFiles: () => assert.fail('no file read without a wave') });
  guardedMerge(dir, '42', 'owner/repo', io);
  assert.deepEqual(io.calls, [{ pr: '42', repo: 'owner/repo', sha: undefined }]);
  assert.deepEqual(assertMergeAllowed(dir, '42', () => assert.fail('no file read without a wave')), { allowed: true, wave: null });
});

test('#5562: overlap with the running wave blocks and names the file and the track', t => {
  const { dir } = runningWave(t);
  const io = mergeIo({ readFiles: () => prFiles('docs/other.md', 'scripts/one.mjs') });
  assert.throws(() => guardedMerge(dir, '42', 'owner/repo', io), /PR #42 file scripts\/one\.mjs overlaps running wave track #1/);
  assert.deepEqual(io.calls, []);
  assert.throws(() => assertMergeAllowed(dir, '42', () => prFiles('SCRIPTS/one.mjs')), /track #1/);
  assert.throws(() => assertMergeAllowed(dir, '42', () => [{ filename: 'docs/moved.mjs', previous_filename: 'scripts/one.mjs' }]), /file scripts\/one\.mjs/, 'a rename out of an owned path counts');
  enqueueTracks(dir, 'rolling-wave', [trackWith(2, ['docs/two.md'])], ownSnapshot);
  assert.throws(() => assertMergeAllowed(dir, '42', () => prFiles('docs/two.md')), /track #2/, 'queued tracks are part of the active set');
});

test('#5562: a glob that stops mid-segment blocks a matching PR file', t => {
  const { dir } = runningWave(t, { tracks: [trackWith(1, ['scripts/wave-*.mjs'])] });
  assert.throws(() => assertMergeAllowed(dir, '42', () => prFiles('scripts/wave-policy.mjs')), /track #1/);
  assert.throws(() => guardedMerge(dir, '42', 'owner/repo', mergeIo({ readFiles: () => prFiles('scripts/wave-freeze.mjs') })), /track #1/);
  assert.equal(assertMergeAllowed(dir, '42', () => prFiles('scripts/wavx.mjs')).allowed, true);
});

test('#5562: files owned by a finished track are free to merge', t => {
  const { dir } = runningWave(t, { tracks: [trackWith(1, ['scripts/one.mjs']), trackWith(2, ['docs/two.md'])] });
  assert.throws(() => assertMergeAllowed(dir, '42', () => prFiles('scripts/one.mjs')), /track #1/);
  intakeTracks(dir, 'rolling-wave', ['feat/1-fixture'], ownSnapshot);
  assert.equal(assertMergeAllowed(dir, '42', () => prFiles('scripts/one.mjs')).allowed, true);
  assert.throws(() => assertMergeAllowed(dir, '42', () => prFiles('docs/two.md')), /track #2/);
});

test('#5562: legacy, malformed and ownership-less markers still block every merge', t => {
  const modernWithout = { waveId: 'w', runtime: 'claude', owner: 'o' };
  for (const body of ['{"fixture":true}', '{broken', JSON.stringify(modernWithout),
    JSON.stringify({ ...modernWithout, tracks: [{ issue: 1, branch: 'feat/1-x' }] }),
    JSON.stringify({ ...modernWithout, tracks: [trackWith(1, ['a.md'])], pendingTracks: 'x' })]) {
    const dir = fixture(t);
    writeFileSync(path.join(dir, 'wave-active.json'), body);
    assert.throws(() => assertMergeAllowed(dir, undefined, () => []), /merge blocked/, body);
    assert.throws(() => assertMergeAllowed(dir, '42', () => []), /merge blocked/, body);
    const io = mergeIo({ readHead: () => assert.fail('a broken marker blocks before any GitHub read'), readFiles: () => assert.fail('no file read') });
    assert.throws(() => guardedMerge(dir, '42', 'owner/repo', io), /merge blocked/, body);
    assert.deepEqual(io.calls, []);
  }
});

test('#5562: an unfinished or unreadable PR file list blocks (fail-closed)', t => {
  const { dir } = runningWave(t);
  const readers = [() => { throw Error('offline'); }, () => ({ message: 'Not Found' }), () => [null], () => [{ filename: '' }],
    () => [{ filename: 'docs/a.md', previous_filename: 7 }], () => flattenPrFilePages([[{ filename: 'docs/a.md' }]], 2)];
  for (const readFiles of readers) {
    assert.throws(() => assertMergeAllowed(dir, '42', readFiles), /merge blocked/);
    const io = mergeIo({ readFiles });
    assert.throws(() => guardedMerge(dir, '42', 'owner/repo', io), /merge blocked/);
    assert.deepEqual(io.calls, []);
  }
  assert.throws(() => flattenPrFilePages({ message: 'x' }, 1), /not an array/);
  assert.throws(() => flattenPrFilePages([[{ filename: 'a' }], { x: 1 }], 1), /not an array/);
  assert.throws(() => flattenPrFilePages([[{ filename: 'a' }]], undefined), /incomplete/);
  assert.deepEqual(flattenPrFilePages([[{ filename: 'a' }], [{ filename: 'b' }]], 2), [{ filename: 'a' }, { filename: 'b' }]);
  assert.deepEqual(flattenPrFilePages([[]], 0), []);
  assert.deepEqual(findOwnershipConflicts({ tracks: [trackWith(1, ['docs/x.md'])] }, prFiles('docs/y.md')), []);
});

test('#5562: a push between the overlap check and the merge blocks it', t => {
  const { dir } = runningWave(t);
  let reads = 0;
  const moved = mergeIo({ readHead: () => (reads++ === 0 ? 'a' : 'b').repeat(40) });
  assert.throws(() => guardedMerge(dir, '42', 'owner/repo', moved), /head changed/);
  assert.deepEqual(moved.calls, []);
  const unknown = mergeIo({ readHead: () => undefined });
  assert.throws(() => guardedMerge(dir, '42', 'owner/repo', unknown), /head unavailable/);
  assert.deepEqual(unknown.calls, []);
});

test('#5562: only the merge call holds the state lock; the GitHub reads happen before it', t => {
  const { dir } = runningWave(t);
  const lockFree = () => withWaveStateLock(dir, () => 'free', 1);
  let during;
  const io = mergeIo({
    readHead: () => { assert.equal(lockFree(), 'free', 'head read must not hold the lock'); return HEAD; },
    readFiles: () => { assert.equal(lockFree(), 'free', 'file read must not hold the lock'); return prFiles('docs/other.md'); },
    merge: () => { try { lockFree(); during = 'free'; } catch (e) { during = e.message; } },
  });
  guardedMerge(dir, '42', 'owner/repo', io);
  assert.match(during, /lock busy/, 'the merge itself runs under the same lock as admission and intake');
});

test('#5562: intake waits out a merge that holds the state lock longer than the default wait', async t => {
  const { dir } = runningWave(t);
  enqueueTracks(dir, 'rolling-wave', [trackWith(2, ['docs/two.md'])], ownSnapshot);
  const moduleUrl = new URL('./wave-policy.mjs', import.meta.url).href;
  const ready = path.join(dir, 'holder-ready');
  // A separate process holds the lock for ~7 s - longer than the ~5 s default.
  const holder = spawn(process.execPath, ['--input-type=module', '-e', `import { writeFileSync } from 'node:fs';
    import { withWaveStateLock } from ${JSON.stringify(moduleUrl)};
    withWaveStateLock(${JSON.stringify(dir)}, () => { writeFileSync(${JSON.stringify(ready)}, 'x'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 7000); });`], { windowsHide: true });
  const exited = new Promise(resolve => holder.once('close', resolve));
  while (!existsSync(ready)) await new Promise(r => setTimeout(r, 25));
  assert.throws(() => updateWave(dir, 'rolling-wave', w => w), /lock busy/, 'default callers still give up');
  const taken = intakeTracks(dir, 'rolling-wave', [], ownSnapshot);
  assert.deepEqual(taken.taken.map(x => x.issue), [2]);
  assert.equal(await exited, 0);
});

test('#5562: assert-merge-allowed CLI passes without a marker and blocks a legacy one before GitHub', t => {
  const dir = fixture(t);
  const call = (...a) => spawnSync(process.execPath, [fileURLToPath(new URL('./wave-policy.mjs', import.meta.url)), 'assert-merge-allowed', '--run-dir', dir, ...a], { encoding: 'utf8' });
  assert.equal(call().status, 0);
  assert.equal(call('--pr', '42').status, 0, 'no marker: no GitHub read needed');
  assert.equal(call('--pr', 'abc').status, 2);
  writeFileSync(path.join(dir, 'wave-active.json'), '{"expiresAt":"2000-01-01"}');
  const blocked = call('--pr', '42');
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /Wave marker exists but is legacy or malformed; merge blocked/);
});
