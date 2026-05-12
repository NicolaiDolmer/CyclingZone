# install-user-hooks.ps1
#
# Skriver SessionStart + Stop hooks til ~/.claude/settings.json paa denne PC.
# Idempotent: bevarer eksisterende settings, tilfoejer kun cross-PC hooks hvis de mangler.
#
# Hooks:
#   SessionStart: 'git fetch --prune origin'                                 (cross-PC sync)
#   SessionStart: 'pwsh -File scripts/link-onedrive-context.ps1' (quiet)     (auto-relink OneDrive)
#   SessionStart: 'bash scripts/check-stale-branches.sh'                     (warn om gone-branches)
#   Stop:         'bash scripts/cross-pc-stop-check.sh'                      (warn om uncommitted)
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

if (-not $settings) { $settings = [PSCustomObject]@{} }
if (-not ($settings.PSObject.Properties.Name -contains "hooks")) {
  $settings | Add-Member -NotePropertyName "hooks" -NotePropertyValue ([PSCustomObject]@{}) -Force
}

function Add-Hook {
  param(
    [Parameter(Mandatory)] [string] $Event,
    [Parameter(Mandatory)] [string] $Command,
    [Parameter(Mandatory)] [string] $MatchPattern,
    [Parameter(Mandatory)] [string] $DisplayName
  )
  $newHook = [PSCustomObject]@{
    matcher = ""
    hooks   = @(
      [PSCustomObject]@{
        type    = "command"
        command = $Command
      }
    )
  }
  $existingProp = @($script:settings.hooks.PSObject.Properties | Where-Object { $_.Name -eq $Event })
  if ($existingProp.Count -eq 0) {
    $script:settings.hooks | Add-Member -NotePropertyName $Event -NotePropertyValue @($newHook) -Force
    Write-Host "Tilfoejet ${Event}: $DisplayName"
    return
  }
  $existing = @($script:settings.hooks.$Event)
  foreach ($entry in $existing) {
    foreach ($h in @($entry.hooks)) {
      if ($h.command -like $MatchPattern) {
        Write-Host "[skip] ${Event} ($DisplayName) findes allerede"
        return
      }
    }
  }
  $script:settings.hooks.$Event = @($existing + $newHook)
  Write-Host "Tilfoejet ${Event}: $DisplayName (bevarer eksisterende)"
}

# --- SessionStart hooks ---
Add-Hook -Event "SessionStart" `
  -Command "git fetch --prune origin 2>&1; git status -sb" `
  -MatchPattern "*git fetch*origin*" `
  -DisplayName "git fetch + status"

Add-Hook -Event "SessionStart" `
  -Command "pwsh -File scripts/link-onedrive-context.ps1 2>&1 | Where-Object { `$_ -match 'STOP|err|Exception' }" `
  -MatchPattern "*link-onedrive-context*" `
  -DisplayName "auto-relink OneDrive context"

Add-Hook -Event "SessionStart" `
  -Command "bash scripts/check-stale-branches.sh" `
  -MatchPattern "*check-stale-branches*" `
  -DisplayName "warn om gone-branches"

# --- Stop hooks ---
Add-Hook -Event "Stop" `
  -Command "bash scripts/cross-pc-stop-check.sh" `
  -MatchPattern "*cross-pc-stop-check*" `
  -DisplayName "cross-pc stop check"

# --- enabledPlugins ---
if (-not ($settings.PSObject.Properties.Name -contains "enabledPlugins")) {
  $settings | Add-Member -NotePropertyName "enabledPlugins" -NotePropertyValue ([PSCustomObject]@{}) -Force
}
$pluginsToEnable = @(
  "claude-code-setup@claude-plugins-official",
  "code-modernization@claude-plugins-official"
)
foreach ($plugin in $pluginsToEnable) {
  $existing = $settings.enabledPlugins.PSObject.Properties[$plugin]
  if ($existing -and $existing.Value -eq $true) {
    Write-Host "[skip] Plugin allerede aktiveret: $plugin"
  } else {
    $settings.enabledPlugins | Add-Member -NotePropertyName $plugin -NotePropertyValue $true -Force
    Write-Host "Aktiveret plugin: $plugin"
  }
}

# --- theme ---
if (-not ($settings.PSObject.Properties.Name -contains "theme")) {
  $settings | Add-Member -NotePropertyName "theme" -NotePropertyValue "auto" -Force
  Write-Host "Sat theme: auto"
}

# Skriv tilbage
$json = $settings | ConvertTo-Json -Depth 10
$json | Out-File -FilePath $settingsPath -Encoding utf8
Write-Host ""
Write-Host "Skrevet: $settingsPath"
Write-Host ""
Write-Host "Verificer indhold:"
Get-Content $settingsPath
