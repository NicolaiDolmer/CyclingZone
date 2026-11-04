import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  MAX_AGE_MS, isPidAlive, isStale, main, markerCovers, markerFilePath, parsePrList,
  readActiveMarker, readMarkerFile, recordMerge, startMarker, stopMarker,
} from './merge-queue-active-marker.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
// Fast ur i alle tests (AGENTS.md: deterministiske tests, intet vaeg-ur).
const NOW = new Date('2026-11-04T12:00:00Z');
const alive = () => true;
const dead = () => false;

function tmpFile() {
  const dir = mkdtempSync(join(tmpdir(), 'mq-marker-'));
  return { dir, file: join(dir, '.claude', 'run', 'merge-queue-active.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('start, merged and stop keep one marker owned by the queue process', () => {
  const t = tmpFile();
  try {
    startMarker(t.file, { pid: 4242, prs: [10, 11], now: NOW });
    recordMerge(t.file, { pid: 4242, pr: 10, sha: SHA_A });
    recordMerge(t.file, { pid: 4242, pr: 10, sha: SHA_A });
    const m = readMarkerFile(t.file);
    assert.deepEqual(m, { pid: 4242, startedAt: NOW.toISOString(), prs: [10, 11], merged: [{ pr: 10, sha: SHA_A }] }, 'no duplicate SHA');
    assert.equal(recordMerge(t.file, { pid: 1, pr: 11, sha: SHA_B }), null, 'another process never edits the marker');
    assert.equal(stopMarker(t.file, { pid: 1 }), false, 'another process never removes the marker');
    assert.ok(existsSync(t.file));
    assert.equal(stopMarker(t.file, { pid: 4242 }), true);
    assert.equal(existsSync(t.file), false);
    assert.equal(stopMarker(t.file, { pid: 4242 }), true, 'stop is idempotent');
  } finally { t.cleanup(); }
});

test('a stale marker is ignored: dead pid or older than the max age', () => {
  const marker = { pid: 4242, startedAt: NOW.toISOString(), prs: [10], merged: [] };
  assert.equal(isStale(marker, { now: NOW, isAlive: alive }), false);
  assert.equal(isStale(marker, { now: NOW, isAlive: dead }), true, 'dead pid');
  assert.equal(isStale(marker, { now: new Date(NOW.getTime() + MAX_AGE_MS + 1), isAlive: alive }), true, 'too old');
  assert.equal(isStale(marker, { now: new Date(NOW.getTime() - 60_000), isAlive: alive }), true, 'started in the future');
  assert.equal(isStale({ ...marker, pid: 'x' }, { now: NOW, isAlive: alive }), true, 'invalid');
});

test('readActiveMarker returns null for missing, broken and stale files', () => {
  const t = tmpFile();
  try {
    assert.equal(readActiveMarker(t.file, { now: NOW, isAlive: alive }), null, 'missing');
    startMarker(t.file, { pid: 4242, prs: [10], now: NOW });
    assert.ok(readActiveMarker(t.file, { now: NOW, isAlive: alive }));
    assert.equal(readActiveMarker(t.file, { now: NOW, isAlive: dead }), null, 'stale');
    writeFileSync(t.file, '{not json');
    assert.equal(readActiveMarker(t.file, { now: NOW, isAlive: alive }), null, 'broken');
  } finally { t.cleanup(); }
});

test('markerCovers matches merged SHAs (full or short) and squash subjects of train PRs only', () => {
  const marker = { pid: 1, startedAt: NOW.toISOString(), prs: [10, 11], merged: [{ pr: 10, sha: SHA_A }] };
  assert.equal(markerCovers(marker, { sha: SHA_A }), true);
  assert.equal(markerCovers(marker, { sha: 'AAAAAAA' }), true, 'short, case-insensitive');
  assert.equal(markerCovers(marker, { sha: 'aaaaaa' }), false, 'too short to trust');
  assert.equal(markerCovers(marker, { sha: SHA_B, subject: 'feat: noget (#11)' }), true, 'merged before the SHA was recorded');
  assert.equal(markerCovers(marker, { sha: SHA_B, subject: 'feat: noget (#12)' }), false, 'not a train PR');
  assert.equal(markerCovers(marker, { sha: SHA_B, subject: 'docs(now): fix #11 senere' }), false);
  assert.equal(markerCovers(null, { sha: SHA_A }), false);
});

test('CLI: covers exits 0 only for a live marker; writes are fail-soft', () => {
  const t = tmpFile();
  try {
    const out = [];
    const opts = { file: t.file, now: NOW, isAlive: alive, out: (l) => out.push(l) };
    assert.equal(main(['covers', '--sha', SHA_A], opts), 1, 'no marker');
    assert.equal(main(['start', '--pid', '77', '--prs', '10, 11,10'], opts), 0);
    assert.deepEqual(readMarkerFile(t.file).prs, [10, 11]);
    assert.equal(main(['merged', '--pid', '77', '--pr', '10', '--sha', SHA_A.toUpperCase()], opts), 0);
    assert.equal(main(['merged', '--pid', '77', '--pr', '10', '--sha', 'nope'], opts), 0, 'invalid input is a warning, not a failure');
    assert.deepEqual(readMarkerFile(t.file).merged, [{ pr: 10, sha: SHA_A }]);
    assert.equal(main(['covers', '--sha', SHA_A], opts), 0);
    assert.equal(main(['covers', '--sha', SHA_A], { ...opts, isAlive: dead }), 1, 'stale = not covered');
    assert.equal(main(['status'], opts), 0);
    assert.match(out.at(-1), /"pid":77/);
    assert.equal(main(['stop', '--pid', '77'], opts), 0);
    assert.equal(existsSync(t.file), false);
    assert.equal(main(['start'], opts), 0, 'missing --pid never fails the queue');
    assert.equal(existsSync(t.file), false);
    assert.equal(main(['bogus'], opts), 1);
  } finally { t.cleanup(); }
});

test('marker path: env override, else the shared git root so worktrees see one file', () => {
  assert.equal(markerFilePath({ env: { MERGE_QUEUE_MARKER_FILE: join(tmpdir(), 'x.json') } }), join(tmpdir(), 'x.json'));
  const t = tmpFile();
  try {
    assert.equal(spawnSync('git', ['init', '-q', t.dir]).status, 0);
    const p = markerFilePath({ cwd: t.dir, env: {} });
    assert.ok(p.toLowerCase().endsWith(join('.claude', 'run', 'merge-queue-active.json').toLowerCase()));
    const sub = join(t.dir, 'deep');
    spawnSync('git', ['-C', t.dir, 'commit', '--allow-empty', '-q', '-m', 'x'], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    assert.equal(spawnSync('git', ['-C', t.dir, 'worktree', 'add', '-q', sub]).status, 0);
    assert.equal(markerFilePath({ cwd: sub, env: {} }), p, 'a worktree resolves to the main checkout marker');
  } finally { t.cleanup(); }
});

test('isPidAlive and parsePrList', () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(0), false);
  assert.equal(isPidAlive(-1), false);
  const gone = spawnSync(process.execPath, ['-e', '0']).pid;
  assert.equal(isPidAlive(gone), false, 'an exited process is not alive');
  assert.deepEqual(parsePrList('1,2 3,,x,-4,2'), [1, 2, 3]);
});

