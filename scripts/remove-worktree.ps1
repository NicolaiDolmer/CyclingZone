# remove-worktree.ps1
#
# Rydder et worktree op når dets branch er merged eller forladt:
#   - Verificerer at branch er merged til origin/main (medmindre -Force)
#   - Verificerer at der ikke er uncommitted/unpushed work (medmindre -Force)
#   - Fjerner ~/.claude/projects/<encoded-worktree-path>/ (memory-junction)
#   - Kører git worktree remove
#   - Sletter den lokale branch hvis merged
#
# Merge-detektion (forbedret 2026-05-31): genkender nu OGSÅ squash-merges.
# Tidligere brugte scriptet kun 'git branch --merged origin/main', som ikke ser
# squash-merges — en squash-merge skaber én ny commit på main uden ancestry til
# branchens egne commits, så --merged rapporterer branchen som "ikke merged" og
# scriptet efterlod den lokalt (skete for docs/844-countries-system efter den
# squash-mergede PR #845). Nu falder vi tilbage til
# 'gh pr list --state merged --head <branch>' når ancestry-checket fejler, og
# bruger 'git branch -D' (force) for den sti, fordi git stadig ser branchen som
# ikke-merged. 'git branch --merged' bevares som primær sti + fallback når gh
# ikke er tilgængelig (almindelige merges / offline). Detektions-logikken ligger
# i scripts/lib/git-merge-detection.ps1 (delt + unit-testet via
# scripts/test-remove-worktree-merge-detection.ps1).
#
# Brug:
#   pwsh -File scripts/remove-worktree.ps1 -Branch feat/min-feature
#   pwsh -File scripts/remove-worktree.ps1 -Branch fix/abc -Force      # skip safety checks
#   pwsh -File scripts/remove-worktree.ps1 -Branch foo -DryRun         # rapportér kun

param(
  [Parameter(Mandatory)] [string] $Branch,
  [string] $RepoRoot = "C:\dev\CyclingZone",
  [string] $WorktreesRoot = "C:\dev\CyclingZone-worktrees",
  [switch] $Force,
  [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Delt merge-detektion (ancestry + squash-PR-fallback). Se filens header.
. (Join-Path $PSScriptRoot 'lib\git-merge-detection.ps1')
# Delt encoding af worktree-sti → ~/.claude/projects/<encoded>/ (memory-junction).
. (Join-Path $PSScriptRoot 'lib\claude-project-paths.ps1')

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
    Write-Host "Brug -Force for at slette alligevel, eller commit/stash først." -ForegroundColor Yellow
    exit 1
  }

  # Check ahead-of-upstream
  $upstream = & git -C $wt rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
  if ($LASTEXITCODE -eq 0 -and $upstream) {
    $ahead = & git -C $wt rev-list --count "@{u}..HEAD" 2>$null
    if ($ahead -gt 0) {
      Write-Host "[stop] $Branch er $ahead commit(s) ahead af $upstream (unpushed)." -ForegroundColor Red
      Write-Host "Brug -Force, eller push først." -ForegroundColor Yellow
      exit 1
    }
  }
}

# Fjern Claude-projects-mappen for worktreet (memory-junction-parent).
# Delt Get-ClaudeProjectDirName koder OGSÅ '.' til '-' — relevant hvis WorktreesRoot
# nogensinde ligger under en sti med '.' (fx .claude\worktrees).
$encoded = Get-ClaudeProjectDirName $wt
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
    Write-Host "[warn] worktree remove fejlede; prøver --force" -ForegroundColor Yellow
    & git -C $RepoRoot worktree remove --force $wt
  }
  Write-Host "  [ok] Worktree fjernet: $wt"
}

# Slet branch lokalt hvis merged.
# To detektionsstier (se scripts/lib/git-merge-detection.ps1):
#   ancestry  -> 'git branch -d'  (almindelig merge; git bekræfter selv status)
#   squash-pr -> 'git branch -D'  (squash; git ser den ikke som merged via ancestry)
if (-not $DryRun) {
  $ancestryMerged = Test-BranchMergedByAncestry -Branch $Branch -RepoRoot $RepoRoot

  # Kør kun gh-proben når ancestry fejler — sparer et netværkskald i det
  # almindelige tilfælde, og holder gh som ren fallback for squash-merges.
  $mergedPrState = if ($ancestryMerged) { $false }
                   else { Test-BranchHasMergedPr -Branch $Branch -RepoRoot $RepoRoot }

  $decision = Get-BranchMergeDecision -AncestryMerged $ancestryMerged -MergedPrState $mergedPrState

  if ($decision.Merged) {
    $delFlag = if ($decision.ForceDelete) { '-D' } else { '-d' }
    & git -C $RepoRoot branch $delFlag $Branch 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "  [ok] Lokal branch $Branch slettet ($($decision.Detail))"
    } else {
      Write-Host "  [warn] Kunne ikke slette lokal branch $Branch (git branch $delFlag fejlede)" -ForegroundColor Yellow
    }
  } else {
    Write-Host "  [info] Branch $Branch $($decision.Detail) - beholdes lokalt" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Færdig." -ForegroundColor Green
