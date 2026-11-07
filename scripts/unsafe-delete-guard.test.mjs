import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkCommand, SAFE_REMOVERS, gitBashToNative } from './unsafe-delete-guard.mjs';

const none = { readScript: () => null, isTracked: () => false, listWorktrees: () => [] };

test('7/11-haendelsen: raa git worktree remove blokeres', () => {
  assert.equal(checkCommand('git worktree remove --force --force "C:/dev/CyclingZone-worktrees/x"', none).blocked, true);
  assert.equal(checkCommand('git -C C:/dev/CyclingZone worktree remove C:/dev/CyclingZone-worktrees/x', none).blocked, true);
  assert.equal(checkCommand('cd /c/dev/CyclingZone && git worktree remove ../x', none).blocked, true);
});

test('7/11-haendelsen: ad hoc-script med rmSync-fallback blokeres', () => {
  const body = "const run = c => execSync(c); run(`git worktree remove --force --force \"${p}\"`); rmSync(p, { recursive: true, force: true });";
  const v = checkCommand('node "C:/Users/x/AppData/Local/Temp/scratchpad/remove.mjs"', { readScript: () => body, isTracked: () => false });
  assert.equal(v.blocked, true);
  assert.match(v.message, /remove-worktree\.ps1/);
});

test('script med rekursiv sletning og ordet worktree blokeres', () => {
  const body = 'for (const w of worktrees) fs.rm(w, { recursive: true })';
  assert.equal(checkCommand('node clean.mjs', { readScript: () => body, isTracked: () => false }).blocked, true);
});

test('rekursiv sletning mod beskyttede stier blokeres', () => {
  for (const c of [
    'rm -rf /c/dev/CyclingZone-worktrees/fix-1',
    'rm -r "$USERPROFILE/OneDrive/CyclingZone-context/balance-internals/1857"',
    'Remove-Item -Recurse -Force C:\\dev\\CyclingZone-worktrees\\fix-1',
    'cmd /c rmdir /s /q C:\\dev\\CZ-6665',
    'rm -rf "$LOCALAPPDATA/CyclingZone/node-modules-cache/root-1"',
  ]) assert.equal(checkCommand(c, none).blocked, true, c);
});

test('review #7839: pipeline efter printf/echo vurderes stadig', () => {
  assert.equal(checkCommand('printf start | git worktree remove --force /c/dev/CyclingZone-worktrees/fix-1', none).blocked, true);
  assert.equal(checkCommand('echo x | rm -rf /c/dev/CyclingZone-worktrees/fix-1', none).blocked, true);
});

test('review #7839: relative maal oploeses mod cwd', () => {
  const inWt = { ...none, cwd: '/c/dev/CyclingZone-worktrees/keep' };
  assert.equal(checkCommand('rm -rf ../fix-1', inWt).blocked, true);
  assert.equal(checkCommand('rm -rf .', inWt).blocked, true);
  assert.equal(checkCommand('Remove-Item -Recurse -Force ..\\fix-1', inWt).blocked, true);
  assert.equal(checkCommand('rm -rf frontend/dist', inWt).blocked, false);
  assert.equal(checkCommand('rm -rf node_modules/.vite', inWt).blocked, false);
  assert.equal(checkCommand('rm -rf frontend/dist', { ...none, cwd: '/c/dev/CyclingZone' }).blocked, false);
});

test('Codex-review #7839: mappe der indeholder worktrees eller cwd blokeres', () => {
  const inWt = { ...none, cwd: '/c/dev/CyclingZone-worktrees/keep', listWorktrees: () => ['/c/dev/CyclingZone', '/c/dev/CyclingZone-worktrees/keep'] };
  assert.equal(checkCommand('rm -rf ../..', inWt).blocked, true);
  assert.equal(checkCommand('rm -rf ..', inWt).blocked, true);
  const inRepoSub = { ...none, cwd: '/c/dev/CyclingZone/frontend', listWorktrees: () => ['/c/dev/CyclingZone'] };
  assert.equal(checkCommand('rm -rf ..', inRepoSub).blocked, true);
  assert.equal(checkCommand('rm -rf dist', inRepoSub).blocked, false);
});

test('Codex-review #7839: ad hoc-script med fast relativ sti uden ordet worktree blokeres', () => {
  const opts = { cwd: '/c/dev/CyclingZone-worktrees/keep', readScript: () => "import fs from 'node:fs';\nfs.rmSync('../victim', { recursive: true });", isTracked: () => false, listWorktrees: () => [] };
  assert.equal(checkCommand('node clean.mjs', opts).blocked, true);
  const okScript = { ...opts, readScript: () => "import fs from 'node:fs';\nfs.rmSync('dist', { recursive: true });" };
  assert.equal(checkCommand('node clean.mjs', okScript).blocked, false);
});

test('sikre veje og almindeligt arbejde blokeres ikke', () => {
  for (const c of [
    'pwsh -File scripts/remove-worktree.ps1 -Branch fix/abc',
    'pwsh -File scripts/prune-merged-worktrees.ps1 -Execute',
    'git worktree list --porcelain',
    'git worktree add ../x -b fix/x',
    'rm -rf frontend/dist',
    'rm -f /c/dev/CyclingZone-worktrees/a-msg.txt',
    'gh issue comment 1 --body "brug aldrig git worktree remove --force"',
    'git commit -m "docs: git worktree remove er forbudt"',
    'node --test scripts/x.test.mjs',
  ]) assert.equal(checkCommand(c, none).blocked, false, c);
});

