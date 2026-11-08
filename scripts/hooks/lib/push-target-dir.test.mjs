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

import { pushDestBranch, BACKUP_BRANCH_RE } from './push-target-dir.mjs';

test('pushDestBranch: eksplicit refspec giver destinationen, ellers null (ejer 8/11)', () => {
  assert.equal(pushDestBranch('git push -q origin HEAD:refs/heads/wip/6181-x'), 'wip/6181-x');
  assert.equal(pushDestBranch('cd /c/wt && FOO=1 git push origin HEAD:wip/a 2>&1 | tail -3'), 'wip/a');
  assert.equal(pushDestBranch('git -C "/c/my wt" push origin feat/a:backup/a'), 'backup/a');
  assert.equal(pushDestBranch('git push origin +HEAD:feat/b'), 'feat/b');
  assert.equal(pushDestBranch('git push -q origin HEAD'), null);
  assert.equal(pushDestBranch('git push'), null);
  assert.ok(BACKUP_BRANCH_RE.test('wip/6181-x'));
  assert.ok(!BACKUP_BRANCH_RE.test('feat/wip-thing'));
});

test('CLI --dest printer destinations-branchen', () => {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'cd /c/wt && git push -q origin HEAD:refs/heads/wip/x' } });
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./push-target-dir.mjs', import.meta.url)), '--dest'], { input, encoding: 'utf8' });
  assert.equal(r.stdout, 'wip/x');
});
