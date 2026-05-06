# install-user-hooks.ps1
#
# Skriver SessionStart + Stop hooks til ~/.claude/settings.json paa denne PC.
# Idempotent: bevarer eksisterende settings, tilfoejer kun cross-PC hooks hvis de mangler.
#
# Hooks:
#   SessionStart: 'git fetch --prune origin' for at se om denne PC er bagud
#   Stop:         scripts/cross-pc-stop-check.sh advarer om uncommitted/unpushed work
#
# Brug: pwsh -File scripts/install-user-hooks.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
$claudeDir = Split-Path -Parent $settingsPath

if (-not (Test-Path $claudeDir)) {
  New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
  Write-Host "Oprettet: $claudeDir"
}

# Laes eksisterende settings hvis de findes
$settings = $null
if (Test-Path $settingsPath) {
  Write-Host "Laeser eksisterende settings: $settingsPath"
  $raw = Get-Content $settingsPath -Raw
  if (-not [string]::IsNullOrWhiteSpace($raw)) {
    try {
      $settings = $raw | ConvertFrom-Json
    } catch {
      throw "Kunne ikke parse $settingsPath som JSON. Fix manuelt foer du korer scriptet."
    }
  }
}

if (-not $settings) {
  $settings = [PSCustomObject]@{}
}

# Tilfoj 'hooks' hvis det mangler
if (-not ($settings.PSObject.Properties.Name -contains "hooks")) {
  $settings | Add-Member -NotePropertyName "hooks" -NotePropertyValue ([PSCustomObject]@{}) -Force
}

# --- SessionStart hook ---
$sessionStartCmd = "git fetch --prune origin 2>&1; git status -sb"
$sessionStartHook = [PSCustomObject]@{
  matcher = ""
  hooks   = @(
    [PSCustomObject]@{
      type    = "command"
      command = $sessionStartCmd
    }
  )
}

$existingSessionStart = @($settings.hooks.PSObject.Properties | Where-Object { $_.Name -eq "SessionStart" })
if ($existingSessionStart.Count -eq 0) {
  $settings.hooks | Add-Member -NotePropertyName "SessionStart" -NotePropertyValue @($sessionStartHook) -Force
  Write-Host "Tilfoejet SessionStart hook"
} else {
  $existing = @($settings.hooks.SessionStart)
  $hasOurHook = $false
  foreach ($entry in $existing) {
    foreach ($h in @($entry.hooks)) {
      if ($h.command -like "*git fetch*origin*") { $hasOurHook = $true; break }
    }
    if ($hasOurHook) { break }
  }
  if ($hasOurHook) {
    Write-Host "[skip] SessionStart hook med 'git fetch origin' findes allerede"
  } else {
    $settings.hooks.SessionStart = @($existing + $sessionStartHook)
    Write-Host "Tilfoejet SessionStart hook (bevarer eksisterende)"
  }
}

# --- Stop hook ---
$stopCmd = "bash scripts/cross-pc-stop-check.sh"
$stopHook = [PSCustomObject]@{
  matcher = ""
  hooks   = @(
    [PSCustomObject]@{
      type    = "command"
      command = $stopCmd
    }
  )
}

$existingStop = @($settings.hooks.PSObject.Properties | Where-Object { $_.Name -eq "Stop" })
if ($existingStop.Count -eq 0) {
  $settings.hooks | Add-Member -NotePropertyName "Stop" -NotePropertyValue @($stopHook) -Force
  Write-Host "Tilfoejet Stop hook"
} else {
  $existing = @($settings.hooks.Stop)
  $hasOurHook = $false
  foreach ($entry in $existing) {
    foreach ($h in @($entry.hooks)) {
      if ($h.command -like "*cross-pc-stop-check*") { $hasOurHook = $true; break }
    }
    if ($hasOurHook) { break }
  }
  if ($hasOurHook) {
    Write-Host "[skip] Stop hook med cross-pc-stop-check.sh findes allerede"
  } else {
    $settings.hooks.Stop = @($existing + $stopHook)
    Write-Host "Tilfoejet Stop hook (bevarer eksisterende)"
  }
}

# Skriv tilbage
$json = $settings | ConvertTo-Json -Depth 10
$json | Out-File -FilePath $settingsPath -Encoding utf8
Write-Host ""
Write-Host "Skrevet: $settingsPath"
Write-Host ""
Write-Host "Verificer indhold:"
Get-Content $settingsPath
