import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const launcher = join(root, 'scripts/hooks/run-codex-hook.ps1');
const pwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '(Get-Process -Id $PID).Path'], {encoding:'utf8'}).stdout.trim();
const run = (script, input, env = process.env) => spawnSync(pwsh, ['-NoProfile', '-File', launcher, script], {cwd:root, input, encoding:'utf8', env});

test('configured command preserves blocking exit 2 through the outer PowerShell shell', () => {
  const config = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8'));
  const hook = config.hooks.PreToolUse.flatMap(group => group.hooks).find(hook => hook.command.includes('block-blocking-shell-commands.sh'));
  const result = spawnSync(pwsh, ['-NoProfile', '-Command', hook.command], {cwd:root, encoding:'utf8', input:JSON.stringify({tool_name:'Bash', tool_input:{command:'git diff'}})});
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /BLOCKED: git diff/);
});
test('observed Bash payload: git diff is blocked by shared pager guard', () => {
  const result = run('scripts/hooks/block-blocking-shell-commands.sh', JSON.stringify({tool_name:'Bash',tool_input:{command:'git diff'}}));
  assert.equal(result.status, 2); assert.match(result.stderr, /BLOCKED/);
});
test('observed Bash payload: explicit no-pager status is allowed', () => {
  const result = run('scripts/hooks/block-blocking-shell-commands.sh', JSON.stringify({tool_name:'Bash',tool_input:{command:'git --no-pager status -sb'}}));
  assert.equal(result.status, 0, result.stderr);
});
test('launcher propagates raw stdin, stdout, stderr and nonzero exit unchanged', () => {
  const fixture = mkdtempSync(join(root, '.codex.local/launcher-test-'));
  try {
    const script = join(fixture, 'transport.sh');
    writeFileSync(script, '#!/bin/bash\ncat\nprintf "stderr-fixture" >&2\nexit 7\n');
    const result = run(script, 'æøå\n{"tool_name":"X"}\n');
    assert.equal(result.status, 7); assert.equal(result.stdout, 'æøå\n{"tool_name":"X"}\n'); assert.equal(result.stderr, 'stderr-fixture');
  } finally { assert.ok(fixture.startsWith(join(root,'.codex.local'))); rmSync(fixture,{recursive:true,force:true}); }
});
test('missing Git runtime is a loud failure, never silent success', () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
  env.PATH = '';
  const result = run('scripts/hooks/block-blocking-shell-commands.sh', '{}', env);
  assert.equal(result.status, 2); assert.match(result.stderr, /CODEX HOOK STARTUP FAILED/);
});
