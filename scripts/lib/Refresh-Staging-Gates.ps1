# No credentials or database execution here; deterministic fail-closed gates.
# Every function throws on doubt. The caller never continues after a throw.

function Assert-RefreshFingerprint([string]$Prod,[string]$Staging) {
  function Parse-Fingerprint([string]$Text) {
    $result=@{}
    foreach($part in ($Text -split ';|\r?\n')) {
      $line=$part.Trim(); if(-not $line){continue}
      if($line -notmatch '^([a-z_]+) ([0-9]+) ([0-9a-f]{32})$'){throw 'Invalid schema fingerprint'}
      if($result.ContainsKey($Matches[1])){throw 'Duplicate schema fingerprint kind'}
      if($Matches[1] -ne 'backup_table'){$result[$Matches[1]]=$Matches[2]+' '+$Matches[3]}
    }
    if($result.Count -eq 0){throw 'Empty schema fingerprint'}
    return $result
  }
  $a=Parse-Fingerprint $Prod; $b=Parse-Fingerprint $Staging
  foreach($kind in @(@($a.Keys)+@($b.Keys)|Select-Object -Unique)) {
    if(-not $a.ContainsKey($kind) -or -not $b.ContainsKey($kind) -or $a[$kind] -ne $b[$kind]){throw "Schema fingerprint mismatch: $kind"}
  }
}

function Assert-RefreshPrivacy([string]$Count) {
  if($Count.Trim() -ne '0'){throw 'Refresh privacy verification failed; no GO'}
}

# Row-count compare (psql -tA output, "name|count" per line). Prod is live, so staging must lie
# between the prod counts taken before and after the dump. Tables dumped without data (LEAN) are
# listed in $Skip; $Slack allows a fixed upper surplus (e.g. rows the cleanup itself inserts).
function Assert-RefreshCounts([string]$ProdBefore,[string]$ProdAfter,[string]$Staging,[string[]]$Skip=@(),[hashtable]$Slack=@{}) {
  function Parse-Counts([string]$Text) {
    $result=@{}
    foreach($raw in ($Text -split '\r?\n')) {
      $line=$raw.Trim(); if(-not $line){continue}
      if($line -notmatch '^([a-z_]+)\|([0-9]+)$'){throw 'Invalid row count output'}
      if($result.ContainsKey($Matches[1])){throw 'Duplicate row count table'}
      $result[$Matches[1]]=[int64]$Matches[2]
    }
    if($result.Count -eq 0){throw 'Empty row count output'}
    return $result
  }
  if(-not $ProdAfter -or -not $ProdAfter.Trim()){$ProdAfter=$ProdBefore}
  $b=Parse-Counts $ProdBefore; $a=Parse-Counts $ProdAfter; $s=Parse-Counts $Staging
  $names=@(@($a.Keys)+@($b.Keys)+@($s.Keys)|Select-Object -Unique)
  foreach($name in $names) {
    if(-not ($a.ContainsKey($name) -and $b.ContainsKey($name) -and $s.ContainsKey($name))){throw "Row count table missing: $name"}
  }
  foreach($name in $names) {
    if($Skip -contains $name){continue}
    $lo=[Math]::Min($a[$name],$b[$name]); $hi=[Math]::Max($a[$name],$b[$name])
    if($Slack.ContainsKey($name)){$hi+=[int64]$Slack[$name]}
    if($s[$name] -lt $lo -or $s[$name] -gt $hi){throw "Row count mismatch: $name (staging $($s[$name]), prod $lo..$hi)"}
  }
}

# psql/pg_restore error text can echo row data (DETAIL, CONTEXT, Key (...)=(...)). Only ERROR/FATAL
# lines survive, with key values and e-mail addresses masked.
function Get-RefreshSafeErrorText([string[]]$Lines) {
  $keep=@()
  foreach($line in @($Lines)) {
    if($null -eq $line){continue}
    if($line -notmatch '(?i)^(psql:[^:]*:[0-9]+: )?(error|fatal):'){continue}
    $safe=[regex]::Replace($line,'\([^)]*\)=\([^)]*\)','(<masked>)')
    $safe=[regex]::Replace($safe,'[^\s''"]+@[^\s''"]+','<masked-email>')
    if($safe.Length -gt 300){$safe=$safe.Substring(0,300)}
    $keep+=$safe
    if($keep.Count -ge 5){break}
  }
  if($keep.Count -eq 0){return '(output suppressed)'}
  return ($keep -join ' | ')
}

