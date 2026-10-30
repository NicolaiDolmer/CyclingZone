param(
  [string] $PgBin = "$env:USERPROFILE/scoop/apps/postgresql17/current/bin",
  [int] $Port = 55493
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
$scratch = Join-Path ([IO.Path]::GetTempPath()) ("rejoin-7153-" + [guid]::NewGuid())
$dataDir = Join-Path $scratch 'data'
$started = $false
$oldPort = $env:REJOIN_PG_PORT
$oldBin = $env:REJOIN_PG_BIN
try {
  $version = & "$PgBin/psql.exe" --version
  if ($version -notmatch 'PostgreSQL\) 17\.') { throw "PG17 required; found $version" }
  New-Item -ItemType Directory -Path $scratch | Out-Null
  & "$PgBin/initdb.exe" -D $dataDir -U postgres -A trust --encoding=UTF8 --no-locale | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
  $startArgs = @('-D', ('"' + $dataDir + '"'), '-o', ('"-h 127.0.0.1 -p ' + $Port + '"'), '-l', ('"' + "$scratch/postgres.log" + '"'), '-w', 'start')
  $process = Start-Process -FilePath "$PgBin/pg_ctl.exe" -ArgumentList $startArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput "$scratch/start.out" -RedirectStandardError "$scratch/start.err"
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw "pg_ctl start failed; see $scratch/start.err" }
  $started = $true
  $env:REJOIN_PG_PORT = "$Port"
  $env:REJOIN_PG_BIN = $PgBin
  & node --test "$repo/backend/lib/testdb/managerSelectionRejoin.integration.test.js"
  if ($LASTEXITCODE -ne 0) { throw 'PG17 regression failed' }
} finally {
  $env:REJOIN_PG_PORT = $oldPort
  $env:REJOIN_PG_BIN = $oldBin
  if ($started) {
    & "$PgBin/pg_ctl.exe" -D $dataDir -m fast -w stop
    if ($LASTEXITCODE -ne 0) { throw "Local PG17 stop failed: $dataDir" }
    Write-Output 'Local PG17 stopped.'
  }
}