test('versionerede scripts er undtaget (reviewet), ikke-versionerede laeses', () => {
  const body = 'rmSync(worktree, { recursive: true })';
  assert.equal(checkCommand('node scripts/wave-policy.mjs finish', { readScript: () => body, isTracked: () => true }).blocked, false);
  assert.equal(checkCommand('node scripts/wave-policy.mjs finish', { readScript: () => body, isTracked: () => false }).blocked, true);
});

test('hook-mode: Bash og PowerShell blokeres med exit 2, andet slipper igennem', () => {
  const run = (tool_name, command) => spawnSync(process.execPath, [fileURLToPath(new URL('./unsafe-delete-guard.mjs', import.meta.url)), 'hook'], { input: JSON.stringify({ tool_name, tool_input: { command } }), encoding: 'utf8' });
  assert.equal(run('PowerShell', 'git worktree remove --force C:\\dev\\CyclingZone-worktrees\\x').status, 2);
  assert.equal(run('PowerShell', 'Remove-Item -Recurse -Force C:\\dev\\CyclingZone-worktrees\\x').status, 2);
  assert.equal(run('Bash', 'rm -rf "/c/Users/x/OneDrive/CyclingZone-context/balance-internals"').status, 2);
  assert.match(run('Bash', 'git worktree remove x').stderr, /remove-worktree\.ps1/);
  assert.equal(run('Bash', 'git status').status, 0);
  assert.equal(run('Read', 'git worktree remove x').status, 0);
});

test('kun allowlisten maa indeholde `worktree remove` blandt versionerede scripts', () => {
  const out = execFileSync('git', ['grep', '-l', '-E', 'worktree.{0,4}remove', '--', 'scripts/*.ps1', 'scripts/*.mjs', 'scripts/*.js', 'scripts/*.sh', 'scripts/lib/*', '.claude/workflows/*'], { encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((f) => !/\.test\.|test-|__tests__/.test(f));
  const allowed = new Set([...SAFE_REMOVERS, 'scripts/unsafe-delete-guard.mjs', 'scripts/new-worktree.ps1', 'scripts/guard-commit-branch.sh', 'scripts/link-onedrive-context.ps1', 'scripts/make-wave-brief.mjs', 'scripts/merge-queue-baseline-resolve.mjs', 'scripts/hooks/cycling-manager-cleanup.sh', 'scripts/lib/archive-worktree-unversioned.ps1', 'scripts/report-orphan-worktree-dirs.mjs' /* kun kommentar */, 'scripts/hooks/block-unsafe-delete.sh' /* kun kommentar */]);
  const extra = out.filter((f) => !allowed.has(f));
  assert.deepEqual(extra, [], `nye scripts der naevner worktree remove - fjern via remove-worktree.ps1 i stedet: ${extra.join(', ')}`);
});

test('versioneret script i et andet worktree end hookens cwd blokeres ikke (bølge 7/11)', async () => {
  const { tmpdir } = await import('node:os');
  const { dirname, join } = await import('node:path');
  // Scriptet ligger i dette repo; hooken koerer fra en helt anden mappe (fx hovedmappen).
  const repo = dirname(dirname(fileURLToPath(import.meta.url)));
  const fwd = (p) => p.split('\\').join('/');
  const script = fwd(join(repo, 'scripts', 'guard-commit-branch.sh'));
  const res = checkCommand(`bash "${script}" fix/x "${fwd(repo)}"`, { cwd: tmpdir(), listWorktrees: () => [] });
  assert.equal(res.blocked, false, res.reason);
});

test('script i et FREMMED repo får ingen undtagelse, heller ikke med et sikkert navn (Codex P1 #7854)', async () => {
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'guard-foreign-'));
  execFileSync('git', ['init', '-q', dir]);
  mkdirSync(join(dir, 'scripts'));
  const script = join(dir, 'scripts', 'remove-worktree.ps1');
  writeFileSync(script, 'git worktree remove --force C:/x\n');
  // Ogsaa naar scriptet er committet i det fremmede repo.
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x']);
  const fwd = (p) => p.split('\\').join('/');
  try {
    const res = checkCommand(`pwsh -File "${fwd(script)}"`, { cwd: tmpdir(), listWorktrees: () => [] });
    assert.equal(res.blocked, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('review #7854: et sikkert NAVN alene undtager ikke; en aendret remove-worktree.ps1 laeses', () => {
  const body = 'git worktree ' + 're' + 'move --force C:/x';
  const cmd = 'pwsh -File C:/dev/CyclingZone-worktrees/lane/scripts/remove-worktree.ps1';
  assert.equal(checkCommand(cmd, { readScript: () => body, isTracked: () => false, listWorktrees: () => [] }).blocked, true);
  assert.equal(checkCommand(cmd, { readScript: () => body, isTracked: () => true, listWorktrees: () => [] }).blocked, false);
});

test('review #7854: Git Bash-sti til et ad hoc-script laeses (ikke fail-open)', () => {
  if (process.platform === 'win32') assert.equal(gitBashToNative('/c/dev/x.mjs'), 'C:/dev/x.mjs');
  let seen = null;
  const res = checkCommand('node /c/Users/x/scratch/clean.mjs', { readScript: (p) => { seen = p; return 'rmSync(worktree, { recursive: true })'; }, isTracked: () => false, listWorktrees: () => [] });
  assert.equal(res.blocked, true);
  if (process.platform === 'win32') assert.ok(seen.replace(/\\/g, '/').startsWith('C:/Users/x/scratch/clean.mjs'));
});
