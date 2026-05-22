<#
.SYNOPSIS
  Seeds Infisical from authoritative sources without exposing values to agent context.

.DESCRIPTION
  Sources per environment:
    dev      -> backend/.env + frontend/.env (lokal)
    preview  -> Vercel preview environment
    prod     -> Vercel production (frontend keys) + Railway variables (backend keys)

  Values flow through shell pipes and temp files only - de printes aldrig i terminal-output
  som en agent kunne se. Temp-filer placeres i $env:TEMP og slettes i finally-blokken.

  Pre-flight kraever:
    1. infisical login          (browser-OAuth)
    2. infisical init           (i repo, linker projekt)
    3. vercel login             (browser-OAuth)
    4. vercel link              (i repo, linker projekt)
    5. railway login            (browser-OAuth)
    6. railway link             (i repo, linker projekt + service)

.PARAMETER Env
  Miljoer der skal seedes: dev, preview, prod eller all (default).

.PARAMETER DryRun
  Print kommandoer der ville koere uden at udfoere dem.

.PARAMETER RailwayService
  Railway service-navn for backend. Default 'backend'.

.EXAMPLE
  pwsh -File scripts/seed-infisical.ps1 -DryRun
  pwsh -File scripts/seed-infisical.ps1 -Env dev
  pwsh -File scripts/seed-infisical.ps1
#>
[CmdletBinding()]
param(
  [ValidateSet('dev','preview','prod','all')]
  [string]$Env = 'all',
  [switch]$DryRun,
  [string]$RailwayService = 'backend'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $RepoRoot

$TempDir = Join-Path $env:TEMP "infisical-seed-$([guid]::NewGuid().Guid.Substring(0,8))"
New-Item -ItemType Directory -Path $TempDir | Out-Null

function Invoke-Step {
  param([string]$Description, [scriptblock]$Action)
  Write-Host "  -> $Description"
  if ($DryRun) { return }
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "Step failed (exit $LASTEXITCODE): $Description" }
}

