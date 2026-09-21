<#
.SYNOPSIS
  #5443 - den ekstraordinaere vaerdikoersel. Toerkoersel som standard.

.DESCRIPTION
  Ejer-knappen til det ene skridt hvor rytterværdierne flytter sig uden for
  soendagen (ejer-beslutning 3, 20/9 aften). Wrapperen goer tre ting: henter
  prod-credentials via Infisical, stiller det spoergsmaal der skal stilles, og
  kalder scriptet med de rigtige argumenter. Al logik - laase, backup, claim,
  rollback - bor i selve scriptet:

      backend/scripts/riderValueExtraordinaryRun5443.js

  Rækkefølgen for hele begivenheden staar i
  docs/runbooks/5443-ekstraordinaer-vaerdikoersel.md. Læs den foerst.

.PARAMETER Apply
  Koer rigtigt. Skriver til prod. Spoerger foerst.

.PARAMETER Rollback
  Rul tilbage fra backup-tabellen. Spoerger foerst.

.EXAMPLE
  pwsh -File scripts/run-value-event-5443.ps1
  Toerkoersel. Skriver intet.

.EXAMPLE
  pwsh -File scripts/run-value-event-5443.ps1 -Apply
#>
[CmdletBinding()]
param(
  [switch]$Apply,
  [switch]$Rollback
)

$ErrorActionPreference = "Stop"

if ($Apply -and $Rollback) {
  Write-Host "-Apply og -Rollback kan ikke kombineres." -ForegroundColor Red
  exit 1
}

# Repo-roden er mappen over scripts/. Saa virker knappen uanset hvor den klikkes fra.
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Script = Join-Path $RepoRoot "backend\scripts\riderValueExtraordinaryRun5443.js"

if (-not (Test-Path $Script)) {
  Write-Host "Kan ikke finde $Script" -ForegroundColor Red
  exit 1
}

$ApplyPhrase = "KOER VAERDISKIFTET 5443"
$RollbackPhrase = "RUL VAERDISKIFTET 5443 TILBAGE"

function Confirm-Step {
  param([string]$Question, [string]$Phrase)
  Write-Host ""
  Write-Host $Question -ForegroundColor Yellow
  Write-Host "Skriv saetningen praecis som den staar for at fortsaette (alt andet afbryder):" -ForegroundColor Yellow
  Write-Host "  $Phrase" -ForegroundColor Cyan
  $answer = Read-Host "> "
  if ($answer -ne $Phrase) {
    Write-Host "Afbrudt. Intet er aendret." -ForegroundColor Green
    exit 0
  }
}

Write-Host ""
Write-Host "#5443 - ekstraordinaer vaerdikoersel" -ForegroundColor Cyan
Write-Host "Repo: $RepoRoot"

$argsList = @()

if ($Rollback) {
  Write-Host "TILSTAND: ROLLBACK - lægger de sikrede vaerdier tilbage." -ForegroundColor Magenta
  Write-Host "Husk bagefter at saette app_config.rider_valuation_model tilbage til 'v4';" -ForegroundColor Magenta
  Write-Host "ellers skriver naeste soendagskoersel de nye vaerdier igen." -ForegroundColor Magenta
  Confirm-Step -Question "Vil du rulle vaerdiskiftet tilbage?" -Phrase $RollbackPhrase
  $env:VALUE_EVENT_5443_OWNER_ACK = "true"
  $argsList = @("--rollback", "--confirm", $RollbackPhrase)
}
elseif ($Apply) {
  Write-Host "TILSTAND: RIGTIG KOERSEL - hele populationens priser flytter sig." -ForegroundColor Magenta
  Write-Host "Tjek foer du fortsaetter:" -ForegroundColor Magenta
  Write-Host "  1. Spillerbeskeden er postet."
  Write-Host "  2. Du har set den friske toerkoersel og sagt god for tallene."
  Write-Host "  3. app_config.rider_valuation_model staar paa 'v5'."
  Confirm-Step -Question "Vil du koere vaerdiskiftet nu?" -Phrase $ApplyPhrase
  $env:VALUE_EVENT_5443_OWNER_ACK = "true"
  $argsList = @("--apply", "--confirm", $ApplyPhrase)
}
else {
  Write-Host "TILSTAND: TOERKOERSEL - der skrives intet." -ForegroundColor Green
}

Push-Location $RepoRoot
try {
  # Infisical leverer SUPABASE_URL/SUPABASE_SERVICE_KEY til processen. Vaerdierne
  # printes aldrig - hverken her eller af scriptet (hard rule om secrets).
  & infisical run --env=prod --silent -- node $Script @argsList
  $code = $LASTEXITCODE
}
finally {
  Pop-Location
  Remove-Item Env:\VALUE_EVENT_5443_OWNER_ACK -ErrorAction SilentlyContinue
}

Write-Host ""
if ($code -eq 0) {
  Write-Host "Faerdig (exit 0)." -ForegroundColor Green
} else {
  Write-Host "Scriptet stoppede (exit $code). Laes beskeden ovenfor - der er ikke skrevet noget medmindre det staar eksplicit." -ForegroundColor Red
}
exit $code
