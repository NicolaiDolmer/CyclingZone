import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  ACQUIRE_EXIT, LOCK_STALE_MS, MAX_AGE_MS, acquireMarker, isPidAlive, isStale, main, markerCovers, markerFilePath, parsePrList,
  readActiveMarker, readMarkerFile, recordMerge, startMarker, stopMarker, withFileLock,
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

// --- Codex P2 (#8330): koe-markoeren tages atomisk ---
test('acquireMarker refuses a live owner and takes over a missing, stale or broken marker', () => {
  const t = tmpFile();
  try {
    assert.equal(acquireMarker(t.file, { pid: 100, prs: [1], now: NOW, isAlive: alive }).ok, true, 'empty -> ours');
    const busy = acquireMarker(t.file, { pid: 200, prs: [2], now: NOW, isAlive: alive });
    assert.equal(busy.ok, false, 'a live owner is never overwritten');
    assert.equal(busy.owner.pid, 100);
    assert.deepEqual(readMarkerFile(t.file).prs, [1], 'the owner marker is untouched');
    assert.equal(acquireMarker(t.file, { pid: 100, prs: [1, 3], now: NOW, isAlive: alive }).ok, true, 'the owner may re-acquire');
    assert.equal(acquireMarker(t.file, { pid: 200, prs: [2], now: NOW, isAlive: dead }).ok, true, 'dead owner -> take over');
    assert.equal(readMarkerFile(t.file).pid, 200);
    writeFileSync(t.file, '{not json');
    assert.equal(acquireMarker(t.file, { pid: 300, prs: [4], now: NOW, isAlive: alive }).ok, true, 'broken file -> take over');
    assert.equal(existsSync(`${t.file}.lock`), false, 'the lock is released');
  } finally { t.cleanup(); }
});

test('CLI acquire: exit 0 = ours, 3 = another live queue, 4 = no proven ownership', () => {
  const t = tmpFile();
  try {
    const out = [];
    const opts = { file: t.file, now: NOW, isAlive: alive, out: (l) => out.push(l) };
    assert.equal(main(['acquire', '--pid', '11', '--prs', '5,6'], opts), ACQUIRE_EXIT.OK);
    assert.equal(main(['acquire', '--pid', '12', '--prs', '7'], opts), ACQUIRE_EXIT.BUSY);
    assert.match(out.at(-1), /pid 11.*5,6/);
    assert.equal(main(['acquire', '--prs', '7'], opts), ACQUIRE_EXIT.ERROR, 'missing --pid fails closed');
    mkdirSync(`${t.file}.lock`);
    assert.equal(main(['acquire', '--pid', '12'], { ...opts, isAlive: dead, lockOpts: { timeoutMs: 50, sleep: () => {} } }), ACQUIRE_EXIT.ERROR, 'a held lock fails closed');
    assert.equal(readMarkerFile(t.file).pid, 11);
  } finally { t.cleanup(); }
});

function ageDir(dir) {
  const old = new Date(Date.now() - LOCK_STALE_MS - 5_000);
  utimesSync(dir, old, old);
}

test('withFileLock clears a lock left by a killed process and only ever removes its own', () => {
  const t = tmpFile();
  try {
    mkdirSync(`${t.file}.lock`, { recursive: true });
    ageDir(`${t.file}.lock`);
    assert.equal(withFileLock(t.file, () => 'ran', { timeoutMs: 1_000 }), 'ran');
    assert.throws(() => withFileLock(t.file, () => { throw new Error('boom'); }), /boom/);
    assert.equal(existsSync(`${t.file}.lock`), false);
    // En laas der under fn blev overtaget af en anden (token skiftet), fjernes ikke.
    withFileLock(t.file, () => writeFileSync(join(`${t.file}.lock`, 'owner'), 'someone-else'));
    assert.equal(existsSync(`${t.file}.lock`), true, 'a replacement lock survives the old owner release');
  } finally { t.cleanup(); }
});

test('a recovery left by a killed process fails closed (no endless wait, no double entry)', () => {
  const t = tmpFile();
  try {
    mkdirSync(`${t.file}.lock`, { recursive: true });
    ageDir(`${t.file}.lock`);
    mkdirSync(`${t.file}.lock.recover`);
    let ran = false;
    assert.throws(() => withFileLock(t.file, () => { ran = true; }, { timeoutMs: 50, sleep: () => {} }), /optaget/);
    assert.equal(ran, false);
  } finally { t.cleanup(); }
});

