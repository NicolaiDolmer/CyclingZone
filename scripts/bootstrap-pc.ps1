<#
.SYNOPSIS
  Bootstrap af ny CyclingZone-udvikler-PC: installerer hele vaerktoejskaeden.

.DESCRIPTION
  Dette er LAGET UNDER repo-opsaetningen. Det installerer kun programmer/runtimes
  og roerer ALDRIG secrets. Naar det er faerdigt koerer du det normale flow:
  logins -> setup-new-pc.ps1 (clone + deps) -> setup-local.ps1 (root deps + git hooks)
  -> Infisical-materialisering. Hele koereplanen staar i docs/CROSS_PC_SETUP.md.

  Idempotent: kan koeres igen uden skade (springer allerede-installeret over).

  VIGTIGT - selvbootstrap (hoenen og aegget):
    En frisk Windows 11 har kun Windows PowerShell 5.1. Dette script kraever pwsh 7.
    Foerste gang, i en almindelig PowerShell (5.1) eller cmd:

        winget install --id Microsoft.PowerShell --source winget

    Aaben DEREFTER en ny "PowerShell 7"-terminal og hent + koer scriptet:

        $u = "https://raw.githubusercontent.com/NicolaiDolmer/CyclingZone/main/scripts/bootstrap-pc.ps1"
        Invoke-RestMethod $u | Out-File "$env:TEMP\bootstrap-pc.ps1"
        pwsh -File "$env:TEMP\bootstrap-pc.ps1"

  Koer som ALMINDELIG bruger (ikke admin) - per-bruger-tools (Claude Code, npm -g)
  skal lande i din profil, ikke admins.

.PARAMETER WithDocker
  Installer ogsaa Docker Desktop (kun hvis du vil koere Supabase lokalt). Default: nej.

.EXAMPLE
  pwsh -File scripts/bootstrap-pc.ps1
  pwsh -File scripts/bootstrap-pc.ps1 -WithDocker
