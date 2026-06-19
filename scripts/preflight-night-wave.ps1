# preflight-night-wave.ps1
#
# GO/NO-GO-gate foer en natbolge (multiagent-fleet om natten) launches.
# Baggrund: natbolge 3 (11/6) blev claimet men aldrig koert — Windows Modern
# Standby suspenderede PC'en 4 min efter claim. Dette script goer "PC'en
# overlever natten + fleet kan koere" til en maskinel kontrol i stedet for
# huskeregler. Runbook: docs/NIGHT_WAVE_RUNBOOK.md
#
# Checks:
#   1. Windows standby/hibernate AC-timeout = 0 (ellers NO-GO; -Fix retter)
#   2. gh auth + GraphQL-probe m. retry (kalibrerer kendt ~40% 401-rate)
#   3. Frisk origin/main (fetch --prune; dirty tree = warn, fetch-fail = NO-GO)
#   4. Worktree-hygiejne (dry-run prune-rapport) + ledig disk (< MinFreeDiskGB = NO-GO)
#   5. Toolchain: node + gh + node_modules i main-checkout
#
# Idempotent og read-only som default; -Fix aendrer KUN powercfg-timeouts.
# Skriver JSON-summary til .codex.local/night-wave-preflight.json.
#
# Exit 0 = GO (launch bolgen i SAMME tur som ejer-go), Exit 1 = NO-GO.
#
# Brug:
#   pwsh -File scripts/preflight-night-wave.ps1          # read-only kontrol
#   pwsh -File scripts/preflight-night-wave.ps1 -Fix     # ret standby/hibernate + re-check
#   pwsh -File scripts/preflight-night-wave.ps1 -SkipPrune  # spring worktree-dry-run over (hurtigere)

param(
  [switch] $Fix,
  [switch] $SkipPrune,
  [int] $MinFreeDiskGB = 10,
  [int] $GhProbeAttempts = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ok = @()
$warn = @()
$fail = @()

function Write-Section($title) {
  Write-Host ""
  Write-Host "=== $title ===" -ForegroundColor Cyan
}

# --- Resolve main repo root (scriptet kan koeres fra en worktree) ---
$repoRoot = (& git -C $PSScriptRoot rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) {
  Write-Host "[NO-GO] Ikke i et git-repo." -ForegroundColor Red
  exit 1
}
$repoRoot = $repoRoot.Trim() -replace "/", "\"
$gitCommonDir = (& git -C $repoRoot rev-parse --git-common-dir 2>$null)
if ($gitCommonDir) {
  $gitCommonDir = $gitCommonDir.Trim() -replace "/", "\"
  if (-not [System.IO.Path]::IsPathRooted($gitCommonDir)) {
    $gitCommonDir = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $gitCommonDir))
  }
  $mainRepo = Split-Path -Parent $gitCommonDir
  if ($mainRepo -and ($mainRepo -ne $repoRoot)) {
    Write-Host "[info] Koerer fra worktree; checks gaar mod hovedrepo: $mainRepo" -ForegroundColor Yellow
    $repoRoot = $mainRepo
  }
}

# --- 1. Windows standby/hibernate ---
Write-Section "Windows standby (natbolge-3-laeringen)"

function Get-AcTimeoutSeconds([string] $settingAlias) {
  # Locale-uafhaengig parsing: output-strukturen er altid
  # Minimum / Maximum / increment / ... / Current AC index / Current DC index,
  # saa AC-indekset er NAESTSIDSTE 0x-hex-match (DC er sidste) — uanset sprog.
  $out = & powercfg /query SCHEME_CURRENT SUB_SLEEP $settingAlias 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
  $hexMatches = [regex]::Matches(($out -join "`n"), '0x[0-9A-Fa-f]{1,8}')
  if ($hexMatches.Count -lt 2) { return $null }
  return [Convert]::ToInt64($hexMatches[$hexMatches.Count - 2].Value, 16)
}

function Test-StandbyConfig {
  $standby = Get-AcTimeoutSeconds "STANDBYIDLE"
  $hibernate = Get-AcTimeoutSeconds "HIBERNATEIDLE"
  return [pscustomobject]@{ StandbyAcSec = $standby; HibernateAcSec = $hibernate }
}

$power = Test-StandbyConfig
$needsFix = (($null -ne $power.StandbyAcSec -and $power.StandbyAcSec -ne 0) -or
             ($null -ne $power.HibernateAcSec -and $power.HibernateAcSec -ne 0))

if ($needsFix -and $Fix) {
  Write-Host "  [fix] Saetter standby-timeout-ac 0 + hibernate-timeout-ac 0..." -ForegroundColor Yellow
  & powercfg /change standby-timeout-ac 0
  & powercfg /change hibernate-timeout-ac 0
  $power = Test-StandbyConfig
  $needsFix = (($null -ne $power.StandbyAcSec -and $power.StandbyAcSec -ne 0) -or
               ($null -ne $power.HibernateAcSec -and $power.HibernateAcSec -ne 0))
}

