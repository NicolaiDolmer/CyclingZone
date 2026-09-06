# wave-lane-watch.ps1
#
# Periodisk boelge-vagt der maaler PR. BRANCH, ikke pr. mappesti (#4918).
#
# Hvorfor et nyt script og ikke en udvidelse af agent-stall-watch.ps1: det
# scriptet er et generelt, engangs-diagnostisk vaerktoej (worktree-fremdrift +
# transcript-mtime, ét kald, ét output-format) der ogsaa bruges uden for
# boelger. Boelge-vagten skal noget andet: koere pr. 15. minut i baggrunden
# hele boelgens levetid, kende "lane"-nummerering og issue-numre, og skrive en
# maalt recovery-brief naar en lane bliver tavs. At presse det ind i
# agent-stall-watch.ps1 ville blande et ad-hoc-diagnostikformat med et
# loop-drevet overvaagningsformat og goere begge sveaerere at aendre isoleret.
# I stedet genbruger dette script samme to grund-signaler (branch-fremdrift +
# dirty-tjek) fra agent-stall-watch.ps1, men lagt om til branch-foerst.
#
# Baggrund (6/9-natten, #4918): tre agenter froes tavst (én om natten, to paa
# samme lane), og orkestratoren opdagede det 35-70 min for sent, fordi
# frys-detektionen enten var notifikations-baseret (kommer aldrig ved frys)
# eller et haandkoert tjek paa en ANTAGET mappesti (en agent arbejdede i
# worktrees/m12lane/... og blev fejlklassificeret som frossen). Det der
# virkede natten efter (7/9): en simpel vagt hvert 15. min der maaler pr.
# branch: `ahead = rev-list --count origin/main..origin/<branch>`, alder =
# nu minus commit-tid paa origin/<branch> (ahead=0 -> alder siden
# boelgestart), dirty = git status --porcelain i worktreet, pr = gh pr list
# --head <branch>. Det fangede alt med 0 falske frys paa 7 laner.
#
# Brug:
#   pwsh -File scripts/wave-lane-watch.ps1 -Once
#   pwsh -File scripts/wave-lane-watch.ps1 -Branches chore/a,chore/b -Once
#   pwsh -File scripts/wave-lane-watch.ps1 -IntervalMinutes 15 -StallMinutes 45
#   pwsh -File scripts/wave-lane-watch.ps1 -Once -Json
#
# Uden -Branches: auto-discovery via 'git worktree list' under -WorktreeRoot
# (default: ..\CyclingZone-worktrees ved siden af repo-roden).
#
# Ren diagnostik ved -Once (muterer intet, exit 0/1 efter stall-count).
# Uden -Once koerer den et evigt loop (Ctrl-C for at stoppe) og skriver
# recovery-brief-<slug>.md i -OutDir naar en lane krydser -StallMinutes —
# kun ÉN gang pr. stall-episode (ikke igen hvert 15. min saa laenge den staar).
#
# Refs #4918, #3855. Se ogsaa: scripts/agent-stall-watch.ps1 (generel,
# ad-hoc-diagnostik), docs/NIGHT_WAVE_RUNBOOK.md §Anti-hang.

