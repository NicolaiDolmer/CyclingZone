# setup-new-pc.ps1
#
# Komplet setup af CyclingZone paa en frisk PC.
# Bruges naar du har en ny computer eller har slettet alt og starter forfra.
#
# Goer:
#   1. Verificerer toolchain (git, node, gh)
#   2. Cloner repo til target (default C:\dev\CyclingZone)
#   3. Korer npm install (backend + frontend)
#   4. Verificerer build
#   5. Tilfoejer target som trusted i ~/.codex/config.toml
#   6. Installerer user-level Claude hooks (~/.claude/settings.json)
#   7. Korer setup-discord-mcp.ps1 hvis Railway CLI er klar
#   8. Printer en checkliste over manuelle skridt (.env.local fra anden PC)
#
# Brug:
#   pwsh -File scripts/setup-new-pc.ps1                          # default target C:\dev\CyclingZone
#   pwsh -File scripts/setup-new-pc.ps1 -Target "D:\code\CZ"     # custom target

param(
  [string]$Target = "C:\dev\CyclingZone",
  [string]$RepoUrl = "https://github.com/NicolaiDolmer/CyclingZone.git"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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
  throw "Git ikke fundet. Installer Git for Windows eller GitHub Desktop foerst."
}

# --- 1. Toolchain ---
Write-Section "Verificer toolchain"

$gitPath = Resolve-GitPath
Write-Host "  [ok] git: $(& $gitPath --version)"

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw "Node ikke fundet. Installer Node.js (anbefalet 20.x eller 22.x)." }
Write-Host "  [ok] node: $(& $nodeCommand.Source --version)"

