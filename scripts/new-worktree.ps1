# new-worktree.ps1
#
# Opretter et git worktree til parallel Claude Code-session og setup'er:
#   - .env hardlinks DIREKTE til OneDrive-context\secrets (omg�r cascade-cloud-fil-issue)
#   - node_modules junction til main repo (sparer ~500 MB + install-tid)
#   - Memory + codex-junctions via link-onedrive-context.ps1 -RepoRoot <worktree>
#
# Brug:
#   pwsh -File scripts/new-worktree.ps1 -Branch feat/min-feature
#   pwsh -File scripts/new-worktree.ps1 -Branch fix/abc -FromBranch origin/develop
#
# Resultat: C:\dev\CyclingZone-worktrees\<branch-slug>\
# �bn ny Claude Code session i den path.

param(
  [Parameter(Mandatory)] [string] $Branch,
  [string] $FromBranch = "origin/main",
  [string] $RepoRoot = "C:\dev\CyclingZone",
  [string] $WorktreesRoot = "C:\dev\CyclingZone-worktrees",
  [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Branch-slug: erstat / med - for path-safety
$slug = $Branch -replace '/','-'
$wt = Join-Path $WorktreesRoot $slug

if (Test-Path $wt) {
  Write-Host "[stop] Worktree-path findes allerede: $wt" -ForegroundColor Red
  Write-Host "       K�r 'git worktree remove $wt' f�rst hvis du vil genskabe." -ForegroundColor Yellow
  exit 1
}

if (-not (Test-Path $WorktreesRoot)) {
  if ($DryRun) {
    Write-Host "[would-mkdir] $WorktreesRoot" -ForegroundColor Cyan
  } else {
    New-Item -ItemType Directory $WorktreesRoot -Force | Out-Null
  }
}

Write-Host "=== git worktree add ===" -ForegroundColor Cyan
if ($DryRun) {
  Write-Host "[would-run] git -C $RepoRoot worktree add -b $Branch $wt $FromBranch" -ForegroundColor Cyan
} else {
  & git -C $RepoRoot worktree add -b $Branch $wt $FromBranch
  if ($LASTEXITCODE -ne 0) { throw "git worktree add fejlede" }
}

Write-Host ""
Write-Host "=== node_modules-junctions + .env-hardlinks (setup-worktree.ps1) ===" -ForegroundColor Cyan
# Genbrug den idempotente setup-logik (junctions + OneDrive-.env-hardlinks).
# Samme script kaldes af SessionStart-hooken for harness-oprettede worktrees (#994).
$setupScript = Join-Path $RepoRoot "scripts\setup-worktree.ps1"
$setupArgs = @('-NoProfile', '-File', $setupScript, '-WorktreeRoot', $wt, '-MainRepoRoot', $RepoRoot)
if ($DryRun) { $setupArgs += '-DryRun' }
& pwsh @setupArgs

Write-Host ""
Write-Host "=== Memory + codex-junctions for worktree ===" -ForegroundColor Cyan
if ($DryRun) {
  Write-Host "  [would-run] link-onedrive-context.ps1 -RepoRoot $wt" -ForegroundColor Cyan
} else {
  & pwsh -File (Join-Path $RepoRoot "scripts\link-onedrive-context.ps1") -RepoRoot $wt
}

Write-Host ""
Write-Host "F�rdig. Worktree klar i: $wt" -ForegroundColor Green
Write-Host ""
Write-Host "N�ste skridt:" -ForegroundColor Cyan
Write-Host "  1. �bn ny Claude Code session i: $wt"
Write-Host "  2. Arbejd som normalt � branch er '$Branch'"
Write-Host "  3. Ved cleanup: pwsh -File scripts\remove-worktree.ps1 -Branch $Branch"
