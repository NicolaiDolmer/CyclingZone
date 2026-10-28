$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'lib/league-check.ps1')
$sha = 'a' * 40
function RestCheck($status = 'completed', $conclusion = 'success') {
  [pscustomobject]@{ name='league-size-invariant'; head_sha=$sha; external_id="league-audit:$sha"; status=$status; conclusion=$conclusion; app=[pscustomobject]@{ slug='github-actions' } }
}
$good = RestCheck
$wrongHead = RestCheck; $wrongHead.head_sha = 'b' * 40
$wrongApp = RestCheck; $wrongApp.app.slug = 'other-app'
$wrongIdentity = RestCheck; $wrongIdentity.external_id = 'unrelated'
$cases = @(
  @{ Name='green audit survives skipped suite omission from rollup'; Checks=@($good); Expected=0 },
  @{ Name='missing audit'; Checks=@(); Expected=1 },
  @{ Name='wrong head'; Checks=@($wrongHead); Expected=1 },
  @{ Name='wrong app'; Checks=@($wrongApp); Expected=1 },
  @{ Name='wrong identity'; Checks=@($wrongIdentity); Expected=1 },
  @{ Name='duplicate audit'; Checks=@($good,$good); Expected=1 },
  @{ Name='queued'; Checks=@((RestCheck 'queued' $null)); Expected=8 },
  @{ Name='running'; Checks=@((RestCheck 'in_progress' $null)); Expected=8 },
  @{ Name='failed'; Checks=@((RestCheck 'completed' 'failure')); Expected=1 },
  @{ Name='skipped'; Checks=@((RestCheck 'completed' 'skipped')); Expected=1 },
  @{ Name='cancelled'; Checks=@((RestCheck 'completed' 'cancelled')); Expected=1 },
  @{ Name='unknown status'; Checks=@((RestCheck 'unknown' 'success')); Expected=1 },
  @{ Name='invalid head'; Checks=@($good); Sha='invalid'; Expected=1 }
)
foreach ($case in $cases) {
  $target = if ($case.ContainsKey('Sha')) { $case.Sha } else { $sha }
  $actual = Get-LeagueRestCheckExitCode -Checks $case.Checks -HeadSha $target
  if ($actual -ne $case.Expected) { throw "$($case.Name): expected $($case.Expected), got $actual" }
}
Write-Host "PASS: $($cases.Count) REST audit scenarios."

# Exercise the real queue entry with rollup omitting the audit, as observed on #7309.
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'merge-queue.ps1'), [ref]$null, [ref]$null)
$fn = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-PrPlanEntry' }, $true)
# AST extraction has no source path; preserve the script root used by production.
$testScriptRoot=$PSScriptRoot.Replace("'", "''")
Invoke-Expression ($fn.Extent.Text.Replace('$PSScriptRoot', "'$testScriptRoot'"))
$Repo = 'owner/repo'
$CodeRabbitNight=$false
$script:gateReads=0
$script:requiredExit=0
$script:reviewBucket='pass'
$script:pushBeforeAudit=$false
function gh {
  $global:LASTEXITCODE = 0
  if ($args -contains '--required') { $script:gateReads++; $global:LASTEXITCODE=$script:requiredExit; return }
  ConvertTo-Json -InputObject @(@{name='review-gate';bucket=$script:reviewBucket;startedAt='2026-10-27T20:00:00Z';event='pull_request_target'}) -Compress
}
function Invoke-GhWithRetry {
  param([string[]]$GhArgs, [switch]$TolerateFailure)
  if ($GhArgs -contains 'headRefOid') { if ($script:pushBeforeAudit -and $script:gateReads -eq 0) { return ('c' * 40) }; return $sha }
  if ($GhArgs[0] -eq 'api' -and $GhArgs[1] -like '*check-runs*') {
    if ($GhArgs[1] -notlike "*/commits/$sha/check-runs?*" -or $GhArgs -notcontains '--paginate' -or $GhArgs -notcontains '--slurp') { throw 'Audit request must be pinned and paginated' }
    return ConvertTo-Json -InputObject @(@{check_runs=@($good)}) -Depth 8 -Compress
  }
  if ($GhArgs -contains 'files,changedFiles,title,mergeable,isDraft,headRefOid,mergeStateStatus') {
    return ConvertTo-Json -Compress @{ title='test'; mergeable='MERGEABLE'; isDraft=$false; headRefOid=$script:metadataHead; mergeStateStatus='CLEAN'; changedFiles=1 }
  }
  if ($GhArgs[0] -eq 'api' -and $GhArgs[1] -like '*/files') { return 'docs/test.md' }
  return $null
}
$script:metadataHead = $sha
$entry = Get-PrPlanEntry 7309
if ($entry.checksExit -ne 0) { throw "Queue must accept the actual green REST audit when rollup omits it: $($entry.checksExit)" }
Write-Host 'PASS: real Get-PrPlanEntry accepts the pinned REST audit without a rollup audit.'