// --- merge-queue.ps1: markoeren skrives ikke i -DryRun og fjernes i finally ---
const queue = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('merge-queue.ps1 starts the marker before the loop, records every merge and stops it in finally', () => {
  const start = queue.indexOf("Invoke-ActiveMarker @('start', '--prs', ($PrNumbers -join ','))\ntry {\nfor ($idx = 0;");
  assert.ok(start > 0, 'marker start + try wraps the merge loop');
  assert.match(queue, /\} finally \{\n[^\n]*\n  Invoke-ActiveMarker @\('stop'\)\n\}\n?$/, 'finally at the end of the script removes the marker');
  const merged = queue.indexOf("Invoke-ActiveMarker @('merged', '--pr', \"$n\", '--sha', $sha)");
  assert.ok(merged > queue.indexOf('$script:batchShas += $sha'), 'merge SHA is recorded after it is known');
  assert.match(queue.slice(merged, merged + 400), /Invoke-TrainCloseOut -Entries @\(\[pscustomobject\]@\{ number = \$n; sha = \$sha \}\) -Phase 'merged'/, 'SHA comment straight after the merge');
});

const psQuote = (value) => "'" + value.replaceAll("'", "''") + "'";
function runMarkerFn(body) {
  const input = `$ErrorActionPreference='Stop'
$ast=[Management.Automation.Language.Parser]::ParseInput(${psQuote(queue)},[ref]$null,[ref]$null)
$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-ActiveMarker'},$true)
if(-not $fn){throw 'Missing Invoke-ActiveMarker'}
Invoke-Expression $fn.Extent.Text
$script:ActiveMarkerScript='fixture.mjs'; $script:nodeCalls=@()
function node { $script:nodeCalls += ,@($args); if($script:throwNode){ throw 'boom' }; $global:LASTEXITCODE=0 }
${body}
Write-Output ('RESULT='+(@{calls=@($script:nodeCalls | ForEach-Object { ,@($_ | ForEach-Object { [string]$_ }) })}|ConvertTo-Json -Compress -Depth 5))
`;
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '& ([scriptblock]::Create([Console]::In.ReadToEnd()))'], { input, encoding: 'utf8', timeout: 60_000 });
  assert.ifError(result.error);
  const line = result.stdout.split(/\r?\n/).find((l) => l.startsWith('RESULT='));
  assert.ok(line, `fixture produced no result: ${result.stderr.slice(-1200)}`);
  const data = JSON.parse(line.slice(7));
  return { status: result.status, calls: (data.calls ?? []).map((c) => (Array.isArray(c) ? c : [c])) };
}

