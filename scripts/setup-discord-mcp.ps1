# Setup Discord MCP (read-only, REST) without writing secrets to repo-local files.
#
# Idempotent. Run once per PC, and again after scripts/discord/mcp-readonly-server.mjs changes:
#   pwsh -File scripts/setup-discord-mcp.ps1
#   pwsh -File scripts/setup-discord-mcp.ps1 -SyncTokenFromInfisical   # new PC / rotated token
#
# What it does (#5484):
#   1. Installs scripts/discord/mcp-readonly-server.mjs to %LOCALAPPDATA%\CyclingZone\discord-mcp\
#      (outside the checkout, so the server works no matter which branch a checkout is on).
#   2. Writes a non-secret .mcp.json to the main repo, every worktree and the OneDrive
#      source file that new worktrees hardlink from (setup-worktree.ps1). In-place writes
#      keep existing hardlinks intact.
#   3. Ensures DISCORD_TOKEN exists as a User env var (optionally synced from Infisical dev),
#      and checks it against Discord REST (read-only GET /users/@me). Never prints the value.
#   4. Disables the discord@claude-plugins-official channel plugin. It is a two-way chat
#      bridge that needs Bun + --channels + pairing; it is not used and failed on every start.
#   5. Ensures .claude/settings.local.json enables the "discord" .mcp.json server.
#   6. Smoke-tests the MCP handshake.

param(
    [switch]$SyncTokenFromInfisical
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "[$msg]" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  ok: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  !!  $msg" -ForegroundColor Yellow }

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Write-Step "1/6 Install read-only Discord MCP server"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw "Node.js was not found on PATH." }
Write-Ok "Node: $(& $nodeCmd.Source --version)"

$serverSrc = Join-Path $repoRoot "scripts\discord\mcp-readonly-server.mjs"
if (-not (Test-Path $serverSrc)) { throw "Missing $serverSrc - run from an up-to-date checkout." }
$installDir = Join-Path $env:LOCALAPPDATA "CyclingZone\discord-mcp"
$serverDst = Join-Path $installDir "mcp-readonly-server.mjs"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$srcHash = (Get-FileHash $serverSrc -Algorithm SHA256).Hash
$dstHash = if (Test-Path $serverDst) { (Get-FileHash $serverDst -Algorithm SHA256).Hash } else { "" }
if ($srcHash -ne $dstHash) {
    Copy-Item $serverSrc $serverDst -Force
    Write-Ok "Installed: $serverDst"
} else {
    Write-Ok "Already up to date: $serverDst"
}

Write-Step "2/6 Write non-secret .mcp.json"
# ${LOCALAPPDATA} is expanded by Claude Code, so one file works on every PC and user.
$mcpJson = @'
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["${LOCALAPPDATA}/CyclingZone/discord-mcp/mcp-readonly-server.mjs"]
    }
  }
}
'@

$mainRepo = ((git -C $repoRoot worktree list | Select-Object -First 1) -split '\s+')[0]
$targets = [System.Collections.Generic.List[string]]::new()
foreach ($entry in (git -C $repoRoot worktree list)) {
    $path = ($entry -split '\s+')[0]
    if ($path -and (Test-Path $path)) { $targets.Add((Join-Path $path ".mcp.json")) }
}
if ($env:OneDrive) {
    $oneDriveMcp = Join-Path $env:OneDrive "CyclingZone-context\secrets\mcp.json"
    if (Test-Path $oneDriveMcp) { $targets.Add($oneDriveMcp) }
}
$written = 0
foreach ($target in $targets) {
    # WriteAllText truncates in place, so hardlinked worktree copies follow along.
    [System.IO.File]::WriteAllText($target, $mcpJson, $utf8NoBom)
    $written++
}
Write-Ok ".mcp.json written without secrets to $written file(s) (main: $mainRepo)"

