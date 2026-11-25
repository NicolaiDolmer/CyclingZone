param([switch]$Worker, [switch]$DryRun)
$ErrorActionPreference = 'Stop'

$common = & git rev-parse --path-format=absolute --git-common-dir
if ($LASTEXITCODE -ne 0 -or -not $common) { exit 0 }
$root = Split-Path -Parent $common
if (-not $Worker) {
    $arguments = @('-NoProfile', '-File', ('"{0}"' -f $PSCommandPath), '-Worker')
    if ($DryRun) { $arguments += '-DryRun' }
    Start-Process -FilePath (Get-Command pwsh).Source -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden
    exit 0
}

$mutex = [Threading.Mutex]::new($false, 'Local\CyclingZone.CodexStartupMaintenance')
$locked = $false
try {
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { exit 0 }
    $runDir = Join-Path $root '.claude\run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    Start-Transcript -Path (Join-Path $runDir 'codex-startup-maintenance.log') | Out-Null
    try {
        if (-not $DryRun) {
            & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'codex-session-claim.ps1') -Mode prune -StaleHours 48
            if ($LASTEXITCODE -ne 0) { throw 'Claim cleanup failed.' }
        }
        $prune = Join-Path (Split-Path -Parent $PSScriptRoot) 'prune-merged-worktrees.ps1'
        & $prune -RepoRoot $root -SessionStart -Execute:(-not $DryRun)
    } finally {
        Stop-Transcript | Out-Null
    }
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
