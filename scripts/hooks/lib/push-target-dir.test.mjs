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

const NL = String.fromCharCode(10);

test('review #7907 punkt 1: ikke-bogstavelige maal giver lokal branch og er aldrig backup', () => {
  for (const c of [
    'git push origin "$(git branch --show-current)"',
    'git push origin $(git branch --show-current)',
    'git push origin "$BRANCH"',
    'git push origin $BRANCH',
    'git push origin HEAD:$BRANCH',
    'git push origin HEAD:wip/$BRANCH',
    'git push origin HEAD:wip/$(x)',
    'git push origin wip/`x`',
    'git push origin `git branch --show-current`',
    'git push origin @',
    'git push origin "refs/heads/*:refs/heads/wip/*"',
  ]) assert.deepEqual(guardTargets(c), [LOCAL_BRANCH], c);
});

test('review #7907 punkt 2: ) og backtick afslutter navnet', () => {
  assert.deepEqual(pushDestinations('(cd wt && git push origin HEAD:feat/red)'), ['feat/red']);
  assert.deepEqual(pushDestinations('x=$(git push origin feat/red)'), ['feat/red']);
  assert.deepEqual(pushDestinations('x=`git push origin feat/red`'), ['feat/red']);
  assert.deepEqual(guardTargets('(git push origin HEAD:wip/a) && git push origin HEAD:feat/red'), ['feat/red']);
  assert.equal(pushTargetDir('(cd /c/wt && git push)'), '/c/wt');
});

test('review #7907 punkt 3: linjeskift afslutter kommandoen, fortsaettelseslinje goer ikke', () => {
  assert.deepEqual(guardTargets('git push' + NL + 'echo done'), [LOCAL_BRANCH]);
  assert.deepEqual(guardTargets('git push' + NL + 'gh pr checks 123'), [LOCAL_BRANCH]);
  assert.deepEqual(guardTargets('git push' + NL + 'cat wip/notes.txt'), [LOCAL_BRANCH]);
  assert.deepEqual(guardTargets('git push \\' + NL + '  origin HEAD:feat/red'), ['feat/red']);
});

test('review #7907 punkt 4: globale git-flag og push-omtale i strenge', () => {
  assert.deepEqual(guardTargets('git push origin HEAD:wip/a && git -c x=y push origin feat/red'), ['feat/red']);
  assert.deepEqual(guardTargets('git push origin HEAD:wip/a && git --no-pager push'), [LOCAL_BRANCH]);
  assert.deepEqual(guardTargets('git commit -m "git push origin wip/a" && git -c x=y push'), [LOCAL_BRANCH]);
  assert.deepEqual(guardTargets('git --no-pager -C "/c/my wt" -c a=b push origin HEAD:wip/a'), [ALL_BACKUP]);
  assert.deepEqual(guardTargets('git --git-dir /c/g --work-tree=/c/w push origin feat/red'), ['feat/red']);
  assert.deepEqual(guardTargets('git push origin HEAD:wip/a && git --ny-flag v push origin feat/red'), ['feat/red']);
  assert.deepEqual(guardTargets('git push origin HEAD:wip/a && bash -c "git push origin feat/red"'), [LOCAL_BRANCH]);
  assert.deepEqual(guardTargets('git push origin HEAD:wip/a --all'), [LOCAL_BRANCH]);
  assert.deepEqual(guardTargets('git log --oneline && git commit -m "git log"'), []);
  assert.equal(pushTargetDir('git --no-pager -C "/c/my wt" push'), '/c/my wt');
  assert.equal(pushTargetDir('git -c a=b -C /c/wt push origin HEAD'), '/c/wt');
  assert.equal(pushTargetDir('git -C "$W" push'), null);
  assert.equal(pushTargetDir('cd "$W" && git push'), null);
});

test('review #7907 punkt 5: redirects stopper ved ; | &', () => {
  assert.deepEqual(guardTargets('git push origin 2>&1;echo done'), [LOCAL_BRANCH]);
  assert.deepEqual(guardTargets('git push origin 2>&1;git push origin HEAD:feat/red'), [LOCAL_BRANCH, 'feat/red']);
  assert.deepEqual(guardTargets('git push origin HEAD:feat/red &>/dev/null&&echo wip/x'), ['feat/red']);
});

test('review #7907 punkt 8: backup-push i almindelige former tillades', () => {
  for (const c of [
    'git push origin HEAD:wip/a > /dev/null 2>&1',
    'git push origin HEAD:wip/a >/dev/null 2>&1',
    'git push origin HEAD:wip/a' + NL + 'echo done',
    'git push origin HEAD:wip/a 2>&1; echo done',
    'git push origin HEAD:wip/a 2>&1|grep x',
    'git push origin HEAD:"wip/a"',
    "git push origin 'HEAD':wip/a # git push origin feat/red",
  ]) assert.deepEqual(guardTargets(c), [ALL_BACKUP], c);
});
