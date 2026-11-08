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

import { pushDestinations, guardTargets, guardPlan, LOCAL_BRANCH, DELETED, ALL_EXEMPT } from './push-target-dir.mjs';

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
  assert.deepEqual(guardTargets('git push origin HEAD:wip/a'), [ALL_EXEMPT]);
  assert.deepEqual(guardTargets('git push origin HEAD:wip/a HEAD:backup/b'), [ALL_EXEMPT]);
  assert.deepEqual(guardTargets('git push origin HEAD:refs/heads/wip/s HEAD:refs/heads/feat/r'), ['feat/r']);
  assert.deepEqual(guardTargets('git push origin HEAD:wip/s && git push origin HEAD:feat/r'), ['feat/r']);
  assert.deepEqual(guardTargets('git push origin HEAD:wip/s && git push'), [LOCAL_BRANCH]);
  assert.deepEqual(guardTargets('git push origin HEAD:feat/wip-thing'), ['feat/wip-thing']);
  assert.deepEqual(guardTargets('echo hej'), []);
});

test('CLI --dest printer vagternes maal, ét pr. linje', () => {
  const run = (command) => spawnSync(process.execPath, [fileURLToPath(new URL('./push-target-dir.mjs', import.meta.url)), '--dest'], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8' }).stdout;
  assert.equal(run('cd /c/wt && git push -q origin HEAD:refs/heads/wip/x'), ALL_EXEMPT);
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
  assert.deepEqual(guardTargets('git --no-pager -C "/c/my wt" -c a=b push origin HEAD:wip/a'), [ALL_EXEMPT]);
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
  ]) assert.deepEqual(guardTargets(c), [ALL_EXEMPT], c);
});

test('sletninger er en sentinel, aldrig en tom liste (review 8/11)', () => {
  assert.deepEqual(pushDestinations('git push origin --delete feat/a feat/b'), [DELETED, DELETED]);
  for (const c of [
    'git push origin --delete feat/a',
    'git push --delete origin feat/a',
    'git push origin -d feat/a',
    'git push -fd origin feat/a',
    'git push origin :feat/a',
    'git push origin +:refs/heads/feat/a',
    'git push origin --delete "$BRANCH"',
    'git push origin :wip/a HEAD:backup/b',
  ]) assert.deepEqual(guardTargets(c), [ALL_EXEMPT], c);
  assert.deepEqual(guardTargets('git push origin :feat/a HEAD:feat/b'), ['feat/b']);
  assert.deepEqual(guardTargets('git push origin --delete feat/a && git push'), [LOCAL_BRANCH]);
});

test('ikke alt med kolon eller d er en sletning', () => {
  assert.deepEqual(guardTargets('git push origin :'), [LOCAL_BRANCH]);
  assert.deepEqual(guardTargets('git push origin :$BRANCH'), [LOCAL_BRANCH]);
  assert.deepEqual(guardTargets('git push -od origin feat/a'), ['feat/a']);
  assert.deepEqual(guardTargets('git push -o -d origin feat/a'), ['feat/a']);
  assert.deepEqual(guardTargets('git push --delete origin'), [LOCAL_BRANCH]);
  assert.deepEqual(guardTargets('git push origin --delete feat/a && git commit -m "git push"'), [LOCAL_BRANCH]);
});

test('--tags og --follow-tags sender mere end backup-maalet (Codex P2)', () => {
  assert.deepEqual(guardTargets('git push origin HEAD:wip/a --tags'), [LOCAL_BRANCH]);
  assert.deepEqual(guardTargets('git push --follow-tags origin HEAD:wip/a'), [LOCAL_BRANCH]);
  assert.deepEqual(guardTargets('git push origin HEAD:wip/a --no-tags'), [ALL_EXEMPT]);
});

test('guardPlan: hvert push har sin egen mappe (review 8/11)', () => {
  assert.deepEqual(guardPlan('git -C /c/a push origin feat/a && git -C "/c/b c" push'), [
    { dest: 'feat/a', dir: '/c/a' },
    { dest: LOCAL_BRANCH, dir: '/c/b c' },
  ]);
  assert.deepEqual(guardPlan('cd /c/wt && git -C /c/a push origin feat/a && git push'), [
    { dest: 'feat/a', dir: '/c/a' },
    { dest: LOCAL_BRANCH, dir: '/c/wt' },
  ]);
  assert.deepEqual(guardPlan('git -C "$W" push'), [{ dest: LOCAL_BRANCH, dir: null }]);
  assert.deepEqual(guardPlan('git -C /c/a push && git -C /c/a push'), [{ dest: LOCAL_BRANCH, dir: '/c/a' }]);
  assert.deepEqual(guardPlan('git -C /c/a push origin HEAD:wip/x && git -C /c/b push origin :feat/y'), [{ dest: ALL_EXEMPT, dir: null }]);
});

