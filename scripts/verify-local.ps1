Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-GitPath {
  $gitCommand = Get-Command git -ErrorAction SilentlyContinue
  if ($gitCommand) {
    return $gitCommand.Source
  }

  $desktopRoots = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "GitHubDesktop") -Directory -Filter "app-*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending

  foreach ($root in $desktopRoots) {
    $candidate = Join-Path $root.FullName "resources\app\git\cmd\git.exe"
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "Git blev ikke fundet. Installer Git eller GitHub Desktop, eller tilfoej git til PATH."
}

function Resolve-NodePath {
  $bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path $bundledNode) {
    return $bundledNode
  }

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

if (-not $normalizedResolvedRoot) {
  throw "Kunne ikke verificere git-worktree for repoet."
}

if ($normalizedResolvedRoot -ne $repoRoot) {
  throw "Scriptet kores ikke fra den forventede repo-root. Forventet: $repoRoot. Git siger: $resolvedRoot."
}

Write-Host "[1/3] Backend tests"
Push-Location (Join-Path $repoRoot "backend")
try {
  & $nodePath --test
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}

$vitePath = Join-Path $repoRoot "frontend\node_modules\vite\bin\vite.js"
if (-not (Test-Path $vitePath)) {
  Write-Warning "Frontend-tests + build blev sprunget over, fordi frontend/node_modules mangler. Koer npm install i frontend eller stol pa GitHub Actions for gaten."
  exit 0
}

# Frontend unit-tests (node --test) koeres FOER build: Vite/esbuild tilgiver
# extensionless relative imports, men Node's ESM-loader i node --test goer ikke.
# Uden dette step slipper sadanne imports forbi lokalt og fejler foerst i CI
# (frontend-build-jobbets "Run frontend tests"). Refs #803.
Write-Host "[2/3] Frontend tests"
Push-Location (Join-Path $repoRoot "frontend")
try {
  & $nodePath --test
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}

Write-Host "[3/3] Frontend build"
Push-Location (Join-Path $repoRoot "frontend")
try {
  & $nodePath $vitePath build
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
