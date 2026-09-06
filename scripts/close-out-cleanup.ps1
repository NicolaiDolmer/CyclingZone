# close-out-cleanup.ps1
#
# Finder og (valgfrit) draeber efterladte baggrundsprocesser fra en boelge/session,
# og rydder rene worktrees for mergede branches (#4920).
#
# Baggrund: ved session-luk 6/9 stod der efterladte processer: en
# "gh pr checks --watch" 2 t 45 min efter PR'en var merget, en preview-server
# paa port 5188 fra en worker, playwright-processer, og to preview-servere
# orkestratoren selv havde startet. De aad CPU (orkestratorens eget
# maalescript naaede ikke igennem paa 2 min) og saa for ejeren ud som
# "CI tager 3 timer".
#
# Hvad den finder (via CommandLine, IKKE "alle node"-processer - workers maa
# ALDRIG selv starte disse, jf. brief-reglen i make-wave-brief.mjs):
#   - gh-processer med '--watch' (gh pr checks --watch, gh run watch)
#   - vite/preview-servere (node-processer med 'vite' i kommandolinjen)
#   - playwright-processer (test-runner + headless browsere under ms-playwright)
#   - 'node --test --watch' (watch-tilstand efterladt koerende)
#
# Rører ALDRIG (eksplicit ekskluderet, uanset match ovenfor):
#   - keep-awake.ps1 (skal koere hele boelgens levetid, jf. #4918)
#   - noget der naevner 'claude' i kommandolinje/procesnavn (Claude Codes egne
#     processer - MCP-servere, subagents; at draebe dem crasher sessionen,
#     jf. scripts/hooks/protect-claude-process.sh)
#
# Sikkerhed:
#   - Default = -DryRun (lister match, draeber intet).
#   - -Execute draeber de fundne processer (Stop-Process -Force) og koerer
#     scripts/prune-merged-worktrees.ps1 -Execute.
#   - Uden -Execute koerer worktree-delen prune-merged-worktrees.ps1 i dens
#     egen dry-run (rapport, sletter intet).
#
# Brug:
#   pwsh -File scripts/close-out-cleanup.ps1              # dry-run (rapportér)
#   pwsh -File scripts/close-out-cleanup.ps1 -Execute      # udfør oprydning
#   pwsh -File scripts/close-out-cleanup.ps1 -SkipWorktreePrune  # kun processer
#
# Refs #4920, #3855.

