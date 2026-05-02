param(
  [string]$EnvPath = "",
  [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-GitPath {
  $gitCommand = Get-Command git -ErrorAction SilentlyContinue
  if ($gitCommand) { return $gitCommand.Source }

  $desktopRoots = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "GitHubDesktop") -Directory -Filter "app-*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending

  foreach ($root in $desktopRoots) {
    $candidate = Join-Path $root.FullName "resources\app\git\cmd\git.exe"
    if (Test-Path $candidate) { return $candidate }
  }

  throw "Git blev ikke fundet. Installer Git eller GitHub Desktop, eller tilfoej git til PATH."
}

function Resolve-NodePath {
  $bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path $bundledNode) { return $bundledNode }

  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw "Node blev ikke fundet pa PATH. Aabn Codex igen eller installer Node.js lokalt."
  }

  return $nodeCommand.Source
}

$repoRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$gitPath = Resolve-GitPath
$nodePath = Resolve-NodePath

$resolvedRoot = (& $gitPath -C $repoRoot rev-parse --show-toplevel).Trim()
$normalizedResolvedRoot = [System.IO.Path]::GetFullPath(($resolvedRoot -replace "/", "\"))

if ($normalizedResolvedRoot -ne $repoRoot) {
  throw "Scriptet koeres ikke fra den forventede repo-root. Forventet: $repoRoot. Git siger: $resolvedRoot."
}

$scriptPath = Join-Path $repoRoot "backend\scripts\verify-invariants.js"
$scriptArgs = @()
if ($EnvPath) { $scriptArgs += "--env"; $scriptArgs += $EnvPath }
if ($Json)    { $scriptArgs += "--json" }

& $nodePath $scriptPath @scriptArgs
exit $LASTEXITCODE
