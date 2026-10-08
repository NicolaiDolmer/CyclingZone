import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const lib=fileURLToPath(new URL('./lib/Refresh-Staging-Gates.ps1',import.meta.url));
const hasPwsh=spawnSync('pwsh',['-NoProfile','-Command','exit 0']).status===0;
function run(body){return spawnSync('pwsh',['-NoProfile','-Command',`$ErrorActionPreference='Stop'; . '${lib.replaceAll("'","''")}'; ${body}`],{encoding:'utf8'});}
const hash='0'.repeat(32),other='1'.repeat(32);
const q=(p)=>`'${p.replaceAll("'","''")}'`;
test('schema gate rejects missing objects, changed definitions, count drift and malformed output',{skip:!hasPwsh},()=>{
  for(const value of [`table 1 ${other}`,`table 2 ${hash}`,`index 1 ${hash}`,'','unknown']) assert.notEqual(run(`Assert-RefreshFingerprint 'table 1 ${hash}' '${value}'`).status,0);
});
test('schema gate ignores only backup class differences',{skip:!hasPwsh},()=>{
  assert.equal(run(`Assert-RefreshFingerprint 'table 1 ${hash};backup_table 89 ${hash}' 'table 1 ${hash};backup_table 59 ${other}'`).status,0);
});
test('privacy gate accepts only exact zero',{skip:!hasPwsh},()=>{
  for(const value of ['1','-1','','0 extra','null']) assert.notEqual(run(`Assert-RefreshPrivacy '${value}'`).status,0);
  assert.equal(run("Assert-RefreshPrivacy '0'").status,0);
});
test('restore plan uses a single transaction and stop-on-error',{skip:!hasPwsh},()=>{
  const result=run("@(Get-RefreshRestoreArguments @('a','b','c','d')) | ConvertTo-Json -Compress");
  assert.equal(result.status,0); const args=JSON.parse(result.stdout);
  assert.ok(args.includes('--single-transaction')); assert.ok(args.includes('ON_ERROR_STOP=1'));
  assert.deepEqual(args.filter(value=>value==='-f'),['-f','-f','-f','-f']);
});
test('actual refresh source cannot mask pg_restore failures or issue unconditional GO',()=>{
  const source=readFileSync(new URL('./refresh-staging.ps1',import.meta.url),'utf8');
  assert.doesNotMatch(source,/pg_restore[^\n]*exit 0/);
  assert.match(source,/Invoke-RefreshGates/);
});

