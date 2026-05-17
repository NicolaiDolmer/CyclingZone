# new-worktree.ps1
#
# Opretter et git worktree til parallel Claude Code-session og setup'er:
#   - .env hardlinks DIREKTE til OneDrive-context\secrets (omg�r cascade-cloud-fil-issue)
#   - node_modules junction til main repo (sparer ~500 MB + install-tid)
#   - Memory + codex-junctions via link-onedrive-context.ps1 -RepoRoot <worktree>
#
# Brug:
#   pwsh -File scripts/new-worktree.ps1 -Branch feat/min-feature
#   pwsh -File scripts/new-worktree.ps1 -Branch fix/abc -FromBranch origin/develop
#
# Resultat: C:\dev\CyclingZone-worktrees\<branch-slug>\
# �bn ny Claude Code session i den path.

param(
  [Parameter(Mandatory)] [string] $Branch,
  [string] $FromBranch = "origin/main",
  [string] $RepoRoot = "C:\dev\CyclingZone",
  [string] $WorktreesRoot = "C:\dev\CyclingZone-worktrees",
  [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Branch-slug: erstat / med - for path-safety
$slug = $Branch -replace '/','-'
$wt = Join-Path $WorktreesRoot $slug

if (Test-Path $wt) {
  Write-Host "[stop] Worktree-path findes allerede: $wt" -ForegroundColor Red
  Write-Host "       K�r 'git worktree remove $wt' f�rst hvis du vil genskabe." -ForegroundColor Yellow
  exit 1
}

if (-not (Test-Path $WorktreesRoot)) {
  if ($DryRun) {
    Write-Host "[would-mkdir] $WorktreesRoot" -ForegroundColor Cyan
  } else {
    New-Item -ItemType Directory $WorktreesRoot -Force | Out-Null
  }
}

Write-Host "=== git worktree add ===" -ForegroundColor Cyan
if ($DryRun) {
  Write-Host "[would-run] git -C $RepoRoot worktree add -b $Branch $wt $FromBranch" -ForegroundColor Cyan
} else {
  & git -C $RepoRoot worktree add -b $Branch $wt $FromBranch
  if ($LASTEXITCODE -ne 0) { throw "git worktree add fejlede" }
}

Write-Host ""
Write-Host "=== .env hardlinks (direkte til OneDrive-secrets) ===" -ForegroundColor Cyan
$secretsRoot = Join-Path $env:OneDrive "CyclingZone-context\secrets"
if (Test-Path $secretsRoot) {
  # OneDrive-secrets bruger '.' i navnet (backend.env), worktree bruger '\\.env'
  $envMap = @{
    'backend\.env'                = 'backend.env'
    'frontend\.env'               = 'frontend.env'
    'frontend\.env.production'    = 'frontend.env.production'
    '.mcp.json'                   = 'mcp.json'
  }
  foreach ($k in $envMap.Keys) {
    $dst = Join-Path $wt $k
    $src = Join-Path $secretsRoot $envMap[$k]
    if (-not (Test-Path $src)) {
      Write-Host "  [skip] OneDrive-source mangler: $($envMap[$k])" -ForegroundColor Yellow
      continue
    }
    $parent = Split-Path $dst -Parent
    if ($parent -and -not (Test-Path $parent)) {
      if ($DryRun) { Write-Host "  [would-mkdir] $parent" -ForegroundColor Cyan }
      else { New-Item -ItemType Directory $parent -Force | Out-Null }
    }
    if (Test-Path $dst) {
      if ($DryRun) { Write-Host "  [would-replace] $k" -ForegroundColor Cyan; continue }
      Remove-Item $dst -Force
    }
    if ($DryRun) {
      Write-Host "  [would-hardlink] $k -> $($envMap[$k])" -ForegroundColor Cyan
    } else {
      # cmd /c mklink /H: mere tolerant overfor OneDrive cloud-files end New-Item -HardLink
      $out = & cmd /c mklink /H "$dst" "$src" 2>&1
      if ($LASTEXITCODE -eq 0) {
        Write-Host "  [ok] $k"
      } else {
        Write-Host "  [warn] mklink fejlede for $k`: $out" -ForegroundColor Yellow
      }
    }
  }
} else {
  Write-Host "  [skip] OneDrive-secrets ikke fundet ($secretsRoot)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== node_modules junctions (delt med main) ===" -ForegroundColor Cyan
foreach ($nm in @('backend\node_modules', 'frontend\node_modules')) {
  $src = Join-Path $RepoRoot $nm
  $dst = Join-Path $wt $nm
  if (-not (Test-Path $src)) {
    Write-Host "  [skip] $nm mangler i main repo (k�r npm install i main f�rst)" -ForegroundColor Yellow
    continue
  }
  if (Test-Path $dst) {
    Write-Host "  [skip] $nm findes allerede"
    continue
  }
  if ($DryRun) {
    Write-Host "  [would-junction] $dst -> $src" -ForegroundColor Cyan
  } else {
    New-Item -ItemType Junction -Path $dst -Target $src | Out-Null
    Write-Host "  [ok] $nm"
  }
}

Write-Host ""
Write-Host "=== Memory + codex-junctions for worktree ===" -ForegroundColor Cyan
if ($DryRun) {
  Write-Host "  [would-run] link-onedrive-context.ps1 -RepoRoot $wt" -ForegroundColor Cyan
} else {
  & pwsh -File (Join-Path $RepoRoot "scripts\link-onedrive-context.ps1") -RepoRoot $wt
}

Write-Host ""
Write-Host "F�rdig. Worktree klar i: $wt" -ForegroundColor Green
Write-Host ""
Write-Host "N�ste skridt:" -ForegroundColor Cyan
Write-Host "  1. �bn ny Claude Code session i: $wt"
Write-Host "  2. Arbejd som normalt � branch er '$Branch'"
Write-Host "  3. Ved cleanup: pwsh -File scripts\remove-worktree.ps1 -Branch $Branch"
