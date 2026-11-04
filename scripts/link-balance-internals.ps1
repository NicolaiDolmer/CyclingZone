# link-balance-internals.ps1 - goer et worktrees balance-internals/ til en
# junction til den delte OneDrive-mappe (#7587 punkt 7). Logikken bor i
# scripts/lib/balance-internals.ps1.
#
# Kaldes af setup-worktree.ps1 (altsaa ogsaa new-worktree.ps1) og af boelgens
# fase 0 for hvert spor - ogsaa et genbrugt worktree. Idempotent.
#
# Brug:
#   pwsh -NoProfile -File scripts/link-balance-internals.ps1 -WorktreeRoot <worktree>
#   pwsh -NoProfile -File scripts/link-balance-internals.ps1 -WorktreeRoot <worktree> -DryRun
#   ... -SharedRoot <mappe>    # kun til tests; default OneDrive\CyclingZone-context\balance-internals
#
# Exit 0 = linket (eller allerede linket, eller hovedcheckoutet - det linkes af
# link-onedrive-context.ps1). Exit 1 = ikke linket; sidste linje siger hvorfor,
# og intet er flyttet eller slettet.

param(
  [Parameter(Mandatory)][string]$WorktreeRoot,
  [string]$SharedRoot,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\balance-internals.ps1')

$wt = [IO.Path]::GetFullPath(($WorktreeRoot -replace '/', '\')).TrimEnd([char]92)
if (-not [IO.Directory]::Exists($wt)) {
  Write-Host "balance-internals: worktreet findes ikke: $wt"
  exit 1
}
# Kun linked worktrees (.git er en fil). Hovedcheckoutet linkes af link-onedrive-context.ps1.
if (-not (Test-Path -LiteralPath (Join-Path $wt '.git') -PathType Leaf)) {
  Write-Host "balance-internals: [skip] $wt er ikke et linked worktree (hovedcheckoutet linkes af link-onedrive-context.ps1)"
  exit 0
}

try {
  $r = Set-BalanceInternalsLink -WorktreeRoot $wt -SharedRoot $SharedRoot -DryRun:$DryRun
} catch {
  Write-Host "balance-internals: [fejl] $($_.Exception.Message) - intet slettet"
  exit 1
}
$tag = if ($r.Ok) { 'ok' } else { 'ikke linket' }
Write-Host "balance-internals: [$tag] $($r.Message)"
if ($r.Ok) { exit 0 } else { exit 1 }
