# cross-pc-env.ps1 - delte helpers til cross-PC-setup (#6602).
#
# Konvention: dot-source fra et andet script:
#   . (Join-Path $PSScriptRoot 'lib\cross-pc-env.ps1')
# Bruges af link-onedrive-context.ps1 og agent-doctor.ps1.
#
# Ren: ingen IO udover laesning af PATH/filsystem og `git --exec-path`.

function Resolve-GitBash {
  # Returnerer fuld sti til Git Bash, eller $null.
  # Raekkefoelge: bash paa PATH (WSL-launcheren i System32 springes over, den
  # kan ikke koere Windows-stier), Program Files\Git, og sidst en sti afledt
  # af `git --exec-path` (<git>\mingw64\libexec\git-core -> <git>\bin\bash.exe).
  # Kun Windows: paa Linux-CI (agent-doctor i quality-inbox/lockfile-drift) er
  # $env:SystemRoot/$env:LOCALAPPDATA tomme, og Join-Path ville kaste under Stop.
  if (-not $IsWindows) { return $null }
  $sys32 = Join-Path $env:SystemRoot 'System32'
  foreach ($cmd in @(Get-Command bash -CommandType Application -All -ErrorAction SilentlyContinue)) {
    if ($cmd.Source -and -not $cmd.Source.StartsWith($sys32, [StringComparison]::OrdinalIgnoreCase)) {
      return $cmd.Source
    }
  }

  $candidates = @()
  foreach ($pf in @($env:ProgramFiles, ${env:ProgramW6432}, ${env:ProgramFiles(x86)}, (Join-Path $env:LOCALAPPDATA 'Programs'))) {
    if ($pf) { $candidates += (Join-Path $pf 'Git\bin\bash.exe') }
  }
  if (Get-Command git -CommandType Application -ErrorAction SilentlyContinue) {
    try {
      $execPath = (& git --exec-path 2>$null | Select-Object -First 1)
      if ($execPath) {
        # <git>\mingw64\libexec\git-core -> tre niveauer op = <git>
        $gitRoot = Split-Path (Split-Path (Split-Path ($execPath -replace '/', '\') -Parent) -Parent) -Parent
        if ($gitRoot) { $candidates += (Join-Path $gitRoot 'bin\bash.exe') }
      }
    } catch { }
  }
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c -PathType Leaf) { return $c }
  }
  return $null
}

# FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: OneDrive-placeholder hvis indhold kun ligger i skyen.
$Script:CloudOnlyAttribute = 0x400000

function Get-CloudOnlyFileCount {
  # Antal filer under $Path (rekursivt) der kun ligger i skyen.
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return 0 }
  return @(Get-ChildItem -LiteralPath $Path -File -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { ([int64]$_.Attributes -band $Script:CloudOnlyAttribute) -ne 0 }).Count
}
