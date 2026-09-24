import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('session claim persists across turns and removes only its own session on SessionEnd', t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-session-claim-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '--quiet', fixture]).status, 0);
  const invoke = (mode, session_id) => spawnSync('pwsh', ['-NoProfile', '-File', path.join(root, 'scripts/hooks/codex-session-claim.ps1'), '-Mode', mode, '-NowMs', '1790000000000'], {
    cwd: fixture, input: JSON.stringify({ session_id }), encoding: 'utf8',
  });
  const first = invoke('start', 'fixture-a');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(invoke('start', 'fixture-b').status, 0);
  const a = path.join(fixture, '.claude/run/agent-sessions/codex-fixture-a.json');
  const b = path.join(fixture, '.claude/run/agent-sessions/codex-fixture-b.json');
  assert.equal(JSON.parse(fs.readFileSync(a)).startedAt, 1790000000000);
  const hooks = JSON.parse(fs.readFileSync(path.join(root, '.codex/hooks.json'))).hooks;
  assert.ok(!JSON.stringify(hooks.Stop).includes('codex-session-claim'));
  assert.ok(JSON.stringify(hooks.SessionEnd).includes('-Mode stop'));
  assert.equal(invoke('start', 'fixture-a').status, 0);
  assert.equal(fs.existsSync(a), true);
  assert.equal(invoke('stop', 'fixture-a').status, 0);
  assert.equal(fs.existsSync(a), false);
  assert.equal(fs.existsSync(b), true);
});