param(
  [string[]] $Branches,
  [string] $WorktreeRoot = "",
  [int] $IntervalMinutes = 15,
  [int] $StallMinutes = 45,
  [switch] $Once,
  [string] $OutDir = "",
  [datetime] $WaveStartTime = (Get-Date),
  [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) { Write-Error "Ikke i et git-repo."; exit 1 }
$repoRoot = $repoRoot.Trim().Replace('/', '\')

# Scriptet kan koeres fra en worktree (git-common-dir peger da tilbage til
# hoved-repoets .git) - loes op til hoved-repoet, saa lane-discovery ser ALLE
# sibling-worktrees, ikke kun det ene worktree scriptet selv koerer fra.
# Samme moenster som preflight-night-wave.ps1.
$gitCommonDir = (& git -C $repoRoot rev-parse --git-common-dir 2>$null)
if ($gitCommonDir) {
  $gitCommonDir = $gitCommonDir.Trim().Replace('/', '\')
  if (-not [System.IO.Path]::IsPathRooted($gitCommonDir)) {
    $gitCommonDir = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $gitCommonDir))
  }
  $mainRepo = Split-Path -Parent $gitCommonDir
  if ($mainRepo -and ($mainRepo -ne $repoRoot) -and (Test-Path $mainRepo)) {
    $repoRoot = $mainRepo
  }
}

if (-not $WorktreeRoot) {
  $WorktreeRoot = Join-Path (Split-Path -Parent $repoRoot) "CyclingZone-worktrees"
}
$WorktreeRoot = $WorktreeRoot.TrimEnd('\', '/')

if (-not $OutDir) { $OutDir = $env:TEMP }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

# --- Lane-discovery: branch + worktree-sti pr. lane -------------------------
function Get-Lanes {
  param([string[]] $ExplicitBranches)

  $lanes = @()
  $wtRaw = (& git -C $repoRoot worktree list --porcelain) -join "`n"
  $byBranch = @{}
  foreach ($block in ($wtRaw -split "`r?`n`r?`n")) {
    if ($block -notmatch 'worktree\s+(.+)') { continue }
    $path = $Matches[1].Trim().Replace('/', '\')
    if ($block -notmatch 'branch\s+refs/heads/(.+)') { continue }
    $branch = $Matches[1].Trim()
    $byBranch[$branch] = $path
  }

  if ($ExplicitBranches -and $ExplicitBranches.Count -gt 0) {
    foreach ($b in $ExplicitBranches) {
      $p = $null
      if ($byBranch.ContainsKey($b)) { $p = $byBranch[$b] }
      $lanes += [pscustomobject]@{ branch = $b; path = $p }
    }
    return $lanes
  }

  # Auto: alle worktrees under $WorktreeRoot (sibling-worktrees, ikke .claude/worktrees).
  foreach ($branch in $byBranch.Keys) {
    $p = $byBranch[$branch]
    if ($p.StartsWith($WorktreeRoot, [StringComparison]::OrdinalIgnoreCase)) {
      $lanes += [pscustomobject]@{ branch = $branch; path = $p }
    }
  }
  return $lanes
}

function Get-IssueNumber([string]$branch) {
  if ($branch -match '(\d{2,6})') { return $Matches[1] }
  return "?"
}

function Get-LastChangedFile([string]$path) {
  if (-not $path -or -not (Test-Path $path)) { return "-" }
  $dirty = & git -C $path status --porcelain 2>$null
  if ($dirty) {
    $first = ($dirty | Select-Object -First 1)
    return ($first.Substring(3).Trim())
  }
  $lastCommitFiles = & git -C $path show --name-only --format="" -1 2>$null
  if ($lastCommitFiles) { return (@($lastCommitFiles | Where-Object { $_ })[0]) }
  return "-"
}

function Measure-Lane {
  param([string]$branch, [string]$path, [int]$laneIndex)

  $ahead = 0
  $originExists = $false
  try {
    & git -C $repoRoot rev-parse --verify --quiet "refs/remotes/origin/$branch" 2>$null | Out-Null
    $originExists = ($LASTEXITCODE -eq 0)
  } catch { $originExists = $false }

  if ($originExists) {
    try {
      $cnt = (& git -C $repoRoot rev-list --count "origin/main..origin/$branch" 2>$null)
      if ($cnt) { $ahead = [int]($cnt.Trim()) }
    } catch {}
  }

  $lastPushAge = $null
  if ($originExists) {
    $iso = (& git -C $repoRoot log -1 --format=%cI "origin/$branch" 2>$null)
    if ($iso) {
      try { $lastPushAge = [math]::Round(((Get-Date) - [datetime]$iso).TotalMinutes, 1) } catch {}
    }
  }
  if ($null -eq $lastPushAge) {
    # Aldrig pushet, eller 0 ahead (branch == main endnu) -> alder siden boelgestart.
    $lastPushAge = [math]::Round(((Get-Date) - $WaveStartTime).TotalMinutes, 1)
  }

  $dirty = 0
  if ($path -and (Test-Path $path)) {
    $dirty = @(& git -C $path status --porcelain 2>$null).Count
  }

  $lastFile = Get-LastChangedFile $path

  $pr = ""
  try {
    . (Join-Path $PSScriptRoot 'lib\gh-retry.ps1')
    $prJson = Invoke-GhWithRetry @('pr', 'list', '--head', $branch, '--state', 'open', '--json', 'number') -TolerateFailure
    if ($prJson) {
      $parsed = ($prJson -join "") | ConvertFrom-Json
      if ($parsed -and $parsed.Count -gt 0) { $pr = "#$($parsed[0].number)" }
    }
  } catch {}

  $flag = ""
  if ($lastPushAge -ge $StallMinutes) { $flag = "TAVS>$StallMinutes" }

  [pscustomobject]@{
    lane      = $laneIndex
    issue     = Get-IssueNumber $branch
    branch    = $branch
    path      = $path
    ahead     = $ahead
    ageMin    = $lastPushAge
    dirty     = $dirty
    lastFile  = $lastFile
    pr        = $pr
    flag      = $flag
    stalled   = ($flag -ne "")
  }
}

function Write-RecoveryBrief {
  param([pscustomobject]$row)

  $slug = ($row.branch -replace '[\\/]', '-')
  $file = Join-Path $OutDir "recovery-brief-$slug.md"

  $lastCommits = "(ingen — aldrig pushet)"
  if ($row.path -and (Test-Path $row.path)) {
    $lc = & git -C $row.path log -3 --oneline 2>$null
    if ($lc) { $lastCommits = ($lc -join "`n") }
  }

  $lines = @()
  $lines += "# Recovery-brief - $($row.branch) (issue #$($row.issue))"
  $lines += ""
  $lines += "Genereret af wave-lane-watch.ps1 ved TAVS-flag (>$StallMinutes min uden push)."
  $lines += ""
  $lines += "## Maalt WIP-status"
  $lines += "- Commits ahead af origin/main (pushet): $($row.ahead)"
  $lines += "- Alder siden sidste push/boelgestart: $($row.ageMin) min"
  $lines += "- Dirty (ucommitted) filer i worktreet: $($row.dirty)"
  $lines += "- Sidst aendrede/dirty fil: $($row.lastFile)"
  $lines += "- Aaben PR: $(if ($row.pr) { $row.pr } else { '(ingen)' })"
  $lines += "- Worktree-sti: $($row.path)"
  $lines += ""
  $lines += "## Seneste 3 commits i worktreet"
  $lines += '```'
  $lines += $lastCommits
  $lines += '```'
  $lines += ""
  $lines += "## Genoptagelses-regler (bindende)"
  $lines += "- Arbejd i SAMME worktree som ovenfor - opret ALDRIG et nyt."
  $lines += "- RESET ALDRIG (intet 'git reset --hard', ingen 'git checkout -- .')."
  $lines += "- Er der ucommitted arbejde: commit det FOERST som 'wip(#$($row.issue)): recovery' foer du fortsaetter noget andet."
  $lines += "- Push straks efter recovery-commit, derefter hvert 15. min igen."
  $lines += ""
  $lines += "Klar til spawn i SAMME worktree."

  ($lines -join "`n") | Out-File -FilePath $file -Encoding utf8
  return $file
}

# --- Ét maale-pass -----------------------------------------------------------
function Invoke-OnePass {
  # @() rundt om BEGGE kald: PowerShell "unroller" et pipeline-resultat med
  # 0 eller 1 elementer til $null hhv. et skalar-objekt ved funktions-capture,
  # uanset hvordan arrayet blev bygget INDE i funktionen. Uden dette braekker
  # "$rows.Count" naar der er praecis 0 eller 1 lane (fanget under -Once med 1
  # lane i dette repo, se PR-body).
  $lanes = @(Get-Lanes -ExplicitBranches $Branches)
  $rows = @()
  $i = 1
  foreach ($lane in $lanes) {
    $rows += Measure-Lane -branch $lane.branch -path $lane.path -laneIndex $i
    $i++
  }
  return , $rows
}

# Frisk origin FOR maalingen (best-effort; hang ikke paa netvaerk).
try { & git -C $repoRoot fetch --prune origin *> $null } catch {}

if ($Once) {
  $rows = Invoke-OnePass
  if ($Json) {
    [pscustomobject]@{
      generatedAt   = (Get-Date).ToString("o")
      stallMinutes  = $StallMinutes
      lanes         = $rows
    } | ConvertTo-Json -Depth 5
    exit 0
  }

  $now = Get-Date -Format "HH:mm"
  Write-Host ""
  Write-Host "=== Wave lane-watch ($now) ===" -ForegroundColor Cyan
  if ($rows.Count -eq 0) {
    Write-Host "  (ingen laner fundet - angiv -Branches eller -WorktreeRoot)"
    exit 0
  }
  $rows | Format-Table lane, branch, issue, ahead, ageMin, dirty, pr, flag -AutoSize | Out-String | Write-Host
  foreach ($r in $rows) {
    Write-Host ("{0} lane {1} (#{2}): push-ahead={3} sidste-push={4}min dirty={5} pr={6}" -f $now, $r.lane, $r.issue, $r.ahead, $r.ageMin, $r.dirty, $(if ($r.pr) { $r.pr } else { "-" }))
  }
  $stalled = @($rows | Where-Object { $_.stalled })
  if ($stalled.Count -gt 0) {
    Write-Host ""
    Write-Host "ADVARSEL: $($stalled.Count) lane(r) TAVS>$StallMinutes min:" -ForegroundColor Yellow
    foreach ($s in $stalled) { Write-Host ("  lane $($s.lane) ($($s.branch))") -ForegroundColor Yellow }
    exit 1
  }
  Write-Host ""
  Write-Host "[OK] Alle laner viser fremdrift inden for $StallMinutes min." -ForegroundColor Green
  exit 0
}

# --- Loop-tilstand: koer hvert -IntervalMinutes, skriv recovery-brief ÉN gang pr. stall-episode.
$reported = @{}
Write-Host "[wave-lane-watch] Loop startet - interval ${IntervalMinutes}min, stall-graense ${StallMinutes}min. Ctrl-C for at stoppe." -ForegroundColor Green
while ($true) {
  try { & git -C $repoRoot fetch --prune origin *> $null } catch {}
  $rows = Invoke-OnePass
  $now = Get-Date -Format "HH:mm"
  foreach ($r in $rows) {
    Write-Host ("{0} lane {1} (#{2}): push-ahead={3} sidste-push={4}min dirty={5} pr={6}{7}" -f $now, $r.lane, $r.issue, $r.ahead, $r.ageMin, $r.dirty, $(if ($r.pr) { $r.pr } else { "-" }), $(if ($r.flag) { "  [$($r.flag)]" } else { "" }))
    if ($r.stalled -and -not $reported.ContainsKey($r.branch)) {
      $brief = Write-RecoveryBrief $r
      Write-Host ("  -> recovery-brief skrevet: $brief") -ForegroundColor Yellow
      $reported[$r.branch] = $true
    } elseif (-not $r.stalled -and $reported.ContainsKey($r.branch)) {
      $reported.Remove($r.branch) | Out-Null
    }
  }
  Start-Sleep -Seconds ($IntervalMinutes * 60)
}
