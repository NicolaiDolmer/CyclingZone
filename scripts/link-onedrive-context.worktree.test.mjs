// Test for scripts/link-onedrive-context.ps1 sektion 2c (#7446): de lokale OneDrive-
// junctions oprettes KUN i hovedcheckoutet (.git er en mappe), aldrig i et linked
// worktree (.git er en fil), fordi 'git worktree remove --force' foelger junctions.
//
// SAFETY: koerer altid med -DryRun og med OneDrive/USERPROFILE peget ind i en frisk
// mappe under os.tmpdir(); den rigtige OneDrive, ~/.claude og repoet roeres aldrig.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'link-onedrive-context.ps1');
const skip = process.platform === 'win32' ? false : 'kraever Windows + pwsh';
let sandbox;

before(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-7446-link-'));
  fs.mkdirSync(path.join(sandbox, 'OneDrive', 'CyclingZone-context', 'memory'), { recursive: true });
  // To filer: scriptets `(Get-ChildItem ...).Count` kraever en samling under StrictMode.
  for (const f of ['MEMORY.md', 'note.md']) fs.writeFileSync(path.join(sandbox, 'OneDrive', 'CyclingZone-context', 'memory', f), '# test\n');
});

after(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

function dryRun(repoRoot) {
  const env = { ...process.env, OneDrive: path.join(sandbox, 'OneDrive'), USERPROFILE: path.join(sandbox, 'home') };
  const r = spawnSync('pwsh', ['-NoProfile', '-File', script, '-DryRun', '-RepoRoot', repoRoot], { env, encoding: 'utf8' });
  return `${r.stdout}\n${r.stderr}`;
}

test('linked worktree (.git er en fil): lokale mapper springes over', { skip }, () => {
  const wt = path.join(sandbox, 'wt');
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: C:/dev/CyclingZone/.git/worktrees/wt\n');
  const out = dryRun(wt);
  assert.match(out, /er et worktree - lokale mapper kobles kun i hovedcheckoutet/);
  assert.doesNotMatch(out, /\[would-link\] Junction: docs\/drafts\/local/);
});

test('hovedcheckout (.git er en mappe): lokale mapper ville blive koblet', { skip }, () => {
  const main = path.join(sandbox, 'main');
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  const out = dryRun(main);
  assert.match(out, /\[would-link\] Junction: docs\/drafts\/local/);
  assert.doesNotMatch(out, /er et worktree/);
});
