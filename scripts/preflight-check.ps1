# preflight-check.ps1
#
# Read-only verifikation der KRAEVES bestaaet paa BEGGE PC'er foer migration.
# Tjekker: git installeret, repo er rent, alt pushet til origin, MCP-konfig er paa plads,
# detekterer OneDrive-sti, lokal-only filer, og lokationer for auto-memory.
#
# Skriver JSON-summary til .codex.local/preflight-state.json til consumption af migrate-scriptet.
#
# Exit 0 = klar til migration, Exit 1 = issues skal loeses foerst.
#
# Brug: pwsh -File scripts/preflight-check.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ok = @()
$warn = @()
$fail = @()

function Write-Section($title) {
  Write-Host ""
  Write-Host "=== $title ===" -ForegroundColor Cyan
}

function Resolve-GitPath {
  $gitCommand = Get-Command git -ErrorAction SilentlyContinue
  if ($gitCommand) { return $gitCommand.Source }
  $desktopRoots = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "GitHubDesktop") -Directory -Filter "app-*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending
  foreach ($root in $desktopRoots) {
    $candidate = Join-Path $root.FullName "resources\app\git\cmd\git.exe"
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

# --- 1. Toolchain ---
Write-Section "Toolchain"

$gitPath = Resolve-GitPath
if ($gitPath) {
  $gitVersion = (& $gitPath --version).Trim()
  $ok += "git: $gitVersion"
  Write-Host "  [ok] $gitVersion"
} else {
  $fail += "git ikke fundet. Installer Git for Windows eller GitHub Desktop."
  Write-Host "  [FAIL] git ikke fundet" -ForegroundColor Red
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
  $nodeVersion = (& $nodeCommand.Source --version).Trim()
  $ok += "node: $nodeVersion"
  Write-Host "  [ok] node $nodeVersion"
} else {
  $warn += "node ikke fundet paa PATH (kan stadig fungere via Codex bundled runtime)"
  Write-Host "  [warn] node ikke fundet paa PATH" -ForegroundColor Yellow
}

$ghCommand = Get-Command gh -ErrorAction SilentlyContinue
if ($ghCommand) {
  $ghVersion = ((& $ghCommand.Source --version) -split "`n")[0].Trim()
  $ok += "gh: $ghVersion"
  Write-Host "  [ok] $ghVersion"
} else {
  $warn += "gh CLI ikke fundet. Anbefales til PR-flow."
  Write-Host "  [warn] gh CLI ikke fundet" -ForegroundColor Yellow
}

if (-not $gitPath) {
  Write-Host ""
  Write-Host "Kan ikke fortsaette uden git. Afbryd." -ForegroundColor Red
  exit 1
}

# --- 2. Repo-state ---
Write-Section "Repo-state"

$repoRoot = (& $gitPath rev-parse --show-toplevel 2>$null).Trim() -replace "/", "\"
if (-not $repoRoot) {
  $fail += "Ikke i et git-repo. Kor scriptet inde i CyclingZone-repo."
  Write-Host "  [FAIL] ikke i et git-repo" -ForegroundColor Red
  Write-Host ""
  Write-Host "Afbryd. Kor scriptet fra repo-root." -ForegroundColor Red
  exit 1
}

# Hvis vi koerer fra en worktree, find hovedrepo'et — al state-tjek skal vaere
# baseret paa hovedrepo, ikke worktree (auto-memory, .codex.local, etc.)
$gitCommonDir = (& $gitPath rev-parse --git-common-dir 2>$null).Trim() -replace "/", "\"
if ($gitCommonDir) {
  # Resolve relative path mod current working directory
  if (-not [System.IO.Path]::IsPathRooted($gitCommonDir)) {
    $gitCommonDir = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $gitCommonDir))
  }
  $mainRepoCandidate = Split-Path -Parent $gitCommonDir
  if ($mainRepoCandidate -and ($mainRepoCandidate -ne $repoRoot)) {
    Write-Host "  [info] Du er i en worktree. State-tjek mod hovedrepo:" -ForegroundColor Yellow
    Write-Host "         Worktree:  $repoRoot" -ForegroundColor Yellow
    Write-Host "         Hovedrepo: $mainRepoCandidate" -ForegroundColor Yellow
    $repoRoot = $mainRepoCandidate
  }
}
Write-Host "  Repo-root: $repoRoot"

$originUrl = (& $gitPath -C $repoRoot config --get remote.origin.url 2>$null).Trim()
if ($originUrl -match "NicolaiDolmer/CyclingZone") {
  $ok += "origin: $originUrl"
  Write-Host "  [ok] origin: $originUrl"
} else {
  $fail += "origin er ikke NicolaiDolmer/CyclingZone (fundet: $originUrl)"
  Write-Host "  [FAIL] uventet origin: $originUrl" -ForegroundColor Red
}

