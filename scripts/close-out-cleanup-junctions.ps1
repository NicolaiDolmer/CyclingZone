# close-out-cleanup-junctions.ps1 - junction-sikker worktree-fjernelse (#6687).
#
# Hvorfor: 15/10 fjernede 'close-out-cleanup.ps1 -Execute' 11 worktrees. Flere
# havde node_modules (root/frontend/backend) som junctions til hovedcheckoutens
# egne node_modules. 'git worktree remove --force' fulgte junctionen og toemte
# MAALET - hovedcheckoutens node_modules var bagefter tomme. Ingen kode/data
# tabt, men lint-staged og alt andet manglede indtil 'npm run sync-deps'.
#
# Dette bibliotek fjerner selve linkene (reparse points) FOER worktreet fjernes,
# uden nogensinde at foelge dem, og verificerer bagefter at hvert links maal
# stadig findes. Kan et link ikke fjernes, eller er et maal blevet roert, saa
# returnerer Remove-WorktreeJunctions Ok=$false og kalderen SKAL nægte at
# fjerne worktreet.
#
# Dot-sources af scripts/prune-merged-worktrees.ps1 (som close-out-cleanup.ps1
# kalder) - ingen top-level sideeffekter her, kun funktioner.
#
# Hvad der scannes (kun links, aldrig almindelige filer/mapper):
#   - worktreets rod (direkte boern)
#   - frontend/, backend/, marketing/ (direkte boern; mindst node_modules)
#   - hvis node_modules er en ECHT mappe: dens direkte boern og @scope-boern
#     (workspace-symlinks) - et link dér kan ellers fanges af en rekursiv sletning
# Hardlinks (.env) og OneDrive-placeholdere er IKKE junction/symlink og roeres ikke.

function Get-WorktreeLinkChildren {
  # Direkte boern af $Dir der er junction/symlink. Foelger ALDRIG et link:
  # DirectoryInfo.GetFileSystemInfos() lister kun navne i $Dir selv.
  param([Parameter(Mandatory)][string]$Dir)
  $found = @()
  if (-not [IO.Directory]::Exists($Dir)) { return $found }
  $info = New-Object IO.DirectoryInfo $Dir
  # Er selve $Dir et link, saa lister vi ikke ind i det (det fanges af forælderens scan).
  if ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) { return $found }
  foreach ($child in $info.GetFileSystemInfos()) {
    if (-not ($child.Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }
    $item = Get-Item -LiteralPath $child.FullName -Force -ErrorAction SilentlyContinue
    if (-not $item) { continue }
    $lt = $item.LinkType
    if ($lt -eq 'Junction' -or $lt -eq 'SymbolicLink') { $found += $item }
  }
  return $found
}

