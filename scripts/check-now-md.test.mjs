// Regressionstest for Stop-hooken scripts/check-now-md.sh under et merge-tog (#7587).
// Med en levende tog-markoer (merge-queue.ps1) udskydes NOW- og SHA-paamindelsen for
// togets commits; uden markoer, med en stale markoer eller for en commit uden for
// toget vises de som foer. Koerer hooken i et midlertidigt git-repo med falsk gh.
//
// Tests: node --test scripts/check-now-md.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('./check-now-md.sh', import.meta.url));
// Fast klokke (AGENTS.md regel 16): hooken og markoer-laeseren faar den via
// CHECK_NOW_MD_NOW_EPOCH, og fixturens commit- og markoer-tider regnes fra den.
const NOW_S = 1_800_000_000;
const NOW_WARNING = 'main blev opdateret';
const REFS_WARNING = 'refererer #7 men issuet har ingen kommentar';

function git(cwd, args, epoch) {
  const date = epoch ? `@${epoch} +0000` : undefined;
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
    },
  });
  assert.equal(res.status, 0, `git ${args.join(' ')}: ${res.stderr}`);
  return res.stdout.trim();
}

// Repo: NOW.md commit for 20 min siden, main-commit "(#42)" + "Refs #7" for 1 min siden.
function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'now-hook-'));
  const nowS = NOW_S;
  git(dir, ['init', '-q']);
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'NOW.md'), '# NOW\n');
  git(dir, ['add', 'docs/NOW.md']);
  git(dir, ['commit', '-q', '-m', 'docs(now): status'], nowS - 1200);
  writeFileSync(join(dir, 'feature.txt'), 'x\n');
  git(dir, ['add', 'feature.txt']);
  git(dir, ['commit', '-q', '-m', 'feat: noget (#42)', '-m', 'Refs #7'], nowS - 60);
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const sha = git(dir, ['rev-parse', 'HEAD']);
  // Falsk gh: issue-kommentarer fra en fil (tom = ingen kommentar med SHA'en).
  const bin = join(dir, 'fakebin');
  mkdirSync(bin);
  writeFileSync(join(dir, 'comments.txt'), '');
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\ncat "${join(dir, 'comments.txt').replaceAll('\\', '/')}"\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  return { dir, sha, bin, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function writeMarker(dir, marker) {
  mkdirSync(join(dir, '.claude', 'run'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'run', 'merge-queue-active.json'), JSON.stringify(marker));
}

function runHook(repo) {
  const env = { ...process.env, HOME: repo.dir, USERPROFILE: repo.dir, PATH: `${repo.bin}${delimiter}${process.env.PATH}`, CHECK_NOW_MD_NOW_EPOCH: String(NOW_S) };
  delete env.MERGE_QUEUE_MARKER_FILE;
  const res = spawnSync('bash', [HOOK.replaceAll('\\', '/')], { cwd: repo.dir, input: '', encoding: 'utf8', env, timeout: 60_000 });
  assert.ifError(res.error);
  assert.equal(res.status, 0, res.stderr);
  return res.stdout;
}

const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;
const started = (minutesAgo = 5) => new Date(NOW_S * 1000 - minutesAgo * 60_000).toISOString();

test('without a marker the NOW and SHA reminders fire as before', () => {
  const repo = setupRepo();
  try {
    const out = runHook(repo);
    assert.match(out, new RegExp(NOW_WARNING));
    assert.match(out, new RegExp(REFS_WARNING));
  } finally { repo.cleanup(); }
});

test('a live marker that recorded the merge SHA defers both reminders', () => {
  const repo = setupRepo();
  try {
    writeMarker(repo.dir, { pid: process.pid, startedAt: started(), prs: [42, 43], merged: [{ pr: 42, sha: repo.sha }] });
    const out = runHook(repo);
    assert.doesNotMatch(out, new RegExp(NOW_WARNING));
    assert.doesNotMatch(out, new RegExp(REFS_WARNING));
  } finally { repo.cleanup(); }
});

test('a live marker covers a train PR merged before its SHA was recorded (squash subject)', () => {
  const repo = setupRepo();
  try {
    writeMarker(repo.dir, { pid: process.pid, startedAt: started(), prs: [42], merged: [] });
    assert.doesNotMatch(runHook(repo), new RegExp(NOW_WARNING));
  } finally { repo.cleanup(); }
});

test('a stale marker (dead pid or too old) is ignored and the reminders fire', () => {
  const repo = setupRepo();
  try {
    writeMarker(repo.dir, { pid: deadPid(), startedAt: started(), prs: [42], merged: [{ pr: 42, sha: repo.sha }] });
    let out = runHook(repo);
    assert.match(out, new RegExp(NOW_WARNING), 'dead pid');
    assert.match(out, new RegExp(REFS_WARNING), 'dead pid');
    writeMarker(repo.dir, { pid: process.pid, startedAt: started(7 * 60), prs: [42], merged: [{ pr: 42, sha: repo.sha }] });
    out = runHook(repo);
    assert.match(out, new RegExp(NOW_WARNING), 'older than the max age');
  } finally { repo.cleanup(); }
});

test('a live marker for another train leaves the reminders for a non-train commit', () => {
  const repo = setupRepo();
  try {
    writeMarker(repo.dir, { pid: process.pid, startedAt: started(), prs: [99], merged: [{ pr: 99, sha: 'c'.repeat(40) }] });
    const out = runHook(repo);
    assert.match(out, new RegExp(NOW_WARNING));
    assert.match(out, new RegExp(REFS_WARNING));
  } finally { repo.cleanup(); }
});

test('the SHA reminder stays quiet once the SHA comment exists (written right after the merge)', () => {
  const repo = setupRepo();
  try {
    writeFileSync(join(repo.dir, 'comments.txt'), `Merget via merge-køen: PR #42 som \`${repo.sha.slice(0, 8)}\` (${repo.sha}). Verifikation afventer.\n`);
    const out = runHook(repo);
    assert.doesNotMatch(out, new RegExp(REFS_WARNING));
    assert.match(out, new RegExp(NOW_WARNING), 'no marker: the NOW reminder is unchanged');
  } finally { repo.cleanup(); }
});
