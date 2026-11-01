// Tests for scripts/close-out-cleanup-junctions.ps1 (#6687).
//
// Regression: 'close-out-cleanup.ps1 -Execute' removed worktrees whose
// node_modules were junctions into the main checkout; 'git worktree remove
// --force' followed the junction and emptied the target.
//
// SAFETY: every test works ONLY inside a fresh directory under os.tmpdir().
// The fake "main" checkout, the fake worktrees and the junctions all live there.
// The real repo checkout (or any real worktree / node_modules) is never touched.
// Windows only (junctions, pwsh) - skipped elsewhere.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const helperPs1 = path.join(here, 'close-out-cleanup-junctions.ps1');
const prunePs1 = path.join(here, 'prune-merged-worktrees.ps1');
const isWindows = process.platform === 'win32';
const skip = isWindows ? false : 'junction-tests kraever Windows + pwsh';

let sandbox;

before(() => {
  if (!isWindows) return;
  const tmpRoot = fs.realpathSync(os.tmpdir());
  sandbox = fs.mkdtempSync(path.join(tmpRoot, 'cz-6687-'));
  assert.ok(sandbox.startsWith(tmpRoot), 'sandbox skal ligge under TEMP');
});

after(() => {
  if (!sandbox) return;
  // Fjern links foerst (rmdir fjerner kun linket), saa rm -rf aldrig behoever foelge dem.
  const ps = [
    "$ErrorActionPreference='SilentlyContinue'",
    'Get-ChildItem -LiteralPath $env:SB -Recurse -Force | Where-Object { $_.LinkType } | ForEach-Object { cmd /c rmdir /Q $_.FullName | Out-Null }',
  ].join('; ');
  spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, SB: sandbox } });
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function pwsh(script, extraEnv = {}) {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
  assert.equal(r.error, undefined, `pwsh kunne ikke startes: ${r.error}`);
  return r;
}

function makeJunction(link, target) {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, 'junction');
}

