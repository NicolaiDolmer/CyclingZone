# migrate-to-clean-location.ps1
#
# Migrerer CyclingZone-repo'et fra nuvaerende sti til en ren placering (default C:\dev\CyclingZone).
# DEFAULT ER DRY-RUN. Kor med -NoDryRun for faktisk migration.
#
# Kraver at preflight-check.ps1 er bestaaet (.codex.local/preflight-state.json med passed=true).
#
# Trin (alle audit-loggede):
#   1. Verificer preflight-state.json siger passed
#   2. Verificer target ikke findes / er tom
#   3. Clone fresh fra origin til target (NY git, ingen orphan-state)
#   4. Kopier lokal-only filer (.env*, .mcp.json, .codex.local/)
#   5. Kopier Claude auto-memory til ny encoded path
#   6. Kor npm install (backend + frontend)
#   7. Kor build-verifikation
#   8. Tilfoj target-path til ~/.codex/config.toml som trusted
#   9. Skriv migration-rapport
#
# IKKE destruktivt: Det gamle repo bliver IKKE slettet. Det skal du goer manuelt
# efter du har bekraeftet at det nye virker.
#
# Brug:
#   pwsh -File scripts/migrate-to-clean-location.ps1                        # dry-run, ingen aendringer
#   pwsh -File scripts/migrate-to-clean-location.ps1 -NoDryRun              # faktisk migration
#   pwsh -File scripts/migrate-to-clean-location.ps1 -Target "C:\dev\CZ"    # custom target

param(
  [string]$Target = "C:\dev\CyclingZone",
  [switch]$NoDryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$DryRun = -not $NoDryRun

function Write-Section($title) {
  Write-Host ""
  Write-Host "=== $title ===" -ForegroundColor Cyan
}

function Invoke-Step($description, [scriptblock]$action) {
  Write-Host ""
  if ($DryRun) {
    Write-Host "[DRY-RUN] $description" -ForegroundColor Magenta
  } else {
    Write-Host "[EXEC] $description" -ForegroundColor Green
    & $action
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
      throw "Step fejlede med exit code ${LASTEXITCODE}: $description"
    }
  }
}

function Resolve-GitPath {
  $gitCommand = Get-Command git -ErrorAction SilentlyContinue
  if ($gitCommand) { return $gitCommand.Source }
  $desktopRoots = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "GitHubDesktop") -Directory -Filter "app-*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending
  foreach ($root in $desktopRoots) {
    $candidate = Join-Path $root.FullName "resources\app\git\cmd\git.exe"
    if (Test-Path $candidate) { return $candidate }
  }
  throw "Git ikke fundet."
}

# --- 0. Banner ---
Write-Host ""
Write-Host "===================================================================" -ForegroundColor Cyan
if ($DryRun) {
  Write-Host "  DRY-RUN MODE (ingen aendringer udfoeres)" -ForegroundColor Magenta
} else {
  Write-Host "  LIVE MIGRATION (aendringer udfoeres)" -ForegroundColor Yellow
}
Write-Host "  Target: $Target" -ForegroundColor White
Write-Host "===================================================================" -ForegroundColor Cyan

# --- 1. Verificer preflight ---
Write-Section "Verificer preflight-state"

$gitPath = Resolve-GitPath
$source = (& $gitPath rev-parse --show-toplevel 2>$null).Trim() -replace "/", "\"
if (-not $source) { throw "Ikke i et git-repo. Kor scriptet inde i CyclingZone-repo." }

# Hvis vi er i en worktree, find hovedrepo'et.
# git rev-parse --git-common-dir returnerer relativ ".git" fra hovedrepo,
# saa vi skal resolve mod current dir for at faa absolut sti foer Split-Path.
$gitDirInfo = & $gitPath rev-parse --git-common-dir 2>$null
if ($gitDirInfo) {
  $commonDir = $gitDirInfo.Trim() -replace "/", "\"
  if (-not [System.IO.Path]::IsPathRooted($commonDir)) {
    $commonDir = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $commonDir))
  }
  $mainRepoCandidate = Split-Path -Parent $commonDir
  if ($mainRepoCandidate -and ($mainRepoCandidate -ne $source)) {
    Write-Host "  [info] Du korer scriptet fra en worktree." -ForegroundColor Yellow
    Write-Host "         Worktree: $source" -ForegroundColor Yellow
    Write-Host "         Hovedrepo: $mainRepoCandidate" -ForegroundColor Yellow
    Write-Host "         Migration cloner fresh fra origin, saa det er OK." -ForegroundColor Yellow
    $source = $mainRepoCandidate
  }
}

Write-Host "  Source: $source"
Write-Host "  Target: $Target"

