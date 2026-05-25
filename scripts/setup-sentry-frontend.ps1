#requires -Version 5.1
<#
.SYNOPSIS
  Setup frontend Sentry env vars + source-map upload secrets i Vercel prod (#348 resten).

.DESCRIPTION
  Idempotent driver der saetter:
    - VITE_SENTRY_DSN                  (frontend runtime DSN, embedded i JS bundle)
    - VITE_SENTRY_ENVIRONMENT          (production)
    - VITE_SENTRY_TRACES_SAMPLE_RATE   (0.1 = 10% trace-sampling, billig)
    - VITE_SENTRY_REPLAY_SAMPLE_RATE   (0 = ingen session-replay default)
    - VITE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE (0.1 = 10% session-replay paa fejl)
    - SENTRY_AUTH_TOKEN                (source-map upload, secure-promptes)
    - SENTRY_ORG                       (cycling-zone)
    - SENTRY_PROJECT                   (cyclingzone)

  Trigger derefter vercel --prod redeploy. Frontend Sentry kraever PROD-build for
  at fyre (se frontend/src/lib/sentry.jsx: ENABLED = import.meta.env.PROD).

  Backend DSN-setup gores separat via:
    railway variables --service CyclingZone --set "SENTRY_DSN=https://..."

.PARAMETER SkipRedeploy
  Sat env vars uden at trigge redeploy. Du skal selv pushe en commit eller koere 'vercel --prod'.

.PARAMETER OverwriteExisting
  Overskriv eksisterende env vars uden at spoerge.

.PARAMETER Dsn
  VITE_SENTRY_DSN value. Hvis ikke angivet, laeses fra $env:VITE_SENTRY_DSN
  (hvis sat), ellers promptes der for det. DSN er public-by-design (embedded
  i frontend bundle), saa ingen secure-prompt — men hardcodes ALDRIG i scripts
  (jf. #620 / #634, hvor en hardcoded DSN-default leakede til transcript).

.EXAMPLE
  pwsh -File scripts/setup-sentry-frontend.ps1

.EXAMPLE
  pwsh -File scripts/setup-sentry-frontend.ps1 -SkipRedeploy

.EXAMPLE
  $env:VITE_SENTRY_DSN = "https://<key>@<host>.ingest.sentry.io/<id>"
  pwsh -File scripts/setup-sentry-frontend.ps1
#>

param(
  [switch]$SkipRedeploy,
  [switch]$OverwriteExisting,
  [string]$Dsn
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

Write-Banner "Frontend Sentry setup (#348 resten)"

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

# ─── 1. Saml DSN ──────────────────────────────────────────────────────────────

Write-Step 1 4 "Hent / bekraeft Sentry DSN"

if (-not $Dsn) {
  if ($env:VITE_SENTRY_DSN) {
    $Dsn = $env:VITE_SENTRY_DSN
    Write-Host "  Bruger VITE_SENTRY_DSN fra environment." -ForegroundColor Gray
  } else {
    Write-Host "  DSN er public-by-design (embedded i frontend bundle) - men hardcodes IKKE i scripts."
    Write-Host "  Find DSN i Sentry UI: Settings -> Projects -> cyclingzone -> Client Keys (DSN)"
    Write-Host "  (eller saet `$env:VITE_SENTRY_DSN foer du koerer scriptet)"
    Write-Host ""
    $Dsn = Read-Host "  Paste DSN her"
  }
}

if (-not $Dsn) {
  Write-Host "[FEJL] Tom DSN - afbryder" -ForegroundColor Red
  exit 1
}

if ($Dsn -notmatch '^https://\w+@[\w.]+\.sentry\.io/\d+$') {
  Write-Host "[FEJL] DSN format ser forkert ud. Forventet:" -ForegroundColor Red
  Write-Host "       https://<publicKey>@<host>.sentry.io/<projectId>" -ForegroundColor Yellow
  exit 1
}

Write-Host "  OK DSN format valid ($($Dsn.Substring(0, 25))...)" -ForegroundColor Green

# ─── 2. Saml auth token ───────────────────────────────────────────────────────

Write-Step 2 4 "Sentry Auth Token (source-maps)"
Write-Host "  Token kraever scopes: project:read + project:releases + org:read"
Write-Host "  Opret paa: https://cycling-zone.sentry.io/settings/auth-tokens/"
Write-Host ""

$authToken = Read-SecureValue "Paste Sentry Auth Token her (input skjules)"

if (-not $authToken) {
  Write-Host "[FEJL] Tom token - afbryder" -ForegroundColor Red
  exit 1
}

if ($authToken -notmatch '^sntry[a-z]_') {
  Write-Host "[ADVARSEL] Token format ser uvant ud (forventet praefix: sntrys_ eller sntryu_)" -ForegroundColor Yellow
  $proceed = Read-Host "  Fortsaet alligevel? (y/N)"
  if ($proceed -notmatch '^[yY]') { exit 1 }
}

Write-Host "  OK Token modtaget ($($authToken.Length) chars)" -ForegroundColor Green

# ─── 3. Vercel env vars ───────────────────────────────────────────────────────

Write-Step 3 4 "Saet Vercel prod env vars"

# Frontend runtime vars
Set-VercelEnv -Name "VITE_SENTRY_DSN"                          -Value $Dsn
Set-VercelEnv -Name "VITE_SENTRY_ENVIRONMENT"                  -Value "production"
Set-VercelEnv -Name "VITE_SENTRY_TRACES_SAMPLE_RATE"           -Value "0.1"
Set-VercelEnv -Name "VITE_SENTRY_REPLAY_SAMPLE_RATE"           -Value "0"
Set-VercelEnv -Name "VITE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE"  -Value "0.1"

# Build-time source-map upload vars
Set-VercelEnv -Name "SENTRY_AUTH_TOKEN" -Value $authToken
Set-VercelEnv -Name "SENTRY_ORG"        -Value "cycling-zone"
Set-VercelEnv -Name "SENTRY_PROJECT"    -Value "cyclingzone"

Write-Host ""
Write-Host "  OK Env vars sat (8 stk)" -ForegroundColor Green

# ─── 4. Redeploy ──────────────────────────────────────────────────────────────

if (-not $SkipRedeploy) {
  Write-Step 4 4 "Trigger Vercel redeploy"
  Write-Host "  Env vars rammer kun nye builds. Trigger redeploy nu? (Y/n)"
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
  Write-Step 4 4 "Springer redeploy over (-SkipRedeploy)"
}

# ─── Faerdig ──────────────────────────────────────────────────────────────────

Write-Banner "Faerdig - naeste skridt"
Write-Host "  Naar redeploy er gennem:"
Write-Host "  1. Aabn https://cycling-zone.vercel.app/?sentry-test=1 (URL-trigger merges af AI separat)"
Write-Host "  2. AI verificerer event i Sentry MCP"
Write-Host "  3. AI fjerner trigger + commenterer paa #348"
Write-Host ""
