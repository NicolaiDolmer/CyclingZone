# git-merge-detection.ps1 — delt merge-detektion for worktree-cleanup.
#
# Afgør om en lokal branch er landet på base-ref, så remove-worktree.ps1 kan
# slette den sikkert. To stier, fordi 'git branch --merged' ALENE ikke fanger
# squash-merges: en squash-merge skaber én ny commit på main uden ancestry til
# branchens egne commits, så --merged rapporterer branchen som "ikke merged".
#
#   1. Ancestry  — Test-BranchMergedByAncestry ('git branch --merged <base>').
#      Fanger fast-forward + ægte merge-commits. Sikker sletning med
#      'git branch -d' (git verificerer selv merge-status).
#   2. Squash-PR — Test-BranchHasMergedPr ('gh pr list --state merged --head').
#      Fanger squash-merges. Kræver 'git branch -D' (force), fordi git stadig
#      ser branchen som ikke-merged via ancestry.
#
# Get-BranchMergeDecision er REN (ingen IO) og kombinerer de to probe-resultater
# til én beslutning — derfor kan beslutnings-logikken unit-testes uden git, gh
# eller netværk. Se scripts/test-remove-worktree-merge-detection.ps1.

function Test-BranchMergedByAncestry {
  # Ancestry-baseret merge-check. Fanger fast-forward + ægte merge-commits,
  # men IKKE squash-merges. Returnerer [bool].
  #
  # Eksakt linje-match (ikke substring-regex): 'git branch --merged' kan
  # præfikse linjer med '* ' (current) eller '+ ' (checked-out i et worktree),
  # og et substring-match ville fejlagtigt matche en længere branch der har
  # $Branch som præfiks (fx 'feat/x' inde i 'feat/x-2').
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Branch,
    [Parameter(Mandatory)][string]$RepoRoot,
    [string]$BaseRef = 'origin/main'
  )
  $merged = & git -C $RepoRoot branch --merged $BaseRef 2>$null
  if (-not $merged) { return $false }
  foreach ($line in $merged) {
    $name = ($line -replace '^[\*\+]?\s*', '').Trim()
    if ($name -eq $Branch) { return $true }
  }
  return $false
}

function Test-BranchHasMergedPr {
  # Squash-merge-detektion via gh. Returnerer:
  #   $true  — en merged PR med denne head-branch findes
  #   $false — gh svarede, men ingen merged PR
  #   $null  — UBESTEMT (gh mangler, er ikke autentificeret, eller kaldet
  #            fejlede). $null lader kalderen falde tilbage uden at påstå
  #            "ikke merged" — vi sletter aldrig en branch vi ikke kan bekræfte.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Branch,
    [Parameter(Mandatory)][string]$RepoRoot
  )
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { return $null }

  $count = $null
  $exit = 1
  # gh respekterer ikke 'git -C'; kør i RepoRoot så repo udledes fra origin.
  Push-Location $RepoRoot
  try {
    $count = & gh pr list --state merged --head $Branch --json number --jq 'length' 2>$null
    $exit = $LASTEXITCODE
  } catch {
    return $null
  } finally {
    Pop-Location
  }
  if ($exit -ne 0) { return $null }

  $text = "$count".Trim()
  $n = 0
  if (-not [int]::TryParse($text, [ref]$n)) { return $null }
  return ($n -gt 0)
}

function Get-BranchMergeDecision {
  # REN beslutnings-funktion (ingen IO) — kombinerer probe-resultaterne.
  #   $AncestryMerged : [bool]          fra Test-BranchMergedByAncestry
  #   $MergedPrState  : $true/$false/$null fra Test-BranchHasMergedPr
  # Returnerer [pscustomobject]:
  #   Merged      [bool]   — skal branchen slettes?
  #   ForceDelete [bool]   — kræver 'git branch -D' (squash) frem for '-d'?
  #   Method      [string] — 'ancestry' | 'squash-pr' | 'none' | 'unknown'
  #   Detail      [string] — menneskelig forklaring til log-output
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][bool]$AncestryMerged,
    $MergedPrState,
    [string]$BaseRef = 'origin/main'
  )

  if ($AncestryMerged) {
    return [pscustomobject]@{
      Merged = $true; ForceDelete = $false; Method = 'ancestry'
      Detail = "merged til $BaseRef (ancestry)"
    }
  }
  if ($MergedPrState -eq $true) {
    return [pscustomobject]@{
      Merged = $true; ForceDelete = $true; Method = 'squash-pr'
      Detail = "squash-merged via merged PR til $BaseRef"
    }
  }
  if ($null -eq $MergedPrState) {
    return [pscustomobject]@{
      Merged = $false; ForceDelete = $false; Method = 'unknown'
      Detail = "ikke merged via ancestry; squash-check ubestemt (gh utilgaengelig/fejlede)"
    }
  }
  return [pscustomobject]@{
    Merged = $false; ForceDelete = $false; Method = 'none'
    Detail = "ikke merged til $BaseRef"
  }
}