$script:metadataHead = 'b' * 40
$entry = Get-PrPlanEntry 7309
if ($entry.checksExit -ne 1) { throw 'A push during the audit/metadata read must not certify a different HEAD' }
Write-Host 'PASS: a HEAD change during audit fails closed.'
$script:metadataHead=$sha
$script:gateReads=0
$script:requiredExit=0
$script:reviewBucket='pass'
$script:pushBeforeAudit=$true
$entry=Get-PrPlanEntry 7309
if($entry.checksExit -ne 1){throw 'A push between required checks and audit must fail closed (CodeRabbit #7313)'}
Write-Host 'PASS: a HEAD change between required checks and audit fails closed.'
# The explicit substitute must replace only the extra reviewer, never required checks.
$realNode=(Get-Command node -CommandType Application | Select-Object -First 1).Source
function node {
 if($args[0] -like '*review-coderabbit-night.mjs'){
   $global:LASTEXITCODE=$script:rabbitExit
   return $script:rabbitJson
 }
 & $realNode @args
}
$script:pushBeforeAudit=$false
$script:metadataHead=$sha
$script:reviewBucket='fail'
$script:rabbitExit=0
$script:rabbitJson=ConvertTo-Json -Compress @{ok=$true;secondReviewer='CodeRabbit';expiresAt=([datetimeoffset]'2026-10-29T22:00:00Z').ToUnixTimeMilliseconds();headSha=$sha}
$CodeRabbitNight=$false
$entry=Get-PrPlanEntry 7313
if($entry.checksExit -ne 1){throw 'Normal gate must still reject absent Claude'}
$CodeRabbitNight=$true
$entry=Get-PrPlanEntry 7313
if($entry.checksExit -ne 0){throw 'Explicit verified CodeRabbit substitute must be usable for the approved PR'}
$script:rabbitJson=ConvertTo-Json -Compress @{ok=$true;secondReviewer='CodeRabbit';expiresAt=([datetimeoffset]'2026-10-29T22:00:00Z').ToUnixTimeMilliseconds();headSha=('d'*40)}
$entry=Get-PrPlanEntry 7313
if($entry.checksExit -ne 1){throw 'Stale substitute HEAD must not pass'}
$script:rabbitJson=ConvertTo-Json -Compress @{ok=$true;secondReviewer='CodeRabbit';expiresAt=([datetimeoffset]'2026-10-29T22:00:00Z').ToUnixTimeMilliseconds();headSha=$sha}
$script:requiredExit=1
$entry=Get-PrPlanEntry 7313
if($entry.checksExit -ne 1){throw 'CodeRabbit substitution must never bypass required CI'}
Write-Host 'PASS: substitute opt-in, unchanged default gate, stale SHA rejection and required CI preserved.'
# Expiry must also hold after the merge lock wait and before each retry.
$ownedPath=Join-Path $PSScriptRoot 'lib/merge-pr-owned.ps1'
$ownedAst=[Management.Automation.Language.Parser]::ParseFile($ownedPath,[ref]$null,[ref]$null)
$deadlineFn=$ownedAst.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Assert-MergeReviewDeadline'},$true)
if(-not $deadlineFn){throw 'Missing authoritative merge deadline check'}
Invoke-Expression $deadlineFn.Extent.Text
Assert-MergeReviewDeadline '2026-10-29T22:00:00Z' ([datetimeoffset]'2026-10-29T21:59:59Z')
$blocked=$false
try { Assert-MergeReviewDeadline '2026-10-29T22:00:00Z' ([datetimeoffset]'2026-10-29T22:00:00Z') } catch { $blocked=$true }
if(-not $blocked){throw 'Deadline boundary must reject the merge'}
. (Join-Path $PSScriptRoot 'lib/gh-retry.ps1')
$script:mergeCalls=0;$script:deadlineReads=0
function gh { $script:mergeCalls++;$global:LASTEXITCODE=1;return 'transient failure' }
$nowValues=@([datetimeoffset]'2026-10-29T21:59:59Z',[datetimeoffset]'2026-10-29T22:00:00Z')
$blocked=$false
try {
 Invoke-GhWithRetry @('pr','merge','7313') -Attempts 2 -DelaySeconds 0 -BeforeAttempt {
  $now=$nowValues[$script:deadlineReads];$script:deadlineReads++
  Assert-MergeReviewDeadline '2026-10-29T22:00:00Z' $now
 }
} catch { $blocked=$true }
if(-not $blocked -or $script:mergeCalls -ne 1 -or $script:deadlineReads -ne 2){throw 'Expiry between retries must stop before the second gh merge'}
Write-Host 'PASS: merge boundary and per-attempt deadline checks use explicit injected times.'
