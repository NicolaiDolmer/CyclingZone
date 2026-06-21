# test-claude-project-paths.ps1
#
# Verificerer Get-ClaudeProjectDirName i scripts/lib/claude-project-paths.ps1 —
# den delte encoding af en arbejdsmappe-sti til Claude Codes
# ~/.claude/projects/<encoded>/ dir-navn. Bruges af prune-merged-worktrees.ps1,
# prune-stale-project-dirs.ps1 og remove-worktree.ps1 til at finde + rydde
# memory-junction'en for et worktree.
#
# Kerne-bug (2026-06-21): tidligere kodede prune-merged-worktrees.ps1 kun ':' og
# '\' ('[:\\]'), men Claude Code koder OGSÅ '.' (og '/') til '-'. Derfor blev
# '\.claude' til '-.claude' i stedet for det faktiske '--claude' on-disk, så
# junction'en aldrig blev fundet → orphan-mapper hobede sig op.
#
# Hermetisk: ren streng-funktion, ingen IO. Forventede navne er verificeret mod
# rigtige mappenavne i ~/.claude/projects/ (fx C--Dev-CyclingZone--claude-...).
#
# Brug:
#   pwsh -File scripts/test-claude-project-paths.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot 'lib\claude-project-paths.ps1')

$pass = 0
$fail = 0
$failDetails = New-Object System.Collections.Generic.List[string]

function Check {
  param([string]$Label, [bool]$Condition, [string]$Got = '')
  if ($Condition) {
    $script:pass++
    Write-Host ("  [PASS] {0}" -f $Label) -ForegroundColor Green
  } else {
    $script:fail++
    $detail = if ($Got) { "$Label -> $Got" } else { $Label }
    Write-Host ("  [FAIL] {0}" -f $detail) -ForegroundColor Red
    $script:failDetails.Add($detail)
  }
}

Write-Host ""
Write-Host "Get-ClaudeProjectDirName (encoding)"

# Kerne-bug: en .claude\worktrees-sti SKAL kode '.' til '-' (dobbelt-bindestreg
# før 'claude'). Dette er den faktiske on-disk-form (empirisk verificeret).
$got = Get-ClaudeProjectDirName 'C:\Dev\CyclingZone\.claude\worktrees\friendly-aryabhata-7c80a1'
$want = 'C--Dev-CyclingZone--claude-worktrees-friendly-aryabhata-7c80a1'
Check "worktree-sti: '.' kodes til '-' (--claude, ikke -.claude)" ($got -eq $want) "$got"

# Manuelt new-worktree.ps1-layout (ingen '.' i stien) — uændret korrekt.
$got = Get-ClaudeProjectDirName 'C:\dev\CyclingZone-worktrees\feat-min-feature'
$want = 'C--dev-CyclingZone-worktrees-feat-min-feature'
Check "manuelt worktree-layout encoder korrekt" ($got -eq $want) "$got"

# Forward slashes normaliseres (git worktree list kan give '/').
$got = Get-ClaudeProjectDirName 'C:/Dev/CyclingZone/.claude/worktrees/foo'
$want = 'C--Dev-CyclingZone--claude-worktrees-foo'
Check "forward slashes normaliseres som backslashes" ($got -eq $want) "$got"

# Trailing separator må ikke give et efterhængende '-'.
$got = Get-ClaudeProjectDirName 'C:\Dev\CyclingZone\.claude\worktrees\foo\'
$want = 'C--Dev-CyclingZone--claude-worktrees-foo'
Check "trailing backslash trimmes (intet efterhængende '-')" ($got -eq $want) "$got"

# Regressionsvagt mod den gamle buggy encoding: resultatet må ALDRIG indeholde
# '-.claude' (mismatch-formen der skabte orphans).
$got = Get-ClaudeProjectDirName 'C:\Dev\CyclingZone\.claude\worktrees\foo'
Check "producerer aldrig den buggy '-.claude'-form" ($got -notmatch '\-\.claude') "$got"

# --- Summary ----------------------------------------------------------------
$total = $pass + $fail
Write-Host ""
Write-Host "================================="
if ($fail -eq 0) {
  Write-Host "ALL TESTS PASSED ($pass/$total)" -ForegroundColor Green
  exit 0
} else {
  Write-Host "$fail/$total tests FAILED" -ForegroundColor Red
  foreach ($d in $failDetails) { Write-Host "  - $d" -ForegroundColor Red }
  exit 1
}
