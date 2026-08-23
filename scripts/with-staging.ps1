# with-staging.ps1 - koer en backend-kommando mod STAGING-branchen i stedet for prod.
#
# Mapper STAGING_SUPABASE_URL / STAGING_SERVICE_KEY / STAGING_DB_URL (Infisical env=prod)
# ind som SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_DB_URL for den ene kommando,
# saa alle eksisterende scripts (snapshot3459, salaryRecompute3645, mandateMigration3514,
# marketValueLevelCorrectionApply ...) kan generalproeves UAENDRET.
#
# Brug (fra repo-roden):
#   pwsh -File scripts/with-staging.ps1 -- node scripts/dev/salaryRecompute3645.mjs
#   pwsh -File scripts/with-staging.ps1 -Cwd backend -- node scripts/dev/mandateMigration3514.mjs --selvtest
#
# Sikkerhed: naegter at koere hvis STAGING_SUPABASE_URL mangler eller er identisk med prod-URL'en.
# Printer aldrig en secret-vaerdi; kun projekt-ref.

param(
  [string] $Cwd = "backend",
  [Parameter(ValueFromRemainingArguments = $true)] [string[]] $Command
)
$ErrorActionPreference = "Stop"
$repo = (git rev-parse --show-toplevel).Trim()
$dir = Join-Path $repo $Cwd
if ($Command.Count -gt 0 -and $Command[0] -eq "--") { $Command = $Command[1..($Command.Count - 1)] }
if (-not $Command -or $Command.Count -eq 0) { throw "Angiv kommandoen efter --" }
$joined = ($Command | ForEach-Object { if ($_ -match '\s') { "'" + $_ + "'" } else { $_ } }) -join " "

$inner = @"
function RefOf(`$u) { if (-not `$u) { return "" }; `$m = [regex]::Match(`$u, "https?://([a-z]{20})\."); if (`$m.Success) { `$m.Groups[1].Value } else { "ukendt" } }
if (-not `$env:STAGING_SUPABASE_URL -or -not `$env:STAGING_SERVICE_KEY) { Write-Host "[NO-GO] STAGING_SUPABASE_URL/STAGING_SERVICE_KEY mangler i Infisical (env=prod)"; exit 2 }
if (`$env:STAGING_SUPABASE_URL -eq `$env:SUPABASE_URL) { Write-Host "[NO-GO] STAGING_SUPABASE_URL er PROD - naegter"; exit 3 }
`$env:SUPABASE_URL = `$env:STAGING_SUPABASE_URL
`$env:SUPABASE_SERVICE_KEY = `$env:STAGING_SERVICE_KEY
if (`$env:STAGING_DB_URL) { `$env:SUPABASE_DB_URL = `$env:STAGING_DB_URL }
`$env:CZ_TARGET_ENV = "staging"
Write-Host ("[with-staging] target-ref=" + (RefOf `$env:SUPABASE_URL))
Set-Location '$dir'
$joined
exit `$LASTEXITCODE
"@
& infisical run --env=prod --silent -- pwsh -NoProfile -Command $inner
exit $LASTEXITCODE
