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
  // Startmappen er altid en kandidat: fra hovedmappen blokeres et skift, ogsaa via -C mod
  // et worktree (samme som paa main foer #8207; sporing maa kun tilfoeje blokeringer).
  assert.equal(callCmd(main, `git -C "${wt}" switch -c feature-z`).status, 2);
  // Vercel Security Review #8207, runde 3: subshell-cd laekker ikke ud, --work-tree/--git-dir,
  // GIT_DIR/GIT_WORK_TREE og git.exe kan ikke flytte vurderingen vaek fra hovedmappen.
  assert.equal(callCmd(main, `(cd "${wt}") && git switch -c feature-l`).status, 2);
  // Codex-review #8207 (P2): subshell eller bash -c med cd maa ikke flytte den ydre mappe.
  assert.equal(callCmd(main, `(cd "${base}" && pwd); git switch -c feature-c1`).status, 2);
  assert.equal(callCmd(main, `bash -c "cd '${wt}'"; git switch -c feature-c2`).status, 2);
  assert.equal(callCmd(main, `git --work-tree="${wt}" switch -c feature-t`).status, 2);
  assert.equal(callCmd(wt, `GIT_WORK_TREE="${main}" GIT_DIR="${main}/.git" git switch -c feature-e`).status, 2);
  assert.equal(callCmd(wt, `git --git-dir="${main}/.git" switch -c feature-g`).status, 2);
  assert.equal(callCmd(wt, `git.exe -C "${main}" switch -c feature-x2`).status, 2);
  // Review #8207, runde 5: et tidligere "git"-lignende token, cd med ekstra tokens, export.
  assert.equal(callCmd(main, 'X=/usr/bin/git git switch -c feature-k').status, 2);
  assert.equal(callCmd(wt, `cd "${main}" 2>/dev/null && git switch -c feature-n`).status, 2);
  assert.equal(callCmd(wt, `cd -- "${main}" && git switch -c feature-d`).status, 2);
  assert.equal(callCmd(wt, `export GIT_DIR="${main}/.git"; git switch -c feature-v`).status, 2);
  // Vercel Security Review #8207: et skift skjult efter cd/export i samme segment.
  assert.equal(callCmd(main, 'cd frontend $(git switch -c feature-s1)').status, 2);
  assert.equal(callCmd(main, 'export GIT_DIR=x Y=$(git switch -c feature-s2)').status, 2);
  // Vercel #8207: en tilladt indre git-kommando maa ikke skjule et forbudt ydre skift.
  assert.equal(callCmd(main, 'X=$(git checkout -- x.txt) git switch -c feature-h1').status, 2);
  assert.equal(callCmd(main, 'git switch -c feature-h2 $(git checkout main)').status, 2);
  assert.equal(callCmd(main, 'echo $(git checkout -- x.txt)').status, 0);
  // Vercel #8207: et branchnavn der ender paa git afslutter ikke argumenterne.
  assert.equal(callCmd(main, 'git checkout feature/git').status, 2);
  assert.equal(callCmd(main, 'git switch git').status, 2);
  // Review #8207: et maal fra en substitution er ukendt og blokeres (som paa main).
  assert.equal(callCmd(main, 'git switch $(cat .branch)').status, 2);
  assert.equal(callCmd(main, 'git checkout `cat .branch`').status, 2);
  // Almindeligt arbejde i et worktree er stadig frit.
  assert.equal(callCmd(wt, 'git switch -c feature-ok').status, 0);
  assert.equal(callCmd(join(wt, 'frontend'), 'git checkout -b feature-ok2').status, 0);
  assert.equal(callCmd(join(main, 'frontend'), 'git checkout -- x.txt').status, 0);
  // Review #8207, runde 2: subshell, bash -c og --work-tree maa heller ikke slippe igennem.
  assert.equal(callCmd(wt, `(cd "${main}" && git checkout -b feature-s)`).status, 2);
  assert.equal(callCmd(wt, `bash -c "cd '${main}' && git switch -c feature-b"`).status, 2);
  assert.equal(callCmd(wt, `git --work-tree="${main}" checkout feature-w`).status, 2);
  assert.equal(callCmd(main, 'git checkout "main"').status, 0);
  // Vercel Security Review #8207: shell-ekspansion eller en mappe der ikke findes er ukendt,
  // saa hovedmappen stadig er maalet (foer: tolket bogstaveligt -> sluppet igennem).
  assert.equal(callCmd(main, 'cd "$PWD/frontend" && git switch -c feature-p').status, 2);
  assert.equal(callCmd(main, 'cd /does/not/exist; git switch -c feature-q').status, 2);
  assert.equal(callCmd(main, 'git -C "$HOME/x" switch -c feature-r').status, 2);
});

// Mini-repo med en kopi af hooken og en falsk setup-worktree.ps1; en falsk pwsh i PATH
// skriver en markoer, hvis hooken starter den. Returnerer [repo, koer(cwd)].
function setupHookFixture(t) {
  const base = scratch(t);
  const bin = join(base, 'bin');
  const marker = join(base, 'pwsh-ran');
  mkdirSync(bin);
  writeFileSync(join(bin, 'pwsh'), `#!/bin/sh\necho "$@" > "${marker.replace(/\\/g, '/')}"\n`, { mode: 0o755 });
  const runHook = (hookPath, cmdCwd) => spawnSync('bash', [hookPath], {
    cwd: base, encoding: 'utf8', timeout: 60_000,
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: cmdCwd, tool_input: { command: 'ls' } }),
    env: { ...process.env, PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` },
  });
  const makeRepo = (name, withHook) => {
    const repo = join(base, name);
    mkdirSync(join(repo, 'scripts', 'hooks', 'lib'), { recursive: true });
    execFileSync('git', ['init', '-q', repo]);
    writeFileSync(join(repo, 'scripts', 'setup-worktree.ps1'), 'Write-Output setup');
    if (withHook) {
      for (const f of ['hooks/setup-worktree-if-needed.sh', 'hooks/lib/hook-cwd.sh']) {
        writeFileSync(join(repo, 'scripts', f), readFileSync(join(ROOT, 'scripts', f)));
      }
    }
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x');
    const wt = join(base, `${name}-wt`);
    git('worktree', 'add', '-q', '-b', 'side', wt);
    return { repo, wt };
  };
  return { base, marker, runHook, makeRepo };
}

test('worktree-setup koerer stadig i hookens eget repos worktree, med det betroede script', t => {
  const { marker, runHook, makeRepo } = setupHookFixture(t);
  const own = makeRepo('own', true);
  const res = runHook(join(own.repo, 'scripts', 'hooks', 'setup-worktree-if-needed.sh'), join(own.wt, 'scripts'));
  assert.equal(res.status, 0, res.stderr);
  assert.ok(existsSync(marker), `hooken startede ikke setup i eget worktree: ${res.stderr}`);
  const args = readFileSync(marker, 'utf8').replace(/\\/g, '/');
  assert.match(args, /own\/scripts\/setup-worktree\.ps1/, 'setup-scriptet skal hentes fra hookens eget repo');
  assert.match(args, /-WorktreeRoot/);
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
