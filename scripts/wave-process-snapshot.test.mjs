import test from 'node:test';
import assert from 'node:assert/strict';
import { processSnapshot } from './wave-process-snapshot.mjs';

const row = { pid: 42, ppid: 4, name: 'node.exe', commandLine: 'node "wave\\runner"', createdAt: '2026-11-02T12:00:00.000Z' };
const snapshot = (processes = [row]) => JSON.stringify({ bootId: 'fixture-boot', processes });

test('repairs literal JSON string controls without losing any process evidence', () => {
  const controls = String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i));
  const expected = { ...row, name: `node${controls}.exe`, commandLine: `node \\"${controls} secret-fixture` };
  const text = snapshot([expected]).replace(/\\u00([01][0-9a-f])|\\[bfnrt]/g, (escape, hex) => hex ? String.fromCharCode(parseInt(hex, 16)) : JSON.parse(`"${escape}"`));
  // Negative control for main's former direct parser, using the same fixture.
  assert.throws(() => JSON.parse(text), SyntaxError);
  assert.deepEqual(processSnapshot({ platform: 'win32', probe: () => text }).processes, [expected]);
});

test('valid JSON preserves escaped quotes, backslashes, null command lines and all rows', () => {
  const rows = [row, { ...row, pid: 43, commandLine: null }];
  assert.deepEqual(processSnapshot({ platform: 'win32', probe: () => snapshot(rows) }).processes, rows);
});

test('snapshot retries CIM failures and never returns partial evidence on exhaustion', () => {
  let calls = 0;
  const waits = [];
  const probe = () => {
    if (++calls < 3) throw Object.assign(new Error('private-command-fixture'), { status: 74, stderr: 'WAVE_CIM_TRANSIENT' });
    return snapshot();
  };
  assert.deepEqual(processSnapshot({ platform: 'win32', probe, wait: ms => waits.push(ms) }).processes, [row]);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [250, 500]);
  calls = 0;
  assert.throws(() => processSnapshot({ platform: 'win32', probe: () => { calls++; throw Object.assign(new Error('private-command-fixture'), { status: 74, stderr: 'WAVE_CIM_TRANSIENT' }); }, wait: () => {} }), error => error.code === 'WAVE_PROCESS_SNAPSHOT_UNAVAILABLE' && !error.stack.includes('private-command-fixture'));
  assert.equal(calls, 3);
});

test('malformed or incomplete snapshots fail closed without echoing command lines', () => {
  for (const text of ['{"secret-fixture":', snapshot([]), snapshot([{ pid: 42 }]), 'null', '{\u0001"processes":[]}']) {
    assert.throws(() => processSnapshot({ platform: 'win32', probe: () => text }), error => {
      assert.match(error.message, /Process snapshot unavailable/);
      assert.doesNotMatch(error.message, /secret-fixture/);
      return true;
    });
  }
});