$ghCommand = Get-Command gh -ErrorAction SilentlyContinue
if (-not $ghCommand) {
  Write-Host "  [warn] gh CLI ikke fundet. Anbefales: 'winget install GitHub.cli'" -ForegroundColor Yellow
} else {
  Write-Host "  [ok] gh: $(((& $ghCommand.Source --version) -split "`n")[0])"
}

# --- 2. Verificer target ---
Write-Section "Verificer target"

if (Test-Path $Target) {
  $existing = Get-ChildItem $Target -Force -ErrorAction SilentlyContinue
  if ($existing) {
    throw "Target '$Target' findes og er IKKE tom. Vaelg en anden sti eller brug migrate-to-clean-location.ps1 i stedet."
  }
}

# Verificer at target ikke ligger under OneDrive
if ($env:OneDrive) {
  $oneDriveNorm = [System.IO.Path]::GetFullPath($env:OneDrive).TrimEnd('\')
  $targetNorm = [System.IO.Path]::GetFullPath($Target)
  if ($targetNorm.StartsWith($oneDriveNorm + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Target '$Target' ligger UNDER OneDrive ($oneDriveNorm). Vaelg en anden sti."
  }
}
Write-Host "  [ok] $Target er en ren placering uden for OneDrive"

# --- 3. Clone ---
Write-Section "Clone repo"

$targetParent = Split-Path -Parent $Target
if (-not (Test-Path $targetParent)) {
  New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
  Write-Host "  Oprettet parent: $targetParent"
}

& $gitPath clone $RepoUrl $Target
if ($LASTEXITCODE -ne 0) { throw "git clone fejlede" }

# --- 4. npm install ---
Write-Section "Installer dependencies"

Push-Location (Join-Path $Target "backend")
try {
  Write-Host "  Backend: npm install..."
  & npm install
  if ($LASTEXITCODE -ne 0) { throw "Backend npm install fejlede" }
} finally { Pop-Location }

Push-Location (Join-Path $Target "frontend")
try {
  Write-Host "  Frontend: npm install..."
  & npm install
  if ($LASTEXITCODE -ne 0) { throw "Frontend npm install fejlede" }
} finally { Pop-Location }

# --- 5. Build-verifikation ---
Write-Section "Verificer frontend build"

Push-Location (Join-Path $Target "frontend")
try {
  & npm run build
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  [warn] Frontend build fejlede. Maaske mangler .env.local." -ForegroundColor Yellow
    Write-Host "         Setup fortsaetter, men du skal fixe det inden du arbejder." -ForegroundColor Yellow
  } else {
    Write-Host "  [ok] Frontend build lykkedes"
  }
} finally { Pop-Location }

# --- 6. Codex trust-entry ---
Write-Section "Tilfoj target til Codex trust"

$codexConfig = Join-Path $env:USERPROFILE ".codex\config.toml"
$targetLower = $Target.ToLower()

if (Test-Path $codexConfig) {
  $configContent = Get-Content $codexConfig -Raw
  if ($configContent -match [regex]::Escape("[projects.'$targetLower'")) {
    Write-Host "  [ok] Target er allerede trusted"
  } else {
    $trustEntry = "`n[projects.'$targetLower']`ntrust_level = `"trusted`"`n"
    Add-Content -Path $codexConfig -Value $trustEntry -Encoding utf8
    Write-Host "  [ok] Tilfoejet trust-entry"
  }
} else {
  Write-Host "  [info] ~/.codex/config.toml findes ikke. Codex maaske ikke installeret endnu."
  Write-Host "         Naar du installerer Codex, kor scriptet igen for at tilfoeje trust-entry."
}

# --- 7. Install user-level Claude hooks ---
Write-Section "Installer user-level Claude hooks"

$installHooks = Join-Path $Target "scripts\install-user-hooks.ps1"
if (Test-Path $installHooks) {
  Push-Location $Target
  try {
    & pwsh -NoProfile -File $installHooks
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  [warn] install-user-hooks.ps1 fejlede" -ForegroundColor Yellow
    }
  } finally { Pop-Location }
} else {
  Write-Host "  [skip] install-user-hooks.ps1 ikke fundet i target"
}

# --- 8. OneDrive-context links (memory + AI-context) ---
# SCOPE (#327): kun memory-junction og AI-context (codex-local).
# Produktionskritiske secrets (.env, .mcp.json) haandteres nu via Infisical — se trin nedenfor.
Write-Section "OneDrive-context links (memory + AI-context)"

$linkScript = Join-Path $Target "scripts\link-onedrive-context.ps1"
$contextRoot = if ($env:OneDrive) { Join-Path $env:OneDrive "CyclingZone-context" } else { $null }

if (-not (Test-Path $linkScript)) {
  Write-Host "  [skip] link-onedrive-context.ps1 ikke fundet"
} elseif (-not $contextRoot -or -not (Test-Path $contextRoot)) {
  Write-Host "  [warn] OneDrive-context mappe findes ikke endnu paa denne PC." -ForegroundColor Yellow
  Write-Host "         Vent til OneDrive synkroniserer (typisk minutter), og koer derefter:"
  Write-Host "         pwsh -File scripts\link-onedrive-context.ps1"
} else {
  Push-Location $Target
  try {
    & pwsh -NoProfile -File $linkScript -RepoRoot $Target
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  [warn] link-onedrive-context.ps1 fejlede. Tjek output ovenfor." -ForegroundColor Yellow
    }
  } finally { Pop-Location }
}

# --- 9. Discord MCP ---
Write-Section "Discord MCP setup"

$discordSetup = Join-Path $Target "scripts\setup-discord-mcp.ps1"
$mcpAlreadyLinked = Test-Path (Join-Path $Target ".mcp.json")
if ($mcpAlreadyLinked) {
  Write-Host "  [ok] .mcp.json findes allerede. Springer Discord-setup over."
} elseif (Test-Path $discordSetup) {
  $railwayCmd = Get-Command railway -ErrorAction SilentlyContinue
  if ($railwayCmd) {
    Write-Host "  Railway CLI fundet, koerer setup-discord-mcp.ps1..."
    Push-Location $Target
    try {
      & pwsh -NoProfile -File $discordSetup
      if ($LASTEXITCODE -ne 0) {
        Write-Host "  [warn] Discord MCP setup fejlede. Kor manuelt senere." -ForegroundColor Yellow
      }
    } finally { Pop-Location }
  } else {
    Write-Host "  [skip] Railway CLI ikke installeret. Installer den (npm i -g @railway/cli)" -ForegroundColor Yellow
    Write-Host "         og kor: pwsh -File $discordSetup"
  }
} else {
  Write-Host "  [skip] setup-discord-mcp.ps1 ikke fundet"
}

# --- Final ---
Write-Section "Setup faerdig"

Write-Host "  Repo placeret: $Target" -ForegroundColor Green
Write-Host ""
Write-Host "  Tjek folgende efter setup:" -ForegroundColor Yellow
Write-Host "    1. Memory + AI-context sync'es via OneDrive (CyclingZone-context\memory)"
Write-Host "       Hvis OneDrive ikke var synket endnu: kor 'pwsh -File scripts/link-onedrive-context.ps1' senere"
Write-Host ""
Write-Host "    2. PRODUKTIONSSECRETS via Infisical (se docs/CROSS_PC_SETUP.md):" -ForegroundColor Yellow
Write-Host "         a. infisical login"
Write-Host "         b. infisical export --env=dev > backend/.env"
Write-Host "         c. infisical export --env=dev > frontend/.env"
Write-Host "         d. pwsh -File scripts/setup-discord-mcp.ps1  # genererer .mcp.json"
Write-Host ""
Write-Host "    3. Delt handoff ligger i GitHub/OneDrive, ikke lokale agent-caches"
Write-Host "       Tjek docs\NOW.md + relevante GitHub issues foer arbejde paa en anden enhed"
Write-Host ""
Write-Host "    4. Aabn mappen i Claude Code og verificer at MCP-servere er tilgaengelige"
Write-Host "    5. Aabn mappen i Codex og verificer at AGENTS.md er auto-loaded"
Write-Host ""
Write-Host "  Working directory:" -ForegroundColor Cyan
Write-Host "    cd $Target"
