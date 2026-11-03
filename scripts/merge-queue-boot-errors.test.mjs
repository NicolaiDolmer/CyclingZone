import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

test('queue distinguishes exhausted evidence probes without exposing their raw output', () => {
  const path = fileURLToPath(new URL('./merge-queue.ps1', import.meta.url)).replaceAll("'", "''");
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', `
    $ErrorActionPreference='Stop';
    $ast=[Management.Automation.Language.Parser]::ParseFile('${path}',[ref]$null,[ref]$null);
    $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-WaveEvidenceFailure'},$true);
    Invoke-Expression $fn.Extent.Text;
    @(@{boot=(Get-WaveEvidenceFailure @('private-command-fixture','WAVE_BOOT_IDENTITY_UNAVAILABLE')); process=(Get-WaveEvidenceFailure @('WAVE_PROCESS_SNAPSHOT_UNAVAILABLE')); other=(Get-WaveEvidenceFailure @('ordinary lock rejection'))}) | ConvertTo-Json -Compress
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.match(value.boot, /boot-identitet.*ikke en afvist boelgelaas/);
  assert.match(value.process, /procesbevis/);
  assert.equal(value.other, null);
  assert.doesNotMatch(result.stdout, /private-command-fixture/);
});

// Execute the actual guarded-merge statements and Exit-Queue/Close-OpenTrain.
// Only native merge and remote CI/deploy I/O are replaced in this fixture.
function guardedMergeFailure(mode, openTrain = true) {
  const source = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf('  $previousReviewDeadline = $env:CZ_MERGE_REVIEW_DEADLINE_UTC');
  const end = source.indexOf('  # Merge-commit-SHA', start);
  assert.ok(start > 0 && end > start, 'actual guarded-merge block exists');
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const queuePath = fileURLToPath(new URL('./merge-queue.ps1', import.meta.url));
  const input = `
$ErrorActionPreference='Stop'
$ast=[Management.Automation.Language.Parser]::ParseFile(${quote(queuePath)},[ref]$null,[ref]$null)
foreach($name in @('Get-WaveEvidenceFailure','Exit-Queue','Close-OpenTrain')){
 $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 Invoke-Expression $fn.Extent.Text
}
$script:batchMerged=@(${openTrain ? '1' : ''}); $script:batchShas=@('first')
$script:lastMergedSha=${openTrain ? "'first'" : '$null'}
$script:batchBackend=$true; $script:batchRailway=$false; $script:batchVercel=$false
$script:trainEntries=@(); $script:ciCalls=0; $script:deployCalls=0; $script:continued=$false; $script:unexpected=$null
$CiTimeoutMinutes=1; $StallMinutes=0; $DeployVerifyTimeoutMinutes=1
$env:CZ_MERGE_REVIEW_DEADLINE_UTC='original'
$CodeRabbitNight=$false; $n=2; $Repo='fixture/repo'; $PSScriptRoot='fixture'
$recheck=[pscustomobject]@{headSha=('b'*40)}
function Wait-BatchCi { $script:ciCalls++; return $true }
function Wait-ForDeployVerification { param($Sha,$TimeoutMinutes,$StallMinutes); $script:deployCalls++; return 'success' }
function Get-DeployGateAction { param($State); return 'continue' }
function node {
 if(${quote(mode)} -eq 'throw'){throw 'private-native-failure'}
 $global:LASTEXITCODE=2
 return 'WAVE_PROCESS_SNAPSHOT_UNAVAILABLE private-fixture-output'
}
try {
 ${source.slice(start, end)}
 $script:continued=$true
} catch { $script:unexpected=$_.Exception.Message; exit 2 }
finally {
 Write-Output ('RESULT='+(@{ci=$script:ciCalls;deploy=$script:deployCalls;continued=$script:continued;remaining=$script:batchMerged.Count;unexpected=$script:unexpected;deadline=$env:CZ_MERGE_REVIEW_DEADLINE_UTC}|ConvertTo-Json -Compress))
}
`;
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '& ([scriptblock]::Create([Console]::In.ReadToEnd()))'], { input, encoding:'utf8', timeout:30_000 });
  assert.ifError(result.error);
  const line = result.stdout.split(/\r?\n/).find(line=>line.startsWith('RESULT='));
  assert.ok(line, result.stderr);
  return {exit:result.status, data:JSON.parse(line.slice(7)), output:result.stdout};
}
test('guarded merge evidence failure closes the already merged train before exit', () => {
  for(const mode of ['evidence','throw']) {
    const result=guardedMergeFailure(mode);
    assert.equal(result.exit,1,JSON.stringify(result.data));
    assert.deepEqual(result.data,{ci:1,deploy:1,continued:false,remaining:0,unexpected:null,deadline:'original'},mode);
    assert.doesNotMatch(result.output,/private-native-failure|private-fixture-output/);
  }
});
test('guarded merge failure before the first merge exits without verifying an empty train', () => {
  const result=guardedMergeFailure('evidence',false);
  assert.equal(result.exit,1);
  assert.deepEqual(result.data,{ci:0,deploy:0,continued:false,remaining:0,unexpected:null,deadline:'original'});
});
