# balance-internals.ps1 - delt balance-internals/ i worktrees (#7587 punkt 7).
#
# Hvorfor: 3/11 havde 9 worktrees egne lokale kopier af `balance-internals/`
# (private maalinger efter hard rule 17), som ville vaere gaaet tabt ved
# oprydning. De blev reddet manuelt ind i den delte OneDrive-mappe. Derfor:
#   1. Et worktrees `balance-internals/` er en junction til den delte mappe
#      (OneDrive\CyclingZone-context\balance-internals, samme mappe som
#      link-onedrive-context.ps1 linker i hovedcheckoutet).
#   2. Oprydningen naegter at fjerne et worktree, hvis dets `balance-internals/`
#      er en RIGTIG mappe med filer der ikke findes (med samme indhold) i den
#      delte mappe.
#
# Konvention: dot-source, kun funktioner, ingen top-level sideeffekter og ingen
# param-blok (en param-blok ville overskrive kalderens $DryRun ved dot-source):
#   . (Join-Path $PSScriptRoot 'lib\balance-internals.ps1')
# Bruges af scripts/link-balance-internals.ps1 (CLI, kaldt af setup-worktree.ps1
# og boelgens fase 0) og scripts/close-out-cleanup-junctions.ps1 (oprydning).
#
# SIKKERHED: foelger ALDRIG et link. En junction fjernes kun som link
# ([IO.Directory]::Delete(<sti>, $false)); en rigtig mappe slettes kun naar hver
# fil er bevist at findes i den delte mappe med samme SHA256, og der ikke ligger
# links inde i den.

function Get-SharedBalanceInternalsPath {
  # Den delte mappe. -SharedRoot vinder (tests); ellers OneDrive. $null = ukendt.
  param([string]$SharedRoot)
  if ($SharedRoot) { return [IO.Path]::GetFullPath($SharedRoot).TrimEnd([char]92) }
  if ($env:OneDrive) { return [IO.Path]::GetFullPath((Join-Path $env:OneDrive 'CyclingZone-context\balance-internals')).TrimEnd([char]92) }
  return $null
}

function Get-BalanceInternalsState {
  # Hvad ligger der paa <worktree>\balance-internals? Foelger aldrig et link.
  # Kind: missing | link | dir. Target kun for link.
  param([Parameter(Mandatory)][string]$WorktreeRoot)
  $path = Join-Path $WorktreeRoot 'balance-internals'
  $info = New-Object IO.DirectoryInfo $path
  if (-not $info.Exists) {
    if ([IO.File]::Exists($path)) { return [pscustomobject]@{ Kind = 'file'; Path = $path; Target = $null } }
    return [pscustomobject]@{ Kind = 'missing'; Path = $path; Target = $null }
  }
  if ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    $target = $null
    if ($item -and $item.Target) {
      $t = "$(@($item.Target)[0])"
      if ($t.StartsWith('\??\')) { $t = $t.Substring(4) }
      if (-not [IO.Path]::IsPathRooted($t)) { $t = Join-Path $WorktreeRoot $t }
      $target = [IO.Path]::GetFullPath($t).TrimEnd([char]92)
    }
    return [pscustomobject]@{ Kind = 'link'; Path = $path; Target = $target }
  }
  return [pscustomobject]@{ Kind = 'dir'; Path = $path; Target = $null }
}

function Get-BalanceInternalsUniqueFiles {
  # Filer i en RIGTIG mappe $Dir der IKKE findes med samme indhold i $Shared.
  # Returnerer { Files (alle relative stier); Unique; Conflicts (findes med andet
  # indhold); Links (reparse points inde i mappen - kan ikke verificeres) }.
  # Get-ChildItem -Recurse foelger ikke junctions uden -FollowSymlink (PS 7).
  param([Parameter(Mandatory)][string]$Dir, [string]$Shared)
  $root = [IO.Path]::GetFullPath($Dir).TrimEnd([char]92)
  $links = @(Get-ChildItem -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | ForEach-Object { $_.FullName })
  $files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) })
  $all = @(); $unique = @(); $conflicts = @()
  foreach ($f in $files) {
    $rel = $f.FullName.Substring($root.Length + 1)
    $all += $rel
    $dest = if ($Shared) { Join-Path $Shared $rel } else { $null }
    if (-not $dest -or -not [IO.File]::Exists($dest)) { $unique += $rel; continue }
    $a = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
    $b = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
    if ($a -ne $b) { $unique += $rel; $conflicts += $rel }
  }
  return [pscustomobject]@{ Files = $all; Unique = $unique; Conflicts = $conflicts; Links = $links }
}

