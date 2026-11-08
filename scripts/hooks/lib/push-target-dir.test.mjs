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

import { pushDestinations, guardTargets, LOCAL_BRANCH, ALL_BACKUP } from './push-target-dir.mjs';

test('pushDestinations: refspec, quoting, redirects og lokal branch (ejer 8/11, Codex P2)', () => {
  assert.deepEqual(pushDestinations('git push -q origin HEAD:refs/heads/wip/6181-x'), ['wip/6181-x']);
  assert.deepEqual(pushDestinations('cd /c/wt && FOO=1 git push origin HEAD:wip/a 2>&1 | tail -3'), ['wip/a']);
  assert.deepEqual(pushDestinations('git -C "/c/my wt" push origin feat/a:backup/a'), ['backup/a']);
  assert.deepEqual(pushDestinations('git push origin +HEAD:feat/b'), ['feat/b']);
  assert.deepEqual(pushDestinations('git push origin "HEAD:refs/heads/feat/review"'), ['feat/review']);
  assert.deepEqual(pushDestinations("git push origin 'HEAD:feat/review'"), ['feat/review']);
  assert.deepEqual(pushDestinations('git push -q origin HEAD'), [LOCAL_BRANCH]);
  assert.deepEqual(pushDestinations('git push'), [LOCAL_BRANCH]);
  assert.deepEqual(pushDestinations('git push -u origin feat/c'), ['feat/c']);
});

test('guardTargets: kun undtaget naar hvert maal er en backup-branch (Codex P2)', () => {
  assert.deepEqual(guardTargets('git push origin HEAD:wip/a'), [ALL_BACKUP]);
  assert.deepEqual(guardTargets('git push origin HEAD:wip/a HEAD:backup/b'), [ALL_BACKUP]);
  assert.deepEqual(guardTargets('git push origin HEAD:refs/heads/wip/s HEAD:refs/heads/feat/r'), ['feat/r']);
  assert.deepEqual(guardTargets('git push origin HEAD:wip/s && git push origin HEAD:feat/r'), ['feat/r']);
  assert.deepEqual(guardTargets('git push origin HEAD:wip/s && git push'), [LOCAL_BRANCH]);
  assert.deepEqual(guardTargets('git push origin HEAD:feat/wip-thing'), ['feat/wip-thing']);
  assert.deepEqual(guardTargets('echo hej'), []);
});

test('CLI --dest printer vagternes maal, ét pr. linje', () => {
  const run = (command) => spawnSync(process.execPath, [fileURLToPath(new URL('./push-target-dir.mjs', import.meta.url)), '--dest'], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8' }).stdout;
  assert.equal(run('cd /c/wt && git push -q origin HEAD:refs/heads/wip/x'), ALL_BACKUP);
  assert.equal(run('git push origin HEAD:wip/x HEAD:feat/a HEAD:feat/b'), ['feat/a', 'feat/b'].join(String.fromCharCode(10)));
});