$stateFile = Join-Path $source ".codex.local\preflight-state.json"
if (-not (Test-Path $stateFile)) {
  throw "preflight-state.json findes ikke. Kor 'pwsh -File scripts/preflight-check.ps1' foerst."
}

$state = Get-Content $stateFile -Raw | ConvertFrom-Json
$ageSec = ((Get-Date) - [datetime]$state.timestamp).TotalSeconds
if ($ageSec -gt 600) {
  Write-Host "  [warn] preflight-state er $([int]$ageSec)s gammel. Genkor preflight for sikkerheds skyld." -ForegroundColor Yellow
  if (-not $DryRun) {
    Write-Host "  Afbryd med Ctrl+C nu hvis du vil genkore preflight foerst..."
    Start-Sleep -Seconds 5
  }
}
if (-not $state.passed) {
  # Migrate accepterer kun ÉN type fail: at repo'et ligger under OneDrive.
  # Det er hele formaalet med migrationen — saa det er ikke en blocker her.
  # Alle andre failures (uncommitted, unpushed, manglende toolchain) blokerer.
  $blockers = @($state.failures | Where-Object { $_ -notlike "*UNDER OneDrive*" })
  if ($blockers.Count -gt 0) {
    Write-Host "  [FAIL] Preflight failede med ikke-OneDrive blockers:" -ForegroundColor Red
    $blockers | ForEach-Object { Write-Host "    - $_" -ForegroundColor Red }
    throw "Loes blockers og kor preflight igen foer migration."
  }
  Write-Host "  [info] Preflight rapporterede 'failed' kun pga. OneDrive — det er forventet og selve aarsagen til migrationen. Fortsaetter." -ForegroundColor Yellow
} else {
  Write-Host "  [ok] preflight-state.passed=true (alder: $([int]$ageSec)s)"
}

# --- 2. Verificer target ---
Write-Section "Verificer target er sikker"

if (Test-Path $Target) {
  $existing = Get-ChildItem $Target -Force -ErrorAction SilentlyContinue
  if ($existing) {
    throw "Target '$Target' eksisterer og er IKKE tom. Vaelg en anden sti eller slet target manuelt."
  }
  Write-Host "  [ok] $Target findes men er tom"
} else {
  Write-Host "  [ok] $Target findes ikke endnu (oprettes)"
}

# Verificer parent eksisterer eller kan oprettes
$targetParent = Split-Path -Parent $Target
if (-not (Test-Path $targetParent)) {
  Invoke-Step "Opret parent-mappe $targetParent" {
    New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
  }
} else {
  Write-Host "  [ok] Parent eksisterer: $targetParent"
}

# Verificer at target ikke ligger under OneDrive
if ($state.oneDriveRoot) {
  $oneDriveNorm = [System.IO.Path]::GetFullPath($state.oneDriveRoot).TrimEnd('\')
  $targetNorm = [System.IO.Path]::GetFullPath($Target)
  if ($targetNorm.StartsWith($oneDriveNorm + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Target '$Target' ligger UNDER OneDrive ($oneDriveNorm). Det vil reproducere problemet."
  }
}
Write-Host "  [ok] Target ligger ikke under OneDrive"

# --- 3. Fresh clone ---
Write-Section "Clone fresh fra origin"

Invoke-Step "git clone $($state.originUrl) $Target" {
  & $gitPath clone $state.originUrl $Target
}

# --- 4. Kopier lokal-only filer ---
Write-Section "Kopier lokal-only filer"

$localFileProps = @($state.localFiles.PSObject.Properties)
if ($localFileProps.Count -eq 0) {
  Write-Host "  (ingen lokal-only filer at kopiere)"
} else {
  foreach ($prop in $localFileProps) {
    $relPath = $prop.Name
    $sourceFull = Join-Path $source $relPath
    $targetFull = Join-Path $Target $relPath
    if (-not (Test-Path $sourceFull)) {
      Write-Host "  [skip] $relPath findes ikke (skipped)"
      continue
    }
    $targetDir = Split-Path -Parent $targetFull
    Invoke-Step "Kopier $relPath" {
      if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }
      if ((Get-Item $sourceFull) -is [System.IO.DirectoryInfo]) {
        Copy-Item -Path $sourceFull -Destination $targetFull -Recurse -Force
      } else {
        Copy-Item -Path $sourceFull -Destination $targetFull -Force
      }
    }
  }
}

# --- 5. Kopier auto-memory ---
Write-Section "Kopier Claude Code auto-memory"

if ($state.memoryPath -and (Test-Path $state.memoryPath)) {
  # Encode ny target-path
  $newEncoded = "C--" + (($Target -replace "^C:", "") -replace "\\", "-").TrimStart("-")
  $newProjectDir = Join-Path $env:USERPROFILE ".claude\projects\$newEncoded"
  $newMemoryDir = Join-Path $newProjectDir "memory"

  Invoke-Step "Kopier auto-memory fra '$($state.memoryPath)' til '$newMemoryDir'" {
    if (-not (Test-Path $newProjectDir)) { New-Item -ItemType Directory -Path $newProjectDir -Force | Out-Null }
    Copy-Item -Path $state.memoryPath -Destination $newMemoryDir -Recurse -Force
  }
} else {
  Write-Host "  [skip] Ingen auto-memory at kopiere"
}

# --- 6. npm install ---
Write-Section "Installer dependencies"

if (-not $DryRun) {
  Push-Location (Join-Path $Target "backend")
  try {
    Write-Host "  Backend: npm install..."
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "Backend npm install fejlede" }
  } finally { Pop-Location }

  Push-Location (Join-Path $Target "frontend")
  try {
    Write-Host "  Frontend: npm install..."
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "Frontend npm install fejlede" }
  } finally { Pop-Location }
} else {
  Write-Host "  [DRY-RUN] Ville kore: cd backend && npm install"
  Write-Host "  [DRY-RUN] Ville kore: cd frontend && npm install"
}

