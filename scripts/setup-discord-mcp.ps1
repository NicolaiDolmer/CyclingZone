# Setup Discord MCP without writing secrets to repo-local files.
#
# This script writes a non-secret .mcp.json in the main repo and worktrees.
# DISCORD_TOKEN must be injected into the parent process environment by the user,
# Infisical, or another secret manager before Claude/Codex starts the MCP server.
#
# Example:
#   pwsh -File scripts/setup-discord-mcp.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "[$msg]" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  ok: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  !!  $msg" -ForegroundColor Yellow }

Write-Step "1/4 Verify local tools"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $nodeCmd -or -not $npmCmd) {
    throw "Node.js/npm was not found on PATH. Install Node.js or run from a shell where npm is available."
}
Write-Ok "Node: $((& $nodeCmd.Source --version) -join ' ')"
Write-Ok "npm: $((& $npmCmd.Source --version) -join ' ')"

if (-not $env:DISCORD_TOKEN) {
    Write-Warn "DISCORD_TOKEN is not set in this shell. .mcp.json will be written without secrets, but the MCP server will only connect after the parent process has DISCORD_TOKEN."
} else {
    Write-Ok "DISCORD_TOKEN is present in environment (value not printed)"
}

Write-Step "2/4 Locate main repo and worktrees"
$mainRepo = (git worktree list | Select-Object -First 1).Trim() -split '\s+' | Select-Object -First 1
if (-not $mainRepo -or -not (Test-Path $mainRepo)) {
    throw "Could not find main repo via 'git worktree list'."
}
Write-Ok "Main repo: $mainRepo"

$worktreeRoots = @($mainRepo)
$wtList = git worktree list
foreach ($entry in $wtList) {
    $path = ($entry -split '\s+')[0]
    if ($path -and (Test-Path $path) -and ($worktreeRoots -notcontains $path)) {
        $worktreeRoots += $path
    }
}

Write-Step "3/4 Write non-secret .mcp.json"
$mcpObject = [ordered]@{
    mcpServers = [ordered]@{
        discord = [ordered]@{
            command = "cmd"
            args = @("/c", "npx", "-y", "mcp-discord")
        }
    }
}
$mcpJson = $mcpObject | ConvertTo-Json -Depth 6

foreach ($root in $worktreeRoots) {
    $target = Join-Path $root ".mcp.json"
    $mcpJson | Out-File -FilePath $target -Encoding utf8 -NoNewline
    Write-Ok ".mcp.json written without inline env secrets: $target"
}

Write-Step "4/4 Verify settings.local.json"
foreach ($root in $worktreeRoots) {
    $settingsPath = Join-Path $root ".claude/settings.local.json"
    if (-not (Test-Path $settingsPath)) {
        $stub = [ordered]@{
            enabledMcpjsonServers = @("discord")
            permissions = [ordered]@{ allow = @() }
        }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $settingsPath) | Out-Null
        $stub | ConvertTo-Json -Depth 5 | Out-File -FilePath $settingsPath -Encoding utf8
        Write-Ok "Created: $settingsPath"
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
        Write-Ok "Already configured: $settingsPath"
        continue
    }
    $obj | ConvertTo-Json -Depth 10 | Out-File -FilePath $settingsPath -Encoding utf8
    Write-Ok "Updated: $settingsPath"
}

Write-Host ""
Write-Host "Discord MCP config is ready." -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Ensure DISCORD_TOKEN is available to the parent Claude/Codex process via Infisical or user env."
Write-Host "  2. Restart Claude/Codex from the project root."
Write-Host "  3. Verify with /mcp; 'discord' should be connected."