$standbyDesc = if ($null -eq $power.StandbyAcSec) { "ukendt" } else { "$($power.StandbyAcSec)s" }
$hibDesc = if ($null -eq $power.HibernateAcSec) { "ukendt" } else { "$($power.HibernateAcSec)s" }
if ($needsFix) {
  $fail += "Standby/hibernate AC-timeout er ikke 0 (standby=$standbyDesc, hibernate=$hibDesc). Koer med -Fix eller: powercfg /change standby-timeout-ac 0 (evt. elevated shell)."
  Write-Host "  [NO-GO] standby AC=$standbyDesc, hibernate AC=$hibDesc — PC'en kan sove fra bolgen" -ForegroundColor Red
} elseif ($null -eq $power.StandbyAcSec -and $null -eq $power.HibernateAcSec) {
  $warn += "Kunne ikke laese powercfg-timeouts. Verificer manuelt: powercfg /query SCHEME_CURRENT SUB_SLEEP"
  Write-Host "  [warn] powercfg-output kunne ikke parses — verificer manuelt" -ForegroundColor Yellow
} else {
  $ok += "Standby/hibernate AC-timeout = 0 (standby=$standbyDesc, hibernate=$hibDesc)"
  Write-Host "  [ok] standby AC=$standbyDesc, hibernate AC=$hibDesc"
}

# Modern Standby (S0) tell — rapporteres altid, da S0-maskiner kan ignorere timeouts.
$sleepStates = (& powercfg /a 2>$null | Select-Object -First 6) -join " | "
Write-Host "  [info] Sleep-states: $sleepStates"

# --- 2. gh auth + GraphQL-probe ---
Write-Section "gh auth + GraphQL-probe (kendt ~40% 401-rate)"

$ghOk = $false
$ghProbeSucceededAt = 0
& gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  $fail += "gh auth status fejlede. Koer 'gh auth login' / 'gh auth refresh' foer bolgen."
  Write-Host "  [NO-GO] gh auth status fejlede" -ForegroundColor Red
} else {
  for ($i = 1; $i -le $GhProbeAttempts; $i++) {
    & gh api graphql -f query='query{viewer{login}}' 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $ghOk = $true; $ghProbeSucceededAt = $i; break }
    if ($i -lt $GhProbeAttempts) { Start-Sleep -Seconds 3 }
  }
  if ($ghOk) {
    $ok += "gh GraphQL-probe ok (forsoeg $ghProbeSucceededAt/$GhProbeAttempts)"
    Write-Host "  [ok] GraphQL svarer (forsoeg $ghProbeSucceededAt af $GhProbeAttempts)"
    if ($ghProbeSucceededAt -gt 1) {
      $warn += "gh GraphQL kraevede $ghProbeSucceededAt forsoeg — forvent 401-stoej i bolgen; agenter SKAL bruge retry-wrapper."
    }
  } else {
    $fail += "gh GraphQL fejlede alle $GhProbeAttempts forsoeg. Koer 'gh auth refresh' og proev igen."
    Write-Host "  [NO-GO] GraphQL fejlede alle $GhProbeAttempts forsoeg" -ForegroundColor Red
  }
}

# --- 3. Frisk origin/main ---
Write-Section "Frisk origin/main"

$fetchOutput = & git -C $repoRoot fetch --prune origin 2>&1
if ($LASTEXITCODE -ne 0) {
  $fail += "git fetch fejlede — origin ikke naabar? ($fetchOutput)"
  Write-Host "  [NO-GO] fetch fejlede: $fetchOutput" -ForegroundColor Red
  $originMainSha = $null
} else {
  $originMainSha = (& git -C $repoRoot rev-parse --short origin/main).Trim()
  $ok += "origin/main fetched: $originMainSha"
  Write-Host "  [ok] origin/main = $originMainSha"
}

$status = & git -C $repoRoot status --porcelain
if ([string]::IsNullOrWhiteSpace(($status -join ""))) {
  $ok += "Main-checkout er rent"
  Write-Host "  [ok] main-checkout rent"
} else {
  $lines = @(@($status) | Where-Object { $_ })
  $warn += "Main-checkout har $($lines.Count) aendret/untracked fil(er) — bolge-agenter brancher fra origin/main, saa det blokerer ikke, men verificer at intet skal committes foerst."
  Write-Host "  [warn] $($lines.Count) aendret/untracked fil(er) i main-checkout:" -ForegroundColor Yellow
  $lines | Select-Object -First 5 | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
}

# --- 4. Worktree-hygiejne + disk ---
Write-Section "Worktree-hygiejne + disk"