param(
  [switch] $Execute,
  [switch] $SkipWorktreePrune,
  [string] $RepoRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (& git rev-parse --show-toplevel 2>$null)
  if (-not $RepoRoot) { Write-Error "Ikke i et git-repo, og ingen -RepoRoot angivet."; exit 1 }
  $RepoRoot = $RepoRoot.Trim().Replace('/', '\')
}

$dry = -not $Execute
$mode = if ($dry) { "DRY-RUN (intet draebes/slettes - koer med -Execute)" } else { "EXECUTE" }
Write-Host "=== close-out-cleanup [$mode] ===" -ForegroundColor Cyan

# --- 1. Efterladte baggrundsprocesser ---------------------------------------
Write-Host "`n--- Processer ---" -ForegroundColor Cyan

function Test-ExcludedProcess([string]$cmdLine, [string]$procName) {
  # Ekskludér ALTID - uanset hvad andre regler matcher paa.
  if ($cmdLine -and ($cmdLine -match '(?i)keep-awake\.ps1')) { return $true }
  if ($cmdLine -and ($cmdLine -match '(?i)claude')) { return $true }
  if ($procName -and ($procName -match '(?i)^claude')) { return $true }
  # @playwright/mcp er Claude Codes EGEN Playwright-MCP-server (browser-
  # automation-vaerktoejet), ikke et efterladt e2e-testkoersel. Maalt 6/9-natten
  # under udvikling af dette script: en naiv 'playwright'-regex matchede 12
  # legitime, aktivt-brugte MCP-serverprocesser (npx @playwright/mcp) og ville
  # have crashet browser-tool-forbindelsen for denne og andre sessioner. Se
  # ogsaa den generelle 'claude'-udelukkelse ovenfor - denne er MERE specifik
  # fordi MCP-serveren ikke selv naevner 'claude' i sin kommandolinje.
  if ($cmdLine -and ($cmdLine -match '(?i)playwright[\\/\s]*mcp' -or $cmdLine -match '(?i)playwright-mcp')) { return $true }
  return $false
}

function Get-MatchReason([string]$cmdLine, [string]$procName, [string]$repoRootForMatch) {
  if (-not $cmdLine) { return $null }
  if ($procName -match '(?i)^gh(\.exe)?$' -and $cmdLine -match '(?i)--watch') {
    return "gh --watch (gh pr checks --watch / gh run watch)"
  }
  if ($cmdLine -match '(?i)\bvite\b') {
    return "vite/preview-server"
  }
  if ($cmdLine -match '(?i)playwright') {
    # Kun ægte test-koersler/headless-browsere: repo-stien, .bin\playwright,
    # 'playwright test', eller browser-cachen under ms-playwright. Uden denne
    # indsnaevring matcher regex'en ogsaa vaerktoejs-infrastruktur der ikke er
    # et testkoersel (fx en fremtidig anden playwright-* pakke).
    $isRepoTest = ($repoRootForMatch -and $cmdLine.Contains($repoRootForMatch)) -or
                  ($cmdLine -match '(?i)ms-playwright') -or
                  ($cmdLine -match '(?i)playwright\s+test') -or
                  ($cmdLine -match '(?i)node_modules[\\/]\.bin[\\/]playwright')
    if ($isRepoTest) { return "playwright (test-runner eller headless browser)" }
  }
  if ($cmdLine -match '(?i)--test' -and $cmdLine -match '(?i)--watch') {
    return "node --test --watch"
  }
  return $null
}

$targets = @()
try {
  $procs = Get-CimInstance Win32_Process -ErrorAction Stop
} catch {
  Write-Host "  [warn] Kunne ikke enumerere processer via Win32_Process: $($_.Exception.Message)" -ForegroundColor Yellow
  $procs = @()
}

foreach ($p in $procs) {
  $cmdLine = $p.CommandLine
  $procName = $p.Name
  if (-not $cmdLine) { continue }
  if (Test-ExcludedProcess -cmdLine $cmdLine -procName $procName) { continue }
  $reason = Get-MatchReason -cmdLine $cmdLine -procName $procName -repoRootForMatch $RepoRoot
  if (-not $reason) { continue }
  $targets += [pscustomobject]@{
    Id = $p.ProcessId; Name = $procName; Reason = $reason
    CommandLine = if ($cmdLine.Length -gt 140) { $cmdLine.Substring(0, 140) + "..." } else { $cmdLine }
  }
}

if ($targets.Count -eq 0) {
  Write-Host "  (ingen efterladte watchers/preview/playwright-processer fundet)"
} else {
  foreach ($t in $targets) {
    $verb = if ($dry) { "[would-kill]" } else { "[kill]" }
    Write-Host ("  $verb PID $($t.Id) ($($t.Name)) - $($t.Reason)") -ForegroundColor Yellow
    Write-Host ("      $($t.CommandLine)") -ForegroundColor DarkGray
    if (-not $dry) {
      try {
        Stop-Process -Id $t.Id -Force -ErrorAction Stop
        Write-Host "      draebt." -ForegroundColor Green
      } catch {
        Write-Host "      kunne ikke draebes: $($_.Exception.Message)" -ForegroundColor Red
      }
    }
  }
}

# --- 2. Rene worktrees for mergede branches ---------------------------------
if ($SkipWorktreePrune) {
  Write-Host "`n--- Worktree-prune ---" -ForegroundColor Cyan
  Write-Host "  [skip] -SkipWorktreePrune angivet"
} else {
  Write-Host "`n--- Worktree-prune (git worktree prune + prune-merged-worktrees.ps1) ---" -ForegroundColor Cyan
  try {
    & git -C $RepoRoot worktree prune -v 2>&1 | ForEach-Object { Write-Host "  $_" }
  } catch {
    Write-Host "  [warn] 'git worktree prune' fejlede: $($_.Exception.Message)" -ForegroundColor Yellow
  }

  $pruneScript = Join-Path $PSScriptRoot "prune-merged-worktrees.ps1"
  if (Test-Path $pruneScript) {
    $pruneArgs = @{ RepoRoot = $RepoRoot }
    if ($Execute) { $pruneArgs["Execute"] = $true }
    & $pruneScript @pruneArgs
  } else {
    Write-Host "  [warn] scripts/prune-merged-worktrees.ps1 ikke fundet - sprunget over" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host ("Resultat: {0} proces(ser) {1}." -f $targets.Count, ($(if ($dry) { "ville blive draebt" } else { "draebt/forsoegt draebt" }))) -ForegroundColor Green
if ($dry) { Write-Host "Koer igen med -Execute for at udfoere." -ForegroundColor Cyan }
