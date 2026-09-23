import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquireWave, releaseWave, checkCapacity, validateTracks, handleHook, updateWave, withIdleWaveLock } from './wave-policy.mjs';
import { assertWaveOwnership } from './wave-ownership.mjs';

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
