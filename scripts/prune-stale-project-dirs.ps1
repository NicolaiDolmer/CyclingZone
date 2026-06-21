# prune-stale-project-dirs.ps1 — engangs/ad-hoc oprydning af forældede
# ~/.claude/projects/<encoded>/ session-dirs for døde worktrees (issue #1271, scope 2).
#
# Hvorfor: Claude Code skriver per-arbejdsmappe session-transcripts til
# ~/.claude/projects/<encoded-path>/. prune-merged-worktrees.ps1 rydder kun
# memory-junction'en for de worktrees DEN selv fjerner — orphans, hvor worktreet
# for længst er væk (slettet manuelt, af en ældre Claude-version, eller af en
# session der aldrig kørte close-out), bliver liggende. 2026-06-21 var der ~80
# sådanne orphans (issue-tallet).
#
# Disse dirs er transcript/historik-CACHES (ikke source-of-truth, jf. AGENTS.md) —
# sikre at slette når den tilhørende arbejdsmappe ikke længere er et live worktree.
#
# Encoding: Claude Code koder arbejdsmappens fulde sti til dir-navn ved at erstatte
# ':', '\', '/' OG '.' med '-'. Derfor bliver '...\.claude\worktrees\...' til
# '...--claude-worktrees-...' (dobbelt-bindestreg). Scriptet udleder live-sættet
# via 'git worktree list' med PRÆCIS denne encoding, så et live worktree (eller en
# undermappe deri) aldrig fjernes.
#
# Sikkerhed:
#   - Default = dry-run. Intet slettes uden -Execute.
#   - 'git worktree list' er autoritativ kilde til hvad der er LIVE.
#   - Beholder et dir hvis dets navn er (eller starter med) et live worktrees
#     encoded path — dvs. også undermappe-sessions af et live worktree.
#   - Rører KUN worktree-session-dirs: navne der starter med
#     '<repo-enc>--claude-worktrees-'. Hoved-checkoutet og top-level repo-dirs
#     (uden worktree-suffix) røres ALDRIG.
#
# Brug:
#   pwsh -File scripts/prune-stale-project-dirs.ps1            # dry-run (rapportér)
#   pwsh -File scripts/prune-stale-project-dirs.ps1 -Execute   # udfør oprydning

param(
  [string] $RepoRoot = "C:\Dev\CyclingZone",
  [switch] $Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Delt encoding (samme regel som prune-merged-worktrees.ps1 + remove-worktree.ps1).
. (Join-Path $PSScriptRoot 'lib\claude-project-paths.ps1')

$dry = -not $Execute
$mode = if ($dry) { "DRY-RUN (intet slettes — kør med -Execute)" } else { "EXECUTE" }
Write-Host "=== prune-stale-project-dirs [$mode] ===" -ForegroundColor Cyan

$projDir = Join-Path $env:USERPROFILE ".claude\projects"
if (-not (Test-Path $projDir)) {
  Write-Host "Ingen ~/.claude/projects/ mappe — intet at gøre." -ForegroundColor Green
  return
}

# LIVE worktrees fra git (autoritativt). Disse — og undermapper deri — beholdes.
# Get-ClaudeProjectDirName koder ':', '\', '/' og '.' til '-' (delt regel).
$liveEnc = @()
$porcelain = & git -C $RepoRoot worktree list --porcelain 2>$null
foreach ($raw in $porcelain) {
  $l = $raw.TrimEnd("`r")
  if ($l -like 'worktree *') { $liveEnc += (Get-ClaudeProjectDirName $l.Substring(9)) }
}
if ($liveEnc.Count -eq 0) {
  Write-Host "Kunne ikke læse 'git worktree list' for $RepoRoot — abort (sletter intet)." -ForegroundColor Red
  exit 1
}

# Worktree-session-dirs for dette repo har altid dette prefix.
$repoEnc = Get-ClaudeProjectDirName $RepoRoot             # fx C--Dev-CyclingZone
$wtPrefix = "$repoEnc--claude-worktrees-"                  # kun .claude/worktrees-sessions

# Behold KUN live-entries der selv er worktree-sessions. Hoved-checkoutet
# ('C--Dev-CyclingZone') må ALDRIG bruges som prefix-match — ellers ville det
# matche hvert eneste worktree-dir og intet blev nogensinde ryddet.
$liveWtEnc = @($liveEnc | Where-Object { $_.StartsWith($wtPrefix) })

function Is-LiveOrChild([string]$name) {
  foreach ($le in $liveWtEnc) {
    # Eksakt match (selve worktreet) eller undermappe-session (live + '-suffix').
    if ($name -eq $le -or $name.StartsWith("$le-")) { return $true }
  }
  return $false
}

$all = Get-ChildItem -Directory $projDir -ErrorAction SilentlyContinue
$candidates = @(); $keptLive = @()
foreach ($d in $all) {
  $name = $d.Name
  if (-not $name.StartsWith($wtPrefix)) { continue }       # kun .claude/worktrees-sessions
  if (Is-LiveOrChild $name) { $keptLive += $name; continue }
  $candidates += $d
}

Write-Host "`n--- Stale orphan worktree-session-dirs ---" -ForegroundColor Cyan
foreach ($d in $candidates) {
  Write-Host ("  {0} {1}" -f ($(if ($dry) {'[would-remove]'} else {'[remove]'})), $d.Name) -ForegroundColor Yellow
  if (-not $dry) {
    # Fjern evt. memory-junction først (cmd rmdir afkobler junction uden at følge target).
    $memJunc = Join-Path $d.FullName 'memory'
    if (Test-Path $memJunc) { & cmd /c rmdir /Q "$memJunc" 2>&1 | Out-Null }
    Remove-Item $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "`n--- Beholdt (live worktree / undermappe) ($($keptLive.Count)) ---" -ForegroundColor DarkGray
foreach ($k in $keptLive) { Write-Host "  $k" -ForegroundColor DarkGray }

Write-Host ""
Write-Host ("Resultat: {0} orphan worktree-session-dir(s) {1}." -f $candidates.Count, ($(if ($dry) {'ville blive fjernet'} else {'fjernet'}))) -ForegroundColor Green
if ($dry) { Write-Host "Kør igen med -Execute for at udføre." -ForegroundColor Cyan }
