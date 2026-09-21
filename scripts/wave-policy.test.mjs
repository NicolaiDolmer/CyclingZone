import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquireWave, releaseWave, checkCapacity, validateTracks, handleHook } from './wave-policy.mjs';

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

test('capacity includes drafts and reserves all planned new PRs', () => {
  const prs = [1, 2, 3, 4, 5, 6, 7].map(n => ({ number: n, headRefName: `other/${n}`, isDraft: true }));
  assert.equal(checkCapacity(prs, [track(10)]).projected, 8);
  assert.throws(() => checkCapacity(prs, [track(10), track(11)]), /PR/);
  assert.throws(() => checkCapacity([...prs, { number: 8 }], [track(10)]), /PR/);
  assert.throws(() => checkCapacity(null, [track(10)]), /PR/);
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

test('Claude Workflow admission uses the same code and cap; dry-run never reserves', async (t) => {
  const dir = fixture(t);
  const payload = { session_id: 'claude-fixture', tool_name: 'Workflow', tool_input: {
    scriptPath: 'C:/Dev/CyclingZone/.claude/workflows/wave.js', args: { tracks: [track(1)] },
  } };
  const full = async () => [1, 2, 3, 4, 5, 6, 7, 8].map(number => ({ number }));
  await assert.rejects(handleHook(payload, dir, full, now), /PR/);
  payload.tool_input.args.dryRun = true;
  await handleHook(payload, dir, full, now);
  assert.equal(existsSync(path.join(dir, 'wave-active.json')), false);
  payload.tool_input.args.dryRun = false;
  await handleHook(payload, dir, async () => [], now);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'wave-active.json'))).runtime, 'claude');
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
