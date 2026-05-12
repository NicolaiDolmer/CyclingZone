# link-onedrive-context.ps1
#
# Skaber junction + hardlinks fra repo + Claude memory til OneDrive-context.
# SCOPE (efter #327 Infisical-migration): kun memory-junction og AI-context filer.
# Produktionskritiske secrets (.env, .mcp.json) styres nu via Infisical — se docs/decisions/secret-management-adr.md.
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
#   pwsh -File scripts/link-onedrive-context.ps1 -DryRun     # rapporter uden at skrive
#   pwsh -File scripts/link-onedrive-context.ps1 -RepoRoot "D:\code\CZ"

param(
  [string]$RepoRoot = "C:\dev\CyclingZone",
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Script:Conflicts = @()

function Add-Conflict([string]$category, [string]$details) {
  $Script:Conflicts += [PSCustomObject]@{ Category = $category; Details = $details }
}

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
# Returnerer 'skip', 'linked', 'sourceMissing'.
# I DryRun-mode skriver vi rapport uden at mutere filsystemet og uden at throw'e.
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
    if (-not $hashMatches) {
      $details = "{0}: lokal afviger fra OneDrive (lokal: {1}; OneDrive: {2})" -f $DisplayName, $Original, $SourceFile
      if ($DryRun) {
        Write-Host ("  [STOP-conflict] {0}" -f $details) -ForegroundColor Red
        Add-Conflict "hardlink" $details
        return
      }
      Write-Host ("  [STOP] Lokal {0} adskiller sig fra OneDrive - manuel kontrol kraevet" -f $DisplayName) -ForegroundColor Red
      Write-Host ("    lokal:    {0}" -f $Original)
      Write-Host ("    OneDrive: {0}" -f $SourceFile)
      throw "Manuel kontrol kraevet for at undgaa data-tab"
    }
    if ($DryRun) {
      Write-Host ("  [would-link] {0} (lokal hash matcher OneDrive; ville erstatte med hardlink)" -f $DisplayName) -ForegroundColor Cyan
      return
    }
    Remove-Item $Original -Force
  } else {
    $parent = Split-Path $Original -Parent
    if ($parent -and -not (Test-Path $parent)) {
      if ($DryRun) {
        Write-Host ("  [would-mkdir] {0}" -f $parent) -ForegroundColor Cyan
      } else {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
      }
    }
  }

  if ($DryRun) {
    Write-Host ("  [would-link] {0} -> {1}" -f $Original, $SourceFile) -ForegroundColor Cyan
    return
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
  Write-Host "  [info] OneDrive ikke konfigureret (env:OneDrive er tom). Skipper." -ForegroundColor Yellow
  exit 0
}
$contextRoot = Join-Path $env:OneDrive "CyclingZone-context"
$memSource = Join-Path $contextRoot "memory"
# $secSource (secrets/) brugt ikke længere — produktionskritiske secrets styres via Infisical (#327)
$clSource = Join-Path $contextRoot "codex-local"

if (-not (Test-Path $contextRoot)) {
  Write-Host "  [info] OneDrive-context ikke synket endnu: $contextRoot. Skipper." -ForegroundColor Yellow
  exit 0
}
if (-not (Test-Path $memSource)) {
  Write-Host "  [info] Mangler memory-mappe i OneDrive: $memSource. Skipper." -ForegroundColor Yellow
  exit 0
}
# secrets-mappe kræves ikke længere — produktionskritiske secrets styres via Infisical (#327)

$memCount = (Get-ChildItem $memSource -File -ErrorAction SilentlyContinue).Count
$clCount = if (Test-Path $clSource) { (Get-ChildItem $clSource -File -ErrorAction SilentlyContinue).Count } else { 0 }
$mode = if ($DryRun) { " [DRY-RUN]" } else { "" }
Write-Host "  [ok]$mode $contextRoot ($memCount memory-filer, $clCount codex-local-filer)"
Write-Host "  [info] Secrets-mappe haandteres ikke af dette script — produktionskritiske secrets styres via Infisical." -ForegroundColor Cyan

# --- 2. Memory-junction ---
Write-Section "Memory junction"

