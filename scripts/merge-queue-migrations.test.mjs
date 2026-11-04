import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const queue = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
function runQueueFunctions(names, body, source = queue) {
  const prelude = `$ErrorActionPreference='Stop'
$ast=[Management.Automation.Language.Parser]::ParseInput(${psQuote(source)},[ref]$null,[ref]$null)
foreach($name in @(${names.map(psQuote).join(',')})){
 $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 if(-not $fn){throw "Missing queue function: $name"}
 Invoke-Expression $fn.Extent.Text
}
`;
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '& ([scriptblock]::Create([Console]::In.ReadToEnd()))'], {
    input: prelude + body, encoding: 'utf8', timeout: 60_000,
  });
  assert.ifError(result.error);
  const line = result.stdout.split(/\r?\n/).find(line => line.startsWith('RESULT='));
  assert.ok(line, `queue fixture produced no result: ${result.stderr.slice(-1200)}`);
  return { status: result.status, data: JSON.parse(line.slice(7)) };
}
function closeTrain(proofs, needsMigration = [true, false, true], source = queue) {
  const entries = needsMigration.map((need, index) => ({
    number: index + 1, sha: String(index + 1).repeat(40), needsMigration: need,
  }));
  return runQueueFunctions(['Wait-BatchMigrations', 'Test-MergeCommitMigration', 'Close-OpenTrain'], `
$script:trainEntries=ConvertFrom-Json ${psQuote(JSON.stringify(entries))}
$script:proofs=ConvertFrom-Json ${psQuote(JSON.stringify(proofs))}
$script:batchMerged=@(1,2,3); $script:batchShas=@('first','last')
$script:lastMergedSha='last'; $script:batchBackend=$false; $script:batchRailway=$false; $script:batchVercel=$false
$script:trainDeploys=1; $script:trainNeedsRailway=$true; $script:queueStall=$false
$script:calls=@(); $script:nextMerge=0; $script:unexpected=$null; $CiTimeoutMinutes=1; $StallMinutes=0; $MinWaitMinutesNoBackend=0
function Wait-BatchCi { return $true }
function Wait-ForWorkflowRun {
 param($WorkflowFile,$Sha,$TimeoutMinutes,$Label,$StallMinutes)
 if($WorkflowFile -ne 'auto-migrate.yml'){throw 'Wrong migration workflow'}
 $script:calls+= $Sha
 $index=$script:calls.Count-1
 return ($index -lt $script:proofs.Count -and [bool]$script:proofs[$index])
}
function Start-Sleep { param($Seconds) }
# Fixture-SHA'erne findes ikke i repoet: git svarer ukendt, saa ventetiden er fail-closed som foer.
function git { $global:LASTEXITCODE=1 }
try { Close-OpenTrain; $script:nextMerge++ }
catch { $script:unexpected=$_.Exception.GetType().Name; exit 2 }
finally {
 $result=@{calls=@($script:calls);batchCount=$script:batchMerged.Count;entryCount=$script:trainEntries.Count;nextMerge=$script:nextMerge;unexpected=$script:unexpected}
 Write-Output ('RESULT='+($result|ConvertTo-Json -Compress))
}
`, source);
}
function assertTrainBlocked(result, expectedCalls) {
  assert.equal(result.status, 1, 'failed migration proof must exit 1');
  assert.equal(result.data.unexpected, null);
  assert.deepEqual(result.data.calls, expectedCalls);
  assert.equal(result.data.batchCount, 3, 'failed proof must retain the train');
  assert.equal(result.data.entryCount, 3, 'failed proof must retain migration entries');
  assert.equal(result.data.nextMerge, 0, 'failed proof must stop before another merge');
}
test('real train closure stops before clearing or continuing on failed or missing migration evidence', () => {
  assertTrainBlocked(closeTrain([false]), ['1'.repeat(40)]);
  assertTrainBlocked(closeTrain([true, false]), ['1'.repeat(40), '3'.repeat(40)]);
  assertTrainBlocked(closeTrain([]), ['1'.repeat(40)]);
});
test('real train closure checks every migration and allows non-migration trains without a workflow', () => {
  const success = closeTrain([true, true]);
  assert.equal(success.status, 0);
  assert.equal(success.data.unexpected, null);
  assert.deepEqual(success.data.calls, ['1'.repeat(40), '3'.repeat(40)]);
  assert.equal(success.data.batchCount, 0);
  assert.equal(success.data.entryCount, 0);
  assert.equal(success.data.nextMerge, 1);
  const noSql = closeTrain([], [false, false, false]);
  assert.equal(noSql.status, 0);
  assert.deepEqual(noSql.data.calls, []);
  assert.equal(noSql.data.nextMerge, 1);
});
test('negative control detects a disabled real train-closure migration gate', () => {
  const disabled = queue.replace('if (-not (Wait-BatchMigrations)) {', 'if ($false -and -not (Wait-BatchMigrations)) {');
  assert.notEqual(disabled, queue, 'negative control must mutate the actual closure');
  const mutated = closeTrain([false], undefined, disabled);
  assert.throws(() => assertTrainBlocked(mutated, ['1'.repeat(40)]), /failed migration proof must exit 1/);
});
test('real PR planning classifies SQL, renames and unknown or incomplete file lists', () => {
  for (const [rows, changedFiles, expected] of [
    [['database/2026-11-02-seed.sql'], 1, true],
    [['docs/internal.md'], 1, false],
    [['database/manual/2026-11-02-private.sql'], 1, false],
    [['docs/moved.sql\tdatabase/2026-11-02-old.sql'], 1, true],
    [['docs/internal.md'], 2, true],
    [[], 0, true],
  ]) {
    const meta = { title: 'fixture', mergeable: 'MERGEABLE', isDraft: false, headRefOid: 'a'.repeat(40), mergeStateStatus: 'CLEAN', changedFiles };
    const result = runQueueFunctions(['Get-PrPlanEntry'], `
$Repo='fixture'; $CodeRabbitNight=$false
$script:meta=${psQuote(JSON.stringify(meta))}
$script:rows=ConvertFrom-Json ${psQuote(JSON.stringify(rows))}
function gh { $global:LASTEXITCODE=1 }
function Invoke-GhWithRetry {
 param($GhArgs,[switch]$TolerateFailure)
 if($GhArgs -contains 'files,changedFiles,title,mergeable,isDraft,headRefOid,mergeStateStatus'){return $script:meta}
 if($GhArgs -contains 'api'){return $script:rows}
 if($GhArgs -contains 'headRefOid'){return '${'a'.repeat(40)}'}
 throw 'Unexpected external query'
}
function Join-Path { param($Path,$ChildPath) return $ChildPath }
function node {
 param($Classifier,$Paths)
 if($Classifier -ne 'merge-queue-files.mjs'){throw 'Wrong classifier'}
 $global:LASTEXITCODE=0
 return '{"touchesBackend":false,"touchesRailway":false,"touchesVercel":false,"solo":false,"needRailway":false}'
}
$entry=Get-PrPlanEntry 1
Write-Output ('RESULT='+(@{needsMigration=$entry.needsMigration}|ConvertTo-Json -Compress))
`);
    assert.equal(result.status, 0);
    assert.equal(result.data.needsMigration, expected, `${JSON.stringify(rows)} / changed=${changedFiles}`);
  }
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

test('merge commit without SQL skips the Auto-migrate wait even when the pre-merge file list was unknown', () => {
  const sha = 'f'.repeat(40);
  for (const [paths, expectWait] of [[['docs/internal.md', 'scripts/x.mjs'], false], [['database/2026-11-03-seed.sql'], true]]) {
    const result = runQueueFunctions(['Wait-BatchMigrations', 'Test-MergeCommitMigration'], `
$script:trainEntries=@(@{number=1;sha='${sha}';needsMigration=$true})
$script:calls=@(); $CiTimeoutMinutes=1; $StallMinutes=0
$script:paths=ConvertFrom-Json ${psQuote(JSON.stringify(paths))}
function git { $global:LASTEXITCODE=0; if ($args -contains 'diff-tree') { return $script:paths } }
function Wait-ForWorkflowRun { param($WorkflowFile,$Sha,$TimeoutMinutes,$Label,$StallMinutes) $script:calls+= $Sha; return $true }
$ok=Wait-BatchMigrations
Write-Output ('RESULT='+(@{ok=$ok;calls=@($script:calls)}|ConvertTo-Json -Compress))
`);
    assert.equal(result.data.ok, true);
    assert.deepEqual(result.data.calls, expectWait ? [sha] : [], JSON.stringify(paths));
  }
});

test('commit missing locally is fetched by SHA, non-interactively, then read', () => {
  const sha = 'd'.repeat(40);
  const result = runQueueFunctions(['Test-MergeCommitMigration'], `
$script:n=0; $script:fetchArgs=$null; $script:prompt=$null; $env:GIT_TERMINAL_PROMPT='keep'
function git {
 $script:n++
 if ($args -contains 'fetch') { $script:fetchArgs=@($args); $script:prompt=$env:GIT_TERMINAL_PROMPT; $global:LASTEXITCODE=0; return }
 if ($args -contains 'diff-tree') { $global:LASTEXITCODE=0; return @('docs/x.md') }
 $global:LASTEXITCODE = $(if ($script:n -eq 1) { 1 } else { 0 })
}
$verdict=Test-MergeCommitMigration -Sha '${sha}'
Write-Output ('RESULT='+(@{verdict=$verdict;fetchArgs=$script:fetchArgs;prompt=$script:prompt;after=$env:GIT_TERMINAL_PROMPT}|ConvertTo-Json -Compress))
`);
  assert.equal(result.data.verdict, 'no', 'fetched commit without SQL skips the wait');
  assert.ok(result.data.fetchArgs.includes(sha), 'fetches exactly the merge commit');
  assert.ok(!result.data.fetchArgs.includes('main'), 'never fetches origin main again');
  assert.ok(result.data.fetchArgs.includes('credential.interactive=never'), 'no credential GUI prompt');
  assert.equal(result.data.prompt, '0', 'terminal prompt disabled during fetch');
  assert.equal(result.data.after, 'keep', 'caller environment restored');
});

test('unreadable merge commit keeps the fail-closed Auto-migrate wait', () => {
  const sha = 'e'.repeat(40);
  const result = runQueueFunctions(['Wait-BatchMigrations', 'Test-MergeCommitMigration'], `
$script:trainEntries=@(@{number=1;sha='${sha}';needsMigration=$true})
$script:calls=@(); $CiTimeoutMinutes=1; $StallMinutes=0
function git { $global:LASTEXITCODE=1 }
function Wait-ForWorkflowRun { param($WorkflowFile,$Sha,$TimeoutMinutes,$Label,$StallMinutes) $script:calls+= $Sha; return $false }
$ok=Wait-BatchMigrations
Write-Output ('RESULT='+(@{ok=$ok;calls=@($script:calls)}|ConvertTo-Json -Compress))
`);
  assert.equal(result.data.ok, false);
  assert.deepEqual(result.data.calls, [sha]);
});
