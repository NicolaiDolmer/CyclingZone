# setup-worktree.ps1
#
# Idempotent setup af et EKSISTERENDE worktree (harness-oprettet eller manuelt).
# Sætter de to ting op som et worktree mangler hvis det blev oprettet uden om
# new-worktree.ps1 (fx Claude Code-harnessens .claude/worktrees/<navn>):
#
#   1. node_modules-junctions -> main-repoets node_modules (sparer ~500 MB + install-tid)
#   2. .env-hardlinks fra OneDrive-context\secrets (backend/.env, frontend/.env,
#      frontend/.env.production, .mcp.json)
#
# SIKKERHED (jf. #634 + repoets secret-leak-regler): env-linking sker via
# `mklink /H` (hardlink) DIREKTE til OneDrive-secret-filerne. Scriptet LÆSER
# aldrig secret-værdierne og dumper dem aldrig — det laver kun filsystem-links.
# Samme sikre mekanisme som new-worktree.ps1 brugte (link-onedrive-context.ps1
# håndterer ikke længere .env efter #327 Infisical-migration, så .env-hardlink-
# logikken bor her).
#
# Idempotent: alle trin skipper hvis target allerede er på plads → sikkert at
# køre igen, og en no-op når alt er sat op (fx kaldt fra SessionStart-hook).
#
# Brug:
#   pwsh -File scripts/setup-worktree.ps1                 # auto-detect via git (CWD = worktree)
#   pwsh -File scripts/setup-worktree.ps1 -DryRun         # rapportér uden at skrive
#   pwsh -File scripts/setup-worktree.ps1 -Quiet          # kun warnings/fejl (hook-mode)
#   pwsh -File scripts/setup-worktree.ps1 -WorktreeRoot <wt> -MainRepoRoot <main>
#
# Refs #994.

