# Ejer 4/11: 'beat' = livstegn pr. tur (Codex Stop-hook); 'prune' = arkivér claims uden
# livstegn i over -StaleHours (SessionEnd fyrer ikke altid, saa claims blev liggende i uger).
param([ValidateSet('start','stop','beat','prune')] [string] $Mode = 'start', [long] $NowMs = 0, [int] $StaleHours = 48)
$ErrorActionPreference = 'Stop'
if ($NowMs -eq 0) { $NowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
if ($Mode -eq 'prune') {
  $common = (& git rev-parse --path-format=absolute --git-common-dir).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Cannot locate shared session registry' }
  $directory = Join-Path (Split-Path -Parent $common) '.claude/run/agent-sessions'
  if (-not (Test-Path -LiteralPath $directory)) { exit 0 }
  $archive = Join-Path $directory 'archive'
  foreach ($f in Get-ChildItem -LiteralPath $directory -Filter 'codex-*.json' -File) {
    try { $c = Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json } catch { continue }
    $last = if ($c.lastSeenAt) { [long]$c.lastSeenAt } else { [long]$c.startedAt }
    if (($NowMs - $last) -gt ([long]$StaleHours * 3600000)) {
      New-Item -ItemType Directory -Path $archive -Force | Out-Null
      Move-Item -LiteralPath $f.FullName -Destination (Join-Path $archive $f.Name) -Force
      Write-Output "Arkiveret: $($f.Name) (intet livstegn i over $StaleHours t)"
    }
  }
  exit 0
}
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
if ($Mode -eq 'beat') {
  if (Test-Path -LiteralPath $file) {
    $claim = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    if ($claim.sessionId -ne $sessionId -or $claim.runtime -ne 'codex') { throw 'Foreign session claim' }
    $data = @{ runtime='codex'; sessionId=$sessionId; cwd=$claim.cwd; startedAt=$claim.startedAt; lastSeenAt=$NowMs } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($file, $data)
  }
  exit 0
}
New-Item -ItemType Directory -Path $directory -Force | Out-Null
if (Test-Path -LiteralPath $file) { exit 0 }
$cwd = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot locate session worktree' }
$data = @{ runtime='codex'; sessionId=$sessionId; cwd=$cwd; startedAt=$NowMs } | ConvertTo-Json -Compress
$stream = [System.IO.File]::Open($file, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
try { $bytes = [System.Text.Encoding]::UTF8.GetBytes($data); $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
