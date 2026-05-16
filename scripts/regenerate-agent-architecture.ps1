#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Regenererer failure-mode-tabellen i docs/AGENT_ARCHITECTURE.md fra .claude/learnings/*.md.

.DESCRIPTION
  Scanner alle postmortems i .claude/learnings/, udtraekker dato (fra filnavn) + titel (fra H1)
  og bygger en sorteret tabel mellem markorer i docs/AGENT_ARCHITECTURE.md.

  Idempotent: no-op hvis intet er aendret.
  CI-mode: -Check returnerer exit 1 hvis tabel er ude af sync (uden at skrive filen).

.EXAMPLE
  pwsh -File scripts/regenerate-agent-architecture.ps1
  pwsh -File scripts/regenerate-agent-architecture.ps1 -Check

.NOTES
  Refs #387.
#>
[CmdletBinding()]
param(
    [switch]$Check
)

$ErrorActionPreference = 'Stop'

$repoRoot = (git rev-parse --show-toplevel).Trim()
$learningsDir = Join-Path $repoRoot '.claude/learnings'
$docPath = Join-Path $repoRoot 'docs/AGENT_ARCHITECTURE.md'
$beginMarker = '<!-- BEGIN FAILURE-MODES (auto-generated) -->'
$endMarker = '<!-- END FAILURE-MODES -->'

if (-not (Test-Path $docPath)) {
    Write-Error "Doc not found: $docPath"
    exit 2
}
if (-not (Test-Path $learningsDir)) {
    Write-Error "Learnings dir not found: $learningsDir"
    exit 2
}

function Get-LearningMeta {
    param([string]$Path)

    $name = [System.IO.Path]::GetFileNameWithoutExtension($Path)
    $dateMatch = [regex]::Match($name, '^(\d{4}-\d{2}-\d{2})')
    if (-not $dateMatch.Success) {
        return $null  # skip filer uden date-prefix
    }
    $date = $dateMatch.Value
    $slug = $name.Substring(11)

    $raw = Get-Content $Path -Raw -ErrorAction Stop

    # Find foerste H1
    $h1Match = [regex]::Match($raw, '(?m)^#\s+(.+?)\s*$')
    if ($h1Match.Success) {
        $title = $h1Match.Groups[1].Value.Trim()
    } else {
        $title = ($slug -replace '-', ' ')
    }

    # Strip eventuel "YYYY-MM-DD" + separator i starten af H1
    $title = $title -replace '^\d{4}-\d{2}-\d{2}\s*[:\-—–]\s*', ''
    $title = $title.Trim()

    # Escape pipe-tegn for markdown-tabel
    $title = $title -replace '\|', '\|'

    [PSCustomObject]@{
        Date = $date
        Slug = $slug
        Title = $title
        FileName = "$name.md"
    }
}

$learnings = Get-ChildItem -Path $learningsDir -Filter '*.md' -File |
    ForEach-Object { Get-LearningMeta -Path $_.FullName } |
    Where-Object { $_ -ne $null } |
    Sort-Object Date -Descending

# Byg ny sektion
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add($beginMarker)
$lines.Add('')
$lines.Add('| Dato | Læring (klik for postmortem) |')
$lines.Add('|---|---|')
foreach ($l in $learnings) {
    # Relativ sti fra docs/ til .claude/learnings/
    $link = "../.claude/learnings/$($l.FileName)"
    $lines.Add("| $($l.Date) | [$($l.Title)]($link) |")
}
$lines.Add('')
$lines.Add($endMarker)

$newSection = ($lines -join "`n")

# Erstat sektion i doc
$docContent = Get-Content $docPath -Raw
$pattern = '(?s)' + [regex]::Escape($beginMarker) + '.*?' + [regex]::Escape($endMarker)

if (-not [regex]::IsMatch($docContent, $pattern)) {
    Write-Error "Markers '$beginMarker' / '$endMarker' not found in $docPath"
    exit 2
}

# Brug MatchEvaluator for at undgaa $-substitution-fnidder
$evaluator = [System.Text.RegularExpressions.MatchEvaluator] { param($m) return $newSection }
$newContent = [regex]::Replace($docContent, $pattern, $evaluator)

$changed = ($newContent -ne $docContent)

if ($Check) {
    if ($changed) {
        Write-Output "OUT-OF-SYNC: AGENT_ARCHITECTURE.md failure-mode-tabel er ude af sync."
        Write-Output "Fix: pwsh -File scripts/regenerate-agent-architecture.ps1"
        exit 1
    }
    Write-Output "OK: failure-mode-tabel up-to-date ($($learnings.Count) entries)"
    exit 0
}

if ($changed) {
    Set-Content -Path $docPath -Value $newContent -NoNewline -Encoding UTF8
    Write-Output "Regenereret: $($learnings.Count) entries i $docPath"
} else {
    Write-Output "No-op: failure-mode-tabel allerede up-to-date ($($learnings.Count) entries)"
}