// Falsk "hovedcheckout" med en node_modules-lignende mappe og en fil, saa vi kan se om den tømmes.
function makeFakeMain(name) {
  const main = path.join(sandbox, name);
  const nm = path.join(main, 'node_modules');
  fs.mkdirSync(path.join(nm, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(nm, 'pkg', 'index.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(nm, 'marker.txt'), 'main-node_modules-skal-overleve\n');
  return { main, nm, marker: path.join(nm, 'marker.txt'), pkgFile: path.join(nm, 'pkg', 'index.js') };
}

function runRemove(wt, { dryRun = false, remover = '' } = {}) {
  const script = [
    "$ErrorActionPreference='Stop'",
    '. $env:HELPER',
    `$r = Remove-WorktreeJunctions -WorktreePath $env:WT ${dryRun ? '-DryRun' : ''} ${remover ? `-LinkRemover { ${remover} }` : ''}`,
    "Write-Output ('RESULT=' + ($r | Select-Object Ok, Found, @{n='Removed';e={@($_.Removed).Count}}, @{n='Errors';e={@($_.Errors)}} | ConvertTo-Json -Compress))",
  ].join('\n');
  const r = pwsh(script, { HELPER: helperPs1, WT: wt });
  assert.equal(r.status, 0, `pwsh fejlede:\n${r.stdout}\n${r.stderr}`);
  const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith('RESULT='));
  assert.ok(line, `ingen RESULT-linje i output:\n${r.stdout}`);
  const res = JSON.parse(line.slice('RESULT='.length));
  res.Errors = [res.Errors].flat().filter(Boolean); // ConvertTo-Json pakker 1 element ud af arrayet
  return res;
}

test('fjerner node_modules-junctions uden at toemme maalet', { skip }, () => {
  const { main, nm, marker, pkgFile } = makeFakeMain('main-a');
  const wt = path.join(sandbox, 'wt-a');
  makeJunction(path.join(wt, 'node_modules'), nm);
  makeJunction(path.join(wt, 'frontend', 'node_modules'), nm);
  makeJunction(path.join(wt, 'backend', 'node_modules'), nm);
  // marketing har en ECHT node_modules med et scoped workspace-link ind til hovedcheckouten.
  fs.mkdirSync(path.join(wt, 'marketing', 'node_modules', '@scope'), { recursive: true });
  makeJunction(path.join(wt, 'marketing', 'node_modules', '@scope', 'pkg'), path.join(nm, 'pkg'));
  fs.writeFileSync(path.join(wt, 'marketing', 'real.txt'), 'rigtig fil\n');

  const res = runRemove(wt);

  assert.equal(res.Ok, true, JSON.stringify(res));
  assert.equal(res.Found, 4);
  assert.equal(res.Removed, 4);
  for (const l of ['node_modules', 'frontend/node_modules', 'backend/node_modules', 'marketing/node_modules/@scope/pkg']) {
    assert.equal(fs.existsSync(path.join(wt, l)), false, `${l} skulle vaere fjernet`);
  }
  // Maalet er intakt - det er hele pointen.
  assert.equal(fs.readFileSync(marker, 'utf8'), 'main-node_modules-skal-overleve\n');
  assert.equal(fs.readFileSync(pkgFile, 'utf8'), 'module.exports = 1;\n');
  assert.ok(fs.existsSync(main));
  // Almindelige filer/mapper i worktreet er urørt.
  assert.ok(fs.existsSync(path.join(wt, 'marketing', 'real.txt')));
  assert.ok(fs.existsSync(path.join(wt, 'marketing', 'node_modules', '@scope')));
});

test('fjerner de lokale OneDrive-junctions (#7446) uden at toemme maalet', { skip }, () => {
  const { nm, marker } = makeFakeMain('main-7446');
  const wt = path.join(sandbox, 'wt-7446');
  const rel = ['docs/drafts/local', 'pr-screens/local', 'docs/snapshots/local', '.codex.local/shared'];
  for (const l of rel) makeJunction(path.join(wt, l), nm);

  const res = runRemove(wt);

  assert.equal(res.Ok, true, JSON.stringify(res));
  assert.equal(res.Found, 4);
  assert.equal(res.Removed, 4);
  for (const l of rel) assert.equal(fs.existsSync(path.join(wt, l)), false, `${l} skulle vaere fjernet`);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'main-node_modules-skal-overleve\n');
});

test('docs/ som junction: kun mellemleddet fjernes, intet scannes ind i maalet (#7446)', { skip }, () => {
  const { nm, marker } = makeFakeMain('main-7446-mid');
  const outside = path.join(sandbox, 'outside-docs');
  makeJunction(path.join(outside, 'drafts', 'local'), nm);
  const wt = path.join(sandbox, 'wt-7446-mid');
  makeJunction(path.join(wt, 'docs'), outside);

  const res = runRemove(wt);

  assert.equal(res.Ok, true, JSON.stringify(res));
  assert.equal(res.Found, 1);
  assert.equal(fs.existsSync(path.join(wt, 'docs')), false);
  assert.ok(fs.existsSync(path.join(outside, 'drafts', 'local')), 'linket uden for worktreet maa ikke roeres');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'main-node_modules-skal-overleve\n');
});

test('dry-run fjerner ingenting men melder linkene', { skip }, () => {
  const { nm, marker } = makeFakeMain('main-b');
  const wt = path.join(sandbox, 'wt-b');
  makeJunction(path.join(wt, 'node_modules'), nm);
  makeJunction(path.join(wt, 'frontend', 'node_modules'), nm);

  const res = runRemove(wt, { dryRun: true });

  assert.equal(res.Ok, true);
  assert.equal(res.Found, 2);
  assert.ok(fs.lstatSync(path.join(wt, 'node_modules')).isSymbolicLink(), 'junction skal stadig findes i dry-run');
  assert.ok(fs.lstatSync(path.join(wt, 'frontend', 'node_modules')).isSymbolicLink());
  assert.ok(fs.existsSync(marker));
});

