# Setup Discord MCP — autonom på tværs af PC'er.
# Henter DISCORD_BOT_TOKEN fra Railway og skriver .mcp.json i main repo + alle worktrees.
#
# Eksempel: pwsh -File scripts/setup-discord-mcp.ps1
#
# Forudsætninger (script tjekker og guider):
#   - Node.js + npm
#   - Railway CLI (installeres automatisk hvis mangler)
#   - Railway-login (én gang pr. PC — script åbner browser hvis nødvendigt)
#   - Projekt linket (script kører `railway link` interaktivt hvis nødvendigt)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "[$msg]" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  ok: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  !!  $msg" -ForegroundColor Yellow }

# 1. Verificér Railway CLI
Write-Step "1/6 Railway CLI"
$railwayCmd = Get-Command railway -ErrorAction SilentlyContinue
if (-not $railwayCmd) {
    Write-Warn "Railway CLI ikke fundet — installerer globalt via npm"
    npm install -g "@railway/cli" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Kunne ikke installere Railway CLI. Kør 'npm install -g @railway/cli' manuelt."
    }
    Write-Ok "Railway CLI installeret"
} else {
    Write-Ok "Railway CLI: $((railway --version) -join ' ')"
}

# 2. Login
Write-Step "2/6 Railway-login"
$whoami = railway whoami 2>&1
if ($whoami -match "Unauthorized" -or $LASTEXITCODE -ne 0) {
    Write-Warn "Ikke logget ind på Railway"
    Write-Host "    Browseren åbnes nu — log ind, derefter fortsætter scriptet automatisk." -ForegroundColor Yellow
    railway login
    if ($LASTEXITCODE -ne 0) {
        throw "Railway login fejlede. Kør 'railway login' manuelt og prøv scriptet igen."
    }
    Write-Ok "Logget ind på Railway"
} else {
    Write-Ok "Allerede logget ind: $whoami"
}

# 3. Link projekt (skal køre fra main repo, ikke worktree)
$mainRepo = (git worktree list | Select-Object -First 1).Trim() -split '\s+' | Select-Object -First 1
if (-not $mainRepo -or -not (Test-Path $mainRepo)) {
    throw "Kunne ikke finde main repo via 'git worktree list'."
}

Write-Step "3/6 Link Railway-projekt"
Push-Location $mainRepo
try {
    $status = railway status 2>&1
    if ($status -match "No linked project" -or $status -match "Project Token not found" -or $LASTEXITCODE -ne 0) {
        Write-Warn "Intet Railway-projekt linket i main repo"
        Write-Host "    Vælg projekt + environment + service fra listen." -ForegroundColor Yellow
        railway link
        if ($LASTEXITCODE -ne 0) {
            throw "Railway link fejlede. Kør 'railway link' manuelt i $mainRepo og prøv scriptet igen."
        }
        Write-Ok "Projekt linket"
    } else {
        Write-Ok "Projekt allerede linket"
    }
} finally {
    Pop-Location
}

# 4. Hent DISCORD_BOT_TOKEN
Write-Step "4/6 Hent DISCORD_BOT_TOKEN"
Push-Location $mainRepo
$token = $null
try {
    $kv = railway variables --kv 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Kunne ikke hente Railway variables: $kv"
    }
    foreach ($line in $kv -split "`r?`n") {
        if ($line -match '^DISCORD_BOT_TOKEN=(.+)$') {
            $token = $Matches[1].Trim('"').Trim()
            break
        }
    }
} finally {
    Pop-Location
}

if (-not $token) {
    throw "DISCORD_BOT_TOKEN ikke fundet i Railway-variables. Tjek at du har valgt den korrekte service ved 'railway link'."
}
Write-Ok "Token hentet (længde: $($token.Length))"

# 5. Skriv .mcp.json til main repo + alle worktrees
Write-Step "5/6 Skriv .mcp.json"
$mcpObject = [ordered]@{
    mcpServers = [ordered]@{
        discord = [ordered]@{
            command = "cmd"
            args = @("/c", "npx", "-y", "mcp-discord")
            env = [ordered]@{
                DISCORD_TOKEN = $token
            }
        }
    }
}
$mcpJson = $mcpObject | ConvertTo-Json -Depth 6

$worktreeRoots = @($mainRepo)
$wtList = git worktree list
foreach ($entry in $wtList) {
    $path = ($entry -split '\s+')[0]
    if ($path -and (Test-Path $path) -and ($worktreeRoots -notcontains $path)) {
        $worktreeRoots += $path
    }
}

foreach ($root in $worktreeRoots) {
    $target = Join-Path $root ".mcp.json"
    $mcpJson | Out-File -FilePath $target -Encoding utf8 -NoNewline
    Write-Ok ".mcp.json skrevet: $target"
}

# 6. Verificér settings.local.json har enabledMcpjsonServers
Write-Step "6/6 Verificér settings.local.json"
foreach ($root in $worktreeRoots) {
    $settingsPath = Join-Path $root ".claude/settings.local.json"
    if (-not (Test-Path $settingsPath)) {
        $stub = [ordered]@{
            enabledMcpjsonServers = @("discord")
            permissions = [ordered]@{ allow = @() }
        }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $settingsPath) | Out-Null
        $stub | ConvertTo-Json -Depth 5 | Out-File -FilePath $settingsPath -Encoding utf8
        Write-Ok "Oprettet: $settingsPath"
        continue
    }
    $raw = Get-Content $settingsPath -Raw
    $obj = $raw | ConvertFrom-Json
    $hasField = $obj.PSObject.Properties.Name -contains 'enabledMcpjsonServers'
    if (-not $hasField) {
        $obj | Add-Member -NotePropertyName enabledMcpjsonServers -NotePropertyValue @("discord") -Force
    } elseif ($obj.enabledMcpjsonServers -notcontains 'discord') {
        $obj.enabledMcpjsonServers = @($obj.enabledMcpjsonServers) + 'discord'
    } else {
        Write-Ok "Allerede konfigureret: $settingsPath"
        continue
    }
    $obj | ConvertTo-Json -Depth 10 | Out-File -FilePath $settingsPath -Encoding utf8
    Write-Ok "Opdateret: $settingsPath"
}

Write-Host ""
Write-Host "Discord MCP er klar." -ForegroundColor Green
Write-Host "Næste skridt:" -ForegroundColor Yellow
Write-Host "  1. Genstart Claude Code (MCP loades kun ved opstart)"
Write-Host "  2. Verificér med /mcp — 'discord' skal stå som connected"
