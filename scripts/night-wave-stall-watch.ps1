# night-wave-stall-watch.ps1
#
# Detektér hængende natbølge-agenter FØR de fryser hele Workflow-barrieren.
# Baggrund: natbølge 2026-07-03 gik maskinen i S0 Modern Standby ~01:15 midt i
# kørslen → 2 agenter frøs → parallel()-barrieren ventede evigt → ingen
# completion-notifikation. Symptomet blev først opdaget 7 timer senere.
#
# To ground-truth-signaler (samme som den manuelle diagnose der fandt hanget):
#   1. Worktree-fremdrift (repo-anchored, pålideligt): pr. fleet-worktree —
#      commits ahead af origin/main, uncommitted arbejde, pushet branch.
#      0 ahead + rent arbejdstræ = agenten har intet produceret (hang-kandidat).
#   2. Transcript-aktivitet (valgfri auto-detekt / -RunDir): mtime-alder pr.
#      agent-transcript. Frossen > StallMinutes mens bølgen stadig kører = hang.
#
# Kør periodisk af orkestratoren under en bølge (fx hvert 8.-10. min). Ren
# diagnostik — muterer intet, exit 0. Kombinér de to tabeller: en branch der er
# IDLE? (0 fremdrift) OG hvis transcript er STALLED = genopret per runbook.
#
# Brug:
#   pwsh -File scripts/night-wave-stall-watch.ps1
#   pwsh -File scripts/night-wave-stall-watch.ps1 -StallMinutes 10
#   pwsh -File scripts/night-wave-stall-watch.ps1 -RunDir <subagents/workflows/wf_...> -Json
#
# Refs #605 (velocity/ops-spor) + docs/NIGHT_WAVE_RUNBOOK.md §Anti-hang.

param(
  [int]$StallMinutes = 8,
  [string]$RunDir,
  [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) { Write-Error "Ikke i et git-repo."; exit 1 }
$repoRoot = $repoRoot.Trim()

# Frisk origin/main så ahead-tællingen er sand (best-effort; hang ikke på netværk).
try { & git -C $repoRoot fetch --prune origin *> $null } catch {}

# --- 1. Worktree-fremdrift (outcome-signal) ---
$rows = @()
$wtRaw = (& git -C $repoRoot worktree list --porcelain) -join "`n"
foreach ($block in ($wtRaw -split "`r?`n`r?`n")) {
  if ($block -notmatch 'worktree\s+(.+)') { continue }
  $path = $Matches[1].Trim()
  # Kun harness-oprettede worktrees (.claude/worktrees) — spring main + manuelle over.
  if ($path -notmatch '\.claude[\\/]worktrees[\\/]') { continue }
  $branch = ''
  if ($block -match 'branch\s+refs/heads/(.+)') { $branch = $Matches[1].Trim() }
  if (-not $branch) { continue }

  $ahead = 0
  try {
    $cnt = (& git -C $repoRoot rev-list --count "origin/main..$branch" 2>$null)
    if ($cnt) { $ahead = [int]($cnt.Trim()) }
  } catch {}
  $dirty = $false
  try { $dirty = [bool]((& git -C $path status --porcelain 2>$null) | Select-Object -First 1) } catch {}
  $pushed = $false
  try { $pushed = [bool]((& git -C $repoRoot branch -r --list "origin/$branch" 2>$null) | Select-Object -First 1) } catch {}

  $state = if ($ahead -gt 0 -or $dirty) { 'WORKING' } else { 'IDLE?' }
  $rows += [pscustomobject]@{
    branch = $branch; ahead = $ahead; dirty = $dirty; pushed = $pushed; state = $state; path = $path
  }
}

# --- 2. Transcript-aktivitet (activity-signal, valgfri) ---
if (-not $RunDir) {
  $projRoot = Join-Path $env:USERPROFILE ".claude\projects"
  if (Test-Path $projRoot) {
    $newest = Get-ChildItem -Path $projRoot -Recurse -Directory -Filter "workflows" -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match 'subagents[\\/]workflows$' } |
      ForEach-Object { Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue } |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($newest) { $RunDir = $newest.FullName }
  }
}

$now = Get-Date
$transcripts = @()
if ($RunDir -and (Test-Path $RunDir)) {
  foreach ($a in (Get-ChildItem -Path $RunDir -Filter "agent-*.jsonl" -ErrorAction SilentlyContinue)) {
    $ageMin = [math]::Round(($now - $a.LastWriteTime).TotalMinutes, 1)
    $transcripts += [pscustomobject]@{
      file = $a.Name; ageMin = $ageMin; stalled = ($ageMin -gt $StallMinutes)
    }
  }
}

$idle = @($rows | Where-Object { $_.state -eq 'IDLE?' })
$stalled = @($transcripts | Where-Object { $_.stalled })

if ($Json) {
  [pscustomobject]@{
    stallMinutes = $StallMinutes
    runDir       = $RunDir
    worktrees    = $rows
    transcripts  = $transcripts
    idleCount    = $idle.Count
    stalledCount = $stalled.Count
  } | ConvertTo-Json -Depth 5
  exit 0
}

Write-Host ""
Write-Host "=== Natbølge stall-watch ===" -ForegroundColor Cyan
Write-Host "StallMinutes: $StallMinutes    RunDir: $([string]::IsNullOrEmpty($RunDir) ? '(ingen fundet)' : $RunDir)"
Write-Host ""
Write-Host "-- Worktree-fremdrift ($($rows.Count) fleet-worktrees) --"
if ($rows.Count -eq 0) {
  Write-Host "  (ingen harness-worktrees under .claude/worktrees)"
} else {
  $rows | Sort-Object state, branch | Format-Table branch, ahead, dirty, pushed, state -AutoSize | Out-String | Write-Host
}
Write-Host "-- Transcript-aktivitet ($($transcripts.Count) agenter) --"
if ($transcripts.Count -eq 0) {
  Write-Host "  (ingen transcripts fundet — angiv -RunDir hvis auto-detekt fejler)"
} else {
  $oldest = ($transcripts | Sort-Object ageMin -Descending | Select-Object -First 1)
  $newestAge = ($transcripts | Sort-Object ageMin | Select-Object -First 1)
  Write-Host ("  Yngste skrivning: {0} min siden · ældste: {1} min siden · STALLED (>{2}m): {3}" -f $newestAge.ageMin, $oldest.ageMin, $StallMinutes, $stalled.Count)
}
Write-Host ""

if ($idle.Count -gt 0 -or $stalled.Count -gt 0) {
  Write-Host "⚠ HANG-KANDIDATER" -ForegroundColor Yellow
  if ($idle.Count -gt 0) {
    Write-Host ("  {0} worktree(s) uden fremdrift (0 ahead + rent): {1}" -f $idle.Count, (($idle | ForEach-Object { $_.branch }) -join ', ')) -ForegroundColor Yellow
  }
  if ($stalled.Count -gt 0) {
    Write-Host ("  {0} transcript(s) frossen >{1} min." -f $stalled.Count, $StallMinutes) -ForegroundColor Yellow
  }
  Write-Host "  → Hvis bølgen stadig burde køre: genopret per docs/NIGHT_WAVE_RUNBOOK.md §Recovery."
  Write-Host "    (Bemærk: et nyligt startet worktree kan stå IDLE? i 1-2 min før første commit — kør igen om et par min for at bekræfte.)"
} else {
  Write-Host "[OK] Ingen hang-kandidater: alle fleet-worktrees viser fremdrift og ingen frosne transcripts." -ForegroundColor Green
}
exit 0