# --- 7. Build-verifikation ---
Write-Section "Verificer build"

if (-not $DryRun) {
  Push-Location (Join-Path $Target "frontend")
  try {
    Write-Host "  Frontend: npm run build..."
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build fejlede. Migration STOPPER. Target er bevaret saa du kan inspicere." }
  } finally { Pop-Location }
} else {
  Write-Host "  [DRY-RUN] Ville kore: cd frontend && npm run build"
}

# --- 8. Codex trust-entry ---
Write-Section "Tilfoj target til Codex trust"

$codexConfig = Join-Path $env:USERPROFILE ".codex\config.toml"
$targetLower = $Target.ToLower()
$trustEntry = @"

[projects.'$targetLower']
trust_level = "trusted"
"@

if (Test-Path $codexConfig) {
  $configContent = Get-Content $codexConfig -Raw
  if ($configContent -match [regex]::Escape("[projects.'$targetLower'")) {
    Write-Host "  [ok] Target er allerede trusted i ~/.codex/config.toml"
  } else {
    Invoke-Step "Append trust-entry til ~/.codex/config.toml" {
      Add-Content -Path $codexConfig -Value $trustEntry -Encoding utf8
    }
  }
} else {
  Write-Host "  [info] ~/.codex/config.toml findes ikke (Codex ikke installeret paa denne PC?)"
}

# --- 9. Migration-rapport ---
Write-Section "Migration-rapport"

$report = [ordered]@{
  timestamp = (Get-Date).ToString("o")
  dryRun    = $DryRun
  source    = $source
  target    = $Target
  hostname  = $env:COMPUTERNAME
  user      = $env:USERNAME
  origin    = $state.originUrl
}
if (-not $DryRun) {
  $reportFile = Join-Path $Target ".codex.local\migration-report.json"
  $reportDir = Split-Path -Parent $reportFile
  if (-not (Test-Path $reportDir)) { New-Item -ItemType Directory -Path $reportDir -Force | Out-Null }
  $report | ConvertTo-Json -Depth 5 | Out-File -FilePath $reportFile -Encoding utf8
  Write-Host "  Rapport: $reportFile"
}
$report | ConvertTo-Json -Depth 5

# --- Final ---
Write-Host ""
Write-Host "===================================================================" -ForegroundColor Cyan
if ($DryRun) {
  Write-Host "  DRY-RUN FAERDIG. Ingen aendringer udfoert." -ForegroundColor Magenta
  Write-Host ""
  Write-Host "  For at udfoere migration:" -ForegroundColor White
  Write-Host "    pwsh -File scripts/migrate-to-clean-location.ps1 -NoDryRun" -ForegroundColor White
} else {
  Write-Host "  MIGRATION FAERDIG: $Target" -ForegroundColor Green
  Write-Host ""
  Write-Host "  Naeste skridt:" -ForegroundColor White
  Write-Host "    1. cd $Target"
  Write-Host "    2. Kor 'pwsh -File scripts/setup-discord-mcp.ps1' for at recreate .mcp.json"
  Write-Host "    3. Aabn Claude Code i $Target og verificer alt virker"
  Write-Host "    4. Aabn Codex i $Target og verificer det er trusted"
  Write-Host "    5. Kor 'pwsh -File scripts/install-user-hooks.ps1' for SessionStart/Stop hooks"
  Write-Host "    6. Naar alt er bekraeftet OK: slet det gamle repo manuelt"
  Write-Host "         Gammel placering: $source"
}
Write-Host "===================================================================" -ForegroundColor Cyan