test('CLI --dest saetter mappen efter maalet med tab', () => {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git -C /c/a push origin feat/a && git push origin feat/b' } });
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./push-target-dir.mjs', import.meta.url)), '--dest'], { input, encoding: 'utf8' });
  assert.equal(r.stdout, ['feat/a\t/c/a', 'feat/b'].join(NL));
});

// Hook-niveau (review 8/11): de rigtige shell-vagter mod rigtige git-repoer og en falsk gh.
// Regressionen sad i selve hooken, saa parser-tests alene kunne ikke fange den.
import { after } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const HOOKS_DIR = fileURLToPath(new URL('..', import.meta.url));
const bash = process.platform === 'win32'
  ? join(resolve(spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim(), '../../..'), 'bin', 'bash.exe')
  : 'bash';

const sandbox = mkdtempSync(join(tmpdir(), 'push-guards-'));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const binDir = join(sandbox, 'bin');
const homeDir = join(sandbox, 'home');
const ghLog = join(sandbox, 'gh.log');
mkdirSync(binDir);
mkdirSync(homeDir);
// Falsk gh: en branch med "red" i navnet har roed CI, resten groen. Logger hvert opslag.
writeFileSync(join(binDir, 'gh'), [
  '#!/bin/bash',
  '[ "$1" = "auth" ] && exit 0',
  'branch=',
  'while [ $# -gt 0 ]; do [ "$1" = "--branch" ] && branch="$2"; shift; done',
  'printf "%s\\n" "$branch" >> "$GH_LOG"',
  'case "$branch" in *red*) c=failure ;; *) c=success ;; esac',
  'printf \'[{"conclusion":"%s","headSha":"abcdef1234","status":"completed"}]\\n\' "$c"',
  '',
].join(NL), { mode: 0o755 });

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

// Repo med en commit efter origin/main, saa der altid er noget at preflighte.
function makeRepo(name, branch) {
  const dir = join(sandbox, name);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'base.txt'), 'x');
  git(dir, 'add', 'base.txt');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  if (branch !== 'main') git(dir, 'checkout', '-q', '-b', branch);
  writeFileSync(join(dir, 'work.js'), 'x');
  git(dir, 'add', 'work.js');
  git(dir, 'commit', '-q', '-m', 'work');
  return dir;
}

// Faste tidspunkter (Codex P2): raekkefoelgen maa ikke afhaenge af vaeguret.
function stampPreflight(dir) {
  const stamp = join(dir, '.git', 'preflight-ok');
  writeFileSync(stamp, 'ok');
  const workTime = new Date('2020-01-01T00:00:00Z');
  const stampTime = new Date('2021-01-01T00:00:00Z');
  utimesSync(join(dir, 'work.js'), workTime, workTime);
  utimesSync(stamp, stampTime, stampTime);
}

function runHook(name, cwd, command) {
  rmSync(ghLog, { force: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'path'));
  Object.assign(env, { PATH: binDir + delimiter + process.env.PATH, HOME: homeDir, GH_LOG: ghLog });
  const r = spawnSync(bash, ['--noprofile', '--norc', join(HOOKS_DIR, name).replaceAll('\\', '/')], {
    cwd, env, encoding: 'utf8', timeout: 60_000,
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
  });
  assert.equal(r.status, 0, r.stderr);
  const looked = existsSync(ghLog) ? readFileSync(ghLog, 'utf8').trim().split(NL).map((l) => l.trim()) : [];
  return { denied: r.stdout.includes('"permissionDecision": "deny"'), looked, out: r.stdout };
}

const ci = (cwd, command) => runHook('check-ci-before-push.sh', cwd, command);
const preflight = (cwd, command) => runHook('check-preflight-before-push.sh', cwd, command);
const quotedDir = (dir) => '"' + dir.replaceAll('\\', '/') + '"';
const pushFrom = (dir, rest = 'origin HEAD') => `git -C ${quotedDir(dir)} push ${rest}`;

const redRepo = makeRepo('red', 'feat/red');
const greenRepo = makeRepo('green', 'feat/green');
const mainRepo = makeRepo('main', 'main');
const freshRepo = makeRepo('fresh', 'feat/fresh');
stampPreflight(freshRepo);

