import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { recoverWave, processSnapshot } from './wave-recovery.mjs';
import { updateWave, readWave } from './wave-policy.mjs';

const now = 1790000000000;
function fixture(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-wave-recovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wave = { waveId: 'fixture-wave', owner: 'fixture-owner', runtime: 'codex', pid: 100,
    bootId: 'fixture-boot', dispatchStarted: true,
    processTracking: 'registered', children: [{ key: 'worker', pid: 200, state: 'running' }], ...extra };
  fs.writeFileSync(path.join(dir, 'wave-active.json'), JSON.stringify(wave));
  return { dir, wave };
}
const expected = { waveId: 'fixture-wave', owner: 'fixture-owner', now };
const sameBoot = processes => () => ({ bootId: 'fixture-boot', processes });
const nextBoot = processes => () => ({ bootId: 'next-boot', processes });

test('observed reboot proves the old tree stopped; evidence retained', t => {
  const { dir } = fixture(t);
  const result = recoverWave(dir, expected, nextBoot([{ pid: 999, ppid: 998 }]));
  assert.equal(result.released, true);
  assert.equal(fs.existsSync(path.join(dir, 'wave-active.json')), false);
  assert.ok(fs.existsSync(result.evidence));
});

test('living owner, worker or orphaned descendant keeps the marker', t => {
  const { dir } = fixture(t);
  for (const processes of [[{ pid: 100, ppid: 1 }], [{ pid: 200, ppid: 100 }], [{ pid: 300, ppid: 200 }]]) {
    assert.throws(() => recoverWave(dir, expected, sameBoot(processes)), /Same-boot/);
    assert.equal(fs.existsSync(path.join(dir, 'wave-active.json')), true);
  }
  updateWave(dir, expected.waveId, wave => ({ ...wave, children: [{ key: 'worker', pid: 200, state: 'stopped' }] }));
  assert.throws(() => recoverWave(dir, expected, sameBoot([{ pid: 300, ppid: 200 }])), /Same-boot/);
  // Both intermediate ancestors have disappeared from the current snapshot.
  assert.throws(() => recoverWave(dir, expected, sameBoot([{ pid: 400, ppid: 300 }])), /Same-boot/);
});

test('unknown process snapshot, missing owner PID, or incomplete spawn never releases', t => {
  const { dir } = fixture(t);
  assert.throws(() => recoverWave(dir, expected, () => { throw Error('unavailable'); }), /unavailable/);
  updateWave(dir, expected.waveId, wave => ({ ...wave, children: [{ key: 'worker', state: 'starting' }] }));
  assert.throws(() => recoverWave(dir, expected, sameBoot([])), /incomplete/);
  const missingOwner = fixture(t, { children: [], pid: null });
  assert.throws(() => recoverWave(missingOwner.dir, expected, sameBoot([])), /owner PID/);
  assert.equal(fs.existsSync(path.join(dir, 'wave-active.json')), true);
});

test('foreign ownership and legacy markers are rejected explicitly', t => {
  const { dir } = fixture(t);
  assert.throws(() => recoverWave(dir, { ...expected, owner: 'other' }, sameBoot([])), /owner/);
  fs.writeFileSync(path.join(dir, 'wave-active.json'), JSON.stringify({ tracks: [], expiresAt: '2000-01-01' }));
  assert.throws(() => recoverWave(dir, expected, sameBoot([])), /legacy/i);
  assert.equal(fs.existsSync(path.join(dir, 'wave-active.json')), true);
});

test('marker updates replace atomically and refuse a different wave', t => {
  const { dir } = fixture(t);
  updateWave(dir, expected.waveId, wave => ({ ...wave, watchPid: 456 }));
  assert.equal(readWave(dir).watchPid, 456);
  assert.throws(() => updateWave(dir, 'foreign', wave => wave), /owner/);
  assert.deepEqual(fs.readdirSync(dir), ['wave-active.json']);
});

test('Windows recovery measures a real stopped owner and refuses the live test process', { skip: process.platform !== 'win32' }, t => {
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(child.status, 0);
  const { dir } = fixture(t, { pid: process.pid, bootId: processSnapshot().bootId, dispatchStarted: false, children: [] });
  assert.throws(() => recoverWave(dir, expected), /alive/);
  const stopped = fixture(t, { pid: child.pid, bootId: processSnapshot().bootId, dispatchStarted: false, children: [] });
  assert.equal(recoverWave(stopped.dir, expected).released, true);
});

// #5533: Windows LastBootUpTime drifts sub-ms within one boot (23/9: +0.772 ms).
const markerTicks = '639256957975000000';
const driftedTicks = '639256957975007720';
const minutesLater = (BigInt(markerTicks) + 5n * 60n * 10_000_000n).toString();
const bootAt = bootId => processes => () => ({ bootId, processes });

test('sub-second boot drift is the same boot: a dispatched wave is never released as host-restarted', t => {
  const { dir } = fixture(t, { bootId: markerTicks });
  assert.throws(() => recoverWave(dir, expected, bootAt(driftedTicks)([{ pid: 999, ppid: 998 }])), /Same-boot/);
  assert.equal(fs.existsSync(path.join(dir, 'wave-active.json')), true);
});

test('sub-second boot drift before dispatch still recovers a dead owner as the same boot', t => {
  const { dir } = fixture(t, { bootId: markerTicks, dispatchStarted: false, children: [] });
  const result = recoverWave(dir, expected, bootAt(driftedTicks)([{ pid: 999, ppid: 998 }]));
  assert.equal(result.released, true);
  const evidence = JSON.parse(fs.readFileSync(result.evidence, 'utf8'));
  assert.equal(evidence.proof, 'dead-owner-before-dispatch');
  assert.equal(evidence.observedBootId, '639256957970000000');
});

test('a real restart minutes later is still recovered as host-restarted', t => {
  const { dir } = fixture(t, { bootId: markerTicks });
  const result = recoverWave(dir, expected, bootAt(minutesLater)([{ pid: 100, ppid: 1 }]));
  assert.equal(result.released, true);
  assert.equal(JSON.parse(fs.readFileSync(result.evidence, 'utf8')).proof, 'host-restarted');
});

test('recovery after reboot does not kill an old watch PID reused by another process', t => {
  const { dir } = fixture(t, { watchPid: process.pid, watchStarted: 'old-identity' });
  assert.equal(recoverWave(dir, expected, nextBoot([{ pid: process.pid, ppid: 1 }])).released, true);
});

test('a recovery crash lock from an earlier boot cannot block the next boot', t => {
  const { dir } = fixture(t);
  fs.writeFileSync(path.join(dir, 'wave-recovery-fixture-wave-old-boot.lock'), '');
  assert.equal(recoverWave(dir, expected, nextBoot([])).released, true);
});

test('Claude hook timeout covers the GitHub deadline with headroom', () => {
  const settings = JSON.parse(fs.readFileSync(new URL('../.claude/settings.json', import.meta.url)));
  const hook = settings.hooks.PreToolUse.flatMap(group => group.hooks).find(h => h.command.includes('guard-agent-spawn.sh'));
  assert.ok(hook.timeout >= 45);
});