param(
  [string] $WorktreeRoot,
  [string] $MainRepoRoot,
  [switch] $DryRun,
  [switch] $Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info($msg, $color = "Gray") {
  if (-not $Quiet) { Write-Host $msg -ForegroundColor $color }
}
function Write-Section($title) {
  if (-not $Quiet) {
    Write-Host ""
    Write-Host "=== $title ===" -ForegroundColor Cyan
  }
}

# --- Path-detektion (fallback til git når params ikke er givet) ---
function Resolve-FullPath([string]$p) {
  return [System.IO.Path]::GetFullPath(($p -replace '/','\'))
}

if (-not $WorktreeRoot) {
  $top = (& git rev-parse --show-toplevel 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $top) {
    Write-Info "[skip] Ikke i et git-repo (git rev-parse fejlede)." "Yellow"
    exit 0
  }
  $WorktreeRoot = Resolve-FullPath ($top.Trim())
}
$WorktreeRoot = Resolve-FullPath $WorktreeRoot

if (-not $MainRepoRoot) {
  $commonDir = (& git -C $WorktreeRoot rev-parse --git-common-dir 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $commonDir) {
    Write-Info "[skip] Kunne ikke finde git-common-dir." "Yellow"
    exit 0
  }
  $commonDir = $commonDir.Trim()
  if (-not [System.IO.Path]::IsPathRooted($commonDir)) {
    $commonDir = Join-Path $WorktreeRoot $commonDir
  }
  $commonDir = Resolve-FullPath $commonDir
  $MainRepoRoot = Split-Path $commonDir -Parent
}
$MainRepoRoot = Resolve-FullPath $MainRepoRoot

$mode = if ($DryRun) { " [DRY-RUN]" } else { "" }
Write-Info "Worktree:  $WorktreeRoot$mode"
Write-Info "Main repo: $MainRepoRoot"

if ($WorktreeRoot -eq $MainRepoRoot) {
  # Vi er i selve main-repoet — node_modules + .env er rigtige filer her, ikke links.
  # setup-worktree er kun relevant for et separat worktree. No-op.
  Write-Info "[skip] Kører i main-repoet (ikke et separat worktree) — intet at linke." "Yellow"
  exit 0
}

# --- 1. node_modules-junctions (delt med main) ---
function Set-NodeModulesJunctions {
  Write-Section "node_modules junctions (delt med main)"
  foreach ($nm in @('backend\node_modules', 'frontend\node_modules')) {
    $src = Join-Path $MainRepoRoot $nm
    $dst = Join-Path $WorktreeRoot $nm
    if (-not (Test-Path $src)) {
      Write-Info "  [skip] $nm mangler i main repo (kør 'npm install' i main først)" "Yellow"
      continue
    }
    if (Test-Path $dst) {
      Write-Info "  [skip] $nm findes allerede"
      continue
    }
    $parent = Split-Path $dst -Parent
    if ($parent -and -not (Test-Path $parent)) {
      if ($DryRun) { Write-Info "  [would-mkdir] $parent" "Cyan" }
      else { New-Item -ItemType Directory $parent -Force | Out-Null }
    }
    if ($DryRun) {
      Write-Info "  [would-junction] $dst -> $src" "Cyan"
    } else {
      New-Item -ItemType Junction -Path $dst -Target $src | Out-Null
      Write-Info "  [ok] $nm"
    }
  }
}

# --- 2. .env-hardlinks (direkte til OneDrive-secrets; ingen værdier læses) ---
function Set-EnvHardlinks {
  Write-Section ".env hardlinks (direkte til OneDrive-secrets)"
  if (-not $env:OneDrive) {
    Write-Info "  [skip] OneDrive ikke konfigureret (env:OneDrive er tom)" "Yellow"
    return
  }
  $secretsRoot = Join-Path $env:OneDrive "CyclingZone-context\secrets"
  if (-not (Test-Path $secretsRoot)) {
    Write-Info "  [skip] OneDrive-secrets ikke fundet ($secretsRoot)" "Yellow"
    return
  }
  # OneDrive-secrets bruger '.' i navnet (backend.env), worktree bruger '\.env'
  $envMap = [ordered]@{
    'backend\.env'             = 'backend.env'
    'frontend\.env'            = 'frontend.env'
    'frontend\.env.production' = 'frontend.env.production'
    '.mcp.json'                = 'mcp.json'
  }
  foreach ($k in $envMap.Keys) {
    $dst = Join-Path $WorktreeRoot $k
    $src = Join-Path $secretsRoot $envMap[$k]
    if (-not (Test-Path $src)) {
      Write-Info "  [skip] OneDrive-source mangler: $($envMap[$k])" "Yellow"
      continue
    }
    # Idempotent: rør ikke en fil der allerede er på plads (hardlink ELLER rigtig fil).
    # Vi sletter aldrig en eksisterende .env → ingen risiko for at klippe lokalt indhold.
    if (Test-Path $dst) {
      Write-Info "  [skip] $k findes allerede"
      continue
    }
    $parent = Split-Path $dst -Parent
    if ($parent -and -not (Test-Path $parent)) {
      if ($DryRun) { Write-Info "  [would-mkdir] $parent" "Cyan" }
      else { New-Item -ItemType Directory $parent -Force | Out-Null }
    }
    if ($DryRun) {
      Write-Info "  [would-hardlink] $k -> $($envMap[$k])" "Cyan"
      continue
    }
    # cmd /c mklink /H: mere tolerant overfor OneDrive cloud-files end New-Item -HardLink.
    # Læser ALDRIG fil-indholdet — laver kun et filsystem-hardlink.
    $out = & cmd /c mklink /H "$dst" "$src" 2>&1
    if ($LASTEXITCODE -eq 0) {
      Write-Info "  [ok] $k"
    } else {
      Write-Info "  [warn] mklink fejlede for $k`: $out" "Yellow"
    }
  }
}

Set-NodeModulesJunctions
Set-EnvHardlinks

Write-Info ""
if ($DryRun) {
  Write-Info "Dry-run færdig. Kør uden -DryRun for at anvende." "Green"
} else {
  Write-Info "Worktree-setup færdig: $WorktreeRoot" "Green"
}
