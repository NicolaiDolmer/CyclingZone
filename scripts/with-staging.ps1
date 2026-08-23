# with-staging.ps1 - koer en backend-kommando mod STAGING-branchen i stedet for prod.
#
# Henter branchens credentials fra Supabase CLI (scripts/lib/Staging-Env.ps1) og mapper dem
# ind som SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_DB_URL for den ene kommando, saa alle
# eksisterende scripts (snapshot3459, salaryRecompute3645, mandateMigration3514,
# marketValueLevelCorrectionApply ...) kan generalproeves UAENDRET. Oevrige prod-secrets
# (Discord, Resend ...) injiceres fra Infisical env=prod som normalt.
#
# Brug (fra repo-roden):
#   pwsh -File scripts/with-staging.ps1 -- node scripts/dev/salaryRecompute3645.mjs
#   pwsh -File scripts/with-staging.ps1 -Cwd backend -- node scripts/dev/mandateMigration3514.mjs --selvtest
#   pwsh -File scripts/with-staging.ps1 -BranchName anden-branch -- node ...
#
# Sikkerhed: naegter hvis branchen er prod-projektet. Printer aldrig en secret-vaerdi.

param(
  [string] $BranchName = "staging-cutover",
  [string] $Cwd = "backend",
  [Parameter(ValueFromRemainingArguments = $true)] [string[]] $Command
)
$ErrorActionPreference = "Stop"
$repo = (git rev-parse --show-toplevel).Trim()
. (Join-Path $repo "scripts/lib/Staging-Env.ps1")
$dir = Join-Path $repo $Cwd
if ($Command.Count -gt 0 -and $Command[0] -eq "--") { $Command = $Command[1..($Command.Count - 1)] }
if (-not $Command -or $Command.Count -eq 0) { throw "Angiv kommandoen efter --" }
$joined = ($Command | ForEach-Object { if ($_ -match '\s') { "'" + $_ + "'" } else { $_ } }) -join " "

Set-StagingEnv -BranchName $BranchName

$inner = @"
`$env:SUPABASE_URL = `$env:STAGING_SUPABASE_URL
`$env:SUPABASE_SERVICE_KEY = `$env:STAGING_SERVICE_KEY
`$env:SUPABASE_DB_URL = `$env:STAGING_DB_URL
`$env:CZ_TARGET_ENV = "staging"
# Live-guard (#3961): staging maa ALDRIG poste til prod-Discord/Resend/Sentry. Alle udgaaende noegler blankes.
foreach (`$k in @("DISCORD_BOT_TOKEN","DISCORD_TOKEN","DISCORD_WEBHOOK_URL","DISCORD_FEEDBACK_WEBHOOK_URL","DISCORD_FORUM_WEBHOOK_URL","DISCORD_TEST_CHANNEL_WEBHOOK_URL","DISCORD_DM_TARGET","RESEND_API_KEY","SENTRY_DSN")) { Remove-Item -ErrorAction SilentlyContinue "Env:`$k" }
`$env:SENTRY_ENVIRONMENT = "staging"
Write-Host "[with-staging] target-ref=`$env:STAGING_REF"
Set-Location '$dir'
$joined
exit `$LASTEXITCODE
"@
& infisical run --env=prod --silent -- pwsh -NoProfile -Command $inner
exit $LASTEXITCODE
