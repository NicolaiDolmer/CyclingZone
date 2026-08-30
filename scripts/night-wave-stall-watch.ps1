# night-wave-stall-watch.ps1
#
# Tynd wrapper om den generaliserede scripts/agent-stall-watch.ps1 (#3423).
# Al logik bor nu i agent-stall-watch.ps1; dette script bevarer natboelgens
# oprindelige adfaerd og kald-signatur uaendret, saa
# docs/NIGHT_WAVE_RUNBOOK.md's dokumenterede kommandoer fortsat virker:
#
#   pwsh -File scripts/night-wave-stall-watch.ps1
#   pwsh -File scripts/night-wave-stall-watch.ps1 -StallMinutes 10
#   pwsh -File scripts/night-wave-stall-watch.ps1 -RunDir <subagents/workflows/wf_...> -Json
#
# "Natboelge-adfaerd" er specifikt: kun harness-oprettede fleet-worktrees
# under .claude/worktrees overvaages (ikke almindelige sibling-worktrees
# under CyclingZone-worktrees/) - det var den oprindelige scoping, og den
# bevares her via -WorktreeFilter.
#
# For almindelige (ikke-natboelge) workflows: brug scripts/agent-stall-watch.ps1
# direkte - den daekker ogsaa sibling-worktrees under CyclingZone-worktrees/.
#
# Refs #605 (velocity/ops-spor), #3423 (generalisering) + docs/NIGHT_WAVE_RUNBOOK.md §Anti-hang.

param(
  [int]$StallMinutes = 8,
  [string]$RunDir,
  [switch]$Json
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$generalized = Join-Path $scriptDir "agent-stall-watch.ps1"

$callParams = @{
  StallMinutes   = $StallMinutes
  WorktreeFilter = '\.claude[\\/]worktrees[\\/]'
}
if ($RunDir) { $callParams["RunDir"] = $RunDir }
if ($Json) { $callParams["Json"] = $true }

& $generalized @callParams
exit $LASTEXITCODE