$worktreeLines = & git -C $repoRoot worktree list --porcelain 2>$null
$worktreeCount = @($worktreeLines | Where-Object { $_ -like "worktree *" }).Count
Write-Host "  [info] $worktreeCount aktive worktrees"

if (-not $SkipPrune) {
  try {
    Write-Host "  Dry-run af prune-merged-worktrees (rapport, intet slettes)..."
    $pruneOut = & pwsh -NoProfile -File (Join-Path $PSScriptRoot "prune-merged-worktrees.ps1") -RepoRoot $repoRoot 2>&1
    $pruneTail = @($pruneOut) | Select-Object -Last 4
    $pruneTail | ForEach-Object { Write-Host "    $_" }
    $ok += "Worktree-prune dry-run koert ($worktreeCount worktrees)"
  } catch {
    $warn += "prune-merged-worktrees dry-run fejlede ($($_.Exception.Message)) — ikke blokerende."
    Write-Host "  [warn] prune dry-run fejlede: $($_.Exception.Message)" -ForegroundColor Yellow
  }
} else {
  Write-Host "  [skip] prune dry-run sprunget over (-SkipPrune)"
}

$drive = Get-PSDrive -Name C
$freeGB = [math]::Round($drive.Free / 1GB, 1)
if ($freeGB -lt $MinFreeDiskGB) {
  $fail += "Kun $freeGB GB ledig paa C: (krav: $MinFreeDiskGB GB). Koer 'npm run cleanup:worktrees:run' eller ryd op foer bolgen."
  Write-Host "  [NO-GO] $freeGB GB ledig paa C: (< $MinFreeDiskGB GB)" -ForegroundColor Red
} else {
  $ok += "$freeGB GB ledig paa C:"
  Write-Host "  [ok] $freeGB GB ledig paa C:"
}

# --- 5. Toolchain ---
Write-Section "Toolchain (main-checkout)"

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
  $nodeVersion = (& $nodeCmd.Source --version).Trim()
  $ok += "node $nodeVersion"
  Write-Host "  [ok] node $nodeVersion"
} else {
  $fail += "node ikke fundet paa PATH — bolge-agenter kan ikke koere tests/builds."
  Write-Host "  [NO-GO] node ikke fundet" -ForegroundColor Red
}

foreach ($dir in @("frontend\node_modules", "backend\node_modules")) {
  $full = Join-Path $repoRoot $dir
  if ((Test-Path $full) -and (@(Get-ChildItem $full -Directory -ErrorAction SilentlyContinue).Count -gt 0)) {
    $ok += "$dir findes"
    Write-Host "  [ok] $dir findes"
  } else {
    $warn += "$dir mangler/tom i main-checkout — koer 'npm run sync-deps' hvis orkestratoren skal koere tests lokalt."
    Write-Host "  [warn] $dir mangler eller tom" -ForegroundColor Yellow
  }
}

# --- Summary + JSON-state ---
Write-Section "Sammenfatning"
Write-Host "  $($ok.Count) ok / $($warn.Count) advarsler / $($fail.Count) NO-GO"

if ($fail.Count -gt 0) {
  Write-Host ""
  Write-Host "NO-GO-aarsager:" -ForegroundColor Red
  $fail | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}
if ($warn.Count -gt 0) {
  Write-Host ""
  Write-Host "Advarsler (ikke blokerende):" -ForegroundColor Yellow
  $warn | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}

$stateDir = Join-Path $repoRoot ".codex.local"
if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
$stateFile = Join-Path $stateDir "night-wave-preflight.json"
[ordered]@{
  timestamp           = (Get-Date).ToString("o")
  hostname            = $env:COMPUTERNAME
  repoRoot            = $repoRoot
  originMainSha       = $originMainSha
  standbyAcSec        = $power.StandbyAcSec
  hibernateAcSec      = $power.HibernateAcSec
  ghProbeSucceededAt  = $ghProbeSucceededAt
  worktreeCount       = $worktreeCount
  freeDiskGB          = $freeGB
  okCount             = $ok.Count
  warnCount           = $warn.Count
  failCount           = $fail.Count
  failures            = $fail
  warnings            = $warn
  go                  = ($fail.Count -eq 0)
} | ConvertTo-Json -Depth 5 | Out-File -FilePath $stateFile -Encoding utf8
Write-Host ""
Write-Host "  State skrevet: $stateFile"

if ($fail.Count -gt 0) {
  Write-Host ""
  Write-Host "[NO-GO] Loes aarsagerne ovenfor og koer scriptet igen." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "[GO] Preflight bestaaet. Launch bolgen i SAMME tur som ejer-go, og forlad foerst maskinen naar launch-beviset er set." -ForegroundColor Green
exit 0