function Test-BalanceInternalsRemovable {
  # Til oprydningen: maa worktreet fjernes uden at miste private filer?
  # Ok=$true: ingen balance-internals, et link (fjernes som link af
  # Remove-WorktreeJunctions), eller en rigtig mappe hvor HVER fil findes med
  # samme indhold i den delte mappe. Alt andet er Ok=$false (fail-closed).
  param([Parameter(Mandatory)][string]$WorktreePath, [string]$SharedRoot)
  $state = Get-BalanceInternalsState -WorktreeRoot $WorktreePath
  if ($state.Kind -ne 'dir') { return [pscustomobject]@{ Ok = $true; Reason = $state.Kind; Unique = @() } }
  $shared = Get-SharedBalanceInternalsPath -SharedRoot $SharedRoot
  $scan = Get-BalanceInternalsUniqueFiles -Dir $state.Path -Shared $shared
  if ($scan.Links.Count -gt 0) {
    return [pscustomobject]@{ Ok = $false; Reason = "balance-internals indeholder links ($($scan.Links[0])) - kan ikke verificeres"; Unique = @() }
  }
  if ($scan.Files.Count -eq 0) { return [pscustomobject]@{ Ok = $true; Reason = 'tom mappe'; Unique = @() } }
  if (-not $shared -or -not [IO.Directory]::Exists($shared)) {
    return [pscustomobject]@{ Ok = $false; Reason = "den delte mappe kan ikke findes ($shared) - $($scan.Files.Count) lokal(e) fil(er) kan ikke verificeres"; Unique = $scan.Files }
  }
  if ($scan.Unique.Count -gt 0) {
    $sample = ($scan.Unique | Select-Object -First 3) -join ', '
    return [pscustomobject]@{ Ok = $false; Reason = "balance-internals har $($scan.Unique.Count) fil(er) der ikke findes i den delte mappe ($sample)"; Unique = $scan.Unique }
  }
  return [pscustomobject]@{ Ok = $true; Reason = 'alle filer findes i den delte mappe'; Unique = @() }
}