test('CI-vagten: push til main fra roed feature-branch afvises paa den lokale branch', () => {
  for (const c of ['git push origin HEAD:main', 'git push origin HEAD:refs/heads/master']) {
    const r = ci(redRepo, c);
    assert.ok(r.denied, c);
    assert.deepEqual(r.looked, ['feat/red'], c);
    assert.match(r.out, /feat\/red/, c);
  }
  assert.equal(ci(greenRepo, 'git push origin HEAD:main').denied, false);
});

test('CI-vagten: main selv blokeres aldrig og slaas ikke op', () => {
  for (const c of ['git push origin HEAD:main', 'git push origin main', 'git push']) {
    const r = ci(mainRepo, c);
    assert.equal(r.denied, false, c);
    assert.deepEqual(r.looked, [], c);
  }
});

test('CI-vagten: et feature-maal doemmes paa maalet, ikke den lokale branch', () => {
  const toRed = ci(greenRepo, 'git push origin HEAD:feat/red-target');
  assert.ok(toRed.denied);
  assert.deepEqual(toRed.looked, ['feat/red-target']);
  const toGreen = ci(redRepo, 'git push origin HEAD:feat/green-target');
  assert.equal(toGreen.denied, false);
  assert.deepEqual(toGreen.looked, ['feat/green-target']);
  assert.ok(ci(redRepo, 'git push').denied);
  assert.ok(ci(mainRepo, 'git push origin feat/red').denied);
});

test('CI-vagten: backup og sletning af en doed roed branch afvises ikke', () => {
  for (const c of [
    'git push origin HEAD:wip/x',
    'git push origin --delete feat/dead-red',
    'git push origin -d feat/dead-red',
    'git push origin :feat/dead-red',
  ]) {
    const r = ci(redRepo, c);
    assert.equal(r.denied, false, c);
    assert.deepEqual(r.looked, [], c);
  }
  assert.ok(ci(greenRepo, 'git push origin :feat/dead-red HEAD:feat/red-x').denied);
  assert.ok(ci(redRepo, 'git push origin --delete feat/dead-red && git push').denied);
});

test('CI-vagten: hvert -C i kaedede pushes bruges', () => {
  const greenFirst = ci(mainRepo, `${pushFrom(greenRepo)} && ${pushFrom(redRepo)}`);
  assert.ok(greenFirst.denied);
  assert.deepEqual(greenFirst.looked, ['feat/green', 'feat/red']);
  const redFirst = ci(mainRepo, `${pushFrom(redRepo)} && ${pushFrom(greenRepo)}`);
  assert.ok(redFirst.denied);
  assert.deepEqual(redFirst.looked, ['feat/red']);
  // Et push uden -C koerer fra sessionens cwd, ikke fra det foregaaende -C.
  assert.ok(ci(redRepo, `${pushFrom(greenRepo)} && git push`).denied);
  assert.equal(ci(greenRepo, `${pushFrom(mainRepo)} && git push`).denied, false);
  assert.ok(ci(mainRepo, pushFrom(redRepo, 'origin HEAD:main')).denied);
});

test('preflight-vagten: vurderer maalet som CI-vagten', () => {
  assert.ok(preflight(redRepo, 'git push origin HEAD:main').denied);
  assert.ok(preflight(redRepo, 'git push').denied);
  assert.equal(preflight(freshRepo, 'git push origin HEAD:main').denied, false);
  assert.equal(preflight(freshRepo, 'git push').denied, false);
  assert.equal(preflight(mainRepo, 'git push origin HEAD:main').denied, false);
  assert.equal(preflight(mainRepo, 'git push').denied, false);
  assert.ok(preflight(mainRepo, 'git push origin HEAD:feat/from-main').denied);
});

test('preflight-vagten: backup og sletning kraever ikke preflight', () => {
  for (const c of ['git push origin HEAD:wip/x', 'git push origin --delete feat/old', 'git push origin :feat/old']) {
    assert.equal(preflight(redRepo, c).denied, false, c);
  }
  assert.ok(preflight(redRepo, 'git push origin :feat/old HEAD:feat/new').denied);
});

test('preflight-vagten: hvert -C i kaedede pushes bruges', () => {
  assert.ok(preflight(mainRepo, `${pushFrom(freshRepo)} && ${pushFrom(redRepo)}`).denied);
  assert.ok(preflight(mainRepo, `${pushFrom(redRepo)} && ${pushFrom(freshRepo)}`).denied);
  assert.equal(preflight(mainRepo, `${pushFrom(freshRepo)} && ${pushFrom(freshRepo, 'origin HEAD:feat/other')}`).denied, false);
  assert.ok(preflight(redRepo, `${pushFrom(freshRepo)} && git push`).denied);
});
