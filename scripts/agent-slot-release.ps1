# agent-slot-release.ps1
#
# Frigiver manuelt en plads i agent-spawn-registret som
# scripts/hooks/guard-agent-spawn.sh fylder (#5142).
#
# Hvornaar: et spor er reelt slut, men dets linje ligger stadig inden for
# 45-minutters-vinduet, saa hooken blokerer et legitimt nyt spawn. Registret er
# bevidst et vindue og ikke en total (se hookens header), saa dette script er
# undtagelsen, ikke den normale vej.
#
# Brug:
#   pwsh -File scripts/agent-slot-release.ps1            # fjern den AELDSTE linje
#   pwsh -File scripts/agent-slot-release.ps1 -Newest    # fjern den nyeste linje
#   pwsh -File scripts/agent-slot-release.ps1 -All       # toem registret
#   pwsh -File scripts/agent-slot-release.ps1 -Status    # vis hvad der ligger der
#
# Refs #5142.

param(
  [switch] $Newest,
  [switch] $All,
  [switch] $Status,
  [string] $RunDir = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $RunDir) {
  if ($env:CZ_AGENT_GUARD_RUN_DIR) {
    $RunDir = $env:CZ_AGENT_GUARD_RUN_DIR
  } else {
    $root = (& git rev-parse --show-toplevel 2>$null)
    if (-not $root) { [Console]::Error.WriteLine("agent-slot-release: ikke i et git-repo."); exit 2 }
    $root = $root.Trim().Replace('/', '\')
    $common = (& git -C $root rev-parse --git-common-dir 2>$null)
    if ($common) {
      $common = $common.Trim().Replace('/', '\')
      if (-not [System.IO.Path]::IsPathRooted($common)) {
        $common = [System.IO.Path]::GetFullPath((Join-Path $root $common))
      }
      $mainRepo = Split-Path -Parent $common
      if ($mainRepo -and (Test-Path $mainRepo)) { $root = $mainRepo }
    }
    $RunDir = Join-Path $root ".claude\run"
  }
}

$registry = Join-Path $RunDir "agent-slots.jsonl"
if (-not (Test-Path $registry)) {
  Write-Host "Registret findes ikke endnu: $registry (ingen spawns registreret)."
  exit 0
}

$lines = @(Get-Content -Path $registry -ErrorAction SilentlyContinue | Where-Object { $_.Trim() })

if ($Status) {
  Write-Host "=== agent-slots ($($lines.Count) linjer) ===" -ForegroundColor Cyan
  Write-Host "Fil: $registry"
  foreach ($l in $lines) { Write-Host "  $l" }
  exit 0
}

if ($lines.Count -eq 0) {
  Write-Host "Registret er allerede tomt."
  exit 0
}

if ($All) {
  Remove-Item -LiteralPath $registry -Force
  Write-Host "Registret toemt ($($lines.Count) linjer fjernet): $registry"
  exit 0
}

if ($Newest) {
  $removed = $lines[-1]
  $rest = @()
  if ($lines.Count -gt 1) { $rest = $lines[0..($lines.Count - 2)] }
} else {
  $removed = $lines[0]
  $rest = @()
  if ($lines.Count -gt 1) { $rest = $lines[1..($lines.Count - 1)] }
}

if ($rest.Count -eq 0) {
  Remove-Item -LiteralPath $registry -Force
} else {
  ($rest -join "`n") + "`n" | Out-File -FilePath $registry -Encoding utf8 -NoNewline
}

Write-Host "Fjernet: $removed"
Write-Host "Tilbage: $($rest.Count) linje(r) i $registry"
