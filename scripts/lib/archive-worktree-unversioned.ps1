# archive-worktree-unversioned.ps1 - et worktree fjernes aldrig, foer alt i det er gemt (#7837).
#
# Hvorfor (haendelse 7/11, PC1, tredje gang efter 15/10 #6687 og 1/11 #7446): 178 worktrees
# blev slettet uden om repoets scripts. Bundlen daekkede commits, men ikke ignorerede og
# ikke-versionerede filer (PR-tekster, maalinger, billeder, undersoegelses-noter), og
# `git status --porcelain` viser ikke ignorerede filer. Ejer 7/11: nul tolerance for slettet
# arbejde, der ikke er faerdigt og live.
#
# Remove-WorktreeSafely er den ENESTE vej til at fjerne et worktree. Raekkefoelgen er fast,
# og hvert trin skal lykkes, foer det naeste koerer:
#   1. Fjern links (junctions/symlinks) uden at foelge dem (close-out-cleanup-junctions.ps1).
#      Ellers foelger sletningen dem ind i node_modules-caches og OneDrive.
#   2. Arkivér til OneDrive private-recovery/worktree-archive/<dato>/<slug>-<tid>/:
#      - files.tar: ALLE ikke-versionerede filer, ogsaa ignorerede (git ls-files --others),
#        undtagen afhaengigheder/build-output og secrets (.env-hardlinks, .mcp.json),
#      - tracked-changes.patch: ucommittede aendringer i versionerede filer (git diff HEAD --binary),
#      - commits.bundle: commits der ikke er paa origin/main (ogsaa naar branchen er pushet),
#      - manifest.json: hvad der er gemt og sprunget over.
#      Arkivet verificeres (tar-listen = fil-listen, bundle verify), foer der slettes.
#   3. git worktree remove (uden --force; --force kun naar 1 og 2 er lykkedes).
# Fejler et trin, returneres Ok=$false, og worktreet roeres ikke.
#
# Claude-transcripts i ~/.claude/projects/<worktree>/ slettes ALDRIG her: de er det, man
# genskaber fra, hvis noget alligevel mangler (7/11 blev 83 filer genskabt fra dem).

. (Join-Path $PSScriptRoot '..\close-out-cleanup-junctions.ps1')

$script:ArchiveSkip = '(^|/)(node_modules|\.vite|dist|coverage|\.turbo|\.next|\.cache)(/|$)|(^|/)\.env($|\.)|(^|/)\.mcp\.json$|^balance-internals(/|$)'

function Get-WorktreeArchiveRoot {
  if ($env:CZ_WORKTREE_ARCHIVE_ROOT) { return $env:CZ_WORKTREE_ARCHIVE_ROOT }
  $od = Join-Path $env:USERPROFILE 'OneDrive\CyclingZone-context'
  if (-not (Test-Path -LiteralPath $od)) { return $null }
  return Join-Path $od 'private-recovery\worktree-archive'
}