function Set-BalanceInternalsLink {
  # Goer <worktree>\balance-internals til en junction til den delte mappe.
  # Idempotent. En rigtig mappe flyttes ind uden overskrivning; ved konflikt
  # (samme navn, andet indhold) eller links inde i den roeres intet.
  # Returnerer { Ok; Action; Message }.
  param([Parameter(Mandatory)][string]$WorktreeRoot, [string]$SharedRoot, [switch]$DryRun)
  $shared = Get-SharedBalanceInternalsPath -SharedRoot $SharedRoot
  if (-not $shared) { return [pscustomobject]@{ Ok = $false; Action = 'no-shared'; Message = 'OneDrive er ikke sat - balance-internals ikke linket' } }
  if (-not [IO.Directory]::Exists($shared)) {
    $parent = Split-Path $shared -Parent
    if (-not [IO.Directory]::Exists($parent)) { return [pscustomobject]@{ Ok = $false; Action = 'no-shared'; Message = "den delte mappes foraelder findes ikke ($parent) - balance-internals ikke linket" } }
    if (-not $DryRun) { New-Item -ItemType Directory -Path $shared -Force | Out-Null }
  }
  $state = Get-BalanceInternalsState -WorktreeRoot $WorktreeRoot
  $label = 'balance-internals'

  if ($state.Kind -eq 'file') { return [pscustomobject]@{ Ok = $false; Action = 'conflict'; Message = "$label er en fil, ikke en mappe - roeres ikke" } }

  if ($state.Kind -eq 'link') {
    if ($state.Target -and ($state.Target -ieq $shared)) { return [pscustomobject]@{ Ok = $true; Action = 'already'; Message = "$label -> $shared allerede paa plads" } }
    if ($DryRun) { return [pscustomobject]@{ Ok = $true; Action = 'would-relink'; Message = "$label peger paa $($state.Target) - ville pege om til $shared" } }
    # Fjern KUN linket (ikke-rekursivt), aldrig maalets indhold.
    [IO.Directory]::Delete($state.Path, $false)
    if ([IO.Directory]::Exists($state.Path)) { return [pscustomobject]@{ Ok = $false; Action = 'error'; Message = "kunne ikke fjerne det gamle link $($state.Path)" } }
  }

  if ($state.Kind -eq 'dir') {
    $scan = Get-BalanceInternalsUniqueFiles -Dir $state.Path -Shared $shared
    if ($scan.Links.Count -gt 0) { return [pscustomobject]@{ Ok = $false; Action = 'conflict'; Message = "$label indeholder links ($($scan.Links[0])) - mappen er ikke roert" } }
    if ($scan.Conflicts.Count -gt 0) {
      $sample = ($scan.Conflicts | Select-Object -First 3) -join ', '
      return [pscustomobject]@{ Ok = $false; Action = 'conflict'; Message = "$label har $($scan.Conflicts.Count) fil(er) med andet indhold end den delte mappe ($sample) - mappen er ikke roert" }
    }
    if ($DryRun) { return [pscustomobject]@{ Ok = $true; Action = 'would-move'; Message = "$label`: $($scan.Unique.Count) fil(er) ville blive flyttet til $shared, derefter junction" } }
    foreach ($rel in $scan.Unique) {
      $dest = Join-Path $shared $rel
      New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
      Copy-Item -LiteralPath (Join-Path $state.Path $rel) -Destination $dest
      $a = (Get-FileHash -LiteralPath (Join-Path $state.Path $rel) -Algorithm SHA256).Hash
      $b = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
      if ($a -ne $b) { return [pscustomobject]@{ Ok = $false; Action = 'error'; Message = "kopien af $rel blev ikke identisk - mappen er ikke slettet" } }
    }
    # Bevis foer sletning: nu skal HVER fil findes med samme indhold i den delte mappe.
    $after = Get-BalanceInternalsUniqueFiles -Dir $state.Path -Shared $shared
    if ($after.Unique.Count -gt 0 -or $after.Links.Count -gt 0) { return [pscustomobject]@{ Ok = $false; Action = 'error'; Message = "$label har stadig $($after.Unique.Count) fil(er) der ikke findes i den delte mappe - mappen er ikke slettet" } }
    # Ingen links inde i mappen (tjekket ovenfor), saa en rekursiv sletning foelger intet.
    Remove-Item -LiteralPath $state.Path -Recurse -Force
  }

  if ($DryRun) { return [pscustomobject]@{ Ok = $true; Action = 'would-link'; Message = "$label -> $shared ville blive oprettet" } }
  New-Item -ItemType Junction -Path $state.Path -Target $shared | Out-Null
  $check = Get-BalanceInternalsState -WorktreeRoot $WorktreeRoot
  if ($check.Kind -ne 'link' -or -not ($check.Target -ieq $shared)) { return [pscustomobject]@{ Ok = $false; Action = 'error'; Message = "junctionen $label blev ikke oprettet korrekt" } }
  $what = if ($state.Kind -eq 'dir') { "lokal mappe flyttet ind og linket" } else { 'linket' }
  return [pscustomobject]@{ Ok = $true; Action = 'linked'; Message = "$label -> $shared ($what)" }
}
