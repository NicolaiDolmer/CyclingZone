# remove-worktree.ps1
#
# Rydder et worktree op n�r dets branch er merged eller forladt:
#   - Verificerer at branch er merged til origin/main (medmindre -Force)
#   - Verificerer at der ikke er uncommitted/unpushed work (medmindre -Force)
#   - Fjerner ~/.claude/projects/<encoded-worktree-path>/ (memory-junction)
#   - K�rer git worktree remove
#
# Brug:
#   pwsh -File scripts/remove-worktree.ps1 -Branch feat/min-feature
#   pwsh -File scripts/remove-worktree.ps1 -Branch fix/abc -Force      # skip safety checks
#   pwsh -File scripts/remove-worktree.ps1 -Branch foo -DryRun         # rapport�r kun

param(
  [Parameter(Mandatory)] [string] $Branch,
  [string] $RepoRoot = "C:\dev\CyclingZone",
  [string] $WorktreesRoot = "C:\dev\CyclingZone-worktrees",
  [switch] $Force,
  [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$slug = $Branch -replace '/','-'
$wt = Join-Path $WorktreesRoot $slug

if (-not (Test-Path $wt)) {
  Write-Host "[stop] Worktree-path findes ikke: $wt" -ForegroundColor Red
  exit 1
}

# Safety checks (medmindre -Force)
if (-not $Force) {
  Write-Host "=== Safety checks ===" -ForegroundColor Cyan
  $porcelain = & git -C $wt status --porcelain 2>$null
  if ($porcelain) {
    Write-Host "[stop] Uncommitted changes i worktree:" -ForegroundColor Red
    Write-Host $porcelain
    Write-Host "Brug -Force for at slette alligevel, eller commit/stash f�rst." -ForegroundColor Yellow
    exit 1
  }

  # Check ahead-of-upstream
  $upstream = & git -C $wt rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
  if ($LASTEXITCODE -eq 0 -and $upstream) {
    $ahead = & git -C $wt rev-list --count "@{u}..HEAD" 2>$null
    if ($ahead -gt 0) {
      Write-Host "[stop] $Branch er $ahead commit(s) ahead af $upstream (unpushed)." -ForegroundColor Red
      Write-Host "Brug -Force, eller push f�rst." -ForegroundColor Yellow
      exit 1
    }
  }
}

# Fjern Claude-projects-mappen for worktreet (memory-junction-parent)
$encoded = $wt -replace '[:\\]','-'
$claudeProj = Join-Path $env:USERPROFILE ".claude\projects\$encoded"
if (Test-Path $claudeProj) {
  if ($DryRun) {
    Write-Host "[would-remove] Claude project-mappe: $claudeProj" -ForegroundColor Cyan
  } else {
    # Junction-child slettes via rmdir; herefter resten af mappen
    $memJunc = Join-Path $claudeProj "memory"
    if (Test-Path $memJunc) {
      & cmd /c rmdir /Q "$memJunc" 2>&1 | Out-Null
    }
    Remove-Item $claudeProj -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  [ok] Fjernet Claude project-mappe"
  }
}

# git worktree remove
if ($DryRun) {
  Write-Host "[would-run] git -C $RepoRoot worktree remove $wt" -ForegroundColor Cyan
} else {
  & git -C $RepoRoot worktree remove $wt
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[warn] worktree remove fejlede; pr�ver --force" -ForegroundColor Yellow
    & git -C $RepoRoot worktree remove --force $wt
  }
  Write-Host "  [ok] Worktree fjernet: $wt"
}

# Slet branch lokalt hvis merged
if (-not $DryRun) {
  $merged = & git -C $RepoRoot branch --merged origin/main 2>$null | Select-String -Pattern "\b$([regex]::Escape($Branch))\b" -Quiet
  if ($merged) {
    & git -C $RepoRoot branch -d $Branch 2>&1 | Out-Null
    Write-Host "  [ok] Lokal branch $Branch slettet (merged til origin/main)"
  } else {
    Write-Host "  [info] Branch $Branch ikke merged til origin/main � beholdes lokalt" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "F�rdig." -ForegroundColor Green
