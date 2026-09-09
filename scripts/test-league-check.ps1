$ErrorActionPreference = 'Stop'
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
Write-Host 'PASS: 7 merge-gate scenarios, including failed, skipped and missing league audit.'
