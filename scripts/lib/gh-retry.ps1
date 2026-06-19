# gh-retry.ps1 — delt retry-wrapper for gh CLI-kald (PowerShell).
#
# Hvorfor: gh CLI rammer GitHub GraphQL med intermitterende HTTP 401
# (~40% af kald) under multiagent-natboelger hvor parallel-last er hoej
# og ingen ejer er vaagen til at koere 'gh auth refresh' (#1285). REST
# rammes sjaeldnere end GraphQL, men begge kan flake. Et enkelt retry
# med kort pause rydder typisk fejlen.
#
# Konvention: dot-source fra et andet script:
#   . (Join-Path $PSScriptRoot 'lib\gh-retry.ps1')
# og kald derefter Invoke-GhWithRetry. Spejler bash-varianten
# scripts/lib/gh-retry.sh (samme defaults: 5 forsoeg, 3s pause).
#
# Ren wrapper: aendrer ingen global state og laver ingen IO udover at
# kalde 'gh' med de givne argumenter.

function Invoke-GhWithRetry {
  # Koerer 'gh <args>' med retry paa ikke-nul exit (typisk 401-flake).
  # Returnerer gh's stdout (som strenge). Skriver gh's egen fejl-output
  # til host paa sidste mislykkede forsoeg. Kaster ved endelig fejl, saa
  # callere kan fange den — medmindre -TolerateFailure er sat, hvor den
  # i stedet returnerer $null og saetter $script-niveau exit-koden via
  # $LASTEXITCODE (uaendret fra sidste gh-kald).
  #
  # Eksempler:
  #   Invoke-GhWithRetry @('issue', 'comment', '42', '--body', 'hej')
  #   $login = Invoke-GhWithRetry @('api', 'graphql', '-f', 'query=query{viewer{login}}')
  [CmdletBinding()]
  param(
    [Parameter(Mandatory, Position = 0)]
    [string[]] $GhArgs,
    [int] $Attempts = 5,
    [int] $DelaySeconds = 3,
    [switch] $TolerateFailure
  )

  if ($Attempts -lt 1) { $Attempts = 1 }
  $lastOutput = $null

  for ($i = 1; $i -le $Attempts; $i++) {
    $lastOutput = & gh @GhArgs 2>&1
    if ($LASTEXITCODE -eq 0) {
      # Skil ren stdout fra evt. ErrorRecord-stoej fra 2>&1.
      return ($lastOutput | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] })
    }
    if ($i -lt $Attempts) {
      Write-Host "  [gh-retry] forsoeg $i/$Attempts fejlede (exit $LASTEXITCODE) — venter ${DelaySeconds}s..." -ForegroundColor Yellow
      Start-Sleep -Seconds $DelaySeconds
    }
  }

  if ($TolerateFailure) {
    Write-Host "  [gh-retry] alle $Attempts forsoeg fejlede — fortsaetter (TolerateFailure)." -ForegroundColor Yellow
    return $null
  }

  $detail = ($lastOutput | Out-String).Trim()
  throw "gh fejlede efter $Attempts forsoeg (sidste exit $LASTEXITCODE): gh $($GhArgs -join ' ')`n$detail"
}

function Test-GhGraphqlWithRetry {
  # Bekvemmelighed: prober gh GraphQL-viewer-endpointet med retry og
  # returnerer en [pscustomobject] med Ok ([bool]) + Attempt (foerste
  # vellykkede forsoegs-nummer, 0 hvis alle fejlede). Bruges af preflight
  # til at kalibrere 401-stoej uden at duplikere retry-loopet.
  [CmdletBinding()]
  param(
    [int] $Attempts = 5,
    [int] $DelaySeconds = 3
  )

  if ($Attempts -lt 1) { $Attempts = 1 }
  for ($i = 1; $i -le $Attempts; $i++) {
    & gh api graphql -f query='query{viewer{login}}' 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
      return [pscustomobject]@{ Ok = $true; Attempt = $i }
    }
    if ($i -lt $Attempts) { Start-Sleep -Seconds $DelaySeconds }
  }
  return [pscustomobject]@{ Ok = $false; Attempt = 0 }
}
