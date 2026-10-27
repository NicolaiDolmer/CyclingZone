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
Invoke-Expression $fn.Extent.Text
$Repo = 'owner/repo'
function gh {
  $global:LASTEXITCODE = 0
  if ($args -contains '--required') { return }
  '[{"name":"review-gate","bucket":"pass","startedAt":"2026-10-27T20:00:00Z","event":"pull_request_target"}]'
}
function Invoke-GhWithRetry {
  param([string[]]$GhArgs, [switch]$TolerateFailure)
  if ($GhArgs -contains 'headRefOid') { return $sha }
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