function Get-WorktreeLinks {
  # Alle links i worktreets rod, frontend/backend/marketing, de lokale OneDrive-
  # mapper (#7446) og (ved ECHT
  # node_modules) node_modules' boern + @scope-boern. Ingen rekursion ind i links.
  param([Parameter(Mandatory)][string]$WorktreePath)
  $links = @()
  $dirs = @($WorktreePath)
  foreach ($sub in 'frontend', 'backend', 'marketing') { $dirs += (Join-Path $WorktreePath $sub) }
  # #7446: de gitignorerede OneDrive-junctions (`<mappe>/local`, `.codex.local/shared`) ligger
  # dybere end roden; uden disse forældre ville 'git worktree remove --force' tømme OneDrive.
  foreach ($sub in 'docs\drafts', 'pr-screens', 'docs\snapshots', '.codex.local') { $dirs += (Join-Path $WorktreePath $sub) }
  foreach ($d in $dirs) {
    # Er selve $d et link (fx frontend -> andet sted), fanges det af forælderens scan,
    # og vi maa IKKE kigge ind i det: dets boern ligger uden for worktreet og ville
    # blive utilgængelige naar linket er fjernet.
    if ([IO.Directory]::Exists($d) -and ((New-Object IO.DirectoryInfo $d).Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }
    $links += Get-WorktreeLinkChildren -Dir $d
    $nm =Join-Path $d 'node_modules'
    if ([IO.Directory]::Exists($nm) -and -not ((New-Object IO.DirectoryInfo $nm).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      $links += Get-WorktreeLinkChildren -Dir $nm
      foreach ($scope in (New-Object IO.DirectoryInfo $nm).GetDirectories('@*')) {
        $links += Get-WorktreeLinkChildren -Dir $scope.FullName
      }
    }
  }
  return $links
}

function Remove-LinkOnly {
  # Fjerner KUN selve linket. Aldrig Remove-Item -Recurse (kan foelge linket).
  param([Parameter(Mandatory)]$Item)
  $p = $Item.FullName
  if ($Item.PSIsContainer) {
    try { [IO.Directory]::Delete($p, $false) }
    catch { & cmd /c rmdir /Q "$p" 2>&1 | Out-Null }
  } else {
    [IO.File]::Delete($p)
  }
}

function Get-LinkTargetPaths {
  # Absolutte maalstier for et link (relative symlink-maal loeses mod linkets forælder).
  param([Parameter(Mandatory)]$Item)
  $out = @()
  $parent = Split-Path -Parent $Item.FullName
  foreach ($t in @($Item.Target)) {
    if (-not $t) { continue }
    $s = "$t"
    if ($s.StartsWith('\??\')) { $s = $s.Substring(4) }
    if (-not [IO.Path]::IsPathRooted($s)) { $s = Join-Path $parent $s }
    $out += $s
  }
  return $out
}

function Remove-WorktreeJunctions {
  # Fjerner junctions/symlinks i et worktree foer 'git worktree remove'.
  #   -WorktreePath : worktree-roden
  #   -DryRun       : rapporter, roer intet
  #   -LinkRemover  : scriptblock($item) der fjerner et link (kun til test; default Remove-LinkOnly)
  # Returnerer [pscustomobject] { Ok; Found; Removed; Errors }.
  # Ok=$false => kalderen SKAL nægte at fjerne worktreet.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$WorktreePath,
    [switch]$DryRun,
    [scriptblock]$LinkRemover = $null
  )
  $removed = @(); $errors = @()
  $links = @(Get-WorktreeLinks -WorktreePath $WorktreePath)

  foreach ($item in $links) {
    $path = $item.FullName
    $targets = @(Get-LinkTargetPaths -Item $item)
    $targetsBefore = @{}
    foreach ($t in $targets) { $targetsBefore[$t] = [IO.Directory]::Exists($t) -or [IO.File]::Exists($t) }

    if ($DryRun) {
      Write-Host "      [would-unlink] $path -> $($targets -join ', ')" -ForegroundColor DarkGray
      $removed += $path
      continue
    }

    try {
      if ($LinkRemover) { & $LinkRemover $item } else { Remove-LinkOnly -Item $item }
    } catch {
      $errors += "kunne ikke fjerne link $path : $($_.Exception.Message)"
      continue
    }

    # Linket skal vaere vaek (Exists foelger ikke linket; GetFileSystemInfos-opslag paa selve stien).
    $stillThere = $null -ne (Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue)
    if ($stillThere) {
      $errors += "link findes stadig efter fjernelse: $path"
      continue
    }
    # Maalet skal findes endnu, hvis det fandtes foer.
    foreach ($t in $targets) {
      if ($targetsBefore[$t] -and -not ([IO.Directory]::Exists($t) -or [IO.File]::Exists($t))) {
        $errors += "MAAL BLEV BORTE efter fjernelse af $path : $t"
      }
    }
    $removed += $path
    Write-Host "      [unlinked] $path" -ForegroundColor DarkGray
  }

  return [pscustomobject]@{
    Ok      = ($errors.Count -eq 0)
    Found   = $links.Count
    Removed = $removed
    Errors  = $errors
  }
}
