# cross-pc-forensic-audit.ps1
#
# Scanner for lokal-only AI-state som ikke kan ses fra anden PC.
# Exit-code: 0 = clean, 1 = fund (skal handles), 2 = setup-fejl.
#
# Brug:
#   pwsh -File scripts/cross-pc-forensic-audit.ps1
#   pwsh -File scripts/cross-pc-forensic-audit.ps1 -Json     # maskine-laesbar
#   pwsh -File scripts/cross-pc-forensic-audit.ps1 -Strict   # fail ogsaa paa warnings
#   pwsh -File scripts/cross-pc-forensic-audit.ps1 -AutoFix  # auto-cleanup .codex.local/
#
# -AutoFix opfoersel (forward-guard fra #522):
#   - stale-ephemeral (>1h gamle commit-msg/pr-body buffers): slettes ubetinget
#   - local-only-content: filename parsed for issue/PR-nummer; hvis matching
#     GitHub issue/PR findes via 'gh', slettes filen; ellers beholdes finding.
#   - hardcoded-user-path, codex-global-*, manus-*, git-*: roeres ikke
#     (kraever manuelt fix eller install-user-hooks.ps1 re-run).
#
# Hvad scriptet kigger efter:
#   1. .codex.local/ — filer udenfor whitelisten (ephemerals OK, persistent indhold IKKE)
#   2. ~/.codex/AGENTS.md — non-empty og ikke junctioned til OneDrive
#   3. ~/.codex/memories/ — non-empty og ikke junctioned til OneDrive
#   4. ~/.manus/ — indhold udenfor logs/
#   5. Uncommitted/unpushed state (samme som stop-check, men inkluderet for completeness)