test('worktree uden links: Ok med Found=0, almindelige mapper roeres ikke', { skip }, () => {
  const wt = path.join(sandbox, 'wt-c');
  fs.mkdirSync(path.join(wt, 'node_modules', 'real'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'node_modules', 'real', 'a.txt'), 'x');

  const res = runRemove(wt);

  assert.equal(res.Ok, true);
  assert.equal(res.Found, 0);
  assert.ok(fs.existsSync(path.join(wt, 'node_modules', 'real', 'a.txt')));
});

test('brudt junction (maal slettet) fjernes uden fejl', { skip }, () => {
  const gone = path.join(sandbox, 'gone-target');
  fs.mkdirSync(gone);
  const wt = path.join(sandbox, 'wt-d');
  makeJunction(path.join(wt, 'node_modules'), gone);
  fs.rmdirSync(gone);

  const res = runRemove(wt);

  assert.equal(res.Ok, true, JSON.stringify(res));
  assert.equal(res.Found, 1);
  assert.throws(() => fs.lstatSync(path.join(wt, 'node_modules')), /ENOENT/);
});

test('frontend/ som junction: linket fjernes, intet scannes ind i maalet (codex P2)', { skip }, () => {
  const { nm } = makeFakeMain('main-g');
  // Eksternt "frontend" med en ECHT node_modules der selv indeholder et link.
  const external = path.join(sandbox, 'external-frontend');
  fs.mkdirSync(path.join(external, 'node_modules'), { recursive: true });
  makeJunction(path.join(external, 'node_modules', 'inner'), path.join(nm, 'pkg'));
  const wt = path.join(sandbox, 'wt-g');
  fs.mkdirSync(wt, { recursive: true });
  makeJunction(path.join(wt, 'frontend'), external);

  const res = runRemove(wt);

  assert.equal(res.Ok, true, JSON.stringify(res));
  assert.equal(res.Found, 1, 'kun frontend-linket selv');
  assert.equal(fs.existsSync(path.join(wt, 'frontend')), false);
  // Det eksterne maal og dets interne link er urørte.
  assert.ok(fs.lstatSync(path.join(external, 'node_modules', 'inner')).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(nm, 'pkg', 'index.js')));
});

test('NAEGTER (Ok=false) naar et link ikke kan fjernes', { skip }, () => {
  const { nm, marker } = makeFakeMain('main-e');
  const wt = path.join(sandbox, 'wt-e');
  makeJunction(path.join(wt, 'node_modules'), nm);

  // Falsk fjerner der ikke goer noget.
  const res = runRemove(wt, { remover: '$null = 1' });

  assert.equal(res.Ok, false);
  assert.match(res.Errors.join('\n'), /findes stadig/);
  assert.ok(fs.existsSync(marker));
});

test('NAEGTER (Ok=false) hvis fjernelsen faar maalet til at forsvinde', { skip }, () => {
  const { main, nm } = makeFakeMain('main-f');
  const wt = path.join(sandbox, 'wt-f');
  makeJunction(path.join(wt, 'node_modules'), nm);

  // Simulerer den oprindelige fejl: fjernelsen foelger linket og toemmer/sletter maalet.
  const res = runRemove(wt, {
    remover: `[IO.Directory]::Delete($_.FullName,$false); Remove-Item -LiteralPath '${nm.replace(/'/g, "''")}' -Recurse -Force`.replace('$_', '$args[0]'),
  });

  assert.equal(res.Ok, false);
  assert.match(res.Errors.join('\n'), /MAAL BLEV BORTE/);
  assert.ok(fs.existsSync(main), 'kun noden under main er slettet af den falske fjerner');
});

