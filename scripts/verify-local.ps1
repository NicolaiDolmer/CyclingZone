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

# #5092: scripts/monday-numbers.test.mjs og scripts/guard-inventory-cell.test.mjs
# koerte ingen steder i verify-kaeden (ingen test:*-entry, intet workflow-step,
# ikke her) - "usynlige" for hele kaeden. Kaeder direkte paa node --test (samme
# moenster som backend/frontend-trinnene nedenfor) i stedet for npm run, saa et
# manglende npm-script ikke stille springes over. Koeres foerst: rene/billige
# guards uden build-afhaengighed, samme rationale som now-md-sidecar-guarden i
# ops-script-tests-jobbet i ci.yml.
$rootNodeModules = Join-Path $repoRoot "node_modules"
if (-not (Test-Path $rootNodeModules)) {
  Write-Warning "Root ops-script-tests (#5092) blev sprunget over, fordi node_modules mangler i repo-roden. Koer npm ci eller stol paa GitHub Actions for gaten."
} else {
  Write-Host "[1/4] Root ops-script tests (#5092)"
  Push-Location $repoRoot
  try {
    & $nodePath --test scripts/monday-numbers.test.mjs
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }

    & $nodePath --test scripts/guard-inventory-cell.test.mjs
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }

    & $nodePath --test scripts/wave-policy.test.mjs scripts/codex-wave.test.mjs scripts/wave-hook.test.mjs scripts/session-claim.test.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally {
    Pop-Location
  }
}

Write-Host "[2/4] Backend tests"
Push-Location (Join-Path $repoRoot "backend")
try {
  # #3172: brug samme scripts/run-tests.js som `npm test`, ikke rå `node --test`
  # — koerer lib/economyEngine.test.js isoleret foerst for at undgaa
  # worker-IPC-flaket (node:internal/test_runner, ramte ogsaa her 31/7).
  & $nodePath scripts/run-tests.js
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
Write-Host "[3/4] Frontend tests"
Push-Location (Join-Path $repoRoot "frontend")
try {
  & $nodePath --test
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}

Write-Host "[4/4] Frontend build"
Push-Location (Join-Path $repoRoot "frontend")
try {
  & $nodePath $vitePath build
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
