# Kør dette script én gang på en ny PC, eller efter git pull der tilføjer nye devDependencies.
# Installerer backend og frontend node_modules lokalt.
# Eksempel: pwsh -File scripts/setup-local.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-NodePath {
  $bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path $bundledNode) { return Split-Path $bundledNode }
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) { return Split-Path $nodeCommand.Source }
  throw "Node blev ikke fundet. Aaben Codex eller installer Node.js."
}

$repoRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$nodeBin   = Resolve-NodePath
$npmPath   = Join-Path $nodeBin "npm.cmd"
if (-not (Test-Path $npmPath)) { $npmPath = "npm" }

Write-Host "setup-local.ps1 — $repoRoot`n"

Write-Host "[1/2] Backend: npm install"
Push-Location (Join-Path $repoRoot "backend")
try {
  & $npmPath install
  if ($LASTEXITCODE -ne 0) { throw "Backend npm install fejlede." }
} finally { Pop-Location }

Write-Host "[2/2] Frontend: npm install"
Push-Location (Join-Path $repoRoot "frontend")
try {
  & $npmPath install
  if ($LASTEXITCODE -ne 0) { throw "Frontend npm install fejlede." }
} finally { Pop-Location }

Write-Host "`n[ok] Lokal opsaetning faerdig."
Write-Host "      Backend lint:    cd backend && npm run lint"
Write-Host "      Frontend lint:   cd frontend && npm run lint"
Write-Host "      Invariant-tjek:  pwsh -File scripts/verify-invariants.ps1"