Write-Step "3/6 DISCORD_TOKEN (User env var; value never printed)"
if ($SyncTokenFromInfisical) {
    $infisical = Get-Command infisical -ErrorAction SilentlyContinue
    if (-not $infisical) { throw "infisical CLI not found. Install it (docs/CROSS_PC_SETUP.md) and run 'infisical login'." }
    Push-Location $repoRoot
    try {
        # The value travels only via the child's environment, never via stdout or the command line.
        & infisical run --env=dev --silent -- pwsh -NoProfile -Command 'if (-not $env:DISCORD_TOKEN) { exit 3 }; [Environment]::SetEnvironmentVariable(''DISCORD_TOKEN'', $env:DISCORD_TOKEN, ''User'')'
        if ($LASTEXITCODE -ne 0) { throw "Could not sync DISCORD_TOKEN from Infisical dev (exit $LASTEXITCODE)." }
    } finally { Pop-Location }
    Write-Ok "DISCORD_TOKEN synced from Infisical dev to the User environment"
}
$userToken = [Environment]::GetEnvironmentVariable('DISCORD_TOKEN', 'User')
if (-not $userToken) {
    Write-Warn "DISCORD_TOKEN is not a User env var. Claude Code starts the server with its own environment, so tools will fail."
    Write-Warn "Fix: pwsh -File scripts/setup-discord-mcp.ps1 -SyncTokenFromInfisical"
} else {
    $env:CZ_DISCORD_PROBE_TOKEN = $userToken
    try {
        $probe = & node -e "fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:'Bot '+process.env.CZ_DISCORD_PROBE_TOKEN}}).then(async r=>{const b=r.ok?await r.json():{};console.log(r.status+' '+(b.username||''))}).catch(e=>console.log('ERR '+e.message))"
    } finally { Remove-Item Env:CZ_DISCORD_PROBE_TOKEN -ErrorAction SilentlyContinue }
    if ($probe -like '200 *') {
        Write-Ok "DISCORD_TOKEN is valid (bot: $($probe.Substring(4)))"
    } else {
        Write-Warn "DISCORD_TOKEN check failed: HTTP $probe. Rotated? Run with -SyncTokenFromInfisical."
    }
}

Write-Step "4/6 Disable unused Discord channel plugin"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
$pluginId = "discord@claude-plugins-official"
$pluginEnabled = $false
if (Test-Path $settingsPath) {
    $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
    if ($settings.PSObject.Properties.Name -contains 'enabledPlugins' -and
        $settings.enabledPlugins.PSObject.Properties.Name -contains $pluginId) {
        $pluginEnabled = [bool]$settings.enabledPlugins.$pluginId
    }
}
if (-not $pluginEnabled) {
    Write-Ok "$pluginId is not enabled"
} elseif (Get-Command claude -ErrorAction SilentlyContinue) {
    & claude plugin disable $pluginId --scope user | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Ok "Disabled $pluginId (re-enable: claude plugin enable $pluginId)" }
    else { Write-Warn "claude plugin disable failed (exit $LASTEXITCODE). Disable it under /plugin." }
} else {
    Write-Warn "claude CLI not on PATH. Disable $pluginId under /plugin in Claude Code."
}

Write-Step "5/6 Verify settings.local.json"
foreach ($entry in (git -C $repoRoot worktree list)) {
    $root = ($entry -split '\s+')[0]
    if (-not ($root -and (Test-Path $root))) { continue }
    $localSettings = Join-Path $root ".claude/settings.local.json"
    if (-not (Test-Path $localSettings)) {
        $stub = [ordered]@{
            enabledMcpjsonServers = @("discord")
            permissions = [ordered]@{ allow = @() }
        }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $localSettings) | Out-Null
        $stub | ConvertTo-Json -Depth 5 | Out-File -FilePath $localSettings -Encoding utf8
        Write-Ok "Created: $localSettings"
        continue
    }
    $obj = Get-Content $localSettings -Raw | ConvertFrom-Json
    $hasField = $obj.PSObject.Properties.Name -contains 'enabledMcpjsonServers'
    if (-not $hasField) {
        $obj | Add-Member -NotePropertyName enabledMcpjsonServers -NotePropertyValue @("discord") -Force
    } elseif ($obj.enabledMcpjsonServers -notcontains 'discord') {
        $obj.enabledMcpjsonServers = @($obj.enabledMcpjsonServers) + 'discord'
    } else {
        continue
    }
    $obj | ConvertTo-Json -Depth 10 | Out-File -FilePath $localSettings -Encoding utf8
    Write-Ok "Updated: $localSettings"
}
Write-Ok "enabledMcpjsonServers contains discord in all checkouts"

Write-Step "6/6 Smoke-test MCP handshake"
$handshake = & node -e @"
const { spawn } = require('node:child_process');
const t0 = Date.now();
const c = spawn(process.execPath, [process.argv[1]], { stdio: ['pipe', 'pipe', 'ignore'] });
let buf = '';
const fail = setTimeout(() => { console.log('TIMEOUT'); c.kill(); process.exit(1); }, 10000);
c.stdout.on('data', (d) => {
  buf += d;
  for (const line of buf.split('\n').slice(0, -1)) {
    const m = JSON.parse(line);
    if (m.id === 2) { clearTimeout(fail); console.log((Date.now() - t0) + 'ms ' + m.result.tools.length + ' tools'); c.kill(); process.exit(0); }
  }
});
c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
"@ $serverDst
if ($LASTEXITCODE -eq 0) { Write-Ok "Handshake $handshake" } else { Write-Warn "Handshake failed: $handshake" }

Write-Host ""
Write-Host "Discord MCP is ready. Start a NEW Claude Code session (MCP servers load at startup)." -ForegroundColor Green
Write-Host "Verify: /mcp shows 'discord' connected; mcp__discord__discord_read_messages can read a channel."
