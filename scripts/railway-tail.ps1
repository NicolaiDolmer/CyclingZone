<#
.SYNOPSIS
  #203: Tail Railway-logs og grep for et givent pattern uden Railway-dashboard.

.DESCRIPTION
  Wrapper omkring `railway logs --json` med jq-style filtrering. Bruges af AI til
  at verificere runtime-effekter (fx [resolveProxyBids] failed eller
  [discord-dm:stdout]) efter smoke-test mod prod.

  Forudsætter Railway CLI installeret + login: https://docs.railway.app/guides/cli
  Windows-install:
    iwr -useb https://railway.app/install.ps1 | iex
    railway login
    cd C:\dev\CyclingZone\backend; railway link  # vælg cyclingzone-production

.PARAMETER Pattern
  Regex som logs filtreres på. Default: alt.

.PARAMETER SinceMinutes
  Hvor langt tilbage logs skal hentes. Default: 5.

.PARAMETER Service
  Railway-service-navn. Default: backend.

.PARAMETER Json
  Output rå JSON (ellers formaterede linjer).

.EXAMPLE
  pwsh -File scripts/railway-tail.ps1 -Pattern '\[resolveProxyBids\]' -SinceMinutes 10

.EXAMPLE
  pwsh -File scripts/railway-tail.ps1 -Pattern '\[discord-dm:stdout\]' -SinceMinutes 2
#>

[CmdletBinding()]
param(
    [string]$Pattern = ".*",
    [int]$SinceMinutes = 5,
    [string]$Service = "backend",
    [switch]$Json
)

$ErrorActionPreference = "Stop"

function Test-RailwayCli {
    $cmd = Get-Command railway -ErrorAction SilentlyContinue
    if ($null -eq $cmd) {
        Write-Error @"
Railway CLI er ikke installeret. Install:
  iwr -useb https://railway.app/install.ps1 | iex
  railway login
  cd C:\dev\CyclingZone\backend
  railway link  # vælg cyclingzone-production / backend
"@
        exit 2
    }
}

function Invoke-RailwayLogs {
    param([int]$Minutes, [string]$ServiceName)

    # Railway CLI v3 syntax: --service kan udelades hvis projektet kun har én service.
    # Vi prefererer eksplicit --service for tydelighed.
    $args = @("logs", "--service", $ServiceName, "--json")

    Write-Verbose "Kører: railway $($args -join ' ')"
    $raw = & railway @args 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "railway logs fejlede (exit $LASTEXITCODE):`n$raw"
        exit $LASTEXITCODE
    }
    return $raw
}

function Format-LogLine {
    param([Parameter(ValueFromPipeline=$true)]$Entry)
    process {
        try {
            $obj = $Entry | ConvertFrom-Json -ErrorAction Stop
            $ts = $obj.timestamp
            $msg = $obj.message
            "[$ts] $msg"
        } catch {
            $Entry  # ikke JSON — vis raw
        }
    }
}

# ── Main ──────────────────────────────────────────────────────────────────────

Test-RailwayCli

$cutoff = (Get-Date).AddMinutes(-$SinceMinutes)
$lines = Invoke-RailwayLogs -Minutes $SinceMinutes -ServiceName $Service

$matched = @()
foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }

    if ($Pattern -ne ".*" -and -not ($line -match $Pattern)) { continue }

    # Hvis JSON, tjek timestamp ≥ cutoff. Ellers behold linjen.
    try {
        $obj = $line | ConvertFrom-Json -ErrorAction Stop
        $ts = [DateTime]::Parse($obj.timestamp)
        if ($ts -lt $cutoff) { continue }
    } catch { }

    $matched += $line
}

if ($Json) {
    $matched | ForEach-Object { $_ }
} else {
    $matched | Format-LogLine
}

Write-Host ""
Write-Host "→ $($matched.Count) match(es) for pattern '$Pattern' siden $($cutoff.ToString('o'))"
exit 0
