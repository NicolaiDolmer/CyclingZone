import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('full Claude hook accepts canonical admission once, preserves owner and refuses second wave', { skip: process.platform === 'win32' ? 'POSIX gh fixture; Windows hook smoke covered by test-guard-agent-spawn.sh' : false }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-hook-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin'), runDir = path.join(root, 'run');
  fs.mkdirSync(bin); fs.mkdirSync(runDir);
  const fakeGh = path.join(bin, 'gh');
  fs.writeFileSync(fakeGh, '#!/bin/sh\nprintf "[]"\n', { mode: 0o755 });
  const payload = { session_id: 'fixture-owner', tool_name: 'Workflow', tool_input: {
    scriptPath: '.claude/workflows/wave.js', args: { tracks: [{ issue: 1, branch: 'codex/fixture', ownership: ['fixtures/a'] }] },
  } };
  const invoke = () => spawnSync('bash', ['scripts/hooks/guard-agent-spawn.sh'], {
    input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CZ_AGENT_GUARD_RUN_DIR: runDir },
  });
  const first = invoke();
  assert.equal(first.status, 0, first.stderr);
  const original = fs.readFileSync(path.join(runDir, 'wave-active.json'), 'utf8');
  assert.equal(JSON.parse(original).runtime, 'claude');
  assert.equal(invoke().status, 2);
  assert.equal(fs.readFileSync(path.join(runDir, 'wave-active.json'), 'utf8'), original);
});