function Save-WorktreeUnversioned {
  # Returnerer [pscustomobject] { Ok; Dir; Files; Skipped; Errors }.
  param(
    [Parameter(Mandatory)][string]$WorktreePath,
    [string]$BaseRef = 'origin/main',
    [switch]$DryRun
  )
  $errors = @()
  $root = Get-WorktreeArchiveRoot
  if (-not $root) { return [pscustomobject]@{ Ok = $false; Dir = $null; Files = 0; Skipped = 0; Errors = @('OneDrive CyclingZone-context findes ikke - intet sted at arkivere, worktreet beholdes') } }
  $slug = Split-Path -Leaf $WorktreePath
  $dir = Join-Path $root ((Get-Date -Format 'yyyy-MM-dd') + '\' + $slug + '-' + (Get-Date -Format 'HHmmss'))

  $raw = & git -C $WorktreePath ls-files --others -z 2>$null
  if ($LASTEXITCODE -ne 0) { return [pscustomobject]@{ Ok = $false; Dir = $dir; Files = 0; Skipped = 0; Errors = @("git ls-files fejlede i $WorktreePath") } }
  $all = @(([string]$raw) -split "`0" | Where-Object { $_ })
  $keep = @($all | Where-Object { $_ -notmatch $script:ArchiveSkip })
  $skipped = @($all | Where-Object { $_ -match $script:ArchiveSkip })
  $patch = & git -C $WorktreePath diff HEAD --binary 2>$null
  $head = (& git -C $WorktreePath rev-parse HEAD 2>$null)
  $branch = (& git -C $WorktreePath branch --show-current 2>$null)
  $ahead = 0
  & git -C $WorktreePath rev-parse --verify --quiet $BaseRef *> $null
  if ($LASTEXITCODE -eq 0) { $ahead = [int](& git -C $WorktreePath rev-list --count "$BaseRef..HEAD" 2>$null) }

  if ($DryRun) {
    return [pscustomobject]@{ Ok = $true; Dir = $dir; Files = $keep.Count; Skipped = $skipped.Count; Errors = @() }
  }
  New-Item -ItemType Directory -Force -Path $dir | Out-Null

  if ($keep.Count -gt 0) {
    $list = Join-Path $dir 'files.txt'
    [IO.File]::WriteAllLines($list, [string[]]$keep, (New-Object Text.UTF8Encoding $false))
    $tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path -LiteralPath $tarExe)) { $tarExe = 'tar' }
    $tar = Join-Path $dir 'files.tar'
    & $tarExe -cf $tar -C $WorktreePath -T $list 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { $errors += "tar fejlede ($LASTEXITCODE)" }
    else {
      $listed = @(& $tarExe -tf $tar 2>$null | Where-Object { $_ -and -not $_.EndsWith('/') })
      if ($listed.Count -lt $keep.Count) { $errors += "arkivet har $($listed.Count) af $($keep.Count) filer" }
    }
  }
  if ($patch) {
    [IO.File]::WriteAllText((Join-Path $dir 'tracked-changes.patch'), (($patch -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))
  }
  if ($ahead -gt 0) {
    $bundle = Join-Path $dir 'commits.bundle'
    & git -C $WorktreePath bundle create $bundle HEAD "^$BaseRef" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { $errors += 'git bundle create fejlede' }
    else {
      & git -C $WorktreePath bundle verify $bundle *> $null
      if ($LASTEXITCODE -ne 0) { $errors += 'git bundle verify fejlede' }
    }
  }
  $manifest = [ordered]@{
    worktree = $WorktreePath; branch = $branch; head = $head; baseRef = $BaseRef; aheadOfBase = $ahead
    archivedFiles = $keep.Count; trackedChanges = [bool]$patch; skipped = $skipped
    created = (Get-Date).ToString('o'); restore = 'tar -xf files.tar -C <tomt worktree>; git apply tracked-changes.patch; git fetch commits.bundle HEAD:refs/heads/<branch>'
  }
  [IO.File]::WriteAllText((Join-Path $dir 'manifest.json'), ($manifest | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))
  return [pscustomobject]@{ Ok = ($errors.Count -eq 0); Dir = $dir; Files = $keep.Count; Skipped = $skipped.Count; Errors = $errors }
}

function Remove-WorktreeSafely {
  # Den eneste vej til at fjerne et worktree. Returnerer { Ok; ArchiveDir; Errors }.
  param(
    [Parameter(Mandatory)][string]$WorktreePath,
    [Parameter(Mandatory)][string]$RepoRoot,
    [string]$BaseRef = 'origin/main',
    [switch]$DryRun
  )
  $links = Remove-WorktreeJunctions -WorktreePath $WorktreePath -DryRun:$DryRun
  if (-not $links.Ok) { return [pscustomobject]@{ Ok = $false; ArchiveDir = $null; Errors = @($links.Errors) } }
  try {
    $arch = Save-WorktreeUnversioned -WorktreePath $WorktreePath -BaseRef $BaseRef -DryRun:$DryRun
  } catch {
    $arch = [pscustomobject]@{ Ok = $false; Dir = $null; Files = 0; Skipped = 0; Errors = @("arkivering fejlede: $($_.Exception.Message)") }
  }
  if (-not $arch.Ok) { return [pscustomobject]@{ Ok = $false; ArchiveDir = $arch.Dir; Errors = @($arch.Errors | ForEach-Object { "arkiv: $_ (worktree BEHOLDT)" }) } }
  if ($DryRun) { return [pscustomobject]@{ Ok = $true; ArchiveDir = $arch.Dir; Errors = @() } }
  # Links er ude, og alt er arkiveret og verificeret: nu er sletning sikker.
  & git -C $RepoRoot worktree remove $WorktreePath 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $again = @(Get-WorktreeLinks -WorktreePath $WorktreePath)
    if ($again.Count -gt 0) { return [pscustomobject]@{ Ok = $false; ArchiveDir = $arch.Dir; Errors = @("links dukkede op igen i $WorktreePath - worktree BEHOLDT") } }
    & git -C $RepoRoot worktree remove --force $WorktreePath 2>&1 | Out-Null
  }
  if (Test-Path -LiteralPath $WorktreePath) { return [pscustomobject]@{ Ok = $false; ArchiveDir = $arch.Dir; Errors = @("git worktree remove fejlede for $WorktreePath") } }
  return [pscustomobject]@{ Ok = $true; ArchiveDir = $arch.Dir; Errors = @() }
}
