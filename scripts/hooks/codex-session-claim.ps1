param([ValidateSet('start','stop')] [string] $Mode = 'start', [long] $NowMs = 0)
$ErrorActionPreference = 'Stop'
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$sessionId = [string]$payload.session_id
if ($sessionId -notmatch '^[A-Za-z0-9_-]{1,120}$') { throw 'Codex session claim requires a valid session_id' }
$common = (& git rev-parse --path-format=absolute --git-common-dir).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot locate shared session registry' }
$root = Split-Path -Parent $common
$directory = Join-Path $root '.claude/run/agent-sessions'
$file = Join-Path $directory "codex-$sessionId.json"
if ($Mode -eq 'stop') {
  if (Test-Path -LiteralPath $file) {
    $claim = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    if ($claim.sessionId -ne $sessionId -or $claim.runtime -ne 'codex') { throw 'Foreign session claim' }
    Remove-Item -LiteralPath $file
  }
  exit 0
}
New-Item -ItemType Directory -Path $directory -Force | Out-Null
if (Test-Path -LiteralPath $file) { exit 0 }
$cwd = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot locate session worktree' }
if ($NowMs -eq 0) { $NowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
$data = @{ runtime='codex'; sessionId=$sessionId; cwd=$cwd; startedAt=$NowMs } | ConvertTo-Json -Compress
$stream = [System.IO.File]::Open($file, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
try { $bytes = [System.Text.Encoding]::UTF8.GetBytes($data); $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
