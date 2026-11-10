import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(new URL('./lib/stacked-prs.ps1', import.meta.url)).replaceAll("'", "''");
const source = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8');
const sha = 'a'.repeat(40);
function run(options = {}) {
  const fixture = JSON.stringify({ children: [2, 3], preview: false, ...options }).replaceAll("'", "''");
  const code = `
    $ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
    $cfg=ConvertFrom-Json -AsHashtable '${fixture}'
    $script:trace=[Collections.Generic.List[object]]::new()
    $script:children=@{}; $script:lists=0
    foreach($id in $cfg.children){$script:children["$id"]=@{number=$id;state='OPEN';baseRefName='feature/parent';headRefName="feature/child-$id";headRefOid='${sha}';isCrossRepository=$false}}
    if($cfg.ContainsKey('nestedPreview')){$script:children['3'].baseRefName='feature/child-2'}
    $script:parent=@{number=1;state='OPEN';headRefName='feature/parent';headRefOid='${sha}';baseRefName='main';isCrossRepository=$false}
    if($cfg.ContainsKey('parent')){foreach($key in $cfg.parent.Keys){$script:parent[$key]=$cfg.parent[$key]}}
    function Invoke-GhWithRetry {
      param([string[]]$GhArgs)
      $script:trace.Add(@($GhArgs))
      if($GhArgs[0] -ne 'pr'){throw 'Unexpected command'}
      switch($GhArgs[1]){
        'list' {
          $script:lists++
          if($cfg.ContainsKey('badList')){return $cfg.badList}
          if($cfg.ContainsKey('listFailure')){throw 'List failed'}
          if($cfg.ContainsKey('newChild') -and $script:lists -gt 1){$script:children['4']=@{number=4;state='OPEN';baseRefName='feature/parent'}}
          if($cfg.ContainsKey('atCap')){return ConvertTo-Json -Compress -InputObject @(1..1000|ForEach-Object{@{number=$_+1;baseRefName='feature/parent'}})}
          $base=$GhArgs[[array]::IndexOf($GhArgs,'--base')+1]
          return ConvertTo-Json -Compress -InputObject @($script:children.Values|Where-Object{$_.baseRefName -ceq $base -and $_.state -eq 'OPEN'}|Sort-Object number)
        }
        'view' {
          if($GhArgs[2] -eq '1'){return ConvertTo-Json -Compress $script:parent}
          $id=$GhArgs[2]
          if($cfg.ContainsKey('movedChild') -and $id -eq '2'){$script:children[$id].baseRefName='other/base'}
          if($cfg.ContainsKey('alreadyMain') -and $id -eq '2'){$script:children[$id].baseRefName='main'}
          if($cfg.ContainsKey('closedChild') -and $id -eq '2'){$script:children[$id].state='CLOSED'}
          return ConvertTo-Json -Compress $script:children[$id]
        }
        'edit' {
          $id=$GhArgs[2]
          if($cfg.ContainsKey('failEdit') -and $id -eq [string]$cfg.failEdit){throw 'Edit failed'}
          if(-not $cfg.ContainsKey('silentEdit')){$script:children[$id].baseRefName='main'}
          return 'edited'
        }
        default {throw 'Unexpected operation'}
      }
    }
    $errorText=$null; $ok=$false
    try {
      if(-not (Test-Path '${modulePath}')){throw 'Stacked PR protection is absent'}
      . '${modulePath}'
      Protect-StackedPullRequests -Number 1 -Repo 'owner/repo' -ExpectedHead '${sha}' -Preview:([bool]$cfg.preview)
      if($cfg.ContainsKey('nestedPreview')){
        $previewBases=@{}
        foreach($id in @(1,2,3)){Protect-StackedPullRequests -Number $id -Repo 'owner/repo' -ExpectedHead '${sha}' -Preview -PreviewBases $previewBases}
      }
      if($cfg.ContainsKey('repeat')){Protect-StackedPullRequests -Number 1 -Repo 'owner/repo' -ExpectedHead '${sha}'}
      $ok=$true
    }catch{$errorText=$_.Exception.Message}
    'RESULT='+(@{ok=$ok;error=$errorText;trace=@($script:trace.ToArray());children=$script:children}|ConvertTo-Json -Depth 20 -Compress)
  `;
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', code], { encoding: 'utf8', timeout: 30000 });
  const line = result.stdout?.split(/\r?\n/).find(s => s.startsWith('RESULT='));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(line, result.stdout + result.stderr);
  return JSON.parse(line.slice(7));
}
const edits = result => result.trace.filter(args => args[1] === 'edit');

