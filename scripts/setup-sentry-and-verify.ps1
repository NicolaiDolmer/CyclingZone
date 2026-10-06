#requires -Version 5.1
<#
.SYNOPSIS
  Setup Sentry env vars i Vercel prod + verificér via smoke-test (#614 + #348).

.NOTES
  ⚠️ ARCHITECTURE-NOTE (2026-05-25): CyclingZone BACKEND lever paa Railway,
  ikke Vercel. Dette script saetter SENTRY_DSN paa VERCEL — relevant for
  FRONTEND/VITE_SENTRY_DSN-setup, IKKE for backend cron-capture.

  For backend (Railway) DSN-setup, brug i stedet:
    railway variables --service CyclingZone --set "SENTRY_DSN=https://..." \
                      --set "SENTRY_ENVIRONMENT=production" \
                      --set "SENTRY_TRACES_SAMPLE_RATE=0.1"
  Railway redeployer automatisk efter env-aendring.

  Smoke-test-delen (-SkipEnvSetup) er stadig nyttig for at validere DSN +
  Sentry pipeline uanset deploy-target.

  Se [.claude/learnings/2026-05-24-claimed-fix-without-verifying-observability-pipeline.md](../.claude/learnings/2026-05-24-claimed-fix-without-verifying-observability-pipeline.md)
  for arkitektur-konfusionen der affoedte denne note.

.DESCRIPTION
  Idempotent driver der:
    1. Secure-prompter for SENTRY_DSN (input skjules)
    2. Validerer DSN format
    3. Saetter SENTRY_DSN, SENTRY_ENVIRONMENT, SENTRY_TRACES_SAMPLE_RATE i Vercel prod
    4. Trigger redeploy (optional — -SkipRedeploy)
    5. Koerer backend/scripts/sentry-smoke-test.mjs lokalt med prod-DSN
    6. Prompter dig til at verificere i Sentry UI

.PARAMETER SkipEnvSetup
  Spring vercel env add-trinet over. Kør smoke-test mod allerede-sat DSN.

.PARAMETER SkipRedeploy
  Spring redeploy over. Du skal selv pushe en commit eller køre 'vercel --prod'.

.PARAMETER OverwriteExisting
  Overskriv eksisterende env vars uden at spørge.

.PARAMETER SkipSmokeTest
  Kun env setup, ingen lokal smoke-test (hvis du kun vil sætte vars).

.EXAMPLE
  pwsh -File scripts/setup-sentry-and-verify.ps1

.EXAMPLE
  pwsh -File scripts/setup-sentry-and-verify.ps1 -SkipRedeploy
#>

param(
  [switch]$SkipEnvSetup,
  [switch]$SkipRedeploy,
  [switch]$OverwriteExisting,
  [switch]$SkipSmokeTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ─── Helpers ──────────────────────────────────────────────────────────────────

function Write-Banner {
  param([string]$Text)
  $line = "-" * 60
  Write-Host ""
  Write-Host $line -ForegroundColor Cyan
  Write-Host "  $Text" -ForegroundColor Cyan
  Write-Host $line -ForegroundColor Cyan
  Write-Host ""
}

function Write-Step {
  param([int]$Num, [int]$Total, [string]$Text)
  Write-Host ""
  Write-Host "[$Num/$Total] $Text" -ForegroundColor Magenta
  Write-Host ""
}

function Read-SecureValue {
  param([string]$Prompt)
  $secure = Read-Host -AsSecureString $Prompt
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Test-VercelEnvExists {
  param([string]$Name)
  $list = & vercel env ls production 2>&1 | Out-String
  return $list -match "(?m)^\s*$([regex]::Escape($Name))\s+"
}

function Set-VercelEnv {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Value
  )

  $exists = Test-VercelEnvExists -Name $Name

  if ($exists) {
    if ($OverwriteExisting) {
      Write-Host "  -> $Name eksisterer - fjerner foer re-add..." -ForegroundColor Yellow
      & vercel env rm $Name production -y 2>&1 | Out-Null
    } else {
      $choice = Read-Host "  $Name eksisterer allerede i prod. Overskriv? (y/N)"
      if ($choice -match '^[yY]') {
        Write-Host "  -> Fjerner eksisterende vaerdi..." -ForegroundColor Yellow
        & vercel env rm $Name production -y 2>&1 | Out-Null
      } else {
        Write-Host "  -- Springer $Name over (eksisterende vaerdi beholdes)" -ForegroundColor Gray
        return
      }
    }
  }

  Write-Host "  + Tilfoejer $Name til prod..." -ForegroundColor Green
  $Value | & vercel env add $Name production 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "vercel env add $Name fejlede (exit code: $LASTEXITCODE). Manual fallback: 'vercel env add $Name production' og paste vaerdi."
  }
}

# ─── Forberedelse ─────────────────────────────────────────────────────────────

$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

Write-Banner "Sentry setup + verify (#614 + #348)"

# Vercel CLI sanity check
try {
  $vercelUser = & vercel whoami 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "vercel whoami fejlede" }
  Write-Host "  Vercel: logged in som $($vercelUser.Trim())" -ForegroundColor Gray
} catch {
  Write-Host "[FEJL] Vercel CLI ikke logged in eller mangler i PATH" -ForegroundColor Red
  Write-Host "       Koer: 'vercel login' (eller 'npm i -g vercel' hvis CLI mangler)" -ForegroundColor Yellow
  exit 1
}

