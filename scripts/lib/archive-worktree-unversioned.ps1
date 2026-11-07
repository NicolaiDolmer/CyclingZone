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
#      - staged-changes.patch og unstaged-changes.patch: index og working tree hver for sig,
#        verificeret ved omvendt anvendelse (git apply --check -R),
#      - commits.bundle: commits der ikke findes paa nogen remote-ref (uafhaengigt af BaseRef),
#      - manifest.json: hvad der er gemt og sprunget over.
#      Arkivet verificeres (praecise filnavne i tar, patches, bundle verify), foer der slettes; enhver ukendt git-status giver Ok=false.
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

  # #7839-review (Codex P1): enhver ukendt git-status giver Ok=false; intet antages.
  $fail = { param($m) [pscustomobject]@{ Ok = $false; Dir = $dir; Files = 0; Skipped = 0; Errors = @($m) } }
  $raw = & git -C $WorktreePath ls-files --others -z 2>$null
  if ($LASTEXITCODE -ne 0) { return (& $fail "git ls-files fejlede i $WorktreePath") }
  $all = @(([string]$raw) -split "`0" | Where-Object { $_ })
  $keep = @($all | Where-Object { $_ -notmatch $script:ArchiveSkip })
  $skipped = @($all | Where-Object { $_ -match $script:ArchiveSkip })
  $head = (& git -C $WorktreePath rev-parse --verify HEAD 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $head) { return (& $fail "git rev-parse HEAD fejlede i $WorktreePath") }
  $branch = (& git -C $WorktreePath branch --show-current 2>$null)
  if ($LASTEXITCODE -ne 0) { return (& $fail "git branch --show-current fejlede i $WorktreePath") }
  # Staged (HEAD->index) og ikke-staged (index->working tree) hver for sig (#7839-review P1).
  & git -C $WorktreePath diff --cached --quiet 2>$null; $stagedRc = $LASTEXITCODE
  & git -C $WorktreePath diff --quiet 2>$null; $unstagedRc = $LASTEXITCODE
  if ($stagedRc -gt 1 -or $unstagedRc -gt 1) { return (& $fail "git diff fejlede i $WorktreePath") }
  $hasStaged = $stagedRc -eq 1; $hasUnstaged = $unstagedRc -eq 1
  # Commits der ikke findes paa nogen remote-ref gemmes altid, uanset BaseRef (#7839-review P1).
  $unpushed = [string](& git -C $WorktreePath rev-list --count HEAD --not --remotes 2>$null)
  if ($LASTEXITCODE -ne 0 -or $unpushed -notmatch '^\d+$') { return (& $fail "git rev-list (upushede commits) fejlede i $WorktreePath") }
  $unpushed = [int]$unpushed
  $ahead = $null
  & git -C $WorktreePath rev-parse --verify --quiet $BaseRef *> $null
  if ($LASTEXITCODE -eq 0) { $ahead = [int](& git -C $WorktreePath rev-list --count "$BaseRef..HEAD" 2>$null) }

  if ($DryRun) {
    return [pscustomobject]@{ Ok = $true; Dir = $dir; Files = $keep.Count; Skipped = $skipped.Count; Errors = @() }
  }
  New-Item -ItemType Directory -Force -Path $dir | Out-Null

  if ($keep.Count -gt 0) {
    $list = Join-Path $dir 'files.txt'
    [IO.File]::WriteAllLines($list, [string[]]$keep, (New-Object Text.UTF8Encoding $false))
    $tarExe = if ($env:SystemRoot) { Join-Path $env:SystemRoot 'System32\tar.exe' } else { 'tar' }
    if ($env:SystemRoot -and -not (Test-Path -LiteralPath $tarExe)) { $tarExe = 'tar' }
    $tar = Join-Path $dir 'files.tar'
    & $tarExe -cf $tar -C $WorktreePath -T $list 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { $errors += "tar fejlede ($LASTEXITCODE)" }
    else {
      # Praecis navnesammenligning, ikke kun antal (#7839-review P2).
      $listed = @(& $tarExe -tf $tar 2>$null)
      if ($LASTEXITCODE -ne 0) { $errors += 'tar -tf fejlede' }
      else {
        $got = [System.Collections.Generic.HashSet[string]]::new([string[]]@($listed | Where-Object { $_ -and -not $_.EndsWith('/') } | ForEach-Object { $_.Replace([char]92, [char]47) }))
        $missing = @($keep | Where-Object { -not $got.Contains($_.Replace([char]92, [char]47)) })
        if ($missing.Count -gt 0) { $errors += "arkivet mangler $($missing.Count) filer (fx $($missing[0]))" }
      }
    }
  }
  # Patches skrives af git selv (binaert korrekt) og verificeres ved omvendt anvendelse paa
  # den nuvaerende tilstand: kan de ikke traekkes fra, er de ikke en tro kopi.
  if ($hasStaged) {
    $sp = Join-Path $dir 'staged-changes.patch'
    & git -C $WorktreePath diff --cached --binary "--output=$sp" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $sp) -or (Get-Item -LiteralPath $sp).Length -eq 0) { $errors += 'staged patch kunne ikke skrives' }
    else {
      & git -C $WorktreePath apply --check --cached -R $sp 2>$null
      if ($LASTEXITCODE -ne 0) { $errors += 'staged patch matcher ikke index' }
    }
  }
  if ($hasUnstaged) {
    $up = Join-Path $dir 'unstaged-changes.patch'
    & git -C $WorktreePath diff --binary "--output=$up" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $up) -or (Get-Item -LiteralPath $up).Length -eq 0) { $errors += 'unstaged patch kunne ikke skrives' }
    else {
      & git -C $WorktreePath apply --check -R $up 2>$null
      if ($LASTEXITCODE -ne 0) { $errors += 'unstaged patch matcher ikke working tree' }
    }
  }
  if ($unpushed -gt 0) {
    $bundle = Join-Path $dir 'commits.bundle'
    & git -C $WorktreePath bundle create $bundle HEAD --not --remotes 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { $errors += 'git bundle create fejlede' }
    else {
      & git -C $WorktreePath bundle verify $bundle *> $null
      if ($LASTEXITCODE -ne 0) { $errors += 'git bundle verify fejlede' }
    }
  }
  $manifest = [ordered]@{
    worktree = $WorktreePath; branch = $branch; head = $head; baseRef = $BaseRef; aheadOfBase = $ahead; unpushedCommits = $unpushed
    archivedFiles = $keep.Count; stagedChanges = $hasStaged; unstagedChanges = $hasUnstaged; skipped = $skipped
    created = (Get-Date).ToString('o')
    restore = 'git fetch commits.bundle HEAD:refs/heads/<branch> (hvis den findes); git worktree add <sti> <branch>; git apply --index staged-changes.patch; git apply unstaged-changes.patch; tar -xf files.tar -C <sti>'
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
