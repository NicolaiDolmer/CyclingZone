# install-user-hooks.ps1
#
# Skriver SessionStart + PreToolUse + Stop hooks til ~/.claude/settings.json paa denne PC.
# Idempotent: bevarer eksisterende settings, tilfoejer kun cross-PC hooks hvis de mangler.
#
# Hooks:
#   PreToolUse:   'bash scripts/hooks/protect-claude-process.sh'             (block self-kill)
#   SessionStart: 'bash scripts/hooks/cycling-manager-cleanup.sh'            (worktree self-heal)
#   SessionStart: 'git fetch --prune origin'                                 (cross-PC sync)
#   SessionStart: 'pwsh -File scripts/link-onedrive-context.ps1' (quiet)     (auto-relink OneDrive)
#   SessionStart: 'bash scripts/check-stale-branches.sh'                     (warn om gone-branches)
#   Stop:         'bash scripts/cross-pc-stop-check.sh'                      (warn om uncommitted)
#
# Hooks bruger repo-relative paths (scripts/hooks/*.sh). De fires med CWD =
# projekt-root naar Claude Code starter i CyclingZone-repoet. Hvis du starter
# Claude Code udenfor repoet vil hookene silently no-op.
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

# --- Migration (#385): fjern legacy combined matchers ---
# Claude Code's matcher-parser haandterer ikke regex-alternation
# (fx "Bash|PowerShell"). Hooks med pipe i matcher fyrer ikke.
# Strip dem her saa Add-Hook kan tilfoeje split-versioner uden duplikater.
foreach ($eventName in @("PreToolUse", "PostToolUse")) {
  $eventProp = @($settings.hooks.PSObject.Properties | Where-Object { $_.Name -eq $eventName })
  if ($eventProp.Count -eq 0) { continue }
  $entries = @($settings.hooks.$eventName)
  $filtered = @()
  foreach ($entry in $entries) {
    $entryMatcher = if ($entry.PSObject.Properties.Name -contains 'matcher') { $entry.matcher } else { "" }
    if ($entryMatcher -match '\|') {
      Write-Host "[migrate] ${eventName}: fjernet legacy combined matcher='$entryMatcher' (#385 splittes til separate entries)"
      continue
    }
    $filtered += $entry
  }
  $settings.hooks.$eventName = @($filtered)
}

function Add-Hook {
  param(
    [Parameter(Mandatory)] [string] $Event,
    [Parameter(Mandatory)] [string] $Command,
    [Parameter(Mandatory)] [string] $MatchPattern,
    [Parameter(Mandatory)] [string] $DisplayName,
    [string] $Matcher = "",
    [int] $Timeout = 0
  )
  $hookCmd = [ordered]@{
    type    = "command"
    command = $Command
  }
  if ($Timeout -gt 0) { $hookCmd["timeout"] = $Timeout }
  $newHook = [PSCustomObject]@{
    matcher = $Matcher
    hooks   = @([PSCustomObject]$hookCmd)
  }
  $existingProp = @($script:settings.hooks.PSObject.Properties | Where-Object { $_.Name -eq $Event })
  if ($existingProp.Count -eq 0) {
    $script:settings.hooks | Add-Member -NotePropertyName $Event -NotePropertyValue @($newHook) -Force
    Write-Host "Tilfoejet ${Event}: $DisplayName"
    return
  }
  # Eksisterende hooks: skelne mellem (a) eksakt match -> skip, (b) pattern-match
  # med wrong-user hardcoded path -> replace (forward-guard fra #522: cross-PC
  # session efterlod /c/Users/<other>/ paths som denne logik tidligere
  # skippede over), og (c) pattern-match med anden command -> bevare (user
  # customization). Hardcoded current-user paths (/c/Users/$env:USERNAME/)
  # behandles ogsaa som wrong: hook-commands skal vaere repo-relative.
  $existing = @($script:settings.hooks.$Event)
  foreach ($entry in $existing) {
    # Matcher-aware idempotency (#385): split-hooks deler command men har
    # forskellig matcher. Skip kun hvis BAADE command OG matcher er ens.
    $entryMatcher = if ($entry.PSObject.Properties.Name -contains 'matcher') { $entry.matcher } else { "" }
    $entryHooks = @($entry.hooks)
    for ($i = 0; $i -lt $entryHooks.Count; $i++) {
      $h = $entryHooks[$i]
      if ($h.command -eq $Command -and $entryMatcher -eq $Matcher) {
        Write-Host "[skip] ${Event} ($DisplayName) findes allerede (matcher='$Matcher')"
        return
      }
      if ($h.command -like $MatchPattern -and $entryMatcher -eq $Matcher) {
        if ($h.command -match '/c/Users/[A-Za-z0-9_.-]+/') {
          $oldCmd = $h.command
          $h.command = $Command
          if ($Timeout -gt 0) {
            if ($h.PSObject.Properties.Name -contains 'timeout') {
              $h.timeout = $Timeout
            } else {
              $h | Add-Member -NotePropertyName 'timeout' -NotePropertyValue $Timeout -Force
            }
          }
          Write-Host "[replace] ${Event} ($DisplayName): wrong-user-path erstattet"
          Write-Host "          old: $oldCmd"
          Write-Host "          new: $Command"
          return
        }
        Write-Host "[skip] ${Event} ($DisplayName): pattern-match men custom command, bevarer"
        return
      }
    }
  }
  $script:settings.hooks.$Event = @($existing + $newHook)
  Write-Host "Tilfoejet ${Event}: $DisplayName (bevarer eksisterende)"
}

# --- PreToolUse hooks ---
# Matcher SKAL splittes per tool (#385): Claude Code's matcher-parser haandterer
# ikke regex-alternation "Bash|PowerShell" — hooks fyrer ikke. Derfor 2 entries.
Add-Hook -Event "PreToolUse" `
  -Command "bash scripts/hooks/protect-claude-process.sh" `
  -MatchPattern "*protect-claude-process*" `
  -DisplayName "block self-kill (Bash)" `
  -Matcher "Bash" `
  -Timeout 5

Add-Hook -Event "PreToolUse" `
  -Command "bash scripts/hooks/protect-claude-process.sh" `
  -MatchPattern "*protect-claude-process*" `
  -DisplayName "block self-kill (PowerShell)" `
  -Matcher "PowerShell" `
  -Timeout 5

# --- SessionStart hooks ---
Add-Hook -Event "SessionStart" `
  -Command "bash scripts/hooks/cycling-manager-cleanup.sh" `
  -MatchPattern "*cycling-manager-cleanup*" `
  -DisplayName "worktree self-heal (cycling-manager-cleanup)" `
  -Timeout 10

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
# Plugin defaults: kun tilfoejet hvis key MANGLER. Eksisterende value (true/false)
# respekteres altid — brugeren kan eksplicit disable plugins uden at scriptet
# overwriter det (fx code-modernization disabled per #382 token-besparelse).
$pluginDefaults = @{
  "claude-code-setup@claude-plugins-official" = $true
}
foreach ($plugin in $pluginDefaults.Keys) {
  $existing = $settings.enabledPlugins.PSObject.Properties[$plugin]
  if ($existing) {
    Write-Host "[skip] Plugin allerede konfigureret: $plugin = $($existing.Value)"
  } else {
    $settings.enabledPlugins | Add-Member -NotePropertyName $plugin -NotePropertyValue $pluginDefaults[$plugin] -Force
    Write-Host "Tilfoejet plugin (default=$($pluginDefaults[$plugin])): $plugin"
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