test('retargets and verifies every child; repeated protection is idempotent', () => {
  const r=run({repeat:true}); assert.equal(r.ok,true,r.error);
  assert.deepEqual(edits(r).map(a=>a[2]),['2','3']);
  assert.ok(edits(r).every(a=>a.includes('--base') && a.at(-1)==='main'));
  assert.ok(Object.values(r.children).every(c=>c.baseRefName==='main'));
  const lastEdit=r.trace.findLastIndex(a=>a[1]==='edit');
  assert.ok(r.trace.slice(lastEdit+1).some(a=>a[1]==='view'&&a[2]==='3'));
  assert.ok(r.trace.slice(lastEdit+1).some(a=>a[1]==='list'));
});
test('no children is successful and performs no edits',()=>{const r=run({children:[]});assert.equal(r.ok,true,r.error);assert.equal(edits(r).length,0);});
test('dry-run discovers children without mutation',()=>{const r=run({preview:true});assert.equal(r.ok,true,r.error);assert.equal(edits(r).length,0);assert.ok(r.trace.some(a=>a[1]==='list'&&a.includes('--base')&&a.includes('feature/parent')));});
test('dry-run projects successive bases through a three-level stack without edits',()=>{
  const r=run({preview:true,nestedPreview:true});
  assert.equal(r.ok,true,r.error); assert.equal(edits(r).length,0);
  assert.equal(r.children['2'].baseRefName,'feature/parent');
  assert.equal(r.children['3'].baseRefName,'feature/child-2');
  assert.ok(r.trace.some(a=>a[1]==='list'&&a.includes('feature/child-2')));
  assert.ok(r.trace.some(a=>a[1]==='list'&&a.includes('feature/child-3')));
});
test('a fork head, including main, cannot retarget same-named local-branch children',()=>{
  for(const headRefName of ['feature/parent','main']){
    const r=run({parent:{isCrossRepository:true,headRefName}});
    assert.equal(r.ok,true,r.error);
    assert.equal(r.trace.filter(a=>a[1]==='list').length,0);
    assert.equal(edits(r).length,0);
  }
});
for(const [name,opts] of Object.entries({
  'unreadable list':{badList:'not-json'}, 'object instead of list':{badList:'{}'},
  'missing child metadata':{badList:'[{"number":2}]'}, 'failed discovery':{listFailure:true},
  'possibly truncated discovery':{atCap:true}, 'changed parent head':{parent:{headRefOid:'b'.repeat(40)}},
  'parent does not target main':{parent:{baseRefName:'other/base'}},
  'child moved to another base':{movedChild:true},
}))test(`${name} stops before any edit`,()=>{const r=run(opts);assert.equal(r.ok,false);assert.equal(edits(r).length,0);});
test('edit failure stops after safe partial progress',()=>{const r=run({failEdit:3});assert.equal(r.ok,false);assert.equal(r.children['2'].baseRefName,'main');assert.equal(r.children['3'].baseRefName,'feature/parent');});
test('successful edit response without changed base does not allow merge',()=>{const r=run({silentEdit:true});assert.equal(r.ok,false);assert.equal(edits(r).length,1);});
test('child arriving during protection stops the parent',()=>{const r=run({newChild:true});assert.equal(r.ok,false);assert.equal(r.children['4'].baseRefName,'feature/parent');});
test('already retargeted or closed child is not edited',()=>{for(const opts of [{alreadyMain:true},{closedChild:true}]){const r=run(opts);assert.equal(r.ok,true,r.error);assert.deepEqual(edits(r).map(a=>a[2]),['3']);}});
test('real queue protects children before its final HEAD/check/tick guards and merge; dry-run also checks',()=>{
  const real=source.indexOf('Protect-StackedPullRequests -Number $n -Repo $Repo -ExpectedHead $fresh.headSha }');
  assert.ok(real>=0,'real merge has no stacked-PR protection');
  const tail=source.slice(real);
  assert.match(tail,/catch\s*\{[\s\S]*?Exit-Queue 1/);
  assert.ok(tail.indexOf('Wait-OutOfMergeTickWindow')<tail.indexOf('guarded-merge --pr'));
  assert.ok(tail.indexOf('$recheck = Get-PrPlanEntry $n')<tail.indexOf('guarded-merge --pr'));
  assert.match(source,/Protect-StackedPullRequests[^\r\n]*-Preview/);
});
