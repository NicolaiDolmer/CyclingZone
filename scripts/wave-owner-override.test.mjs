import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ownerOverride, matchingProcesses } from './wave-owner-override.mjs';

const now = 1790000000000;
const wave = { waveId: 'fixture-wave', runtime: 'codex', owner: 'fixture-owner', pid: 101, watchPid: 303,
  tracks: [{ issue: 1, branch: 'codex/fixture', worktree: 'C:/fixtures/lane' }], children: [{ pid: 202 }] };
const rows = [
  { pid: 101, ppid: 1, name: 'node.exe', commandLine: 'node runner', createdAt: 'fixed' },
  { pid: 202, ppid: 101, name: 'pwsh.exe', commandLine: 'pwsh', createdAt: 'fixed' },
  { pid: 303, ppid: 1, name: 'pwsh.exe', commandLine: 'wave-lane-watch.ps1', createdAt: 'fixed' },
  { pid: 404, ppid: 1, name: 'node.exe', commandLine: 'node C:\\fixtures\\lane\\script.js --token=SECRET', createdAt: 'fixed' },
  { pid: 505, ppid: 1, name: 'node.exe', commandLine: 'node C:\\fixtures\\lane-other\\script.js', createdAt: 'fixed' },
];
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-owner-override-'));
  fs.writeFileSync(path.join(dir, 'wave-active.json'), JSON.stringify(wave));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function io(extra = {}) {
  return { isTTY: true, outputIsTTY: true, snapshot: () => ({ bootId: 'fixture', processes: rows }),
    write: () => {}, ask: async phrase => phrase, now: () => now, identity: () => ({ user: 'fixture-user', host: 'fixture-host' }), ...extra };
}

test('overview matches registered PIDs, worktree boundaries and watch without exposing command arguments', () => {
  const result = matchingProcesses(wave, ['C:/fixtures/lane'], rows);
  assert.deepEqual(result.map(p => p.pid), [101, 202, 303, 404]);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
});

test('non-TTY CLI cannot read or mutate a marker even with a piped confirmation', t => {
  const dir = fixture(t);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./wave-policy.mjs', import.meta.url)), 'recover', '--owner-override', '--run-dir', dir], { input: 'FRIGIV BOELGE fixture-wave\n', encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /TTY/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'wave-active.json'))), wave);
});

test('wrong phrase preserves the marker', async t => {
  const dir = fixture(t);
  await assert.rejects(ownerOverride(dir, io({ ask: async () => 'yes' })), /confirmation/);
  assert.ok(fs.existsSync(path.join(dir, 'wave-active.json')));
});

test('confirmed fixture logs user, host, time and displayed process overview; kills no process', async t => {
  const dir = fixture(t), output = [];
  const result = await ownerOverride(dir, io({ write: line => output.push(line) }));
  assert.equal(result.released, true);
  assert.ok(!fs.existsSync(path.join(dir, 'wave-active.json')));
  const audit = JSON.parse(fs.readFileSync(result.evidence));
  assert.deepEqual(audit.confirmedBy, { user: 'fixture-user', host: 'fixture-host' });
  assert.equal(audit.confirmedAt, now);
  assert.equal(audit.processes.length, 4);
  assert.ok(output.join('\n').includes('404'));
  assert.ok(!output.join('\n').includes('SECRET'));
});

test('changed marker or newly matched process during confirmation aborts', async t => {
  const dir = fixture(t);
  await assert.rejects(ownerOverride(dir, io({ ask: async phrase => {
    fs.writeFileSync(path.join(dir, 'wave-active.json'), JSON.stringify({ ...wave, owner: 'another-owner' })); return phrase;
  } })), /changed/);
  fs.writeFileSync(path.join(dir, 'wave-active.json'), JSON.stringify(wave));
  let calls = 0;
  await assert.rejects(ownerOverride(dir, io({ snapshot: () => ({ bootId: 'fixture', processes: ++calls === 1 ? rows : [...rows, { pid: 606, ppid: 202, name: 'new.exe', createdAt: 'new' }] }) })), /new process/i);
  assert.ok(fs.existsSync(path.join(dir, 'wave-active.json')));
});

test('confirmation-time process snapshot is taken while the state lock is held', async t => {
  const dir = fixture(t);
  let calls = 0;
  await ownerOverride(dir, io({ snapshot: () => {
    if (++calls === 2) assert.ok(fs.readdirSync(dir).some(name => /^wave-state-.*\.lock$/.test(name)));
    return { bootId: 'fixture', processes: rows };
  } }));
});
