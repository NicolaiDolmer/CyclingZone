// Hooks skal virke uanset arbejdsmappe (#8206).
//
// Haendelse 15/11: hook-kommandoerne i .claude/settings.json brugte relative stier
// (`bash scripts/hooks/x.sh`). Stod sessionen i frontend/, et andet worktree eller
// scratchpad, fandtes filen ikke (exit 127), og Claude Code viste "A hook gave no
// usable answer" -- secret-, slette-, branch- og preflight-vagterne koerte slet ikke.
// Desuden vurderede vagterne hook-processens cwd, ikke den mappe kommandoen koerer i.
//
// Tests: node --test scripts/hook-paths.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');
const SETTINGS = ['.claude/settings.json', '.claude/settings.local.json'];
// Eneste tilladte form: interpreter + absolut sti via CLAUDE_PROJECT_DIR (+ evt. simple argumenter).
const ABSOLUTE_FORM = /^(?:bash|node) "\$CLAUDE_PROJECT_DIR\/([^"]+)"(?: [\w-]+)*$/;

function hookCommands() {
  const out = [];
  for (const file of SETTINGS) {
    const abs = join(ROOT, file);
    if (!existsSync(abs)) continue;
    const hooks = JSON.parse(readFileSync(abs, 'utf8')).hooks ?? {};
    for (const [event, groups] of Object.entries(hooks)) {
      for (const group of groups) {
        for (const hook of group.hooks ?? []) {
          if (hook.type === 'command') out.push({ file, event, matcher: group.matcher ?? '', command: hook.command });
        }
      }
    }
  }
  return out;
}

const run = (command, { cwd, input }) => spawnSync('bash', ['-c', command], {
  cwd, input, encoding: 'utf8', timeout: 60_000,
  env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, GH_TOKEN: '', GITHUB_TOKEN: '' },
});

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hook-paths-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('hver hook-kommando bruger "$CLAUDE_PROJECT_DIR/..." og peger paa en fil der findes', () => {
  const commands = hookCommands();
  assert.ok(commands.length > 10, 'fandt ingen hook-kommandoer i settings.json');
  for (const { file, event, command } of commands) {
    const m = command.match(ABSOLUTE_FORM);
    assert.ok(m, `${file} ${event}: hook-kommandoen skal bruge bash/node "$CLAUDE_PROJECT_DIR/<sti>", ikke en relativ sti: ${command}`);
    assert.ok(existsSync(join(ROOT, m[1])), `${file} ${event}: ${m[1]} findes ikke`);
  }
});

test('Pre/PostToolUse-hooks finder deres script fra frontend/ og fra en mappe uden for repoet', t => {
  const outside = scratch(t);
  for (const cwd of [join(ROOT, 'frontend'), outside]) {
    for (const { event, command } of hookCommands().filter(h => /^(Pre|Post)ToolUse$/.test(h.event))) {
      const input = JSON.stringify({ hook_event_name: event, tool_name: 'NoSuchTool', tool_input: {}, cwd });
      const res = run(command, { cwd, input });
      assert.notEqual(res.status, 127, `${command} fra ${cwd}: ${res.stderr}`);
      assert.equal(res.status, 0, `${command} fra ${cwd} afviste et neutralt kald: ${res.stderr}`);
    }
  }
});

test('slette-vagten blokerer ogsaa naar kommandoen staar uden for repoet', t => {
  const outside = scratch(t);
  const command = 'bash "$CLAUDE_PROJECT_DIR/scripts/hooks/block-unsafe-delete.sh"';
  // Sammensat i koeretid, saa slette-vagten ikke laeser selve testfilen som et slettescript.
  const target = ['C:/dev', 'CyclingZone-worktrees', 'x'].join('/');
  const input = JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: outside,
    tool_input: { command: ['rm', '-rf', `"${target}"`].join(' ') },
  });
  const res = run(command, { cwd: outside, input });
  assert.equal(res.status, 2, `forventede blokering (exit 2), fik ${res.status}: ${res.stderr}`);
});

test('branch-vagten vurderer kommandoens mappe (input-cwd), ogsaa fra en undermappe', t => {
  const base = scratch(t);
  const main = join(base, 'main');
  const git = (...args) => execFileSync('git', ['-C', main, ...args], { stdio: 'ignore' });
  mkdirSync(join(main, 'frontend'), { recursive: true });
  execFileSync('git', ['init', '-q', main]);
  writeFileSync(join(main, 'frontend', 'x.txt'), 'x');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x');
  const wt = join(base, 'wt');
  git('worktree', 'add', '-q', '-b', 'side', wt);

  const command = 'bash "$CLAUDE_PROJECT_DIR/scripts/hooks/block-branch-switch-in-main-checkout.sh"';
  const call = (processCwd, cmdCwd) => run(command, {
    cwd: processCwd,
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: cmdCwd, tool_input: { command: 'git switch -c feature-x' } }),
  });
  // Hovedmappens undermappe: blokeres (foer: [ -d .git ] fejlede i frontend/ -> sluppet igennem).
  assert.equal(call(base, join(main, 'frontend')).status, 2);
  // Hook-processen staar i hovedmappen, men kommandoen koerer i et worktree: tilladt
  // (foer: falsk blokering, maalt 15/11 i en worktree-session).
  assert.equal(call(main, join(wt, 'frontend')).status, 0);
  assert.equal(call(main, wt).status, 0);
  // Review #8207: fra et worktree maa hovedmappen ikke skiftes via git -C eller cd.
  const callCmd = (cmdCwd, cmd) => run(command, {
    cwd: base,
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: cmdCwd, tool_input: { command: cmd } }),
  });
  assert.equal(callCmd(wt, `git -C "${main}" switch -c feature-x`).status, 2);
  assert.equal(callCmd(wt, `cd "${main}" && git checkout -b feature-y`).status, 2);
  assert.equal(callCmd(main, `git -C "${wt}" switch -c feature-z`).status, 0);
  assert.equal(callCmd(join(main, 'frontend'), 'git checkout -- x.txt').status, 0);
});

test('worktree-setup koerer aldrig kode fra et fremmed repos worktree (Vercel Security Review #8207)', t => {
  const base = scratch(t);
  const foreign = join(base, 'foreign');
  const git = (...args) => execFileSync('git', ['-C', foreign, ...args], { stdio: 'ignore' });
  mkdirSync(join(foreign, 'scripts'), { recursive: true });
  execFileSync('git', ['init', '-q', foreign]);
  writeFileSync(join(foreign, 'scripts', 'setup-worktree.ps1'), 'Write-Output owned');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x');
  const wt = join(base, 'foreign-wt');
  git('worktree', 'add', '-q', '-b', 'side', wt);
  // Falsk pwsh foerst i PATH: skriver en markoer, hvis hooken overhovedet starter den.
  const bin = join(base, 'bin');
  const marker = join(base, 'pwsh-ran');
  mkdirSync(bin);
  writeFileSync(join(bin, 'pwsh'), `#!/bin/sh\necho ran > "${marker.replace(/\\/g, '/')}"\n`, { mode: 0o755 });
  const res = spawnSync('bash', ['-c', 'bash "$CLAUDE_PROJECT_DIR/scripts/hooks/setup-worktree-if-needed.sh"'], {
    cwd: base, encoding: 'utf8', timeout: 60_000,
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: wt, tool_input: { command: 'ls' } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(existsSync(marker), false, 'hooken startede pwsh i et fremmed repos worktree');
  assert.equal(existsSync(join(wt, '.git-worktree-setup-failed')), false);
});
