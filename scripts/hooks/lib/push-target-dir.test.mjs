import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pushTargetDir } from './push-target-dir.mjs';

test('pushTargetDir: uquotet, enkelt- og dobbeltquotet cd samt git -C (Codex P2 #7660)', () => {
  assert.equal(pushTargetDir('cd /c/wt && git push'), '/c/wt');
  assert.equal(pushTargetDir("cd '/c/my wt' && git push"), '/c/my wt');
  assert.equal(pushTargetDir('cd "/c/my wt" && git push -q origin HEAD'), '/c/my wt');
  assert.equal(pushTargetDir('git -C "/c/wt 2" push'), '/c/wt 2');
  assert.equal(pushTargetDir("git -C '/c/wt' push"), '/c/wt');
  assert.equal(pushTargetDir('git push'), null);
});

test('CLI laeser hook-JSON, hvor dobbelte anfoerselstegn er JSON-escaped', () => {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'cd "/c/my wt" && git push' } });
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./push-target-dir.mjs', import.meta.url))], { input, encoding: 'utf8' });
  assert.equal(r.stdout, '/c/my wt');
});
