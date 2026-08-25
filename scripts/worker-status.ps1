# worker-status.ps1
#
# Ét blik på alle parallelle sessioner: hvor længe siden hver worktree sidst
# committede, om arbejdet er pushet, og om der ligger ucommitted arbejde.
#
# Baggrund (#4250): 25/8 stod en worker 66 minutter uden push. Den var ikke
# inaktiv — den havde 190 linjers færdigt arbejde liggende ucommitted, som var
# gået tabt hvis den var timet ud. Kadence-reglen fandtes allerede i
# spawn-prompten; det der manglede var en billig måde at SE bruddet på.
#
# Brug:
#   pwsh -File scripts/worker-status.ps1
#   pwsh -File scripts/worker-status.ps1 -StallMinutes 20
#
# Kolonner:
#   SIDST     minutter siden sidste commit i worktreet
#   UCOMMIT   antal filer med ucommitted ændringer (det farlige tal)
#   UPUSHET   commits der ikke er pushet endnu
#   PR        åben PR for branchen, hvis nogen

param(
  [int] $StallMinutes = 30,
  [string] $RepoRoot = "C:\dev\CyclingZone"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$worktrees = @()
$current = @{}

# `git worktree list --porcelain` giver blokke adskilt af tomme linjer.
foreach ($line in (& git -C $RepoRoot worktree list --porcelain)) {
  if ($line -match '^worktree (.+)$')      { $current = @{ Path = $Matches[1] } }
  elseif ($line -match '^branch refs/heads/(.+)$') { $current.Branch = $Matches[1] }
  elseif ($line -match '^detached$')       { $current.Branch = "(detached)" }
  elseif ($line.Trim() -eq '' -and $current.Count -gt 0) {
    $worktrees += [pscustomobject]$current; $current = @{}
  }
}
if ($current.Count -gt 0) { $worktrees += [pscustomobject]$current }

$now = Get-Date
$rows = @()
$stalled = @()

foreach ($wt in $worktrees) {
  if (-not (Test-Path $wt.Path)) { continue }
  $branch = if ($wt.PSObject.Properties.Name -contains 'Branch') { $wt.Branch } else { "(ukendt)" }

  $lastIso = & git -C $wt.Path log -1 --format=%cI 2>$null
  $minutes = if ($lastIso) { [int]((New-TimeSpan -Start ([datetime]$lastIso) -End $now).TotalMinutes) } else { -1 }

  $dirty = @(& git -C $wt.Path status --porcelain 2>$null).Count

  $unpushed = 0
  $upstream = & git -C $wt.Path rev-parse --abbrev-ref '@{u}' 2>$null
  if ($LASTEXITCODE -eq 0 -and $upstream) {
    $unpushed = @(& git -C $wt.Path rev-list '@{u}..HEAD' 2>$null).Count
  } else {
    $unpushed = -1   # ingen upstream = aldrig pushet
  }

  $pr = ""
  if ($branch -ne "main" -and $branch -ne "(detached)") {
    $prJson = & gh pr list --head $branch --state open --json number,isDraft 2>$null | Out-String
    if ($prJson -and $prJson.Trim() -ne "[]") {
      try {
        $p = ($prJson | ConvertFrom-Json)[0]
        $pr = if ($p.isDraft) { "#$($p.number) draft" } else { "#$($p.number)" }
      } catch { $pr = "?" }
    }
  }

  $rows += [pscustomobject]@{
    BRANCH  = $branch
    SIDST   = if ($minutes -lt 0) { "-" } else { "$minutes min" }
    UCOMMIT = $dirty
    UPUSHET = if ($unpushed -lt 0) { "aldrig" } else { $unpushed }
    PR      = $pr
  }

  # Stall = for længe siden commit, ELLER ucommitted arbejde der ligger og flyder.
  if ($branch -ne "main" -and ($minutes -ge $StallMinutes -or $dirty -gt 0)) {
    $stalled += [pscustomobject]@{ Branch = $branch; Minutes = $minutes; Dirty = $dirty; Path = $wt.Path }
  }
}

$rows | Format-Table -AutoSize

if ($stalled.Count -gt 0) {
  Write-Host ""
  Write-Host "[handling paakraevet]" -ForegroundColor Yellow
  foreach ($s in $stalled) {
    if ($s.Dirty -gt 0) {
      Write-Host ("  {0}: {1} ucommitted filer - RED DEM FOERST (git add -A; git commit -F <fil>; git push)" -f $s.Branch, $s.Dirty) -ForegroundColor Red
    }
    if ($s.Minutes -ge $StallMinutes) {
      Write-Host ("  {0}: {1} min siden sidste commit (graense {2}) - kraev status, ellers TaskStop og overtag" -f $s.Branch, $s.Minutes, $StallMinutes) -ForegroundColor Yellow
    }
  }
  exit 1
}

Write-Host ""
Write-Host "[ok] Alle worktrees inden for kadence-graensen ($StallMinutes min), intet ucommitted." -ForegroundColor Green