const counts=(o)=>Object.entries(o).map(([k,v])=>`${k}|${v}`).join('\n');
const base={riders:100,teams:10,races:50,race_results:5,board_profiles:10,app_config:20,auth_users:30};
test('count gate: staging must lie inside the prod before/after window',{skip:!hasPwsh},()=>{
  const gate=(before,after,stage)=>run(`Assert-RefreshCounts '${counts(before)}' '${counts(after)}' '${counts(stage)}'`);
  assert.equal(gate(base,{...base,auth_users:32},{...base,auth_users:31}).status,0);
  assert.notEqual(gate(base,base,{...base,riders:99}).status,0);
  assert.notEqual(gate(base,{...base,auth_users:32},{...base,auth_users:33}).status,0);
  assert.notEqual(gate(base,base,{...base,riders:0}).status,0);
});
test('count gate: missing table, malformed output and empty output fail closed',{skip:!hasPwsh},()=>{
  const {races,...noRaces}=base;
  assert.notEqual(run(`Assert-RefreshCounts '${counts(base)}' '' '${counts(noRaces)}'`).status,0);
  assert.notEqual(run(`Assert-RefreshCounts '${counts(base)}' '' 'riders=1'`).status,0);
  assert.notEqual(run(`Assert-RefreshCounts '${counts(base)}' '' ''`).status,0);
  assert.notEqual(run(`Assert-RefreshCounts '' '' '${counts(base)}'`).status,0);
});
test('count gate: skip list (LEAN) and fixed slack are the only tolerances',{skip:!hasPwsh},()=>{
  const lean={...base,race_results:0};
  assert.notEqual(run(`Assert-RefreshCounts '${counts(base)}' '' '${counts(lean)}'`).status,0);
  assert.equal(run(`Assert-RefreshCounts '${counts(base)}' '' '${counts(lean)}' -Skip race_results`).status,0);
  assert.equal(run(`Assert-RefreshCounts '${counts(base)}' '' '${counts({...base,app_config:21})}' -Slack @{app_config=1}`).status,0);
  assert.notEqual(run(`Assert-RefreshCounts '${counts(base)}' '' '${counts({...base,app_config:22})}' -Slack @{app_config=1}`).status,0);
});
test('error text never echoes row data, keys or e-mails',{skip:!hasPwsh},()=>{
  const result=run(`Get-RefreshSafeErrorText @('psql:x.sql:9: ERROR:  duplicate key value violates unique constraint "u" for a@b.example','DETAIL:  Key (email)=(secret@real.example) already exists.','CONTEXT:  COPY users, line 5: "secret@real.example"','psql:x.sql:9: ERROR:  Key (id)=(abc) is bad')`);
  assert.equal(result.status,0);
  assert.doesNotMatch(result.stdout,/secret|real\.example|a@b|abc|COPY users|DETAIL/);
  assert.match(result.stdout,/ERROR/);
  assert.match(run("Get-RefreshSafeErrorText @('DETAIL: only row data')").stdout,/suppressed/);
});
test('failed native step throws with exit code and safe text, success returns output',{skip:!hasPwsh},()=>{
  const bad=run("Invoke-RefreshNative { 'ERROR:  boom'; 'DETAIL: Key (e)=(x@y.z)'; $global:LASTEXITCODE=3 } 'Restore'");
  assert.notEqual(bad.status,0); assert.match(bad.stderr,/Restore failed \(exit 3\)/); assert.doesNotMatch(bad.stderr,/x@y\.z/);
  const ok=run("(Invoke-RefreshNative { 'a'; 'b' } 'Step') -join ','");
  assert.equal(ok.status,0); assert.match(ok.stdout,/a,b/);
});
test('restore plan enforces guard, auth, public, cleanup order and real files',{skip:!hasPwsh},()=>{
  const dir=mkdtempSync(join(tmpdir(),'cz-refresh-'));
  try{
    const names=['restore-guard.sql','auth-data.sql','public-progress.sql','restore-sanitize.sql'];
    const paths=names.map(n=>join(dir,n)); for(const p of paths) writeFileSync(p,'select 1;');
    const list=(arr)=>arr.map(q).join(',');
    assert.equal(run(`Get-RefreshRestoreArguments @(${list(paths)}) -RequireFiles | Out-Null`).status,0);
    assert.notEqual(run(`Get-RefreshRestoreArguments @(${list([paths[3],paths[1],paths[2],paths[0]])}) | Out-Null`).status,0);
    assert.notEqual(run(`Get-RefreshRestoreArguments @(${list([paths[0],paths[2],paths[1],paths[3]])}) -RequireFiles | Out-Null`).status,0);
    writeFileSync(paths[2],'');
    assert.notEqual(run(`Get-RefreshRestoreArguments @(${list(paths)}) -RequireFiles | Out-Null`).status,0);
    rmSync(paths[1]);
    assert.notEqual(run(`Get-RefreshRestoreArguments @(${list(paths)}) -RequireFiles | Out-Null`).status,0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('transaction control anywhere in the restore input is rejected',{skip:!hasPwsh},()=>{
  for(const line of ['BEGIN;','commit;','  ROLLBACK ;','START TRANSACTION;','END;']) assert.equal(run(`Test-RefreshTransactionControl '${line}'`).stdout.trim(),'True');
  for(const line of ['select 1;','COPY public.x FROM stdin;','-- commit;']) assert.equal(run(`Test-RefreshTransactionControl '${line}'`).stdout.trim(),'False');
  assert.notEqual(run('Assert-RefreshNoTransactionControl "select 1;`nCOMMIT;" \'x\'').status,0);
});
test('cleanup SQL: auth privacy before anonymizer, no begin/commit, triggers stay off',{skip:!hasPwsh},()=>{
  const anon=readFileSync(new URL('./staging/anonymize-staging.sql',import.meta.url),'utf8');
  assert.match(anon,/^begin;/im); assert.match(anon,/^commit;/im);
  const dir=mkdtempSync(join(tmpdir(),'cz-refresh-'));
  try{
    const f=join(dir,'anon.sql'); writeFileSync(f,anon);
    const r=run(`New-RefreshSanitizeSql ([IO.File]::ReadAllText(${q(f)}))`);
    assert.equal(r.status,0);
    assert.doesNotMatch(r.stdout,/^\s*(begin|commit);/im);
    assert.doesNotMatch(r.stdout,/session_replication_role\s*=\s*origin/i);
    assert.ok(r.stdout.indexOf('update auth.users')>=0 && r.stdout.indexOf('update auth.users')<r.stdout.indexOf('truncate table'));
    assert.notEqual(run('New-RefreshSanitizeSql "select 1;`nset session_replication_role=origin;"').status,0);
    assert.notEqual(run('New-RefreshSanitizeSql "select 1;`nrollback;"').status,0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
const FP=`table 1 ${hash}`;
function gates(stageBody){
  return run(`$global:calls=@(); $files=@{fingerprint='fp';counts='ct';privacy='pv'};
    $prod={param($f) $global:calls+="prod:$f"; if($f -eq 'fp'){'${FP}'}};
    $stage={param($f) $global:calls+="stage:$f"; ${stageBody}};
    try { Invoke-RefreshGates $prod $stage $files '${counts(base)}' '' @() @{} } catch { Write-Output "FAIL:$($_.Exception.Message)" }
    Write-Output ('CALLS:'+($global:calls -join ','))`);
}
const sw=(fp,ct,pv)=>`switch($f){'fp'{'${fp}'} 'ct'{'${ct.replaceAll('\n',';')}'.Split(';')} 'pv'{'${pv}'}}`;
test('gates: GO only when fingerprint, counts and privacy all pass; privacy is the last call',{skip:!hasPwsh},()=>{
  const out=gates(sw(FP,counts(base),'0')).stdout;
  assert.match(out,/^GO/m); assert.match(out,/CALLS:prod:fp,stage:fp,stage:ct,stage:pv/);
});
test('gates: any failing gate stops the sequence, privacy never reached after earlier failure',{skip:!hasPwsh},()=>{
  const fp=gates(sw(`table 1 ${other}`,counts(base),'0')).stdout;
  assert.match(fp,/FAIL:Schema fingerprint mismatch/); assert.doesNotMatch(fp,/stage:ct|stage:pv/);
  const ct=gates(sw(FP,counts({...base,riders:1}),'0')).stdout;
  assert.match(ct,/FAIL:Row count mismatch: riders/); assert.doesNotMatch(ct,/stage:pv/);
  const pv=gates(sw(FP,counts(base),'3')).stdout;
  assert.match(pv,/FAIL:Refresh privacy/); assert.doesNotMatch(pv,/^GO/m);
});
test('refresh script wires gates, atomic restore and dump proof (source contract)',()=>{
  const source=readFileSync(new URL('./refresh-staging.ps1',import.meta.url),'utf8');
  assert.match(source,/Get-RefreshRestoreArguments[^\n]*-RequireFiles/);
  assert.match(source,/New-RefreshSanitizeSql/); assert.match(source,/dump-complete\.marker/);
  assert.match(source,/-SkipDump kraever/);
  assert.ok(source.indexOf('Invoke-RefreshGates')>source.indexOf('Invoke-Staging "psql `$env:STAGING_DB_URL $quoted"'),'gates run after restore');
  assert.ok(source.lastIndexOf('Write-Host "[GO]')>source.indexOf('Invoke-RefreshGates'),'GO printed only after gates');
});