# Allowlist filter per ADR §"Runtime-verified secret inventory".
# Vercel/Railway returnerer mange ekstra system-vars (VERCEL_*, TURBO_*, POSTGRES_* etc.) -
# vi seeder kun de explicit-listede nogler for at holde Infisical clean.
$AllowedFrontendKeys = @('VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_API_URL', 'VITE_CLARITY_PROJECT_ID')
$AllowedBackendKeys  = @('SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'FRONTEND_URL', 'PORT')

function Filter-EnvFile {
  param(
    [string]$Source,
    [string]$Dest,
    [string[]]$AllowKeys
  )
  # Split-baseret filter: handterer quoted/unquoted, values med = i sig, etc.
  Get-Content -LiteralPath $Source | Where-Object {
    $line = $_
    $eqIdx = $line.IndexOf('=')
    if ($eqIdx -le 0) { return $false }
    $key = $line.Substring(0, $eqIdx)
    $val = $line.Substring($eqIdx + 1)
    ($key -match '^[A-Z_][A-Z0-9_]*$') -and ($key -in $AllowKeys) -and ($val.Trim('"').Trim().Length -gt 0)
  } | Set-Content -LiteralPath $Dest -Encoding utf8NoBOM
  if ((Get-Item -LiteralPath $Dest).Length -eq 0) {
    throw "Filter resulted in empty file - check allowlist matches source keys"
  }
}

try {
  Write-Host "==> Pre-flight checks"

  # Infisical auth + project link (redirect both streams - token must NEVER reach agent context)
  infisical user get token 1>$null 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Infisical not authenticated. Run: infisical login" }
  if (-not (Test-Path .infisical.json)) { throw ".infisical.json mangler. Run: infisical init" }
  Write-Host "  [OK] Infisical: authenticated + projekt linket"

  if ($Env -in @('prod','preview','all')) {
    $null = vercel whoami 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Vercel not authenticated. Run: vercel login" }
    if (-not (Test-Path .vercel)) { throw ".vercel/ mangler. Run: vercel link" }
    Write-Host "  [OK] Vercel: authenticated + projekt linket"
  }

  if ($Env -in @('prod','all')) {
    $null = railway whoami 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Railway not authenticated. Run: railway login" }
    Write-Host "  [OK] Railway: authenticated"
  }

  Write-Host ""

  # --- DEV: local .env files ---
  if ($Env -in @('dev','all')) {
    Write-Host "==> Seeding dev (lokale .env-filer)"
    if (-not (Test-Path backend/.env))  { throw "backend/.env mangler" }
    if (-not (Test-Path frontend/.env)) { throw "frontend/.env mangler" }

    Invoke-Step "infisical secrets set --env=dev --file=backend/.env" {
      $null = infisical secrets set --env=dev --file=backend/.env --silent 2>$null
    }
    Invoke-Step "infisical secrets set --env=dev --file=frontend/.env" {
      $null = infisical secrets set --env=dev --file=frontend/.env --silent 2>$null
    }
    Write-Host ""
  }

  # --- PREVIEW: Vercel preview ---
  if ($Env -in @('preview','all')) {
    Write-Host "==> Seeding preview (Vercel preview)"
    $previewRaw      = Join-Path $TempDir "preview-raw.env"
    $previewFiltered = Join-Path $TempDir "preview-filtered.env"

    Invoke-Step "vercel env pull <tmp> --environment=preview" {
      $null = vercel env pull $previewRaw --environment=preview --yes 2>$null
    }
    Invoke-Step "filter to ADR allowlist (frontend keys)" {
      Filter-EnvFile -Source $previewRaw -Dest $previewFiltered -AllowKeys $AllowedFrontendKeys
    }
    Invoke-Step "infisical secrets set --env=preview --file=<tmp>" {
      $null = infisical secrets set --env=preview --file=$previewFiltered --silent 2>$null
    }
    Write-Host ""
  }

  # --- PROD: Vercel (frontend) + Railway (backend) ---
  if ($Env -in @('prod','all')) {
    Write-Host "==> Seeding prod (Vercel frontend + Railway backend)"

    # Frontend keys from Vercel (filter to ADR allowlist)
    $prodFeRaw      = Join-Path $TempDir "prod-frontend-raw.env"
    $prodFeFiltered = Join-Path $TempDir "prod-frontend-filtered.env"
    Invoke-Step "vercel env pull <tmp> --environment=production" {
      $null = vercel env pull $prodFeRaw --environment=production --yes 2>$null
    }
    Invoke-Step "filter to ADR allowlist (frontend keys)" {
      Filter-EnvFile -Source $prodFeRaw -Dest $prodFeFiltered -AllowKeys $AllowedFrontendKeys
    }
    Invoke-Step "infisical secrets set --env=prod --file=<tmp> (frontend)" {
      $null = infisical secrets set --env=prod --file=$prodFeFiltered --silent 2>$null
    }

    # Backend keys from Railway (filter to ADR allowlist)
    $prodBeRaw      = Join-Path $TempDir "prod-backend-raw.env"
    $prodBeFiltered = Join-Path $TempDir "prod-backend-filtered.env"
    Invoke-Step "railway variable list --service=$RailwayService --kv > <tmp>" {
      railway variable list --service=$RailwayService --kv 2>$null `
        | Out-File -Encoding utf8NoBOM -FilePath $prodBeRaw -ErrorAction Stop
      if ((Get-Item $prodBeRaw).Length -eq 0) { throw "Railway variables tom - tjek service-navn ($RailwayService)" }
    }
    Invoke-Step "filter to ADR allowlist (backend keys)" {
      Filter-EnvFile -Source $prodBeRaw -Dest $prodBeFiltered -AllowKeys $AllowedBackendKeys
    }
    Invoke-Step "infisical secrets set --env=prod --file=<tmp> (backend)" {
      $null = infisical secrets set --env=prod --file=$prodBeFiltered --silent 2>$null
    }
    Write-Host ""
  }

  Write-Host "==> Seed complete"
  if ($DryRun) { Write-Host "    (Dry run - ingen aendringer udfoert)" }
}
finally {
  if (Test-Path $TempDir) {
    Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
    Write-Host "==> Temp files cleaned"
  }
}
