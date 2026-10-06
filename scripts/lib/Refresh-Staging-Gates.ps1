# No credentials or database execution here; deterministic fail-closed gates.
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

function Get-RefreshRestoreArguments([string[]]$Files) {
  if($Files.Count -lt 4){throw 'Incomplete atomic restore plan'}
  $restoreOptions=@('--single-transaction','-v','ON_ERROR_STOP=1','-q')
  foreach($file in $Files){$restoreOptions+=@('-f',$file)}
  return $restoreOptions
}
