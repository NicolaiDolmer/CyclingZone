param(
  [string] $PgBin = "$env:USERPROFILE/scoop/apps/postgresql17/current/bin",
  [int] $Port = 55487
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
$scratch = Join-Path ([IO.Path]::GetTempPath()) ("race-identity-6857-" + [guid]::NewGuid())
$dataDir = Join-Path $scratch 'data'
$started = $false
function Sql([string] $Statement) {
  # Fixtures exceed Windows' command-line limit; always pass SQL through a file.
  $sqlFile = Join-Path $scratch 'query.sql'
  [IO.File]::WriteAllText($sqlFile, $Statement, [Text.UTF8Encoding]::new($false))
  $result = & "$PgBin/psql.exe" -X -h 127.0.0.1 -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -tA -f $sqlFile
  if ($LASTEXITCODE -ne 0) { throw 'Local PG17 SQL failed' }
  return $result
}
try {
  $version = & "$PgBin/psql.exe" --version
  if ($version -notmatch 'PostgreSQL\) 17\.') { throw "PG17 required; found $version" }
  Write-Output $version
  New-Item -ItemType Directory -Path $scratch | Out-Null
  & "$PgBin/initdb.exe" -D $dataDir -U postgres -A trust --encoding=UTF8 --no-locale | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
  # A detached postgres inherits pipeline handles on Windows. Separate file handles
  # let pg_ctl return without PowerShell waiting for the server's lifetime.
  $startArgs = @('-D', ('"' + $dataDir + '"'), '-o', ('"-h 127.0.0.1 -p ' + $Port + '"'), '-l', ('"' + "$scratch/postgres.log" + '"'), '-w', 'start')
  $pgStart = Start-Process -FilePath "$PgBin/pg_ctl.exe" -ArgumentList $startArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput "$scratch/start.out" -RedirectStandardError "$scratch/start.err"
  $pgStart.WaitForExit()
  if ($pgStart.ExitCode -ne 0) { throw "pg_ctl start failed; see $scratch/start.err" }
  $started = $true
  $fixture = Get-Content "$repo/backend/lib/__fixtures__/racePoolCatalog.prod.json" -Raw | ConvertFrom-Json
  $rows = $fixture.catalog | Select-Object id,external_id,race_type,race_class,name | ConvertTo-Json -Compress
  $escaped = $rows.Replace("'", "''")
  Sql "CREATE TABLE public.race_pool(id uuid PRIMARY KEY, external_id text, race_type text, race_class text, name text); INSERT INTO public.race_pool SELECT * FROM jsonb_populate_recordset(null::public.race_pool, '$escaped'::jsonb);" | Out-Null
  $fingerprint = "SELECT count(*)::text || ':' || md5(string_agg((to_jsonb(r) - 'race_identity_type' - 'signature' - 'authored_route')::text, ',' ORDER BY id)) FROM public.race_pool r"
  $before = Sql $fingerprint
  Write-Output "Baseline rows:fingerprint $before"
  Write-Output ("Baseline identity columns: " + (Sql "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='race_pool' AND column_name IN ('race_identity_type','signature','authored_route')"))
  for ($run = 1; $run -le 2; $run++) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    & "$PgBin/psql.exe" -X -h 127.0.0.1 -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -f "$repo/database/2026-10-19-6857-race-identity.sql" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Migration run $run failed" }
    $watch.Stop()
    Write-Output "Migration run $run passed ($($watch.ElapsedMilliseconds) ms)"
  }
  if ((Sql $fingerprint) -ne $before) { throw 'Existing catalog changed' }
  $nulls = Sql "SELECT count(*) FROM public.race_pool WHERE race_identity_type IS NULL AND signature IS NULL AND authored_route IS NULL"
  if ([int]$nulls -ne $fixture.catalog.Count) { throw 'Legacy NULL defaults changed' }
  Sql @'
DO $$
DECLARE identity_type text;
BEGIN
  FOREACH identity_type IN ARRAY ARRAY['sprinters','climbers_gt_prelude','hilly','cobbles_benelux','time_trial','gravel','mountains_first','allround'] LOOP
    UPDATE public.race_pool SET race_identity_type = identity_type;
  END LOOP;
  BEGIN
    UPDATE public.race_pool SET race_identity_type = 'invalid';
    RAISE EXCEPTION 'Invalid identity was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.race_pool SET race_identity_type = NULL;
END $$;
'@ | Out-Null
  Sql "SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, 'NULL') FROM information_schema.columns WHERE table_schema='public' AND table_name='race_pool' AND column_name IN ('race_identity_type','signature','authored_route') ORDER BY column_name"
  Write-Output 'PASS: two applications, preserved catalog, NULL defaults, eight allowed types, invalid type rejected.'
} finally {
  if ($started) {
    & "$PgBin/pg_ctl.exe" -D $dataDir -m fast -w stop
    if ($LASTEXITCODE -ne 0) { throw "Local PG17 stop failed: $dataDir" }
    Write-Output 'Local PG17 stopped.'
  }
  # Keep local diagnostics in the uniquely named temp directory; no recursive deletion.
}