// Hver "koe" er sin egen proces, der lever under hele kapploebet (som pwsh-koeen).
// Ingen vaeg-ur-vinduer (AGENTS.md): faelles injiceret tid, og testen styrer
// start og slut med filer, saa vinderen lever, til alle har svaret.
const RACE_CHILD = `const { existsSync } = await import('node:fs');
const { main } = await import(process.env.RACE_MODULE);
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
const giveUp = () => { process.stdout.write('TIMEOUT\\n'); process.exit(9); };
let spins = 0;
process.stdout.write('READY\\n');
while (!existsSync(process.env.RACE_GO)) { pause(); if (++spins > 30000) giveUp(); }
const code = main(['acquire', '--pid', String(process.pid), '--prs', '1'], { now: new Date(process.env.RACE_NOW), out: () => {} });
process.stdout.write('CODE=' + code + '\\n');
spins = 0;
while (!existsSync(process.env.RACE_RELEASE)) { pause(); if (++spins > 30000) giveUp(); }`;

async function raceQueues(t, contenders) {
  const env = {
    ...process.env,
    MERGE_QUEUE_MARKER_FILE: t.file,
    RACE_MODULE: new URL('./merge-queue-active-marker.mjs', import.meta.url).href,
    RACE_NOW: NOW.toISOString(),
    RACE_GO: join(t.dir, 'go'),
    RACE_RELEASE: join(t.dir, 'release'),
  };
  let ready = 0;
  let answered = 0;
  let onReady;
  let onAnswered;
  const allReady = new Promise((r) => { onReady = r; });
  const allAnswered = new Promise((r) => { onAnswered = r; });
  const finished = Array.from({ length: contenders }, () => new Promise((resolveRun, reject) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', RACE_CHILD], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => {
      const before = stdout;
      stdout += d;
      if (!before.includes('READY') && stdout.includes('READY') && ++ready === contenders) onReady();
      if (!before.includes('CODE=') && stdout.includes('CODE=') && ++answered === contenders) onAnswered();
    });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', reject);
    p.on('close', (exit) => {
      if (!stdout.includes('CODE=')) { onReady(); onAnswered(); }
      resolveRun({ code: Number(/CODE=(\d+)/.exec(stdout)?.[1] ?? -1), exit, stderr: stderr.slice(-400) });
    });
  }));
  await allReady;
  writeFileSync(env.RACE_GO, '');
  await allAnswered;
  writeFileSync(env.RACE_RELEASE, '');
  return Promise.all(finished);
}

test('race: queues that start at the same instant -> exactly one acquires the marker', async () => {
  const t = tmpFile();
  try {
    const results = await raceQueues(t, 6);
    assert.deepEqual(results.map((r) => r.code).sort(), [0, 3, 3, 3, 3, 3], `exactly one winner: ${JSON.stringify(results)}`);
    assert.equal(existsSync(`${t.file}.lock`), false);
  } finally { t.cleanup(); }
});

test('race: queues that all find the same abandoned lock -> exactly one acquires the marker', async () => {
  const t = tmpFile();
  try {
    mkdirSync(`${t.file}.lock`, { recursive: true });
    ageDir(`${t.file}.lock`);
    const results = await raceQueues(t, 6);
    assert.deepEqual(results.map((r) => r.code).sort(), [0, 3, 3, 3, 3, 3], `exactly one winner: ${JSON.stringify(results)}`);
    assert.equal(existsSync(`${t.file}.lock`), false);
    assert.equal(existsSync(`${t.file}.lock.recover`), false);
  } finally { t.cleanup(); }
});

// --- merge-queue.ps1: markoeren skrives ikke i -DryRun og fjernes i finally ---
const queue = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('merge-queue.ps1 acquires the marker atomically before the loop, records every merge and stops it in finally', () => {
  const acquire = queue.indexOf('& node $script:ActiveMarkerScript acquire --prs ($PrNumbers -join \',\') --pid "$PID"');
  assert.ok(acquire > 0, 'the queue takes the marker with acquire (Codex P2 #8330), not status + start');
  assert.ok(!queue.includes("Invoke-ActiveMarker @('start'"), 'no unconditional start that could overwrite a live owner');
  assert.ok(!queue.includes('ActiveMarkerScript status'), 'no separate status read (the race window)');
  const busy = queue.indexOf('if ($acquireExit -eq 3) {', acquire);
  const failed = queue.indexOf('if ($acquireExit -ne 0) {', acquire);
  const loop = queue.indexOf('try {\nfor ($idx = 0;');
  assert.ok(busy > acquire && failed > busy && loop > failed, 'busy -> exit 3, any other failure -> stop, both before the merge loop');
  assert.match(queue.slice(busy, failed), /exit 3/);
  assert.match(queue.slice(failed, loop), /exit 1/, 'fail-closed: no proven ownership, no merges');
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
