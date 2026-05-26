<#
.SYNOPSIS
  Sync Infisical dev SUPABASE_SERVICE_KEY from prod environment (closes #337).

.DESCRIPTION
  Pulls SUPABASE_SERVICE_KEY value from Infisical's prod environment and writes
  it to the dev environment. Used post-Phase-5 (#327) when Infisical dev still
  contains a stale value (e.g. seeded from a local backend/.env that was never
  rotated to sb_secret_*).

  Secret value handling:
    1. infisical export writes prod env to a temp file (stdout redirected)
    2. Get-Content + Where-Object filters SUPABASE_SERVICE_KEY line to second
       temp file (no value printed to host)
    3. infisical secrets set --file consumes second temp file
    4. Temp files deleted in finally block
    5. Verification calls audit-rls-coverage.js via infisical run; only JSON
       result is parsed, value never echoed

  Sanity checks:
    - Prod's value must start with sb_secret_ (NOT legacy eyJ JWT)
    - If sanity fails, script exits without modifying dev

.PARAMETER DryRun
  Print actions without modifying Infisical or running audit.

.PARAMETER InfisicalExe
  Path to infisical.exe. Defaults to winget install path; falls back to
  PATH lookup if the default path does not exist.

.EXAMPLE
  pwsh -File scripts/rotate-supabase-key-dev-from-prod.ps1 -DryRun
  pwsh -File scripts/rotate-supabase-key-dev-from-prod.ps1
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [string]$InfisicalExe = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\infisical.infisical_Microsoft.Winget.Source_8wekyb3d8bbwe\infisical.exe"
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $RepoRoot

# Pre-flight: locate CLI
if (-not (Test-Path $InfisicalExe)) {
  $cmd = Get-Command infisical -ErrorAction SilentlyContinue
  if ($cmd) {
    $InfisicalExe = $cmd.Source
  } else {
    throw "Infisical CLI not found. Install: winget install Infisical.infisical"
  }
}
Write-Host "==> Pre-flight"
Write-Host "    CLI: $InfisicalExe"

# Pre-flight: auth + project link
$null = & $InfisicalExe user get token 2>$null
if ($LASTEXITCODE -ne 0) { throw "Not authenticated. Run: infisical login" }
if (-not (Test-Path .infisical.json)) { throw ".infisical.json missing (run from repo root)" }
Write-Host "    [OK] authenticated + .infisical.json found"

# Temp workspace
$TempDir = Join-Path $env:TEMP "infisical-rotate-$([guid]::NewGuid().Guid.Substring(0,8))"
New-Item -ItemType Directory -Path $TempDir | Out-Null
$prodExport = Join-Path $TempDir "prod.env"
$keyOnly = Join-Path $TempDir "key.env"

try {
  Write-Host ""
  Write-Host "==> Step 1: Export prod -> $prodExport"
  if ($DryRun) {
    Write-Host "    [DRY RUN] would run: infisical export --env=prod --format=dotenv > $prodExport"
  } else {
    & $InfisicalExe export --env=prod --format=dotenv 2>$null | Out-File -FilePath $prodExport -Encoding utf8NoBOM
    if (-not (Test-Path $prodExport) -or (Get-Item $prodExport).Length -eq 0) {
      throw "Prod export empty - check 'infisical login' + project link"
    }
    Write-Host "    [OK] $((Get-Content $prodExport).Count) line(s) exported"
  }

  Write-Host ""
  Write-Host "==> Step 2: Extract SUPABASE_SERVICE_KEY line + sanity-check prefix"
  if ($DryRun) {
    Write-Host "    [DRY RUN] would filter SUPABASE_SERVICE_KEY line + verify sb_secret_ prefix"
  } else {
    $line = Get-Content $prodExport | Where-Object { $_ -match '^SUPABASE_SERVICE_KEY=' } | Select-Object -First 1
    if (-not $line) { throw "SUPABASE_SERVICE_KEY missing in prod export" }

    $valueAfterEq = $line.Substring($line.IndexOf('=') + 1).Trim('"').Trim("'")
    $isSbSecret = $valueAfterEq.StartsWith('sb_secret_')
    $isLegacy = $valueAfterEq.StartsWith('eyJ')
    Write-Host "    sb_secret_=$isSbSecret, legacy_eyJ=$isLegacy, length=$($valueAfterEq.Length)"

    if (-not $isSbSecret) {
      throw "Prod's SUPABASE_SERVICE_KEY does NOT start with sb_secret_. Full manual rotation needed (ADR Phase 5.D)."
    }

    $line | Set-Content -Path $keyOnly -Encoding utf8NoBOM
    Write-Host "    [OK] filtered to $keyOnly"
  }

  Write-Host ""
  Write-Host "==> Step 3: Set in Infisical dev environment"
  if ($DryRun) {
    Write-Host "    [DRY RUN] would run: infisical secrets set --env=dev --file=$keyOnly --silent"
  } else {
    $null = & $InfisicalExe secrets set --env=dev --file=$keyOnly --silent 2>$null
    if ($LASTEXITCODE -ne 0) { throw "infisical secrets set failed (exit $LASTEXITCODE)" }
    Write-Host "    [OK] Infisical dev SUPABASE_SERVICE_KEY updated"
  }

  Write-Host ""
  Write-Host "==> Step 4: Verify via audit-rls-coverage"
  if ($DryRun) {
    Write-Host "    [DRY RUN] would run: infisical run --env=dev -- node backend/scripts/audit-rls-coverage.js --json"
  } else {
    $auditRaw = & $InfisicalExe run --env=dev -- node backend/scripts/audit-rls-coverage.js --json 2>&1
    $auditOutput = ($auditRaw | Out-String).Trim()
    # Strip the leading "Injecting N secrets" log-line so JSON parses cleanly
    $jsonStart = $auditOutput.IndexOf('{')
    if ($jsonStart -ge 0) {
      $auditJson = $auditOutput.Substring($jsonStart)
      try {
        $parsed = $auditJson | ConvertFrom-Json
        $critical = [int]$parsed.critical_count
        if ($critical -eq 0) {
          Write-Host "    [OK] audit-rls: no frontend-blocked tables"
        } else {
          Write-Host "    [OK auth] audit-rls returned $critical critical findings (auth works; findings are separate concern)"
        }
        Write-Host ""
        Write-Host "==> Rotation complete. #337 can now be closed."
      } catch {
        Write-Host "    [WARN] audit JSON parse failed: $($_.Exception.Message)"
        Write-Host "    Raw (first 300 chars): $($auditOutput.Substring(0, [Math]::Min(300, $auditOutput.Length)))"
      }
    } else {
      Write-Host "    [FAIL] audit returned non-JSON output. First 5 lines:"
      ($auditOutput -split "`n" | Select-Object -First 5) | ForEach-Object { Write-Host "      $_" }
    }
  }

} finally {
  if (Test-Path $TempDir) {
    Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "==> Temp files cleaned"
  }
}
