# prune-merged-worktrees.ps1 — bulk-oprydning af merged worktrees + branches.
#
# Hvorfor: både Claude Code-sessioner og new-worktree.ps1 OPRETTER worktrees,
# men close-out fjerner dem aldrig, så de hober sig op (43 stk. observeret
# 2026-06-03). remove-worktree.ps1 rydder ÉN branch ad gangen og antager
# layoutet C:\dev\CyclingZone-worktrees\<slug> — den ser derfor ikke Claude
# Codes auto-worktrees under .claude/worktrees/<random-name>. Dette script er
# sweep'et: det enumererer ALLE worktrees via 'git worktree list' (autoritativt,
# layout-uafhængigt) og genbruger den delte, unit-testede merge-detektion fra
# scripts/lib/git-merge-detection.ps1 — så squash-merges fanges korrekt.
#
# Sikkerhed (sletter ALDRIG noget vi ikke kan bekræfte er merged):
#   - Default = dry-run. Intet slettes uden -Execute.
#   - Springer over: primær checkout, det worktree scriptet selv kører i,
#     locked worktrees, detached HEAD, og branches der stadig lever på origin.
#   - Springer over worktrees med uncommitted changes (medmindre -Force).
#   - Sletter kun når ancestry-merge ELLER merged PR (gh) bekræfter det.
#     Er gh utilgængelig/ubestemt for en squash-branch → branchen BEHOLDES.
#
# Brug:
#   pwsh -File scripts/prune-merged-worktrees.ps1            # dry-run (rapportér)
#   pwsh -File scripts/prune-merged-worktrees.ps1 -Execute   # udfør oprydning
#   pwsh -File scripts/prune-merged-worktrees.ps1 -Execute -Force  # også uncommitted

param(
  [string] $RepoRoot = "C:\Dev\CyclingZone",
  [string] $BaseRef = "origin/main",
  [switch] $Execute,
  [switch] $Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot 'lib\git-merge-detection.ps1')

$dry = -not $Execute
$mode = if ($dry) { "DRY-RUN (intet slettes — kør med -Execute)" } else { "EXECUTE" }
Write-Host "=== prune-merged-worktrees [$mode] ===" -ForegroundColor Cyan

# Hold remote-tracking refs friske, så 'lever på origin' og ancestry er korrekte.
& git -C $RepoRoot fetch --prune origin --quiet 2>$null

# Branches der stadig lever på origin → rør dem aldrig (kan være aktivt arbejde).
$liveOnOrigin = [System.Collections.Generic.HashSet[string]]::new()
foreach ($line in (& git -C $RepoRoot branch -r --format='%(refname:short)' 2>$null)) {
  $b = $line.Trim()
  if ($b -and $b -notlike '*->*' -and $b.StartsWith('origin/')) {
    [void]$liveOnOrigin.Add($b.Substring('origin/'.Length))
  }
}

