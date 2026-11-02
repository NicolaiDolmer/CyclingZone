import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const queue = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('train closure waits for each migration SHA before clearing the train', () => {
  const close = queue.slice(queue.indexOf('function Close-OpenTrain'));
  assert.ok(close.indexOf('Wait-BatchMigrations') >= 0);
  assert.ok(close.indexOf('Wait-BatchMigrations') < close.indexOf('$script:batchMerged = @()'));
  assert.match(queue, /needsMigration\s*=\s*\[bool\]/);
  assert.match(queue, /database\/2026-\[\^\/\]\*\\\.sql/);
});

test('train checks every migration entry and stops on the first missing proof', () => {
  const batch = queue.slice(queue.indexOf('function Wait-BatchMigrations {'), queue.indexOf('function Wait-BatchCi {'));
  for (const fail of [false, true]) {
    const script = `${batch}
$script:trainEntries=@(
 @{number=1;sha='a';needsMigration=$true},
 @{number=2;sha='b';needsMigration=$false},
 @{number=3;sha='c';needsMigration=$true})
$script:calls=@(); $CiTimeoutMinutes=1; $StallMinutes=0
function Wait-ForWorkflowRun { param($WorkflowFile,$Sha,$TimeoutMinutes,$Label,$StallMinutes)
 if($WorkflowFile -ne 'auto-migrate.yml'){throw 'wrong workflow'}
 $script:calls+= $Sha
 return (-not $${fail})
}
$ok=Wait-BatchMigrations
if($ok -eq $${fail}){exit 8}
$expected=if($${fail}){'a'}else{'a,c'}
if(($script:calls -join ',') -ne $expected){exit 9}
`;
    const result = spawnSync('pwsh', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});

test('migration workflow waiter fails closed on wrong SHA and every non-success outcome', () => {
  const waiter = queue.slice(queue.indexOf('function Wait-ForWorkflowRun {'), queue.indexOf('function Wait-ForDeployVerification {'));
  for (const [status, conclusion, sha, expected] of [
    ['completed', 'success', 'expected', true],
    ['completed', 'failure', 'expected', false],
    ['completed', 'cancelled', 'expected', false],
    ['completed', 'timed_out', 'expected', false],
    ['completed', 'skipped', 'expected', false],
    ['completed', 'success', 'wrong', false],
    ['completed', 'success', '', false],
    ['in_progress', '', 'expected', false],
    ['missing', '', 'expected', false],
  ]) {
    const script = `${waiter}\n$DryRun=$false; $Repo='fixture'; $script:t=[datetime]'2026-11-02T00:00:00Z'
function Invoke-GhWithRetry { param($a, [switch]$TolerateFailure)
 if ('${status}' -eq 'missing') { return '[]' }
 if ($a -contains 'list') { return '[{"databaseId":1,"headSha":"expected"}]' }
 return '{"status":"${status}","conclusion":"${conclusion}","headSha":"${sha}","jobs":[]}'
}
$ok=Wait-ForWorkflowRun -WorkflowFile auto-migrate.yml -Sha expected -TimeoutMinutes 1 -Label fixture -Now { $script:t } -Pause { param($s) $script:t=$script:t.AddMinutes(2) }
if ($ok -ne $${expected}) { exit 9 }
`;
    const result = spawnSync('pwsh', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(result.status, 0, `${status}/${conclusion}/${sha}: ${result.stdout} ${result.stderr}`);
  }
});
