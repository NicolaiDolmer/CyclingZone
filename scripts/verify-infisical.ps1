<#
.SYNOPSIS
  Ongoing health-check af Infisical secret-management state.

.DESCRIPTION
  Verificerer:
    1. Infisical CLI authenticated
    2. .infisical.json eksisterer og peger paa korrekt workspace
    3. Hver env (dev/preview/prod) har de forventede ADR-allowlist keys
    4. Ingen extra/uventede keys (drift-check)

  Output: per-env status med exit-kode 0 ved success, 1 ved mismatch.
  Values logges aldrig - kun key-navne og counts.

.EXAMPLE
  pwsh -File scripts/verify-infisical.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $RepoRoot

# Forventet inventory per ADR §"Runtime-verified secret inventory"
$Expected = @{
  dev = @('SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'FRONTEND_URL', 'PORT', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_API_URL')
  preview = @('VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_API_URL', 'VITE_CLARITY_PROJECT_ID')
  prod = @('SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'FRONTEND_URL', 'PORT', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_API_URL', 'VITE_CLARITY_PROJECT_ID')
}

$failed = $false

Write-Host "==> Pre-flight"
infisical user get token 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "  [FAIL] Infisical ikke logget ind. Run: infisical login"
  exit 1
}
Write-Host "  [OK] Infisical authenticated"

if (-not (Test-Path .infisical.json)) {
  Write-Host "  [FAIL] .infisical.json mangler. Run: infisical init (eller hent workspaceId fra dashboard-URL)"
  exit 1
}
$workspaceId = (Get-Content .infisical.json | ConvertFrom-Json).workspaceId
Write-Host "  [OK] Workspace linked: $($workspaceId.Substring(0,8))..."

Write-Host ""
Write-Host "==> Env coverage check (ADR allowlist)"

foreach ($env in @('dev', 'preview', 'prod')) {
  $actualKeys = infisical secrets --env=$env -o dotenv 2>$null | ForEach-Object {
    if ($_ -match '^([A-Z_][A-Z0-9_]*)=') { $Matches[1] }
  } | Sort-Object

  $expectedKeys = $Expected[$env] | Sort-Object

  $missing = Compare-Object $expectedKeys $actualKeys -PassThru | Where-Object { $_ -in $expectedKeys }
  $extra   = Compare-Object $expectedKeys $actualKeys -PassThru | Where-Object { $_ -in $actualKeys }

  $actualCount = ($actualKeys | Measure-Object).Count
  $expectedCount = ($expectedKeys | Measure-Object).Count

  if (-not $missing -and -not $extra) {
    Write-Host "  [OK]   $env  : $actualCount/$expectedCount keys match ADR inventory"
  } else {
    Write-Host "  [FAIL] $env  : $actualCount keys present, $expectedCount expected"
    if ($missing) { Write-Host "         missing: $($missing -join ', ')" }
    if ($extra)   { Write-Host "         extra (not in ADR): $($extra -join ', ')" }
    $failed = $true
  }
}

Write-Host ""
if ($failed) {
  Write-Host "==> FAIL - ses ovenfor. Genseed med: pwsh -File scripts/seed-infisical.ps1 -RailwayService CyclingZone"
  exit 1
} else {
  Write-Host "==> [OK] Infisical state matcher ADR inventory paa tvaers af alle 3 envs"
  exit 0
}