# Smoke-test script sanity check
$smokeScript = Join-Path $repoRoot "backend/scripts/sentry-smoke-test.mjs"
if (-not (Test-Path $smokeScript)) {
  Write-Host "[FEJL] Smoke-test script mangler: $smokeScript" -ForegroundColor Red
  exit 1
}

# ─── 1. Saml DSN ──────────────────────────────────────────────────────────────

Write-Step 1 5 "Hent Sentry DSN"
Write-Host "  1. Aabn Sentry UI"
Write-Host "  2. Settings (gear-icon nederst venstre) -> Projects -> cyclingzone"
Write-Host "  3. Client Keys (DSN) -> kopier 'DSN'-feltet"
Write-Host ""

$dsn = Read-SecureValue "Paste DSN her (input skjules)"

if (-not $dsn) {
  Write-Host "[FEJL] Tom DSN - afbryder" -ForegroundColor Red
  exit 1
}

if ($dsn -notmatch '^https://\w+@[\w.]+\.sentry\.io/\d+$') {
  Write-Host "[FEJL] DSN format ser forkert ud. Forventet:" -ForegroundColor Red
  Write-Host "       https://<publicKey>@<host>.sentry.io/<projectId>" -ForegroundColor Yellow
  exit 1
}

Write-Host "  OK DSN format valid ($($dsn.Substring(0, 25))...)" -ForegroundColor Green

# ─── 2. Vercel env vars ───────────────────────────────────────────────────────

if (-not $SkipEnvSetup) {
  Write-Step 2 5 "Saet Vercel prod env vars"

  Set-VercelEnv -Name "SENTRY_DSN"                -Value $dsn
  Set-VercelEnv -Name "SENTRY_ENVIRONMENT"        -Value "production"
  Set-VercelEnv -Name "SENTRY_TRACES_SAMPLE_RATE" -Value "0.1"

  Write-Host ""
  Write-Host "  OK Env vars sat" -ForegroundColor Green
} else {
  Write-Step 2 5 "Springer env setup over (-SkipEnvSetup)"
}

# ─── 3. Redeploy ──────────────────────────────────────────────────────────────

if (-not $SkipRedeploy) {
  Write-Step 3 5 "Trigger Vercel redeploy"
  Write-Host "  Env vars rammer kun nye deployments. Trigger redeploy nu? (Y/n)"
  $confirm = Read-Host
  if ($confirm -notmatch '^[nN]') {
    Write-Host "  -> Koerer 'vercel --prod'..." -ForegroundColor Cyan
    & vercel --prod
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  [ADVARSEL] vercel --prod returnerede exit $LASTEXITCODE - tjek manuelt" -ForegroundColor Yellow
    } else {
      Write-Host "  OK Redeploy trigget" -ForegroundColor Green
    }
  } else {
    Write-Host "  -- Springer redeploy over (du skal selv pushe en commit eller koere 'vercel --prod')" -ForegroundColor Gray
  }
} else {
  Write-Step 3 5 "Springer redeploy over (-SkipRedeploy)"
}

# ─── 4. Lokal smoke-test ──────────────────────────────────────────────────────

if (-not $SkipSmokeTest) {
  Write-Step 4 5 "Lokal smoke-test med prod-DSN"

  $env:SENTRY_DSN = $dsn
  try {
    & node $smokeScript
    $smokeExit = $LASTEXITCODE
  } finally {
    Remove-Item Env:SENTRY_DSN -ErrorAction SilentlyContinue
  }

  if ($smokeExit -ne 0) {
    Write-Host ""
    Write-Host "[FEJL] Smoke-test fejlede (exit: $smokeExit)" -ForegroundColor Red
    exit $smokeExit
  }
} else {
  Write-Step 4 5 "Springer smoke-test over (-SkipSmokeTest)"
}

# ─── 5. Verifikation ──────────────────────────────────────────────────────────

Write-Step 5 5 "Bekraeft i Sentry UI"
Write-Host "  Aabn Sentry -> Issues"
Write-Host "  Soeg:    cron:smoke-test"
Write-Host "  Find:    'Sentry smoke test - cron capture pattern verification'"
Write-Host ""
Write-Host "  Hvis event er der:    #348 + #614 kan lukkes (sig til, saa lukker AI dem via gh CLI)." -ForegroundColor Green
Write-Host "  Hvis IKKE:            tjek SENTRY_DSN korrekt + redeploy faerdig + giv det 30 sek." -ForegroundColor Yellow
Write-Host ""

Write-Banner "Faerdig - verificer nu i Sentry UI"