// --- Integration: selve prune-merged-worktrees.ps1 mod et temp-repo ---------------------------
// Falsk 'gh' (gh.cmd) i PATH svarer "1" => "merged PR findes", saa vi ikke rammer GitHub.
// RepoRoot er temp-repoet, aldrig det rigtige repo.

function git(cwd, ...args) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
    },
  });
  assert.equal(r.status, 0, `git ${args.join(' ')} fejlede:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

function makeRepoWithMergedWorktree(name) {
  const base = path.join(sandbox, name);
  const origin = path.join(base, 'origin.git');
  const main = path.join(base, 'main');
  const wt = path.join(base, 'wt-feat');
  const fakeBin = path.join(base, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, 'gh.cmd'), '@echo 1\r\n');
  git(base, 'init', '--bare', '-b', 'main', origin);
  git(base, 'clone', origin, main);
  fs.writeFileSync(path.join(main, '.gitignore'), 'node_modules\n');
  fs.writeFileSync(path.join(main, 'a.txt'), 'a\n');
  git(main, 'add', '.');
  git(main, 'commit', '-m', 'init');
  git(main, 'push', '-u', 'origin', 'main');
  git(main, 'worktree', 'add', '-b', 'feat/x', wt);
  fs.writeFileSync(path.join(wt, 'b.txt'), 'b\n');
  git(wt, 'add', 'b.txt');
  git(wt, 'commit', '-m', 'work');
  // "Merge" feat/x ind i main og push (ancestry + falsk merged-PR).
  git(main, 'merge', '--no-ff', 'feat/x', '-m', 'merge');
  git(main, 'push', 'origin', 'main');
  // Hovedcheckoutens node_modules + worktree-junctions ind til den.
  const nm = path.join(main, 'node_modules');
  fs.mkdirSync(path.join(nm, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(nm, 'marker.txt'), 'overlever\n');
  fs.writeFileSync(path.join(nm, 'pkg', 'index.js'), 'x\n');
  makeJunction(path.join(wt, 'node_modules'), nm);
  makeJunction(path.join(wt, 'frontend', 'node_modules'), nm);
  return { base, main, wt, nm, fakeBin };
}

function runPrune(fx, { execute }) {
  const script = [
    "$ErrorActionPreference='Stop'",
    `& $env:PRUNE -RepoRoot $env:MAIN ${execute ? '-Execute' : ''}`,
  ].join('\n');
  const r = pwsh(script, {
    PRUNE: prunePs1,
    MAIN: fx.main,
    PATH: `${fx.fakeBin}${path.delimiter}${process.env.PATH}`,
  });
  assert.equal(r.status, 0, `prune fejlede:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

test('integration: prune -Execute fjerner worktree men toemmer ikke maalet', { skip }, () => {
  const fx = makeRepoWithMergedWorktree('int-a');
  assert.ok(fx.main.startsWith(sandbox), 'RepoRoot skal vaere i sandboxen');

  const out = runPrune(fx, { execute: true });

  assert.match(out, /\[remove\]/, out);
  assert.equal(fs.existsSync(fx.wt), false, 'worktree-mappen skulle vaere fjernet');
  assert.equal(fs.readFileSync(path.join(fx.nm, 'marker.txt'), 'utf8'), 'overlever\n');
  assert.equal(fs.readFileSync(path.join(fx.nm, 'pkg', 'index.js'), 'utf8'), 'x\n');
});

test('integration: prune dry-run roerer hverken worktree eller links', { skip }, () => {
  const fx = makeRepoWithMergedWorktree('int-b');

  const out = runPrune(fx, { execute: false });

  assert.match(out, /\[would-remove\]/, out);
  assert.match(out, /\[would-unlink\]/, out);
  assert.ok(fs.existsSync(fx.wt));
  assert.ok(fs.lstatSync(path.join(fx.wt, 'node_modules')).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(fx.nm, 'marker.txt')));
});
