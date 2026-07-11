# keep-awake.ps1
#
# Holder maskinen vågen under en natbølge — modvirker S0 Modern Standby.
# Natbølge 2026-07-03: `powercfg /change standby-timeout-ac 0` var IKKE nok på en
# S0 Low Power Idle-maskine; den sov alligevel ~01:15 og frøs hele fleet'et.
# SetThreadExecutionState(ES_SYSTEM_REQUIRED) holder systemet vågent så længe
# DENNE proces kører — kør scriptet i SIT EGET terminal-vindue under bølgen.
#
# Brug:
#   pwsh -File scripts/keep-awake.ps1              # holder vågen i 8 timer (default)
#   pwsh -File scripts/keep-awake.ps1 -Minutes 360 # 6 timer
#   Ctrl-C for at frigive før tid.
#
# Verificér med preflight: `powercfg /a`-linjen afslører om maskinen er S0
# (Standby S0 Low Power Idle) — det er dem der kan sove trods timeout=0.
# Refs docs/NIGHT_WAVE_RUNBOOK.md §Anti-hang.

param(
  [int]$Minutes = 480
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NwKeepAwake {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
'@

[uint32]$ES_CONTINUOUS       = [uint32]'0x80000000'  # hex-literal parses som negativ int32 i pwsh 7 → eksplicit uint32-konvertering
[uint32]$ES_SYSTEM_REQUIRED  = 0x00000001
$keepAwakeFlags = $ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED

$deadline = (Get-Date).AddMinutes($Minutes)
Write-Host "[keep-awake] Holder maskinen vågen indtil $($deadline.ToString('HH:mm')) ($Minutes min). Ctrl-C for at frigive." -ForegroundColor Green

try {
  while ((Get-Date) -lt $deadline) {
    # Re-assert hvert minut (billigt; robust hvis en anden proces nulstiller state).
    [void][NwKeepAwake]::SetThreadExecutionState($keepAwakeFlags)
    $left = [int]([math]::Ceiling(($deadline - (Get-Date)).TotalMinutes))
    Write-Host ("[keep-awake] vågen · {0} min tilbage · {1}" -f $left, (Get-Date).ToString('HH:mm:ss'))
    Start-Sleep -Seconds 60
  }
}
finally {
  # Frigiv: tillad normal sleep igen.
  [void][NwKeepAwake]::SetThreadExecutionState($ES_CONTINUOUS)
  Write-Host "[keep-awake] Frigivet — normal strømstyring genoptaget." -ForegroundColor Yellow
}