# Claude Code encoder repo-pathen ved at erstatte BAADE : og \ med -
# F.eks. C:\dev\CyclingZone -> C--dev-CyclingZone
$encoded = $RepoRoot -replace '[:\\]','-'
$claudeProjects = Join-Path $env:USERPROFILE ".claude\projects"
$projectDir = Join-Path $claudeProjects $encoded
$memTarget = Join-Path $projectDir "memory"

if (-not (Test-Path $projectDir)) {
  if ($DryRun) {
    Write-Host "  [would-mkdir] $projectDir" -ForegroundColor Cyan
  } else {
    New-Item -ItemType Directory -Path $projectDir -Force | Out-Null
    Write-Host "  Oprettet project-mappe: $projectDir"
  }
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
    if ($DryRun) {
      Write-Host ("  [would-relink] Junction peger forkert ({0}); ville genskabe -> $memSource" -f ($item.Target -join ', ')) -ForegroundColor Cyan
      $needLink = $false
    } else {
      Write-Host "  [warn] Junction peger forkert ($($item.Target -join ', ')). Genskaber..."
      Remove-Junction $memTarget
    }
  } else {
    $existing = @(Get-ChildItem $memTarget -File -ErrorAction SilentlyContinue)
    if ($existing.Count -eq 0) {
      if ($DryRun) {
        Write-Host "  [would-rmdir] Tom memory-mappe; ville slette og lave junction" -ForegroundColor Cyan
        $needLink = $false
      } else {
        Remove-Item $memTarget -Recurse -Force
        Write-Host "  Tom memory-mappe slettet"
      }
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
        $details = "Lokale memory-filer afviger fra OneDrive"
        if ($extraFiles.Count -gt 0)    { $details += " | extra: " + ($extraFiles -join ', ') }
        if ($modifiedFiles.Count -gt 0) { $details += " | modified: " + ($modifiedFiles -join ', ') }
        if ($DryRun) {
          Write-Host ("  [STOP-conflict] {0}" -f $details) -ForegroundColor Red
          Add-Conflict "memory-junction" $details
          $needLink = $false
        } else {
          Write-Host "  [STOP] $details" -ForegroundColor Red
          Write-Host "  Flyt unikke filer til $memSource manuelt foer du koerer scriptet igen." -ForegroundColor Red
          throw "Manuel kontrol kraevet for at undgaa data-tab"
        }
      } else {
        if ($DryRun) {
          Write-Host "  [would-rmdir] Lokale filer matcher OneDrive; ville slette og lave junction" -ForegroundColor Cyan
          $needLink = $false
        } else {
          Remove-Item $memTarget -Recurse -Force
          Write-Host "  Lokale filer matcher OneDrive - slettet for at lave junction"
        }
      }
    }
  }
}

if ($needLink) {
  if ($DryRun) {
    Write-Host "  [would-link] Junction: $memTarget -> $memSource" -ForegroundColor Cyan
  } else {
    New-Item -ItemType Junction -Path $memTarget -Target $memSource | Out-Null
    Write-Host "  [ok] Junction: $memTarget -> $memSource"
  }
}

# --- DEPRECATED: Secret hardlinks (#327) ---
# backend/.env, frontend/.env, frontend/.env.production og .mcp.json haandteres IKKE laengere
# af dette script. Produktionskritiske secrets styres nu via Infisical.
# Lokal .env-filer genereres ved: infisical export --env=dev > backend/.env
# Se docs/decisions/secret-management-adr.md og docs/CROSS_PC_SETUP.md for bootstrap-vejledning.

# --- 3. Codex-local hardlinks ---
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

# --- 4. Slut-rapport ---
Write-Host ""
if ($DryRun) {
  if ($Script:Conflicts.Count -gt 0) {
    Write-Host ("{0} konflikt(er) fundet, fix dem foer du koerer uden -DryRun:" -f $Script:Conflicts.Count) -ForegroundColor Red
    foreach ($c in $Script:Conflicts) {
      Write-Host ("  - [{0}] {1}" -f $c.Category, $c.Details) -ForegroundColor Red
    }
    exit 1
  }
  Write-Host "Dry-run faerdig - ingen konflikter. Koer uden -DryRun for at anvende aendringer." -ForegroundColor Green
} else {
  Write-Host "Faerdig. Memory + codex-local AI-context synces via OneDrive. Produktionssecrets: brug Infisical." -ForegroundColor Green
}