#>
[CmdletBinding()]
param(
  [switch]$WithDocker
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Helpers ---------------------------------------------------------------

function Update-SessionPath {
  # Genindlaes PATH i nuvaerende session, saa nyinstallerede tools findes uden genstart.
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

function Install-Winget {
  param(
    [Parameter(Mandatory)][string]$Id,
    [string]$Name = $Id
  )
  $found = winget list --exact --id $Id --accept-source-agreements 2>$null |
           Select-String -SimpleMatch $Id
  if ($found) { Write-Host "  [skip]    $Name (allerede installeret)"; return }
  Write-Host "  [install] $Name"
  winget install --exact --id $Id --silent `
    --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { Write-Warning "  $Name returnerede exit $LASTEXITCODE - fortsaetter." }
}

function Install-Scoop {
  # Per-bruger pakkemanager. Maa IKKE koeres som admin (scriptet enforcer det
  # allerede i sektion 0). Kraever RemoteSigned ExecutionPolicy (sat tidligt).
  if (Get-Command scoop -ErrorAction SilentlyContinue) {
    Write-Host "  [skip]    Scoop (allerede installeret)"
    return
  }
  Write-Host "  [install] Scoop (per-bruger pakkemanager)"
  Invoke-RestMethod -Uri 'https://get.scoop.sh' | Invoke-Expression
  Update-SessionPath
  $scoopShims = Join-Path $env:USERPROFILE 'scoop\shims'
  if ((Test-Path $scoopShims) -and ($env:Path -notlike "*$scoopShims*")) {
    $env:Path = "$scoopShims;$env:Path"
  }
}

function Install-Infisical {
  # Infisical CLI via Scoop. winget-pakken 'Infisical.infisical' er pt. doed
  # (tom/uvedligeholdt manifest), saa vi bruger Infisicals officielle Scoop-bucket.
  if (Get-Command infisical -ErrorAction SilentlyContinue) {
    Write-Host "  [skip]    Infisical CLI (allerede installeret)"
    return
  }
  Install-Scoop
  if (-not (Get-Command scoop -ErrorAction SilentlyContinue)) {
    Write-Warning "  Scoop ikke tilgaengelig - kan ikke installere Infisical. Manuelt: https://infisical.com/docs/cli/overview"
    return
  }
  # 'scoop bucket add' fejler hvis bucket'en allerede findes -> guard (idempotent).
  $bucketList = (scoop bucket list 6>&1 | Out-String)
  if ($bucketList -notmatch '(?im)^\s*infisical\b') {
    scoop bucket add infisical https://github.com/Infisical/scoop-infisical.git
  } else {
    Write-Host "  [skip]    scoop bucket 'infisical' findes allerede"
  }
  scoop install infisical
  if ($LASTEXITCODE -ne 0) { Write-Warning "  Infisical CLI install via Scoop fejlede." }
  else { Write-Host "  [ok]      Infisical CLI (Scoop)" }
  Update-SessionPath
}

# --- 0. Forudsaetninger ----------------------------------------------------

if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw "Koer dette i PowerShell 7 (pwsh), ikke Windows PowerShell 5.1. Se kommentaren oeverst i scriptet."
}
$isAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
  throw "Koer som ALMINDELIG bruger, ikke admin (per-bruger-tools skal lande i din profil)."
}
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw "winget (App Installer) blev ikke fundet. Installer 'App Installer' fra Microsoft Store og proev igen."
}

Write-Host "=== CyclingZone PC-bootstrap ===`n"

# Saet ExecutionPolicy TIDLIGT (CurrentUser, ikke admin-kraevende). Uden dette
# blokerer en frisk Windows 11 baade Scoop-installeren og de efterfoelgende
# child-scripts (setup-new-pc.ps1 m.fl.) - selve dette script slipper kun fordi
# 'pwsh -File' bypasser policy for én fil. Idempotent: kun naar noedvendigt.
$cuPolicy = Get-ExecutionPolicy -Scope CurrentUser
if ($cuPolicy -notin @('RemoteSigned', 'Unrestricted', 'Bypass')) {
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
  Write-Host "  [ok]      ExecutionPolicy CurrentUser -> RemoteSigned"
} else {
  Write-Host "  [skip]    ExecutionPolicy CurrentUser allerede '$cuPolicy'"
}

# --- 1. winget + Scoop: apps og runtimes ----------------------------------

Write-Host "`n[1/8] Pakker (winget + Scoop)"
Install-Winget -Id 'Git.Git'                    -Name 'Git'
Install-Winget -Id 'GitHub.cli'                 -Name 'GitHub CLI'
Install-Winget -Id 'Microsoft.PowerShell'       -Name 'PowerShell 7'
Install-Winget -Id 'Microsoft.WindowsTerminal'  -Name 'Windows Terminal'
Install-Winget -Id 'Microsoft.VisualStudioCode' -Name 'VS Code'
Install-Winget -Id 'OpenJS.NodeJS.LTS'          -Name 'Node.js LTS (24.x - repo kraever >=24 <25)'
Install-Winget -Id 'Python.Python.3.12'         -Name 'Python 3.12 (uci-scraper, import-scripts, skills)'
Install-Winget -Id 'Bitwarden.Bitwarden'        -Name 'Bitwarden (personlige logins + 2FA)'
Install-Winget -Id 'Google.Chrome'              -Name 'Google Chrome (web-dev + Chrome MCP)'
Update-SessionPath

# Infisical CLI via Scoop (winget-pakken er pt. doed) - se Install-Infisical.
Install-Infisical

# --- 2. npm globale CLI'er (Vercel, Railway, Codex) -----------------------

Write-Host "`n[2/8] npm globale CLI'er"
if (Get-Command npm -ErrorAction SilentlyContinue) {
  npm install -g vercel @railway/cli
  if ($LASTEXITCODE -ne 0) { Write-Warning "  vercel/railway global install fejlede." }
  else { Write-Host "  [ok]      vercel + railway" }

  # Codex CLI (AI-dev makker til Claude). Hvis pakkenavnet aendrer sig: https://github.com/openai/codex
  npm install -g @openai/codex
  if ($LASTEXITCODE -ne 0) { Write-Warning "  Codex CLI (@openai/codex) kunne ikke installeres - tjek aktuel kommando paa openai/codex." }
  else { Write-Host "  [ok]      Codex CLI" }
} else {
  Write-Warning "  npm ikke paa PATH endnu. Genstart pwsh og koer scriptet igen (Node-PATH aktiveres efter genstart)."
}

# --- 3. Claude Code (native installer, kraever ikke Node) ------------------

Write-Host "`n[3/8] Claude Code (native installer)"
if (Get-Command claude -ErrorAction SilentlyContinue) {
  Write-Host "  [skip]    Claude Code (allerede installeret)"
} else {
  Invoke-RestMethod -Uri 'https://claude.ai/install.ps1' | Invoke-Expression
  Update-SessionPath
}

# Claude Code's native installer lander i ~/.local/bin, men tilfoejer ikke altid
# mappen til den persistente User-PATH (kun session). Sikr den permanent saa
# 'claude' resolver i nye terminaler. Idempotent.
$localBin  = Join-Path $env:USERPROFILE '.local\bin'
$userPath  = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$localBin*") {
  $newUserPath = (@($userPath, $localBin) | Where-Object { $_ }) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
  Write-Host "  [ok]      ~/.local/bin tilfoejet til User-PATH"
  Update-SessionPath
} else {
  Write-Host "  [skip]    ~/.local/bin allerede i User-PATH"
}

# --- 4. VS Code-extensions -------------------------------------------------

Write-Host "`n[4/8] VS Code-extensions"
if (Get-Command code -ErrorAction SilentlyContinue) {
  $exts = @(
    'dbaeumer.vscode-eslint',          # ESLint
    'esbenp.prettier-vscode',          # Prettier
    'bradlc.vscode-tailwindcss',       # Tailwind (frontend bruger det)
    'eamodio.gitlens',                 # Git-historik
    'editorconfig.editorconfig',
    'ms-playwright.playwright',        # E2E-tests
    'usernamehw.errorlens',            # Inline fejl
    'ms-vscode.powershell',            # .ps1-scripts (repoet har mange)
    'github.vscode-github-actions',    # CI-workflows
    'anthropic.claude-code'            # Claude Code IDE-integration
  )
  foreach ($e in $exts) {
    code --install-extension $e --force *> $null
    if ($LASTEXITCODE -eq 0) { Write-Host "  [ok]      $e" }
    else { Write-Warning "  $e (kunne ikke installeres - tjek extension-id)" }
  }
} else {
  Write-Warning "  'code' ikke paa PATH endnu. Genstart pwsh og koer scriptet igen."
}

# --- 5. Git globale defaults + identitet -----------------------------------

Write-Host "`n[5/8] Git-konfiguration"
if (Get-Command git -ErrorAction SilentlyContinue) {
  git config --global init.defaultBranch main
  $gitName  = git config --global user.name  2>$null
  $gitEmail = git config --global user.email 2>$null
  if (-not $gitName -or -not $gitEmail) {
    Write-Warning "  Git-identitet ikke sat. Saet den (ellers bliver dine commits forkerte):"
    Write-Host '              git config --global user.name  "Dit Navn"'
    Write-Host '              git config --global user.email "din@email.dk"'
  } else {
    Write-Host "  [ok]      git-identitet: $gitName <$gitEmail>"
  }
} else {
  Write-Warning "  git ikke paa PATH endnu. Genstart pwsh og koer scriptet igen."
}

# --- 6. Valgfrit: Docker Desktop -------------------------------------------

Write-Host "`n[6/8] Valgfrit: Docker"
if ($WithDocker) {
  Install-Winget -Id 'Docker.DockerDesktop' -Name 'Docker Desktop'
} else {
  Write-Host "  [skip]    Docker Desktop (brug -WithDocker hvis du vil have lokal Supabase)"
}

# --- 7. Sikkerhedstjek: BitLocker ------------------------------------------

Write-Host "`n[7/8] Sikkerhedstjek (BitLocker)"
try {
  $bl = Get-BitLockerVolume -MountPoint 'C:' -ErrorAction Stop
  if ($bl.ProtectionStatus -ne 'On') {
    Write-Warning "  BitLocker er IKKE aktiv paa C:. Aktiver det og gem recovery key i Bitwarden."
  } else { Write-Host "  [ok]      BitLocker aktiv paa C:" }
} catch {
  Write-Host "  [info]    Kunne ikke laese BitLocker-status (maaske Windows Home). Tjek diskkryptering manuelt."
}

# --- 8. Handoff: hvad du goer naar toolchain er klar -----------------------

Write-Host "`n[8/8] Toolchain faerdig`n"
Write-Host "=== NAESTE SKRIDT (secrets-laget - IKKE en del af dette script) ===`n"

Write-Host "1) GENSTART pwsh (saa Node/PATH/extensions er aktivt)`n"

Write-Host "2) LOG IND paa dine konti (rul Bitwarden + OneDrive FOERST):"
Write-Host "   - Bitwarden        : laas din vault op (alle andre logins ligger her)"
Write-Host "   - OneDrive         : log ind og VENT paa at 'CyclingZone-context' synkroniserer"
Write-Host "                        (Claude-memory + AI-context kommer derfra - kritisk)"
Write-Host "   - gh auth login    : GitHub"
Write-Host "   - infisical login  : secrets (browser-OAuth)"
Write-Host "   - vercel login     : frontend-deploy"
Write-Host "   - railway login    : backend-deploy + Discord-MCP-token"
Write-Host "   - claude           : Anthropic (OAuth ved foerste koersel)"
Write-Host "   - codex            : OpenAI (login ved foerste koersel)`n"

Write-Host "3) HENT + KOER repo-opsaetningen (cloner selv til C:\dev\CyclingZone):"
Write-Host '   $u = "https://raw.githubusercontent.com/NicolaiDolmer/CyclingZone/main/scripts/setup-new-pc.ps1"'
Write-Host '   Invoke-RestMethod $u | Out-File "$env:TEMP\setup-new-pc.ps1"'
Write-Host '   pwsh -File "$env:TEMP\setup-new-pc.ps1"'
Write-Host ""

Write-Host "4) GOER repoet commit-klart (root-deps + git hooks):"
Write-Host "   cd C:\dev\CyclingZone"
Write-Host "   pwsh -File scripts/setup-local.ps1`n"

Write-Host "5) MATERIALISÉR secrets via Infisical (.infisical.json er allerede i repoet"
Write-Host "   - brug 'login', ALDRIG 'infisical init' som ville overskrive linket):"
Write-Host "   infisical run --env=dev -- node backend/scripts/verify-infisical-injection.js`n"

Write-Host "6) VERIFICÉR hele opsaetningen:"
Write-Host "   pwsh -File scripts/agent-doctor.ps1"
Write-Host "   pwsh -File scripts/verify-infisical.ps1`n"

Write-Host "Fuld koereplan: docs/CROSS_PC_SETUP.md (Scenarie 2 - frisk PC)"
