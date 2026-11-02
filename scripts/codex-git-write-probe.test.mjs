import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { probeGitWrites } from './codex-git-write-probe.mjs';

function fixture(t){
  const root=fs.mkdtempSync(path.join(process.env.CZ_PROBE_TEST_TMP || os.tmpdir(),'cz-git-probe-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const main=path.join(root,'main'),worktree=path.join(root,'worker');
  const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  execFileSync('git',['init','-q','-b','main',main]);
  git(main,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-q','--allow-empty','-m','fixture');
  git(main,'worktree','add','-q','-b','codex/fixture',worktree);
  return {root,main,worktree,git,out:path.join(root,'proof.json')};
}

test('actual owned metadata markers are removed and protected refs/config remain unchanged',t=>{
  const f=fixture(t),common=f.git(f.worktree,'rev-parse','--path-format=absolute','--git-common-dir');
  const protectedFiles=['HEAD','config','refs/heads/main'].map(file=>path.join(common,file));
  const before=protectedFiles.map(file=>fs.readFileSync(file,'utf8'));
  probeGitWrites(f.worktree,'codex/fixture',f.out);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.out,'utf8')),{ok:true,branch:'codex/fixture',worktree:path.resolve(f.worktree)});
  assert.deepEqual(protectedFiles.map(file=>fs.readFileSync(file,'utf8')),before);
  for(const folder of ['objects','refs/heads/codex','worktrees/worker']) assert.equal(fs.readdirSync(path.join(common,folder)).some(file=>file.includes('codex-write-probe')),false);
});

test('wrong branch and primary checkout fail before a permission artifact exists',t=>{
  const f=fixture(t);
  assert.throws(()=>probeGitWrites(f.worktree,'codex/other',f.out),/mismatch/);
  assert.equal(fs.existsSync(f.out),false);
  assert.throws(()=>probeGitWrites(f.main,'main',f.out),/Invalid owned branch/);
  assert.equal(fs.existsSync(f.out),false);
});

test('invalid branch traversal cannot create metadata',t=>{
  const f=fixture(t);
  assert.throws(()=>probeGitWrites(f.worktree,'codex/../../main',f.out),/Invalid owned branch/);
  assert.equal(fs.existsSync(f.out),false);
});

test('first unlink failure does not prevent remaining cleanup or emit proof',t=>{
  const f=fixture(t), attempted=[];
  const unlink=fs.unlinkSync;
  fs.unlinkSync=file=>{
    attempted.push(file);
    if(attempted.length===1) throw Error('injected unlink failure');
    return unlink(file);
  };
  try { assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out)); }
  finally { fs.unlinkSync=unlink; }
  assert.equal(attempted.filter(file=>!file.includes('owner-')).length,3);
  assert.equal(fs.existsSync(f.out),false);
  probeGitWrites(f.worktree,'codex/fixture',f.out,{isAlive:()=>false});
  assert.equal(JSON.parse(fs.readFileSync(f.out)).ok,true);
});

test('partial creation and partial writes clean every file already owned',t=>{
  for(const failedAt of [1,2,3,4]) {
    const f=fixture(t);
    let writes=0;
    const io=new Proxy(fs,{get(target,key){
      if(key==='writeFileSync') return (file,data,...args)=>{
        if(++writes===failedAt) {
          fs.writeFileSync(file,data.slice(0,7),...args);
          throw Error('injected partial write');
        }
        return fs.writeFileSync(file,data,...args);
      };
      return target[key];
    }});
    assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out,{io}),/partial write/);
    assert.equal(fs.existsSync(f.out),false);
    probeGitWrites(f.worktree,'codex/fixture',f.out);
    assert.equal(JSON.parse(fs.readFileSync(f.out)).ok,true);
  }
});

test('creation failure cleans prior markers and preserves a colliding foreign file',t=>{
  for(const failedAt of [2,3,4]) {
    const f=fixture(t);
    let opens=0, collision;
    const io=new Proxy(fs,{get(target,key){
      if(key==='openSync') return (file,...args)=>{
        if(++opens===failedAt) {
          collision=file;
          fs.writeFileSync(file,'foreign collision',{flag:'wx'});
        }
        return fs.openSync(file,...args);
      };
      return target[key];
    }});
    assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out,{io}),/EEXIST/);
    assert.equal(fs.readFileSync(collision,'utf8'),'foreign collision');
    assert.equal(fs.existsSync(f.out),false);
    const privateDir=f.git(f.worktree,'rev-parse','--path-format=absolute','--git-dir');
    assert.equal(fs.readdirSync(privateDir).some(name=>name.includes('owner-')),false);
  }
});

function interrupted(f, stage) {
  const moduleUrl=new URL('./codex-git-write-probe.mjs',import.meta.url).href;
  const code=`import fs from 'node:fs'; import {probeGitWrites} from ${JSON.stringify(moduleUrl)};
    let writes=0;
    const io=new Proxy(fs,{get(target,key){
      if(key==='writeFileSync') return (...args)=>{
        const result=fs.writeFileSync(...args);
        if(++writes===${stage}) process.exit(0);
        return result;
      };
      return target[key];
    }});
    probeGitWrites(${JSON.stringify(f.worktree)},'codex/fixture',${JSON.stringify(f.out)},{io});`;
  execFileSync(process.execPath,['--input-type=module','-e',code]);
}

test('startup recovers a dead process after each creation stage including the refs marker',t=>{
  for(const stage of [1,2,3,4]) {
    const f=fixture(t);
    interrupted(f,stage);
    assert.equal(fs.existsSync(f.out),false);
    probeGitWrites(f.worktree,'codex/fixture',f.out);
    assert.equal(JSON.parse(fs.readFileSync(f.out)).ok,true);
    assert.equal(f.git(f.worktree,'for-each-ref','--format=%(refname)').includes('write-probe'),false);
  }
});

test('active probe, unknown legacy ref and changed file identity are preserved without proof',t=>{
  const f=fixture(t);
  interrupted(f,4);
  const common=f.git(f.worktree,'rev-parse','--path-format=absolute','--git-common-dir');
  const refs=path.join(common,'refs','heads','codex');
  const marker=fs.readdirSync(refs).find(file=>file.includes('write-probe'));
  const markerPath=path.join(refs,marker), original=fs.readFileSync(markerPath,'utf8');
  assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out,{isAlive:()=>true}),/active probe/);
  assert.equal(fs.readFileSync(markerPath,'utf8'),original);
  fs.writeFileSync(markerPath,'foreign replacement');
  assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out),/cleanup/);
  assert.equal(fs.readFileSync(markerPath,'utf8'),'foreign replacement');
  assert.equal(fs.existsSync(f.out),false);
});

test('foreign branch live marker and unknown ref are never pruned',t=>{
  const f=fixture(t), common=f.git(f.worktree,'rev-parse','--path-format=absolute','--git-common-dir');
  const foreign=path.join(common,'refs','heads','codex','other.codex-write-probe-unknown');
  fs.writeFileSync(foreign,'foreign marker');
  probeGitWrites(f.worktree,'codex/fixture',f.out);
  assert.equal(fs.readFileSync(foreign,'utf8'),'foreign marker');
  fs.unlinkSync(f.out);
  const legacy=path.join(common,'refs','heads','codex','fixture.codex-write-probe-unknown');
  fs.writeFileSync(legacy,'probe');
  assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out),/manual inspection/);
  assert.equal(fs.readFileSync(legacy,'utf8'),'probe');
  assert.equal(fs.existsSync(f.out),false);
});
