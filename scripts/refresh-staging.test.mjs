import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const lib=fileURLToPath(new URL('./lib/Refresh-Staging-Gates.ps1',import.meta.url));
const hasPwsh=spawnSync('pwsh',['-NoProfile','-Command','exit 0']).status===0;
function run(body){return spawnSync('pwsh',['-NoProfile','-Command',`$ErrorActionPreference='Stop'; . '${lib.replaceAll("'","''")}'; ${body}`],{encoding:'utf8'});}
const hash='0'.repeat(32),other='1'.repeat(32);
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
  assert.match(source,/Assert-RefreshFingerprint/); assert.match(source,/Assert-RefreshPrivacy/);
});
