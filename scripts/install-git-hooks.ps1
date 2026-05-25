# install-git-hooks.ps1
#
# Idempotent setup af repo-side git hooks:
#   1. core.hooksPath = .githooks   (aktivér tracked .githooks/pre-commit + pre-push)
#   2. Verificér gitleaks installeret (offer winget install hvis ikke)
#   3. Smoke-test pre-commit med fake-secret fixture
#
# Brug:
#   pwsh -File scripts/install-git-hooks.ps1
#   pwsh -File scripts/install-git-hooks.ps1 -InstallGitleaks
#   pwsh -File scripts/install-git-hooks.ps1 -SmokeTest
#
# Refs: #634 AC5 (forward-guard fra #296 endelig bygget).

[CmdletBinding()]
param(
  [switch]$InstallGitleaks,
  [switch]$SmokeTest,
  [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Info($msg) { if (-not $Quiet) { Write-Host $msg } }
function Warn($msg) { Write-Host "⚠️  $msg" -ForegroundColor Yellow }
function Ok($msg)   { Write-Host "✅ $msg" -ForegroundColor Green }
function Err($msg)  { Write-Host "❌ $msg" -ForegroundColor Red }

$repoRoot = (git rev-parse --show-toplevel) 2>$null
if (-not $repoRoot) { Err "Not in a git repository."; exit 1 }
Push-Location $repoRoot

try {
  # --- (1) core.hooksPath ---
  $current = (git config --get core.hooksPath) 2>$null
  if ($current -eq ".githooks") {
    Info "[1/3] core.hooksPath already set to .githooks"
  } else {
    Info "[1/3] Setting core.hooksPath -> .githooks"
    & git config core.hooksPath .githooks
    Ok "core.hooksPath set"
  }

  # --- (2) gitleaks ---
  $gitleaks = Get-Command gitleaks -ErrorAction SilentlyContinue
  if ($gitleaks) {
    $version = (& gitleaks version 2>&1) -join " "
    Info "[2/3] gitleaks installed: $version"
  } else {
    Warn "[2/3] gitleaks NOT installed."
    if ($InstallGitleaks) {
      $winget = Get-Command winget -ErrorAction SilentlyContinue
      if ($winget) {
        Info "Installing gitleaks via winget..."
        & winget install --id zricethezav.gitleaks --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) {
          Err "winget install failed. Manual: https://github.com/gitleaks/gitleaks#installation"
          exit 1
        }
        Ok "gitleaks installed via winget. Restart shell for PATH update."
      } else {
        Err "winget not available. Install gitleaks manually:"
        Write-Host "   https://github.com/gitleaks/gitleaks/releases (latest binary)"
        Write-Host "   eller: choco install gitleaks"
        Write-Host "   eller: scoop install gitleaks"
        exit 1
      }
    } else {
      Warn "Pre-commit hook will use PYTHON FALLBACK (slower, fewer patterns)."
      Warn "Run with -InstallGitleaks to install via winget."
    }
  }

  # --- (3) Smoke-test ---
  if ($SmokeTest) {
    Info "[3/3] Running smoke-test against fake-secret fixture..."

    $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "cz-pre-commit-test-$(Get-Random)"
    New-Item -ItemType Directory -Path $tmpDir | Out-Null

    try {
      Push-Location $tmpDir
      & git init --quiet
      & git config user.email "test@example.com"
      & git config user.name "Test"
      & git config core.hooksPath (Join-Path $repoRoot ".githooks")

      # Copy gitleaks config if available
      $gitleaksTomlPath = Join-Path $repoRoot ".gitleaks.toml"
      if (Test-Path $gitleaksTomlPath) {
        Copy-Item $gitleaksTomlPath -Destination $tmpDir
      }

      # Fake-secret fixture konstrueret ved runtime så source-fil ikke selv
      # indeholder pattern (undgår at sanitize-secrets.sh flagger denne fil).
      # Resultatet matcher `sb_secret_*` regex.
      $prefix = "sb" + "_secret_"
      $fakeSecret = $prefix + "TESTONLY1234567890abcdefghijklmnopqrstuvwx"
      "API_KEY=$fakeSecret" | Out-File -FilePath "test-leak.env" -Encoding utf8 -NoNewline
      & git add test-leak.env

      # Attempt commit - should be BLOCKED
      $commitOutput = & git commit -m "test: should be blocked" 2>&1 | Out-String
      $commitExit = $LASTEXITCODE

      if ($commitExit -ne 0) {
        Ok "Smoke-test PASSED: pre-commit hook blocked fake secret (exit=$commitExit)"
        if ($commitOutput -match "BLOCKED|gitleaks|secret") {
          Info "  Hook produced expected secret-related output."
        }
      } else {
        Err "Smoke-test FAILED: pre-commit hook did NOT block fake secret."
        Err "Output: $commitOutput"
        exit 1
      }
    } finally {
      Pop-Location
      if (Test-Path $tmpDir) {
        Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
      }
    }
  } else {
    Info "[3/3] Skipping smoke-test (use -SmokeTest to verify)."
  }

  Info ""
  Ok "Git hooks ready."
  Info "  Pre-commit: secret-scan + lint-staged (.githooks/pre-commit)"
  Info "  Pre-push:   secret-scan + lint + PatchNotes-check (.githooks/pre-push)"
  Info ""
  Info "Test manually:"
  Info "  pwsh -File scripts/install-git-hooks.ps1 -SmokeTest"
  Info "Or test the sanitize-secrets hook:"
  Info "  pwsh -File scripts/test-sanitize-secrets.ps1"

} finally {
  Pop-Location
}

exit 0
