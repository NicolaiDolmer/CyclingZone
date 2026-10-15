$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'lib/league-check.ps1')
$cases = @(
  @{ Name='missing'; Checks=@(); Expected=1 },
  @{ Name='unrelated audit passed'; Checks=@(@{name='audit';bucket='pass'}); Expected=1 },
  @{ Name='league passed'; Checks=@(@{name='league-size-invariant';bucket='pass'}); Expected=0 },
  @{ Name='league pending'; Checks=@(@{name='league-size-invariant';bucket='pending'}); Expected=8 },
  @{ Name='league failed'; Checks=@(@{name='league-size-invariant';bucket='fail'}); Expected=1 },
  @{ Name='league skipped'; Checks=@(@{name='league-size-invariant';bucket='skipping'}); Expected=1 },
  @{ Name='ambiguous duplicates'; Checks=@(@{name='league-size-invariant';bucket='pass'},@{name='league-size-invariant';bucket='fail'}); Expected=1 }
)
foreach ($case in $cases) {
  $actual = Get-LeagueCheckExitCode -Checks $case.Checks
  if ($actual -ne $case.Expected) { throw "$($case.Name): expected $($case.Expected), got $actual" }
}

# #6654: review-gate. Formen matcher `gh pr checks --json name,bucket,startedAt`
# (ConvertFrom-Json giver pscustomobject med startedAt altid til stede).
function Gate([string]$bucket, $startedAt) { [pscustomobject]@{ name = 'review-gate'; bucket = $bucket; startedAt = $startedAt } }
$league = [pscustomobject]@{ name = 'league-size-invariant'; bucket = 'pass'; startedAt = '2026-10-15T10:00:00Z' }
$gateCases = @(
  @{ Name='gate missing (PR from before the gate)'; Checks=@($league); Expected=1 },
  @{ Name='gate missing, nothing at all'; Checks=@(); Expected=1 },
  @{ Name='gate passed'; Checks=@($league, (Gate 'pass' '2026-10-15T10:00:00Z')); Expected=0 },
  @{ Name='gate pending'; Checks=@((Gate 'pending' '2026-10-15T10:00:00Z')); Expected=8 },
  @{ Name='gate failed'; Checks=@((Gate 'fail' '2026-10-15T10:00:00Z')); Expected=1 },
  @{ Name='gate skipped'; Checks=@((Gate 'skipping' '2026-10-15T10:00:00Z')); Expected=1 },
  @{ Name='newest run wins (old fail, new pass)'; Checks=@((Gate 'fail' '2026-10-15T09:00:00Z'), (Gate 'pass' '2026-10-15T11:00:00Z')); Expected=0 },
  @{ Name='newest run wins (old pass, new fail)'; Checks=@((Gate 'pass' '2026-10-15T09:00:00Z'), (Gate 'fail' '2026-10-15T11:00:00Z')); Expected=1 },
  @{ Name='unstarted run counts as newest (null)'; Checks=@((Gate 'pass' '2026-10-15T09:00:00Z'), (Gate 'pending' $null)); Expected=8 },
  @{ Name='unstarted run counts as newest (zero date)'; Checks=@((Gate 'pass' '2026-10-15T09:00:00Z'), (Gate 'pending' '0001-01-01T00:00:00Z')); Expected=8 }
)
foreach ($case in $gateCases) {
  $actual = Get-ReviewGateCheckExitCode -Checks $case.Checks
  if ($actual -ne $case.Expected) { throw "$($case.Name): expected $($case.Expected), got $actual" }
}
Write-Host "PASS: $($cases.Count) league-audit + $($gateCases.Count) review-gate merge-gate scenarios, including failed, skipped and missing checks."