test('Invoke-ActiveMarker writes nothing in -DryRun, passes the own PID and never throws', () => {
  const dry = runMarkerFn("$DryRun=$true; Invoke-ActiveMarker @('start','--prs','1,2')");
  assert.deepEqual(dry.calls, [], '-DryRun writes no marker');
  const real = runMarkerFn("$DryRun=$false; Invoke-ActiveMarker @('start','--prs','1,2')");
  assert.equal(real.calls.length, 1);
  assert.deepEqual(real.calls[0].slice(0, 4), ['fixture.mjs', 'start', '--prs', '1,2']);
  assert.equal(real.calls[0][4], '--pid');
  assert.match(real.calls[0][5], /^\d+$/);
  const throwing = runMarkerFn("$DryRun=$false; $script:throwNode=$true; Invoke-ActiveMarker @('stop')");
  assert.equal(throwing.status, 0, 'a marker failure never stops the queue');
  assert.equal(throwing.calls.length, 1);
});

test('PowerShell runs the marker cleanup in finally on exit, and keeps the exit code', () => {
  const t = tmpFile();
  try {
    const script = join(t.dir, 'q.ps1');
    writeFileSync(script, `try {\n  if ($args[0] -eq 'stop') { exit 1 }\n  if ($args[0] -eq 'pending') { exit 75 }\n} finally {\n  Set-Content -LiteralPath '${join(t.dir, 'cleaned').replaceAll("'", "''")}' -Value $args[0]\n}\n`);
    for (const [mode, code] of [['stop', 1], ['pending', 75], ['ok', 0]]) {
      rmSync(join(t.dir, 'cleaned'), { force: true });
      const res = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', script, mode], { encoding: 'utf8', timeout: 60_000 });
      assert.equal(res.status, code, mode);
      assert.equal(readFileSync(join(t.dir, 'cleaned'), 'utf8').trim(), mode, `${mode}: finally ran`);
    }
  } finally { t.cleanup(); }
});
