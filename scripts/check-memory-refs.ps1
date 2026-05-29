#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Forward-guard mod memory-konsoliderings-regression: fanger tabte issue-refs
  (#N) og fil-pegepinde ((*.md)) i memory-dir under en konsolidering.

.DESCRIPTION
  Baggrund (#605 P0.3 / #743, 2026-05-29): under memory-konsolidering omskrev
  agenten ved en fejl project_slice07_complete.md tyndere og tabte
  follow-up-referencerne #239/#240. Fanget af manuel verifikation — men kun
  ved held. Dette script gør checket mekanisk:

    1. -Snapshot  : gem per-fil sæt af #N-refs + (*.md)-pegepinde til en
                    baseline-JSON FØR du konsoliderer.
    2. (konsolidér memory som normalt)
    3. -Verify    : sammenlign nuværende state mod baseline. Rapportér enhver
                    ref der FANDTES før men er VÆK nu, per fil.

  Et tabt ref er ikke altid en fejl (bevidst merge/retire er OK), men det skal
  være et BEVIDST valg — scriptet tvinger det frem i lyset i stedet for at lade
  det ske usynligt.

  Bemærk: memory-dir er typisk en symlink til OneDrive (ikke git-tracked), så
  git-diff fanger IKKE disse tab. Derfor dette dedikerede script.

.PARAMETER Snapshot
  Gem baseline.

.PARAMETER Verify
  Sammenlign mod baseline.

.PARAMETER MemoryDir
  Sti til memory-dir. Default: $env:USERPROFILE\.claude\projects\C--Dev-CyclingZone\memory

.PARAMETER BaselinePath
  Sti til baseline-JSON. Default: <repo>\docs\metrics\memory-refs-snapshot.json

.EXAMPLE
  pwsh -File scripts/check-memory-refs.ps1 -Snapshot
  # ... konsolidér memory ...
  pwsh -File scripts/check-memory-refs.ps1 -Verify
#>
[CmdletBinding()]
param(
  [switch]$Snapshot,
  [switch]$Verify,
  [string]$MemoryDir,
  [string]$BaselinePath
)

$ErrorActionPreference = "Stop"

if (-not $Snapshot -and -not $Verify) {
  Write-Host "Brug: -Snapshot (foer konsolidering) eller -Verify (efter)." -ForegroundColor Yellow
  exit 2
}

# --- Resolve paths ---------------------------------------------------------
if (-not $MemoryDir) {
  $MemoryDir = Join-Path $env:USERPROFILE ".claude\projects\C--Dev-CyclingZone\memory"
}
if (-not (Test-Path $MemoryDir)) {
  Write-Host "FAIL: memory-dir ikke fundet: $MemoryDir" -ForegroundColor Red
  exit 2
}

if (-not $BaselinePath) {
  $repoRoot = (& git rev-parse --show-toplevel 2>$null)
  if (-not $repoRoot) { $repoRoot = (Get-Location).Path }
  $BaselinePath = Join-Path $repoRoot "docs\metrics\memory-refs-snapshot.json"
}

# --- Extract refs per file -------------------------------------------------
function Get-RefMap {
  param([string]$dir)
  $map = @{}
  $files = Get-ChildItem -Path $dir -Filter "*.md" -File -ErrorAction SilentlyContinue
  foreach ($f in $files) {
    $text = Get-Content -Path $f.FullName -Raw -ErrorAction SilentlyContinue
    if ($null -eq $text) { $text = "" }

    # Issue/PR-refs: #123 (mindst 2 cifre for at undgaa stoej som "#1 punkt")
    $issues = [regex]::Matches($text, '#\d{2,}') | ForEach-Object { $_.Value }

    # Fil-pegepinde: (noget.md) — interne memory-links
    $links = [regex]::Matches($text, '\(([A-Za-z0-9_\-]+\.md)\)') | ForEach-Object { $_.Groups[1].Value }

    $refs = @($issues) + @($links) | Sort-Object -Unique
    $map[$f.Name] = @($refs)
  }
  return $map
}

$current = Get-RefMap -dir $MemoryDir

# --- Snapshot mode ---------------------------------------------------------
if ($Snapshot) {
  $out = [ordered]@{
    generated  = (Get-Date -Format "o")
    memory_dir = $MemoryDir
    file_count = $current.Keys.Count
    refs       = $current
  }
  $dir = Split-Path $BaselinePath -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $out | ConvertTo-Json -Depth 6 | Set-Content -Path $BaselinePath -Encoding UTF8
  $totalRefs = ($current.Values | ForEach-Object { $_.Count } | Measure-Object -Sum).Sum
  Write-Host "Snapshot gemt: $BaselinePath" -ForegroundColor Green
  Write-Host "  $($current.Keys.Count) filer, $totalRefs refs i alt." -ForegroundColor Green
  exit 0
}

# --- Verify mode -----------------------------------------------------------
if ($Verify) {
  if (-not (Test-Path $BaselinePath)) {
    Write-Host "FAIL: ingen baseline. Koer -Snapshot foerst: $BaselinePath" -ForegroundColor Red
    exit 2
  }
  $base = Get-Content -Path $BaselinePath -Raw | ConvertFrom-Json

  $lostTotal = 0
  $deletedFiles = @()
  $report = @()

  foreach ($fname in ($base.refs.PSObject.Properties.Name)) {
    $before = @($base.refs.$fname)
    if (-not $current.ContainsKey($fname)) {
      # Filen er slettet helt — det er typisk bevidst (retire), men flag refs den bar.
      if ($before.Count -gt 0) {
        $deletedFiles += [pscustomobject]@{ file = $fname; carried = $before }
      } else {
        $deletedFiles += [pscustomobject]@{ file = $fname; carried = @() }
      }
      continue
    }
    $after = @($current[$fname])
    $lost = $before | Where-Object { $after -notcontains $_ }
    if ($lost.Count -gt 0) {
      $lostTotal += $lost.Count
      $report += [pscustomobject]@{ file = $fname; lost = @($lost) }
    }
  }

  Write-Host "=== Memory-ref verifikation ===" -ForegroundColor Cyan
  Write-Host "Baseline: $($base.generated)  ($($base.file_count) filer)"
  Write-Host ""

  if ($report.Count -eq 0 -and $deletedFiles.Count -eq 0) {
    Write-Host "OK: ingen refs tabt, ingen filer slettet. Konsolidering bevarede alle #N + pegepinde." -ForegroundColor Green
    exit 0
  }

  if ($deletedFiles.Count -gt 0) {
    Write-Host "SLETTEDE FILER (bekraeft at retire var bevidst):" -ForegroundColor Yellow
    foreach ($d in $deletedFiles) {
      $c = if ($d.carried.Count -gt 0) { " (bar refs: " + ($d.carried -join ", ") + ")" } else { "" }
      Write-Host "  - $($d.file)$c" -ForegroundColor Yellow
    }
    Write-Host ""
  }

  if ($report.Count -gt 0) {
    Write-Host "TABTE REFS i bevarede filer (REGRESSION-RISIKO — verificer hver):" -ForegroundColor Red
    foreach ($r in $report) {
      Write-Host "  - $($r.file): tabte " -NoNewline -ForegroundColor Red
      Write-Host ($r.lost -join ", ") -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Hvis et tab er BEVIDST: OK, fortsaet. Hvis ikke: gendan ref'en foer commit." -ForegroundColor Yellow
    exit 1
  }

  # Kun slettede filer, ingen in-file tab.
  exit 0
}