param(
  [switch]$Json,
  [switch]$Strict,
  [switch]$AutoFix,
  [string]$RepoRoot = "C:\dev\CyclingZone"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$findings = @()

# Cross-PS-version hardlink check: pwsh 7 returnerer tom LinkType for hardlinks paa Windows.
# fsutil hardlink list giver alle paths der peger paa samme inode (>1 path = hardlinkede).
# Samme problem haandteres i link-onedrive-context.ps1 via fsutil file queryfileid.
function Test-IsHardlink($path) {
  try {
    $links = @(& fsutil hardlink list $path 2>$null)
    return $links.Count -gt 1
  } catch {
    return $false
  }
}

function Add-Finding {
  param(
    [Parameter(Mandatory)] [ValidateSet("error","warn")] [string] $Severity,
    [Parameter(Mandatory)] [string] $Category,
    [Parameter(Mandatory)] [string] $Path,
    [Parameter(Mandatory)] [string] $Message,
    [string] $Fix
  )
  $script:findings += [PSCustomObject]@{
    severity = $Severity
    category = $Category
    path = $Path
    message = $Message
    fix = $Fix
  }
}

# Filename -> issue/PR refs. Bruges af -AutoFix til at verificere GitHub-state
# foer .codex.local/-filer slettes. Patterns matcher historiske agent-naming:
#   issue-481-kickoff-comment.md     -> issue#481
#   pr-366-body.md / pr366-body.md   -> pr#366
#   pr-body-449-517.md               -> pr#449 + pr#517
#   comment-449.md                   -> any#449 (issue eller PR)
#   549-audit-comment.md             -> any#549
# Filer uden parsbart nummer (fx 'issue-body-brand-identity.md') returneres
# som tomt array -> finding beholdes og rapporteres til agent.
function Get-FilenameRefs {
  param([string] $Name)
  $refs = @()
  if ($Name -match '^issue-(\d+)') {
    $refs += [PSCustomObject]@{ type = 'issue'; number = [int]$matches[1] }
    return $refs
  }
  if ($Name -match '^pr-body-(\d+)(?:-(\d+))?') {
    $refs += [PSCustomObject]@{ type = 'pr'; number = [int]$matches[1] }
    if ($matches.Count -gt 2 -and $matches[2]) {
      $refs += [PSCustomObject]@{ type = 'pr'; number = [int]$matches[2] }
    }
    return $refs
  }
  if ($Name -match '^pr-?(\d+)') {
    $refs += [PSCustomObject]@{ type = 'pr'; number = [int]$matches[1] }
    return $refs
  }
  if ($Name -match '^comment-(\d+)') {
    $refs += [PSCustomObject]@{ type = 'any'; number = [int]$matches[1] }
    return $refs
  }
  if ($Name -match '^(\d+)-') {
    $refs += [PSCustomObject]@{ type = 'any'; number = [int]$matches[1] }
    return $refs
  }
  return $refs
}

# Verify a GitHub ref exists. gh issue/pr view returnerer exit 0 hvis fundet,
# !=0 hvis ikke. PR-numre er ogsaa "issues" i GitHub-API, saa 'any' tjekker
# baade issue og pr endpoints (forste hit vinder).
function Test-GitHubRefExists {
  param(
    [Parameter(Mandatory)] [int] $Number,
    [Parameter(Mandatory)] [ValidateSet('issue','pr','any')] [string] $Type
  )
  if ($Type -eq 'issue' -or $Type -eq 'any') {
    & gh issue view $Number --json number 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { return $true }
  }
  if ($Type -eq 'pr' -or $Type -eq 'any') {
    & gh pr view $Number --json number 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { return $true }
  }
  return $false
}

# --- 1. .codex.local whitelist enforcement ---
# Ephemerals der maa vaere lokale. Alt andet skal til GitHub eller OneDrive.
$codexLocalWhitelist = @(
  "SESSION_CONTEXT.md",
  "SUPABASE_CONTEXT.md",
  "supabase-readonly.env",
  "preflight-state.json"
)
# Pattern-baserede ephemerals (kortlivede buffers)
$codexLocalEphemeralPatterns = @(
  '^commit-msg.*\.txt$',
  '^commit-\d+\.txt$',
  '^commitmsg-.*\.txt$',
  '^pr\d+-body\.md$',
  '^pr-body-.*\.md$'
)

$codexLocalDir = Join-Path $RepoRoot ".codex.local"
if (Test-Path $codexLocalDir) {
  $items = Get-ChildItem $codexLocalDir -Recurse -File -ErrorAction SilentlyContinue
  foreach ($item in $items) {
    $rel = $item.FullName.Substring($codexLocalDir.Length + 1) -replace '\\','/'
    $name = $item.Name

    if ($codexLocalWhitelist -contains $name) { continue }

    $isEphemeral = $false
    foreach ($pat in $codexLocalEphemeralPatterns) {
      if ($name -match $pat) { $isEphemeral = $true; break }
    }
    if ($isEphemeral) {
      # Buffer over 1 time gammel? Sandsynligvis glemt.
      if ($item.LastWriteTime -lt (Get-Date).AddHours(-1)) {
        Add-Finding -Severity "warn" -Category "stale-ephemeral" -Path ".codex.local/$rel" `
          -Message "Ephemeral-buffer aeldre end 1 time (LastWrite=$($item.LastWriteTime))" `
          -Fix "Slet filen hvis du ikke skal bruge den: Remove-Item '$($item.FullName)'"
      }
      continue
    }

    # Ikke-whitelistet, ikke ephemeral = persistent indhold der er stuck lokalt.
    Add-Finding -Severity "error" -Category "local-only-content" -Path ".codex.local/$rel" `
      -Message "Persistent indhold i .codex.local/ er usynligt for anden PC" `
      -Fix "Promovér til GitHub (gh issue/pr create --body-file) eller OneDrive-context, derefter slet"
  }
}

# --- 2. ~/.codex/AGENTS.md ---
$codexAgents = Join-Path $env:USERPROFILE ".codex\AGENTS.md"
if (Test-Path $codexAgents) {
  $size = (Get-Item $codexAgents).Length
  if ($size -gt 0) {
    $item = Get-Item $codexAgents -Force
    # LinkType er upaalidelig i pwsh 7 (returnerer tom for hardlinks) - brug fsutil-fallback.
    $isHardlink = Test-IsHardlink $codexAgents
    $isSymlink = $item.LinkType -eq "SymbolicLink"
    if (-not ($isHardlink -or $isSymlink)) {
      Add-Finding -Severity "error" -Category "codex-global-config" -Path $codexAgents `
        -Message "~/.codex/AGENTS.md har indhold ($size bytes) men er ikke linket til OneDrive" `
        -Fix "Flyt indhold til repo-root AGENTS.md (delt) eller hardlink til ~/OneDrive/CyclingZone-context/codex-memories/AGENTS.md eller codex-local/AGENTS.md"
    }
  }
}

# --- 3. ~/.codex/memories/ ---
$codexMem = Join-Path $env:USERPROFILE ".codex\memories"
if (Test-Path $codexMem) {
  $memItem = Get-Item $codexMem -Force
  $isJunction = $memItem.LinkType -eq "Junction" -or $memItem.LinkType -eq "SymbolicLink"
  $contents = @(Get-ChildItem $codexMem -Recurse -File -ErrorAction SilentlyContinue)
  if (-not $isJunction -and $contents.Count -gt 0) {
    Add-Finding -Severity "error" -Category "codex-global-memory" -Path $codexMem `
      -Message "~/.codex/memories/ har $($contents.Count) fil(er) men er ikke junctioned til OneDrive" `
      -Fix "Kor: pwsh -File scripts/link-onedrive-context.ps1 (efter at have flyttet indhold til ~/OneDrive/CyclingZone-context/codex-memories/)"
  }
}

# --- 4. ~/.manus/ udenfor logs/ ---
$manus = Join-Path $env:USERPROFILE ".manus"
if (Test-Path $manus) {
  $entries = Get-ChildItem $manus -Force -ErrorAction SilentlyContinue
  foreach ($e in $entries) {
    if ($e.Name -eq "logs") { continue }
    if ($e.PSIsContainer) {
      $hasContent = @(Get-ChildItem $e.FullName -Recurse -File -ErrorAction SilentlyContinue).Count -gt 0
      if ($hasContent) {
        Add-Finding -Severity "warn" -Category "manus-local" -Path $e.FullName `
          -Message "Manus-mappe '$($e.Name)' har indhold der maaske ikke synces" `
          -Fix "Verificér om indholdet skal til OneDrive (CyclingZone-Manus noter) eller GitHub"
      }
    } else {
      Add-Finding -Severity "warn" -Category "manus-local" -Path $e.FullName `
        -Message "Manus-fil '$($e.Name)' ligger lokalt" `
        -Fix "Verificér om filen skal til OneDrive eller GitHub"
    }
  }
}

# --- 5b. Hard-coded user paths in hooks + settings ---
# Forward-guard fra #383: any `/c/Users/<name>/` reference in ~/.claude/settings.json
# or scripts/hooks/*.sh breaks cross-PC reproducibility — fails on the other PC
# whose USERPROFILE name differs (ndmh3 vs emmas). Comments are excluded.
$pathPattern = '/c/Users/[A-Za-z0-9_.-]+/'

$claudeSettings = Join-Path $env:USERPROFILE ".claude\settings.json"
if (Test-Path $claudeSettings) {
  $content = Get-Content $claudeSettings -Raw -ErrorAction SilentlyContinue
  if ($content -and $content -match $pathPattern) {
    $matchValue = ([regex]::Match($content, $pathPattern)).Value
    Add-Finding -Severity "error" -Category "hardcoded-user-path" -Path $claudeSettings `
      -Message "Hardcoded user path '$matchValue' i ~/.claude/settings.json — vil fejle paa anden PC" `
      -Fix "Refactor til repo-relative path (fx 'bash scripts/hooks/X.sh'); kor 'pwsh -File scripts/install-user-hooks.ps1' for idempotent re-install"
  }
}

$hooksDir = Join-Path $RepoRoot "scripts\hooks"
if (Test-Path $hooksDir) {
  $hookFiles = Get-ChildItem $hooksDir -Filter "*.sh" -File -ErrorAction SilentlyContinue
  foreach ($f in $hookFiles) {
    $lines = Get-Content $f.FullName -ErrorAction SilentlyContinue
    $lineNo = 0
    foreach ($line in $lines) {
      $lineNo++
      # Skip comment-only lines (bash shebang or # comments after optional whitespace).
      if ($line -match '^\s*#') { continue }
      if ($line -match $pathPattern) {
        $matchValue = ([regex]::Match($line, $pathPattern)).Value
        Add-Finding -Severity "error" -Category "hardcoded-user-path" -Path "$($f.FullName):$lineNo" `
          -Message "Hardcoded user path '$matchValue' i hook-script linje $lineNo — vil fejle paa anden PC" `
          -Fix "Erstat med git-baseret detection (fx 'git rev-parse --show-toplevel') eller relative path"
        break
      }
    }
  }
}

# --- 5. Git: uncommitted / unpushed ---
Push-Location $RepoRoot
try {
  $porcelain = git status --porcelain 2>$null
  if ($porcelain) {
    $count = ($porcelain -split "`n").Count
    Add-Finding -Severity "warn" -Category "git-uncommitted" -Path $RepoRoot `
      -Message "$count uncommitted aendring(er)" `
      -Fix "git add + git commit + git push (eller stash hvis bevidst pause)"
  }
  $upstream = git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
  if ($upstream) {
    $ahead = (git rev-list --count "@{u}..HEAD" 2>$null) -as [int]
    if ($ahead -gt 0) {
      $branch = git rev-parse --abbrev-ref HEAD 2>$null
      Add-Finding -Severity "warn" -Category "git-unpushed" -Path $RepoRoot `
        -Message "$branch er $ahead commit(s) ahead af $upstream" `
        -Fix "git push"
    }
  }
} finally {
  Pop-Location
}

# --- AutoFix: process resolvable findings before output ---
$autoFixApplied = @()
$autoFixSkipped = @()

if ($AutoFix) {
  $ghAvailable = $null -ne (Get-Command gh -ErrorAction SilentlyContinue)
  $remainingFindings = @()

  foreach ($f in $findings) {
    $handled = $false

    if ($f.category -eq 'stale-ephemeral') {
      $fullPath = Join-Path $RepoRoot ($f.path -replace '/', '\')
      try {
        Remove-Item -LiteralPath $fullPath -Force -ErrorAction Stop
        $autoFixApplied += [PSCustomObject]@{
          path = $f.path
          reason = 'stale-ephemeral >1h, auto-deleted'
        }
        $handled = $true
      } catch {
        $autoFixSkipped += [PSCustomObject]@{
          path = $f.path
          reason = "delete failed: $($_.Exception.Message)"
        }
      }
    }
    elseif ($f.category -eq 'local-only-content') {
      if (-not $ghAvailable) {
        $autoFixSkipped += [PSCustomObject]@{
          path = $f.path
          reason = 'gh CLI ikke tilgaengelig; kan ikke verificere GitHub-state'
        }
      } else {
        $fileName = Split-Path -Leaf $f.path
        $refs = @(Get-FilenameRefs -Name $fileName)
        if ($refs.Count -eq 0) {
          $autoFixSkipped += [PSCustomObject]@{
            path = $f.path
            reason = 'ingen issue/PR-nummer i filename; kan ikke verificere'
          }
        } else {
          $allExist = $true
          $missing = @()
          foreach ($ref in $refs) {
            if (-not (Test-GitHubRefExists -Number $ref.number -Type $ref.type)) {
              $allExist = $false
              $missing += "$($ref.type)#$($ref.number)"
            }
          }
          if ($allExist) {
            $fullPath = Join-Path $RepoRoot ($f.path -replace '/', '\')
            try {
              Remove-Item -LiteralPath $fullPath -Force -ErrorAction Stop
              $refsList = ($refs | ForEach-Object { "$($_.type)#$($_.number)" }) -join ', '
              $autoFixApplied += [PSCustomObject]@{
                path = $f.path
                reason = "GitHub-state verificeret ($refsList), auto-deleted"
              }
              $handled = $true
            } catch {
              $autoFixSkipped += [PSCustomObject]@{
                path = $f.path
                reason = "delete failed: $($_.Exception.Message)"
              }
            }
          } else {
            $autoFixSkipped += [PSCustomObject]@{
              path = $f.path
              reason = "GitHub-state ikke fundet for: $($missing -join ', ')"
            }
          }
        }
      }
    }

    if (-not $handled) { $remainingFindings += $f }
  }

  $findings = $remainingFindings
}

# --- Output ---
$errors = @($findings | Where-Object { $_.severity -eq "error" })
$warns  = @($findings | Where-Object { $_.severity -eq "warn" })

if ($Json) {
  $result = [PSCustomObject]@{
    timestamp = (Get-Date).ToString("o")
    errors = $errors.Count
    warnings = $warns.Count
    findings = $findings
  }
  if ($AutoFix) {
    $result | Add-Member -NotePropertyName autoFix -NotePropertyValue ([PSCustomObject]@{
      applied = $autoFixApplied
      skipped = $autoFixSkipped
    }) -Force
  }
  $result | ConvertTo-Json -Depth 5
} else {
  if ($AutoFix -and ($autoFixApplied.Count -gt 0 -or $autoFixSkipped.Count -gt 0)) {
    Write-Host ""
    Write-Host "AutoFix: $($autoFixApplied.Count) auto-rettet, $($autoFixSkipped.Count) sprunget over" -ForegroundColor Cyan
    foreach ($a in $autoFixApplied) {
      Write-Host ("  [fixed] {0} — {1}" -f $a.path, $a.reason) -ForegroundColor Green
    }
    foreach ($s in $autoFixSkipped) {
      Write-Host ("  [skip]  {0} — {1}" -f $s.path, $s.reason) -ForegroundColor Yellow
    }
    Write-Host ""
  }
  if ($findings.Count -eq 0) {
    Write-Host "[clean] Ingen lokal-only AI-state fundet." -ForegroundColor Green
  } else {
    Write-Host ""
    Write-Host "Cross-PC forensisk audit: $($errors.Count) error(s), $($warns.Count) warning(s)" -ForegroundColor Cyan
    Write-Host ""
    foreach ($f in $findings) {
      $color = if ($f.severity -eq "error") { "Red" } else { "Yellow" }
      Write-Host ("[{0}] {1}" -f $f.severity.ToUpper(), $f.category) -ForegroundColor $color
      Write-Host ("  path: {0}" -f $f.path)
      Write-Host ("  why:  {0}" -f $f.message)
      if ($f.fix) { Write-Host ("  fix:  {0}" -f $f.fix) -ForegroundColor Cyan }
      Write-Host ""
    }
  }
}

if ($errors.Count -gt 0) { exit 1 }
if ($Strict -and $warns.Count -gt 0) { exit 1 }
exit 0