# OneDrive-detektion
$onedriveRoot = $env:OneDrive
$underOneDrive = $false
if ($onedriveRoot) {
  $normalizedOnedrive = [System.IO.Path]::GetFullPath($onedriveRoot).TrimEnd('\')
  $normalizedRepo = [System.IO.Path]::GetFullPath($repoRoot)
  if ($normalizedRepo.StartsWith($normalizedOnedrive + '\', [StringComparison]::OrdinalIgnoreCase)) {
    $underOneDrive = $true
    $fail += "Repo er UNDER OneDrive ($normalizedOnedrive). Det er hovedaarsagen til vi migrerer."
    Write-Host "  [FAIL] Repo ligger under OneDrive: $normalizedOnedrive" -ForegroundColor Red
  } else {
    $ok += "Repo er IKKE under OneDrive"
    Write-Host "  [ok] Repo ligger uden for OneDrive ($normalizedOnedrive)"
  }
} else {
  $ok += "Ingen OneDrive-installation detekteret"
  Write-Host "  [ok] Ingen OneDrive-installation detekteret"
}

# --- 3. Working tree status ---
Write-Section "Working tree (skal vaere helt rent)"

$status = & $gitPath -C $repoRoot status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
  $ok += "Working tree er rent"
  Write-Host "  [ok] ingen uncommitted changes"
} else {
  $fail += "Uncommitted changes findes. Commit eller stash foer migration."
  Write-Host "  [FAIL] Uncommitted changes:" -ForegroundColor Red
  $status -split "`n" | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
}

# Untracked filer (ikke kritisk men flag dem)
$untracked = & $gitPath -C $repoRoot ls-files --others --exclude-standard
if (-not [string]::IsNullOrWhiteSpace($untracked)) {
  $count = ($untracked -split "`n").Count
  $warn += "$count untracked fil(er) findes. Verificer at intet skal committes."
  Write-Host "  [warn] $count untracked fil(er). Verificer:" -ForegroundColor Yellow
  ($untracked -split "`n") | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
}

# --- 4. Origin sync state ---
Write-Section "GitHub-sync state (alle branches)"

# Fetch foer comparison (uden at modificere working tree)
Write-Host "  Fetcher origin..."
$fetchOutput = & $gitPath -C $repoRoot fetch --prune origin 2>&1
if ($LASTEXITCODE -ne 0) {
  $fail += "git fetch fejlede. Origin ikke naabar?"
  Write-Host "  [FAIL] fetch fejlede:" -ForegroundColor Red
  Write-Host "    $fetchOutput" -ForegroundColor Red
} else {
  Write-Host "  [ok] fetch lykkedes"

  # Tjek alle lokale branches mod deres upstream
  $branchInfo = & $gitPath -C $repoRoot for-each-ref --format='%(refname:short)|%(upstream:short)|%(upstream:track)' refs/heads/
  $aheadBranches = @()
  $noUpstreamBranches = @()
  foreach ($line in ($branchInfo -split "`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line -split '\|'
    $branch = $parts[0]
    $upstream = if ($parts.Length -gt 1) { $parts[1] } else { "" }
    $track = if ($parts.Length -gt 2) { $parts[2] } else { "" }
    if (-not $upstream) {
      $noUpstreamBranches += $branch
    } elseif ($track -match "ahead") {
      $aheadBranches += "$branch ($track)"
    }
  }

  if ($aheadBranches.Count -gt 0) {
    $fail += "$($aheadBranches.Count) branch(es) er ahead af origin. Push foer migration."
    Write-Host "  [FAIL] Branches ahead af origin:" -ForegroundColor Red
    $aheadBranches | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
  } else {
    $ok += "Alle tracking-branches er pushet"
    Write-Host "  [ok] Alle tracking-branches er pushet til origin"
  }

  if ($noUpstreamBranches.Count -gt 0) {
    $warn += "$($noUpstreamBranches.Count) branch(es) uden upstream. Verificer de er bevidst lokale."
    Write-Host "  [warn] Branches uden upstream (lokal-only):" -ForegroundColor Yellow
    $noUpstreamBranches | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
  }

  # Tjek for stash entries
  $stashes = & $gitPath -C $repoRoot stash list
  if (-not [string]::IsNullOrWhiteSpace($stashes)) {
    $count = ($stashes -split "`n").Count
    $warn += "$count stash-entry/-ies findes. Overvej om de skal committes."
    Write-Host "  [warn] $count stash-entry/-ies:" -ForegroundColor Yellow
    ($stashes -split "`n") | Select-Object -First 5 | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
  }
}

# --- 5. Lokal-only filer ---
Write-Section "Lokal-only filer (skal kopieres ved migration)"

$localFiles = @{}
$candidates = @(
  ".env.local",
  ".env.production",
  ".env",
  ".mcp.json",
  "backend/.env",
  "backend/.env.local",
  "frontend/.env.local"
)
foreach ($f in $candidates) {
  $full = Join-Path $repoRoot $f
  if (Test-Path $full -PathType Leaf) {
    $size = (Get-Item $full).Length
    $localFiles[$f] = $size
    Write-Host ("  [found] {0} ({1} bytes)" -f $f, $size)
  }
}

if (Test-Path (Join-Path $repoRoot ".codex.local") -PathType Container) {
  $codexLocal = Get-ChildItem (Join-Path $repoRoot ".codex.local") -File -Recurse | Measure-Object Length -Sum
  $localFiles[".codex.local/"] = $codexLocal.Sum
  Write-Host ("  [found] .codex.local/ ({0} filer, {1} bytes)" -f $codexLocal.Count, $codexLocal.Sum)
}

if ($localFiles.Count -eq 0) {
  Write-Host "  (ingen lokal-only filer fundet)"
}

# --- 6. Auto-memory location ---
Write-Section "Claude Code auto-memory"

# Claude Code encoder repo-pathen ved at erstatte : med "" og \ med -
# F.eks.: C:\Users\emmas\dev\repo bliver C--Users-emmas-dev-repo
$encodedPath = "C--" + (($repoRoot -replace "^C:", "") -replace "\\", "-").TrimStart("-")
$claudeProjects = Join-Path $env:USERPROFILE ".claude\projects"
$candidatePaths = @()
if (Test-Path $claudeProjects) {
  $candidatePaths = @(Get-ChildItem $claudeProjects -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ieq $encodedPath })
}

$memoryPath = $null
if ($candidatePaths.Count -gt 0) {
  $memoryPath = Join-Path $candidatePaths[0].FullName "memory"
  if (Test-Path $memoryPath) {
    $memFiles = @(Get-ChildItem $memoryPath -File)
    Write-Host ("  [found] {0} ({1} filer)" -f $memoryPath, $memFiles.Count)
  } else {
    Write-Host ("  [info] Project-mappe findes men ingen memory/-undermappe endnu: {0}" -f $candidatePaths[0].FullName)
  }
} else {
  Write-Host ("  [info] Ingen Claude-projects mappe matcher endnu (forventet: {0})" -f $encodedPath)
}

# --- 7. Codex global trust state ---
Write-Section "Codex global config"

$codexConfig = Join-Path $env:USERPROFILE ".codex\config.toml"
if (Test-Path $codexConfig) {
  $configContent = Get-Content $codexConfig -Raw
  $repoLower = $repoRoot.ToLower()
  if ($configContent -match [regex]::Escape("[projects.'$repoLower'")) {
    Write-Host "  [ok] Repo er trusted i ~/.codex/config.toml"
  } else {
    Write-Host "  [info] Repo-pathen er ikke listet som trusted i ~/.codex/config.toml endnu"
  }
} else {
  Write-Host "  [info] ~/.codex/config.toml findes ikke (Codex maaske ikke installeret)"
}

# --- Summary ---
Write-Section "Sammenfatning"
Write-Host "  $($ok.Count) ok / $($warn.Count) advarsler / $($fail.Count) fejl"

if ($fail.Count -gt 0) {
  Write-Host ""
  Write-Host "FEJL der skal loeses foer migration:" -ForegroundColor Red
  $fail | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}

if ($warn.Count -gt 0) {
  Write-Host ""
  Write-Host "Advarsler (ikke blokkende, men verificer):" -ForegroundColor Yellow
  $warn | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}

# Skriv JSON-state
$stateDir = Join-Path $repoRoot ".codex.local"
if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
$stateFile = Join-Path $stateDir "preflight-state.json"
$state = [ordered]@{
  timestamp     = (Get-Date).ToString("o")
  repoRoot      = $repoRoot
  originUrl     = $originUrl
  underOneDrive = $underOneDrive
  hostname      = $env:COMPUTERNAME
  user          = $env:USERNAME
  oneDriveRoot  = $onedriveRoot
  localFiles    = $localFiles
  memoryPath    = $memoryPath
  okCount       = $ok.Count
  warnCount     = $warn.Count
  failCount     = $fail.Count
  failures      = $fail
  warnings      = $warn
  passed        = ($fail.Count -eq 0)
}
$state | ConvertTo-Json -Depth 5 | Out-File -FilePath $stateFile -Encoding utf8
Write-Host ""
Write-Host "  State skrevet: $stateFile"

if ($fail.Count -gt 0) {
  Write-Host ""
  Write-Host "[BLOKERET] Loes fejl, kor scriptet igen, foer migration." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "[KLAR] Preflight bestaaet. Migration kan kores." -ForegroundColor Green
exit 0
