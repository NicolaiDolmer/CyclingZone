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
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, utimesSync, readdirSync, copyFileSync } from 'node:fs';
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

// Samlet pwsh-fjernelse (#8246/#8269): to flettede, gamle claude/*-worktrees; det foerste
// er laast (fjernelsen fejler, det skal blive), det andet har en apostrof i stien (ps_q)
// og skal fjernes. Svaret er kandidatens indeks, saa et forkert indeks ville ramme det
// forkerte worktree/gren.
test('samlet pwsh-fjernelse: indeks-mapping og apostrof i sti', { skip: spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status !== 0 }, () => {
  const { base, repo } = setup('CyclingZone-origin');
  const archive = join(base, 'archive');
  try {
    // Hooken dot-sourcer arkiv-biblioteket fra repoets egen scripts-mappe.
    mkdirSync(join(repo, 'scripts/lib'), { recursive: true });
    copyFileSync(join(root, 'scripts/lib/archive-worktree-unversioned.ps1'), join(repo, 'scripts/lib/archive-worktree-unversioned.ps1'));
    copyFileSync(join(root, 'scripts/lib/balance-internals.ps1'), join(repo, 'scripts/lib/balance-internals.ps1'));
    copyFileSync(join(root, 'scripts/close-out-cleanup-junctions.ps1'),join(repo, 'scripts/close-out-cleanup-junctions.ps1'));
    // Fast referencetid (regel 16): hooken faar samme tidspunkt via CZ_CLEANUP_NOW_EPOCH.
    const NOW_EPOCH = 1893456000; // 2030-01-01T00:00:00Z
    const old = new Date((NOW_EPOCH - 3 * 3600) * 1000);
    const locked = join(repo, '.claude/worktrees/a-locked');
    const quoted = join(repo, ".claude/worktrees/b-o'quote");
    git(repo, 'branch', 'claude/locked', 'main~1');
    git(repo, 'branch', 'claude/quoted', 'main~1');
    git(repo, 'worktree', 'add', '-q', locked, 'claude/locked');
    git(repo, 'worktree', 'add', '-q', quoted, 'claude/quoted');
    git(repo, 'worktree', 'lock', locked);
    utimesSync(locked, old, old);
    utimesSync(quoted, old, old);
    const res = spawnSync(bash, ['--noprofile', '--norc', hook], { cwd: repo, encoding: 'utf8', input: '{}', env: { ...process.env, CZ_WORKTREE_ARCHIVE_ROOT: archive, CZ_CLEANUP_NOW_EPOCH: String(NOW_EPOCH) } });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(existsSync(quoted), false, 'worktree med apostrof skal vaere fjernet');
    assert.equal(existsSync(locked), true, 'laast worktree skal blive');
    const bs = branches(repo);
    assert.equal(bs.includes('claude/quoted'), false, 'grenen for det fjernede worktree skal vaere slettet');
    assert.equal(bs.includes('claude/locked'), true, 'grenen for det beholdte worktree skal blive');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// Et tag ved navn "origin/main" maa aldrig vinde over remote-branchen.
test('tag ved navn origin/main forvirrer ikke hooken', () => {
  const { base, repo, originHead } = setup('CyclingZone-origin');
  try {
    git(repo, 'tag', 'origin/main', git(repo, 'rev-parse', 'feat/unmerged'));
    const res = runHook(repo);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(git(repo, 'rev-parse', 'main'), originHead, 'main skal fast-forwardes til remote-branchen, ikke til tagget');
    assert.equal(branches(repo).includes('feat/unmerged'), true);
    assert.equal(branches(repo).includes('fix/merged'), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('logfilen i temp-mappen ryddes efter koerslen', () => {
  const { base, repo } = setup('CyclingZone-origin');
  const tmp = join(base, 'tmpdir');
  mkdirSync(tmp);
  try {
    const res = spawnSync(bash, ['--noprofile', '--norc', hook], { cwd: repo, encoding: 'utf8', input: '{}', env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp } });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(readdirSync(tmp), [], 'mktemp-logfilen skal vaere slettet');
  } finally { rmSync(base, { recursive: true, force: true }); }
});