# Runs a native step, merges stderr, and throws on any non-zero exit with a PII-safe message.
# Returns the output lines (stdout and stderr) on success.
function Invoke-RefreshNative([scriptblock]$Run,[string]$Step) {
  $global:LASTEXITCODE=0
  $out=@(& $Run 2>&1 | ForEach-Object { "$_" })
  $code=$global:LASTEXITCODE
  if($code -ne 0){throw "$Step failed (exit $code). $(Get-RefreshSafeErrorText $out)"}
  return $out
}

function Test-RefreshTransactionControl([string]$Line) {
  return ($Line -match '(?i)^\s*(begin|commit|rollback|end|start\s+transaction|abort)(\s+work|\s+transaction)?\s*;\s*$')
}

# The restore must be ONE transaction. Any embedded transaction control would split it.
function Assert-RefreshNoTransactionControl([string]$Sql,[string]$Name) {
  foreach($line in ($Sql -split '\r?\n')) {
    if(Test-RefreshTransactionControl $line){throw "Transaction control found in $Name; restore would not be atomic"}
  }
}

# Ordering contract: guard first, auth users before public data (FK), cleanup last.
function Get-RefreshRestoreArguments([string[]]$Files,[switch]$RequireFiles) {
  if($Files.Count -lt 4){throw 'Incomplete atomic restore plan'}
  $expected=@('restore-guard.sql','auth-data.sql','public-progress.sql','restore-sanitize.sql')
  $leaves=@($Files|ForEach-Object { Split-Path -Leaf $_ })
  $named=@($leaves|Where-Object { $expected -contains $_ })
  if($RequireFiles -or $named.Count -gt 0){
    if(($leaves -join '|') -ne ($expected -join '|')){throw 'Restore plan order violated: guard, auth, public, cleanup'}
  }
  if($RequireFiles){
    foreach($file in $Files){
      if(-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -eq 0){throw "Restore input missing or empty: $(Split-Path -Leaf $file)"}
    }
  }
  $restoreOptions=@('--single-transaction','-v','ON_ERROR_STOP=1','-q')
  foreach($file in $Files){$restoreOptions+=@('-f',$file)}
  return $restoreOptions
}

# Cleanup SQL: auth privacy first, then the shared anonymizer. Triggers stay disabled (replica role
# set by the guard file) for the whole transaction so cleanup cannot spawn new outbox/notification rows.
function New-RefreshSanitizeSql([string]$AnonSql) {
  $anon=[regex]::Replace($AnonSql,'(?im)^\s*(begin|commit);\s*$','')
  Assert-RefreshNoTransactionControl $anon 'anonymize-staging.sql'
  $authPrivacy=@'
update auth.users set email='loadtest-' || id::text || '@loadtest.invalid', phone=null,
  encrypted_password='', raw_user_meta_data='{}'::jsonb, raw_app_meta_data='{}'::jsonb;
'@
  $sql=$authPrivacy+"`n"+$anon
  if($sql -match '(?i)session_replication_role\s*=\s*origin'){throw 'Cleanup must not re-enable triggers before anonymization'}
  return $sql
}

# Gate sequence after a restore (or in -VerifyOnly). Callers pass scriptblocks that run a SQL file
# and return output lines. The privacy count is deliberately the LAST database call.
function Invoke-RefreshGates([scriptblock]$ProdCall,[scriptblock]$StageCall,[hashtable]$Files,[string]$ProdCountsBefore,[string]$ProdCountsAfter,[string[]]$Skip=@(),[hashtable]$Slack=@{}) {
  $prodFp=@(& $ProdCall $Files.fingerprint) -join "`n"
  $stageFp=@(& $StageCall $Files.fingerprint) -join "`n"
  Assert-RefreshFingerprint $prodFp $stageFp
  $stageCounts=@(& $StageCall $Files.counts) -join "`n"
  Assert-RefreshCounts $ProdCountsBefore $ProdCountsAfter $stageCounts $Skip $Slack
  $privacy=@(& $StageCall $Files.privacy) -join "`n"
  Assert-RefreshPrivacy $privacy
  return 'GO'
}