# Det worktree scriptet selv kører i — må aldrig fjernes.
$selfTop = (& git -C $PSScriptRoot rev-parse --show-toplevel 2>$null)
if ($selfTop) { $selfTop = $selfTop.Replace('/', '\').TrimEnd('\') }

# Parse 'git worktree list --porcelain' til blokke.
$porcelain = & git -C $RepoRoot worktree list --porcelain
$blocks = @()
$cur = @{}
foreach ($raw in $porcelain) {
  $l = $raw.TrimEnd("`r")
  if ($l -eq '') { if ($cur.Count) { $blocks += [pscustomobject]$cur; $cur = @{} }; continue }
  if ($l -like 'worktree *') { $cur = @{ path = $l.Substring(9) } }
  elseif ($l -like 'branch *')   { $cur.branch = ($l.Substring(7) -replace '^refs/heads/', '') }
  elseif ($l -eq 'locked' -or $l -like 'locked *') { $cur.locked = $true }
  elseif ($l -eq 'bare')         { $cur.bare = $true }
  elseif ($l -eq 'detached')     { $cur.detached = $true }
}
if ($cur.Count) { $blocks += [pscustomobject]$cur }

$primaryPath = if ($blocks.Count) { $blocks[0].path.Replace('/', '\').TrimEnd('\') } else { '' }

$removed = @(); $skipped = @(); $branchesToSweep = [System.Collections.Generic.HashSet[string]]::new()

function Remove-MemoryJunction([string]$wtPath) {
  # Spejler remove-worktree.ps1: fjern ~/.claude/projects/<encoded>/ (memory-junction-parent).
  $encoded = $wtPath -replace '[:\\]', '-'
  $claudeProj = Join-Path $env:USERPROFILE ".claude\projects\$encoded"
  if (-not (Test-Path $claudeProj)) { return }
  if ($script:dry) { Write-Host "      [would-remove] $claudeProj" -ForegroundColor DarkGray; return }
  $memJunc = Join-Path $claudeProj 'memory'
  if (Test-Path $memJunc) { & cmd /c rmdir /Q "$memJunc" 2>&1 | Out-Null }
  Remove-Item $claudeProj -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "`n--- Worktrees ---" -ForegroundColor Cyan
foreach ($b in $blocks) {
  $path = $b.path.Replace('/', '\').TrimEnd('\')
  $branch = if ($b.PSObject.Properties.Name -contains 'branch') { $b.branch } else { $null }
  $tag = if ($branch) { "$path  [$branch]" } else { "$path  [detached]" }

  if ($path -eq $primaryPath)        { $skipped += "primær checkout       : $tag"; continue }
  if ($selfTop -and $path -eq $selfTop) { $skipped += "aktiv session         : $tag"; continue }
  if ($b.PSObject.Properties.Name -contains 'locked')   { $skipped += "locked (i brug)       : $tag"; continue }
  if (-not $branch)                  { $skipped += "detached HEAD         : $tag"; continue }
  if ($liveOnOrigin.Contains($branch)) { $skipped += "branch lever på origin: $tag"; continue }

  # Uncommitted?
  if (-not $Force) {
    $st = & git -C $path status --porcelain 2>$null
    if ($st) { $skipped += "uncommitted ($((@($st)).Count) filer): $tag"; continue }
  }

  # Merge-beslutning (genbrug delt lib).
  $anc = Test-BranchMergedByAncestry -Branch $branch -RepoRoot $RepoRoot -BaseRef $BaseRef
  $prState = if ($anc) { $false } else { Test-BranchHasMergedPr -Branch $branch -RepoRoot $RepoRoot }
  $decision = Get-BranchMergeDecision -AncestryMerged $anc -MergedPrState $prState -BaseRef $BaseRef

  if (-not $decision.Merged) { $skipped += "$($decision.Detail): $tag"; continue }

  Write-Host ("  {0} {1}  [{2}]  ({3})" -f ($(if ($dry) {'[would-remove]'} else {'[remove]'})), $path, $branch, $decision.Detail) -ForegroundColor Yellow
  Remove-MemoryJunction $path
  if (-not $dry) {
    & git -C $RepoRoot worktree remove $path 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { & git -C $RepoRoot worktree remove --force $path 2>&1 | Out-Null }
  }
  [void]$branchesToSweep.Add("$branch|$($decision.ForceDelete)")
  $removed += $tag
}

# Slet branches for de fjernede worktrees + løse merged branches uden worktree.
Write-Host "`n--- Branches ---" -ForegroundColor Cyan
$wtBranches = [System.Collections.Generic.HashSet[string]]::new()
foreach ($b in $blocks) { if ($b.PSObject.Properties.Name -contains 'branch') { [void]$wtBranches.Add($b.branch) } }

$delBranches = @()
$plannedNames = [System.Collections.Generic.HashSet[string]]::new()
# (1) branches hvis worktree lige blev fjernet
foreach ($entry in $branchesToSweep) {
  $parts = $entry -split '\|', 2
  $delBranches += [pscustomobject]@{ name = $parts[0]; force = ($parts[1] -eq 'True') }
  [void]$plannedNames.Add($parts[0])
}
# (2) løse branches uden worktree
foreach ($line in (& git -C $RepoRoot branch --format='%(refname:short)' 2>$null)) {
  $n = $line.Trim()
  if (-not $n -or $n -eq 'main') { continue }
  if ($wtBranches.Contains($n)) { continue }       # stadig i et (beholdt) worktree
  if ($liveOnOrigin.Contains($n)) { continue }      # lever på origin
  if ($plannedNames.Contains($n)) { continue }      # allerede planlagt
  $anc = Test-BranchMergedByAncestry -Branch $n -RepoRoot $RepoRoot -BaseRef $BaseRef
  $prState = if ($anc) { $false } else { Test-BranchHasMergedPr -Branch $n -RepoRoot $RepoRoot }
  $decision = Get-BranchMergeDecision -AncestryMerged $anc -MergedPrState $prState -BaseRef $BaseRef
  if ($decision.Merged) { $delBranches += [pscustomobject]@{ name = $n; force = $decision.ForceDelete } }
}

foreach ($d in $delBranches) {
  $flag = if ($d.force) { '-D' } else { '-d' }
  Write-Host ("  {0} git branch {1} {2}" -f ($(if ($dry) {'[would-run]'} else {'[run]'})), $flag, $d.name) -ForegroundColor Yellow
  if (-not $dry) { & git -C $RepoRoot branch $flag $d.name 2>&1 | Out-Null }
}

Write-Host "`n--- Sprunget over ($($skipped.Count)) ---" -ForegroundColor DarkGray
foreach ($s in $skipped) { Write-Host "  $s" -ForegroundColor DarkGray }

Write-Host ""
Write-Host ("Resultat: {0} worktree(s), {1} branch(es) {2}." -f $removed.Count, $delBranches.Count, ($(if ($dry) {'ville blive fjernet'} else {'fjernet'}))) -ForegroundColor Green
if ($dry) { Write-Host "Kør igen med -Execute for at udføre." -ForegroundColor Cyan }
