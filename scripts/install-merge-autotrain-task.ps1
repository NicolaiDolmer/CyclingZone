# install-merge-autotrain-task.ps1: registrerer merge-auto-toget som Windows-planlagt opgave (#7654).
#
# Opgaven koerer `node scripts/merge-autotrain.mjs --log` hvert 20. minut fra
# hoved-checkoutet (den kalder selv scripts/merge-queue.ps1 for klare PR'er i
# en staaende kategori og goer intet, naar et tog allerede koerer). Dette
# script REGISTRERER kun opgaven; det koerer hverken toget eller nogen merge.
# Koeres paa PC1 af ejeren eller en session med ejerens go. Aldrig i CI.
#
#   pwsh -File scripts/install-merge-autotrain-task.ps1 -DryRun        # vis hvad der ville blive registreret
#   pwsh -File scripts/install-merge-autotrain-task.ps1                # registrer (eller opdater)
#   pwsh -File scripts/install-merge-autotrain-task.ps1 -TaskDryRun    # registrer, men toget koerer med --dry-run (proevekoersel)
#   pwsh -File scripts/install-merge-autotrain-task.ps1 -Unregister    # fjern opgaven igen
#
# Forudsaetninger: `gh auth status` er logget ind som brugeren, `node` og `pwsh`
# findes paa PATH, og DISCORD_OPS_WEBHOOK_URL er sat som bruger-miljoevariabel
# (ellers meldes alarmen kun i loggen .claude/run/merge-autotrain.log).
# Opgaven koerer kun naar brugeren er logget ind (gh-tokenet ligger i brugerens
# credential store) og aldrig to instanser ad gangen.

param(
  [string] $TaskName = 'CyclingZone merge-auto-tog',
  [string] $RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [int] $IntervalMinutes = 20,
  [switch] $TaskDryRun,
  [switch] $DryRun,
  [switch] $Unregister
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:CI) { Write-Host 'CI: merge-auto-toget registreres aldrig i CI.'; exit 0 }
if (-not $IsWindows) { Write-Host 'Kun Windows (Task Scheduler).'; exit 0 }

if ($Unregister) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    if ($DryRun) { Write-Host "DRY-RUN: ville fjerne opgaven '$TaskName'."; exit 0 }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Opgaven '$TaskName' er fjernet."
  } else {
    Write-Host "Opgaven '$TaskName' findes ikke."
  }
  exit 0
}

if ($IntervalMinutes -lt 5) { throw '-IntervalMinutes skal vaere mindst 5.' }

$RepoRoot = (Resolve-Path $RepoRoot).Path
$script = Join-Path $RepoRoot 'scripts\merge-autotrain.mjs'
if (-not (Test-Path $script)) { throw "Finder ikke $script (er -RepoRoot hoved-checkoutet?)" }

# Opgaven skal pege paa hoved-checkoutet, ikke et worktree der kan blive slettet.
$commonDir = (& git -C $RepoRoot rev-parse --path-format=absolute --git-common-dir 2>$null)
$mainRoot = if ($commonDir) { Split-Path -Parent ([string]$commonDir).Trim() } else { $null }
if ($mainRoot -and ((Resolve-Path $mainRoot).Path -ne $RepoRoot)) {
  Write-Host "ADVARSEL: $RepoRoot er et worktree. Brug hoved-checkoutet: -RepoRoot '$mainRoot'." -ForegroundColor Yellow
}

$node = (Get-Command node -ErrorAction SilentlyContinue)?.Source
$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue)?.Source
if (-not $node) { throw 'node findes ikke paa PATH.' }
if (-not $pwsh) { throw 'pwsh findes ikke paa PATH.' }

$nodeArgs = @("'$script'", '--log')
if ($TaskDryRun) { $nodeArgs += '--dry-run' }
# pwsh -WindowStyle Hidden: intet konsolvindue der blinker hvert 20. minut.
$command = "& '$node' $($nodeArgs -join ' ')"
$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -Command `"$command`""

if (-not [Environment]::GetEnvironmentVariable('DISCORD_OPS_WEBHOOK_URL', 'User')) {
  Write-Host 'BEMAERK: DISCORD_OPS_WEBHOOK_URL er ikke sat som bruger-miljoevariabel; alarmer skrives kun i loggen.' -ForegroundColor Yellow
}

Write-Host "Opgave:   $TaskName"
Write-Host "Interval: hvert $IntervalMinutes. minut$(if ($TaskDryRun) { ' (toget i --dry-run)' })"
Write-Host "Mappe:    $RepoRoot"
Write-Host "Kommando: $pwsh $arguments"
Write-Host "Log:      $(Join-Path $RepoRoot '.claude\run\merge-autotrain.log')"

if ($DryRun) { Write-Host 'DRY-RUN: intet registreret.'; exit 0 }

$action = New-ScheduledTaskAction -Execute $pwsh -Argument $arguments -WorkingDirectory $RepoRoot
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
# Et tog kan tage timer (CI paa main + deploy-verifikation); naeste koersel springes
# over imens (IgnoreNew), og en haengt koersel draebes efter 6 timer.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 6) `
  -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'CyclingZone #7654: merger klare PRer i staaende kategori via scripts/merge-queue.ps1 og melder ventende klare PRer i Discord-ops.' -Force | Out-Null

Write-Host "Registreret. Foerste koersel om ca. 1 minut. Fjern igen med -Unregister." -ForegroundColor Green
exit 0
