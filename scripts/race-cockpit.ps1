#!/usr/bin/env pwsh
# Race-engine cockpit — ét-kommando rerun (#1420).
#
# Regenererer race-dry-run-cockpit'en med simple knapper, skriver til en gitignored
# per-run-sti (backend/scripts/out/cockpit-<mix>-<seed>...html) og AUTO-ÅBNER den i
# standard-browseren. Read-only — rører intet i prod/DB.
#
#   pwsh -File scripts/race-cockpit.ps1                          # default-felt, seed 2026
#   pwsh -File scripts/race-cockpit.ps1 -Mix climb-heavy -Seed 7 -Roles
#   npm run race:cockpit                                         # = default-kørsel
#   npm run race:cockpit -- -Mix sprint-heavy -Condition         # knapper via npm
#
# Knapper:
#   -Seed <int>        styrer al tilfældighed (samme seed → identisk eksempel)
#   -Mix <preset>      rytter-blanding: default | random | sprint-heavy | climb-heavy | elite-dense | balanced
#   -Count <int>       feltstørrelse (default 800)
#   -Condition         tilsæt seeded form/træthed per rytter
#   -Roles             snake-draft hold + tildel kaptajn/hunter/helper-roller
[CmdletBinding()]
param(
  [int]$Seed = 2026,
  # NB: source of truth for preset-listen er backend/lib/fictionalRiderMixPresets.js;
  # ValidateSet her giver kun tab-completion + tidlig fejl. Node validerer også.
  [ValidateSet('default', 'random', 'sprint-heavy', 'climb-heavy', 'elite-dense', 'balanced')]
  [string]$Mix = 'default',
  [int]$Count = 800,
  [switch]$Condition,
  [switch]$Roles
)
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$dryRun = Join-Path $repoRoot 'backend/scripts/simulateSeasonDryRun.js'
if (-not (Test-Path $dryRun)) { throw "Finder ikke dry-run-scriptet: $dryRun" }

$nodeArgs = @($dryRun, "--seed=$Seed", "--count=$Count", "--mix=$Mix")
if ($Condition) { $nodeArgs += '--condition=random' }
if ($Roles) { $nodeArgs += '--roles' }

$tags = @()
if ($Condition) { $tags += 'condition' }
if ($Roles) { $tags += 'roles' }
$tagStr = if ($tags.Count) { ' + ' + ($tags -join ' + ') } else { '' }
Write-Host "🚴 race:cockpit — seed=$Seed mix=$Mix count=$Count$tagStr" -ForegroundColor Cyan

# EAP=Continue lokalt: en native-stderr-linje fra Node (fx deprecation-warning)
# skal IKKE kaste NativeCommandError under det merged 2>&1-capture.
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
Push-Location $repoRoot
try {
  [string[]]$output = & node @nodeArgs 2>&1
}
finally {
  Pop-Location
  $ErrorActionPreference = $prevEAP
}
$output | ForEach-Object { Write-Host $_ }

if ($LASTEXITCODE -ne 0) {
  Write-Warning "Motoren rapporterede brud (exit $LASTEXITCODE) — se output ovenfor. Cockpit åbnes alligevel."
}

# Find den printede cockpit-sti ("📄 HTML-cockpit: <sti>") og auto-åbn den.
$pathLine = $output | Select-String -Pattern 'HTML-cockpit:\s*(.+)$' | Select-Object -First 1
if ($pathLine) {
  $htmlPath = $pathLine.Matches[0].Groups[1].Value.Trim()
  if (Test-Path $htmlPath) {
    Write-Host "→ åbner $htmlPath" -ForegroundColor Green
    Invoke-Item $htmlPath
  }
  else {
    Write-Warning "Cockpit-sti ikke fundet på disk: $htmlPath"
  }
}
else {
  Write-Warning "Kunne ikke finde cockpit-stien i output."
}
