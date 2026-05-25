# probe-vercel-keys.ps1
#
# Safe wrapper omkring `vercel env ls`. Printer KUN key-navne, ALDRIG values.
# Refs: #634 AC3.
#
# Brug:
#   pwsh -File scripts/probe-vercel-keys.ps1
#   pwsh -File scripts/probe-vercel-keys.ps1 -Environment production
#   pwsh -File scripts/probe-vercel-keys.ps1 -Filter SUPABASE
#
# Output (eksempel):
#   Vercel env vars (env: production) — 24 keys
#     SENTRY_AUTH_TOKEN (encrypted)
#     VITE_SENTRY_DSN (encrypted)
#     VITE_SUPABASE_ANON_KEY (encrypted)
#     ...

[CmdletBinding()]
param(
  [ValidateSet("production", "preview", "development")]
  [string]$Environment = "production",
  [string]$Filter = "",
  [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$vercelCmd = Get-Command vercel -ErrorAction SilentlyContinue
if (-not $vercelCmd) {
  Write-Error "vercel CLI not found. Install: npm i -g vercel"
  exit 1
}

# Auth check
$whoami = & vercel whoami 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Error "vercel not authenticated. Run: vercel login"
  exit 1
}

# Verify project linked (.vercel/project.json must exist)
$projectFile = Join-Path (Get-Location) ".vercel\project.json"
if (-not (Test-Path $projectFile)) {
  Write-Error "Vercel project not linked. Run: vercel link"
  exit 1
}

# Fetch env list. CRITICAL: `--format json` returnerer både key + value +
# metadata i samme JSON. Vi parse + projekt ONLY .key og .type. Values
# discarded fra memory ASAP.
$rawJson = $null
try {
  $rawJson = & vercel env ls $Environment --format json 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Error "vercel env ls failed (exit=$LASTEXITCODE)."
    exit 1
  }
} catch {
  Write-Error "vercel env ls error: $($_.Exception.Message)"
  exit 1
}

$entries = $null
try {
  $parsed = $rawJson | ConvertFrom-Json
  # Defensive: vercel sometimes wraps in {"envs": [...]} format; handle both
  if ($parsed.PSObject.Properties.Name -contains "envs") {
    $parsed = $parsed.envs
  }
  # Project ONLY key + type (encrypted/plain/system). Value field DISCARDED.
  $entries = $parsed | ForEach-Object {
    [PSCustomObject]@{
      Key  = $_.key
      Type = $_.type
    }
  } | Sort-Object Key
} catch {
  Write-Error "Failed to parse vercel env ls JSON. Output suppressed for safety."
  exit 1
} finally {
  $rawJson = $null
  $parsed = $null
}

# Optional filter
if ($Filter) {
  $entries = $entries | Where-Object { $_.Key -match $Filter }
}

# Output
if ($Json) {
  $entries | ConvertTo-Json -Compress
} else {
  Write-Host "Vercel env vars (env: $Environment) — $($entries.Count) keys"
  if ($Filter) { Write-Host "  filter: '$Filter'" }
  $entries | ForEach-Object { Write-Host "  $($_.Key) ($($_.Type))" }
}

exit 0
