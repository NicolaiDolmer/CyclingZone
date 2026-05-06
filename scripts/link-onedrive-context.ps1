# link-onedrive-context.ps1
#
# Skaber junction + hardlinks fra repo + Claude memory til OneDrive-context.
# Idempotent: skip hvis allerede linkede; advarer hvis OneDrive-context mangler filer.
#
# Sikkerhedsnet:
#   - Tjekker at OneDrive er sat (env:OneDrive)
#   - Tjekker at OneDrive-context er fuldt synket (filer er readable, ikke placeholders)
#   - Hash-sammenligner foer sletning af eksisterende filer (ingen tab af unikt indhold)
#   - Advarer hvis konflikter der skal loeses manuelt
#
# Brug:
#   pwsh -File scripts/link-onedrive-context.ps1
#   pwsh -File scripts/link-onedrive-context.ps1 -RepoRoot "D:\code\CZ"

param(
  [string]$RepoRoot = "C:\dev\CyclingZone"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Section($title) {
  Write-Host ""
  Write-Host "=== $title ===" -ForegroundColor Cyan
}

function Test-Readable($path) {
  try {
    [System.IO.File]::OpenRead($path).Close()
    return $true
  } catch {
    return $false
  }
}

# Cross-PS-version hardlink check: NTFS File ID er ens hvis to paths peger paa samme inode.
# Virker baade i Windows PowerShell 5.1 og PowerShell 7 (i modsaetning til $item.LinkType).
function Test-IsHardlinkOf($linkPath, $expectedTarget) {
  if (-not (Test-Path $linkPath)) { return $false }
  if (-not (Test-Path $expectedTarget)) { return $false }
  try {
    $a = & fsutil file queryfileid $linkPath 2>&1
    $b = & fsutil file queryfileid $expectedTarget 2>&1
    return ($a -eq $b)
  } catch {
    return $false
  }
}

# Idempotent hardlink-establishment for en enkelt fil.
# Returnerer 'skip', 'linked', 'sourceMissing', eller throw'er ved konflikt.
function Sync-HardLink {
  param(
    [Parameter(Mandatory)] [string] $Original,
    [Parameter(Mandatory)] [string] $SourceFile,
    [Parameter(Mandatory)] [string] $DisplayName
  )

  if (-not (Test-Path $SourceFile)) {
    Write-Host ("  [skip] Source mangler i OneDrive: {0}" -f $DisplayName) -ForegroundColor Yellow
    return
  }
  if (-not (Test-Readable $SourceFile)) {
    Write-Host ("  [skip] Source ikke fully synced (placeholder?): {0}" -f $DisplayName) -ForegroundColor Yellow
    return
  }

  if (Test-Path $Original) {
    if (Test-IsHardlinkOf $Original $SourceFile) {
      Write-Host ("  [skip] {0} allerede hardlinkede" -f $DisplayName)
      return
    }
    $hashMatches = $false
    try {
      $oh = (Get-FileHash $Original -Algorithm MD5).Hash
      $sh = (Get-FileHash $SourceFile -Algorithm MD5).Hash
      $hashMatches = ($oh -eq $sh)
    } catch {
      Write-Host ("  [warn] Kunne ikke hash {0}: {1}" -f $DisplayName, $_.Exception.Message)
    }
    if ($hashMatches) {
      Remove-Item $Original -Force
    } else {
      Write-Host ("  [STOP] Lokal {0} adskiller sig fra OneDrive - manuel kontrol kraevet" -f $DisplayName) -ForegroundColor Red
      Write-Host ("    lokal:    {0}" -f $Original)
      Write-Host ("    OneDrive: {0}" -f $SourceFile)
      throw "Manuel kontrol kraevet for at undgaa data-tab"
    }
  } else {
    $parent = Split-Path $Original -Parent
    if ($parent -and -not (Test-Path $parent)) {
      New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
  }

  New-Item -ItemType HardLink -Path $Original -Target $SourceFile | Out-Null
  Write-Host ("  [ok] {0}" -f $DisplayName)
}

# Junction kan ikke slettes med Remove-Item i NonInteractive PowerShell - brug rmdir
function Remove-Junction($path) {
  & cmd /c rmdir /Q "$path" 2>&1 | Out-Null
  if (Test-Path $path) {
    throw "Kunne ikke slette junction: $path"
  }
}

# --- 1. OneDrive-context tilgaengelig ---
Write-Section "Verificer OneDrive-context"

if (-not $env:OneDrive) {
  throw "OneDrive ikke konfigureret (env:OneDrive er tom). Installer/log ind paa OneDrive og prov igen."
}
$contextRoot = Join-Path $env:OneDrive "CyclingZone-context"
$memSource = Join-Path $contextRoot "memory"
$secSource = Join-Path $contextRoot "secrets"
$clSource = Join-Path $contextRoot "codex-local"

if (-not (Test-Path $contextRoot)) {
  throw "Mangler: $contextRoot. Vent paa at OneDrive synkroniserer (kan tage minutter), og koer scriptet igen."
}
if (-not (Test-Path $memSource)) { throw "Mangler memory: $memSource" }
if (-not (Test-Path $secSource)) { throw "Mangler secrets: $secSource" }

$memCount = (Get-ChildItem $memSource -File -ErrorAction SilentlyContinue).Count
$secCount = (Get-ChildItem $secSource -File -ErrorAction SilentlyContinue).Count
$clCount = if (Test-Path $clSource) { (Get-ChildItem $clSource -File -ErrorAction SilentlyContinue).Count } else { 0 }
Write-Host "  [ok] $contextRoot ($memCount memory-filer, $secCount secret-filer, $clCount codex-local-filer)"

# --- 2. Memory-junction ---
Write-Section "Memory junction"

# Claude Code encoder repo-pathen ved at erstatte BAADE : og \ med -
# F.eks. C:\dev\CyclingZone -> C--dev-CyclingZone
$encoded = $RepoRoot -replace '[:\\]','-'
$claudeProjects = Join-Path $env:USERPROFILE ".claude\projects"
$projectDir = Join-Path $claudeProjects $encoded
$memTarget = Join-Path $projectDir "memory"

if (-not (Test-Path $projectDir)) {
  New-Item -ItemType Directory -Path $projectDir -Force | Out-Null
  Write-Host "  Oprettet project-mappe: $projectDir"
}

$needLink = $true
if (Test-Path $memTarget) {
  $item = Get-Item $memTarget -Force
  $isJunction = ($item.LinkType -eq "Junction")
  $targetMatches = $false
  if ($isJunction -and $item.Target) {
    foreach ($t in @($item.Target)) {
      if ($t -eq $memSource) { $targetMatches = $true; break }
    }
  }

  if ($isJunction -and $targetMatches) {
    Write-Host "  [skip] Junction allerede paa plads -> $memSource"
    $needLink = $false
  } elseif ($isJunction) {
    Write-Host "  [warn] Junction peger forkert ($($item.Target -join ', ')). Genskaber..."
    Remove-Junction $memTarget
  } else {
    $existing = @(Get-ChildItem $memTarget -File -ErrorAction SilentlyContinue)
    if ($existing.Count -eq 0) {
      Remove-Item $memTarget -Recurse -Force
      Write-Host "  Tom memory-mappe slettet"
    } else {
      $extraFiles = @()
      $modifiedFiles = @()
      foreach ($f in $existing) {
        $oneDriveCounterpart = Join-Path $memSource $f.Name
        if (-not (Test-Path $oneDriveCounterpart)) {
          $extraFiles += $f.Name
        } else {
          $localHash = (Get-FileHash $f.FullName -Algorithm MD5).Hash
          $oneDriveHash = (Get-FileHash $oneDriveCounterpart -Algorithm MD5).Hash
          if ($localHash -ne $oneDriveHash) { $modifiedFiles += $f.Name }
        }
      }
      if ($extraFiles.Count -gt 0 -or $modifiedFiles.Count -gt 0) {
        Write-Host "  [STOP] Lokale memory-filer adskiller sig fra OneDrive:" -ForegroundColor Red
        if ($extraFiles.Count -gt 0)    { Write-Host ("    extra (kun lokalt):    " + ($extraFiles -join ', ')) }
        if ($modifiedFiles.Count -gt 0) { Write-Host ("    modified (afviger):    " + ($modifiedFiles -join ', ')) }
        Write-Host "  Flyt unikke filer til $memSource manuelt foer du koerer scriptet igen." -ForegroundColor Red
        throw "Manuel kontrol kraevet for at undgaa data-tab"
      }
      Remove-Item $memTarget -Recurse -Force
      Write-Host "  Lokale filer matcher OneDrive - slettet for at lave junction"
    }
  }
}

if ($needLink) {
  New-Item -ItemType Junction -Path $memTarget -Target $memSource | Out-Null
  Write-Host "  [ok] Junction: $memTarget -> $memSource"
}

# --- 3. Secret hardlinks ---
Write-Section "Secret hardlinks"

$secretPairs = @(
  @{ Path = "backend\.env";              Source = "backend.env" },
  @{ Path = "frontend\.env";             Source = "frontend.env" },
  @{ Path = "frontend\.env.production";  Source = "frontend.env.production" },
  @{ Path = ".mcp.json";                 Source = "mcp.json" }
)

foreach ($p in $secretPairs) {
  Sync-HardLink -Original (Join-Path $RepoRoot $p.Path) -SourceFile (Join-Path $secSource $p.Source) -DisplayName $p.Path
}

# --- 4. Codex-local hardlinks ---
Write-Section "Codex-local hardlinks"

if (Test-Path $clSource) {
  $codexPairs = @(
    @{ Path = ".codex.local\SUPABASE_CONTEXT.md";   Source = "SUPABASE_CONTEXT.md" },
    @{ Path = ".codex.local\supabase-readonly.env"; Source = "supabase-readonly.env" }
  )
  foreach ($p in $codexPairs) {
    Sync-HardLink -Original (Join-Path $RepoRoot $p.Path) -SourceFile (Join-Path $clSource $p.Source) -DisplayName $p.Path
  }
} else {
  Write-Host "  [skip] codex-local ikke i OneDrive endnu (valgfri)"
}

Write-Host ""
Write-Host "Faerdig. Memory + secrets + codex-local synces nu via OneDrive begge veje." -ForegroundColor Green
