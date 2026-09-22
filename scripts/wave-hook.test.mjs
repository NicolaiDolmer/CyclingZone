import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { acquireWave } from './wave-policy.mjs';

test('full Claude hook requires registered admission and permits only its owner to resume', { skip: process.platform === 'win32' ? 'POSIX gh fixture; Windows hook smoke covered by test-guard-agent-spawn.sh' : false }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-hook-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin'), runDir = path.join(root, 'run');
  fs.mkdirSync(bin); fs.mkdirSync(runDir);
  const fakeGh = path.join(bin, 'gh');
  fs.writeFileSync(fakeGh, '#!/bin/sh\nprintf "[]"\n', { mode: 0o755 });
  const payload = { session_id: 'fixture-owner', tool_name: 'Workflow', tool_input: {
    scriptPath: '.claude/workflows/wave.js', args: { tracks: [{ issue: 1, branch: 'codex/fixture', ownership: ['fixtures/a'] }] },
  } };
  const invoke = (input = payload) => spawnSync('bash', ['scripts/hooks/guard-agent-spawn.sh'], {
    input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CZ_AGENT_GUARD_RUN_DIR: runDir },
  });
  const first = invoke();
  assert.equal(first.status, 2, first.stderr);
  assert.match(first.stderr, /Cannot verify admission owner process/);
  assert.equal(fs.existsSync(path.join(runDir, 'wave-active.json')), false);
  await acquireWave(runDir, { runtime: 'claude', owner: payload.session_id, pid: process.pid,
    now: 1790000000000, workflowRunId: 'fixture-run', tracks: payload.tool_input.args.tracks }, async () => []);
  const original = fs.readFileSync(path.join(runDir, 'wave-active.json'), 'utf8');
  assert.equal(JSON.parse(original).runtime, 'claude');
  const resume = { tool_name: 'Workflow', session_id: payload.session_id, tool_input: { resumeFromRunId: 'fixture-run' } };
  const own = invoke(resume);
  assert.equal(own.status, 0, own.stderr);
  assert.match(invoke({ ...resume, session_id: 'foreign-session' }).stderr, /Another session owns this wave/);
  assert.equal(invoke().status, 2);
  assert.equal(fs.readFileSync(path.join(runDir, 'wave-active.json'), 'utf8'), original);
});
