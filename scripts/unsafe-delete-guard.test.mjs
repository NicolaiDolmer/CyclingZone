import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkCommand, SAFE_REMOVERS } from './unsafe-delete-guard.mjs';

const none = { readScript: () => null, isTracked: () => false };

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
