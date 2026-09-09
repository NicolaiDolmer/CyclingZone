function Get-LeagueCheckExitCode {
  param([object[]] $Checks)
  $league = @($Checks | Where-Object { $_.name -eq 'league-size-invariant' })
  if ($league.Count -ne 1) { return 1 }
  if ($league[0].bucket -eq 'pass') { return 0 }
  if ($league[0].bucket -eq 'pending') { return 8 }
  return 1
}
