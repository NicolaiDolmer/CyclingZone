function Get-LeagueCheckExitCode {
  param([object[]] $Checks)
  $league = @($Checks | Where-Object { $_.name -eq 'league-size-invariant' })
  if ($league.Count -ne 1) { return 1 }
  if ($league[0].bucket -eq 'pass') { return 0 }
  if ($league[0].bucket -eq 'pending') { return 8 }
  return 1
}

# #6654 (rule 35): review-gate stopper merge-koeen ogsaa foer ejeren goer den
# required. Seneste koersel gaelder (en koersel uden startedAt, eller med
# GitHubs nul-dato, er endnu ikke startet og regnes som nyest). Rod, skippet og
# MANGLENDE check = stop (1): en PR uden gate-koersel har intet review-bevis.
# Afventer = vent (8).
# Kun checks fra event pull_request_target taeller (Codex-fund #6657): dér kommer
# YAML'en fra main. Et job med samme navn i en PR-styret workflow (pull_request)
# kan ikke efterligne gaten. Inputtet er `gh pr checks --json name,bucket,startedAt,event`.
function Test-TrustedReviewGateCheck($Check) {
  if ($Check.name -ne 'review-gate') { return $false }
  $eventProp = $Check.PSObject.Properties['event']
  return [bool]($eventProp -and $eventProp.Value -eq 'pull_request_target')
}

function Get-ReviewGateCheckExitCode {
  param([object[]] $Checks)
  $runs = @($Checks | Where-Object { Test-TrustedReviewGateCheck $_ })
  if ($runs.Count -eq 0) { return 1 }
  $gate = @($runs | Sort-Object -Descending {
      $at = $_.startedAt
      if ($at) { $dt = [datetime]$at; if ($dt.Year -gt 1) { return $dt } }
      [datetime]::MaxValue
    })
  if ($gate[0].bucket -eq 'pass') { return 0 }
  if ($gate[0].bucket -eq 'pending') { return 8 }
  return 1
}
