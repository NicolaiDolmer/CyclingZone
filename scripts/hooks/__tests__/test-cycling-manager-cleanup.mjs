// Prøver for SessionStart-oprydningen scripts/hooks/cycling-manager-cleanup.sh (#8240).
//
// Hooken blev omskrevet til samlede git-opslag (een worktree-liste, een
// --merged-liste, een `git branch -D`) i stedet for 3-4 git-processer pr. gren.
// Prøverne laaser de samme filtre fast i et engangs-repo i temp-mappen:
// flettede feature-grene uden worktree slettes; alt andet bliver staaende.
// Grenen med merged claude/*-worktree under .claude/worktrees roeres ikke her
// (den sti kalder pwsh + OneDrive-arkiv); aktivitets-vagten dækkes af et nyt
// claude-worktree der skal blive staaende.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const hook = join(root, 'scripts/hooks/cycling-manager-cleanup.sh');
const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim();
const bash = process.platform === 'win32' ? join(resolve(execPath, '../../..'), 'bin', 'bash.exe') : 'bash';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
const commit = (cwd, file, msg) => { writeFileSync(join(cwd, file), msg); git(cwd, 'add', file); git(cwd, 'commit', '-q', '-m', msg); };
const branches = (cwd) => git(cwd, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/').split('\n').filter(Boolean).sort();
const runHook = (cwd) => spawnSync(bash, ['--noprofile', '--norc', hook], { cwd, encoding: 'utf8', input: '{}' });

// Engangs-repo med origin hvis sti indeholder repo-navnet (hookens fjernsikring).
function setup(originName) {
  const base = mkdtempSync(join(tmpdir(), 'cm-cleanup-'));
  const origin = join(base, `${originName}.git`);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  const repo = join(base, 'repo');
  execFileSync('git', ['clone', '-q', origin, repo], { stdio: 'ignore' });
  git(repo, 'checkout', '-q', '-b', 'main');
  commit(repo, 'a.txt', 'one');
  commit(repo, 'b.txt', 'two');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  // Flettede grene (peger paa en commit paa main).
  for (const b of ['fix/merged', 'chore/merged', 'investigate/merged', 'docs/in-lane', 'claude/active']) git(repo, 'branch', b, 'main~1');
  // Ufflettet gren.
  git(repo, 'checkout', '-q', '-b', 'feat/unmerged');
  commit(repo, 'c.txt', 'three');
  git(repo, 'checkout', '-q', 'main');
  // Lane-worktree uden for repoet paa en flettet gren -> grenen skal bevares.
  git(repo, 'worktree', 'add', '-q', join(base, 'lane'), 'docs/in-lane');
  // Nyt (aktivt) claude-worktree under .claude/worktrees -> skal bevares.
  mkdirSync(join(repo, '.claude/worktrees'), { recursive: true });
  git(repo, 'worktree', 'add', '-q', join(repo, '.claude/worktrees/active'), 'claude/active');
  // Forældreløs mappe uden .git -> skal ryddes.
  mkdirSync(join(repo, '.claude/worktrees/orphan/x'), { recursive: true });
  writeFileSync(join(repo, '.claude/worktrees/orphan/x/f'), 'x');
  // origin/main rykker frem fra en anden klon -> lokal main skal fast-forwardes.
  const other = join(base, 'other');
  execFileSync('git', ['clone', '-q', origin, other], { stdio: 'ignore' });
  commit(other, 'd.txt', 'four');
  git(other, 'push', '-q', 'origin', 'main');
  return { base, repo, originHead: git(other, 'rev-parse', 'HEAD') };
}

test('CyclingZone-repo: kun flettede feature-grene uden worktree slettes, orphan ryddes, main fast-forwardes', () => {
  const { base, repo, originHead } = setup('CyclingZone-origin');
  try {
    const res = runHook(repo);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(branches(repo), ['claude/active', 'docs/in-lane', 'feat/unmerged', 'investigate/merged', 'main']);
    assert.equal(existsSync(join(repo, '.claude/worktrees/orphan')), false, 'orphan-mappen skal vaere ryddet');
    assert.equal(existsSync(join(repo, '.claude/worktrees/active')), true, 'aktivt claude-worktree skal bevares');
    assert.equal(git(repo, 'rev-parse', 'main'), originHead, 'main skal vaere fast-forwardet til origin/main');
    // Taellingen er nu korrekt (foer #8240 gik grene-taelleren tabt i en subshell).
    assert.equal(res.stdout.trim(), '{"systemMessage": "Worktree-cleanup: ryddet 1 orphan dir(s), 2 branch(es)."}');
    // Anden koersel: intet tilbage at rydde -> ingen besked.
    const again = runHook(repo);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.stdout, '');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('fremmed repo (origin uden CyclingZone i navnet) roeres ikke', () => {
  const { base, repo } = setup('some-other-project');
  try {
    const before = branches(repo);
    const res = runHook(repo);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, '');
    assert.deepEqual(branches(repo), before);
    assert.equal(existsSync(join(repo, '.claude/worktrees/orphan')), true);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('uden for et git-repo: exit 0 og ingen output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-cleanup-nogit-'));
  try {
    const res = runHook(dir);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
