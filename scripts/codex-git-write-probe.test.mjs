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
  if(stage===1) return interrupt(f,0,'ready');
  return interrupt(f,stage-1,'after');
}
function interrupt(f,stage,mode) {
  const moduleUrl=new URL('./codex-git-write-probe.mjs',import.meta.url).href;
  const code=`import fs from 'node:fs';import {probeGitWrites} from ${JSON.stringify(moduleUrl)};
    let opened=0,selectedFd;
    const io=new Proxy(fs,{get(target,key){
      if(key==='openSync') return (file,...args)=>{
        const fd=fs.openSync(file,...args);
        if(!file.includes('owner-')) {
          if(++opened===${stage}) {selectedFd=fd;if(${JSON.stringify(mode)}==='preidentity')process.exit(0);}
        }
        return fd;
      };
      if(key==='writeFileSync') return (file,data,...args)=>{
        if(file===selectedFd) {
          if(${JSON.stringify(mode)}==='before')process.exit(0);
          if(${JSON.stringify(mode)}==='during'){fs.writeFileSync(file,data.slice(0,7),...args);process.exit(0);}
          const result=fs.writeFileSync(file,data,...args);process.exit(0);return result;
        }
        const result=fs.writeFileSync(file,data,...args);
        if(${JSON.stringify(mode)}==='ready' && typeof file==='string' && JSON.parse(data).ready)process.exit(0);
        return result;
      };
      if(key==='fsyncSync')return (...args)=>{const result=fs.fsyncSync(...args);if(${JSON.stringify(mode)}==='ready')process.exit(0);return result;};
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
  fs.unlinkSync(markerPath);
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


test('fstat failure closes every opened descriptor and cannot strand an invisible marker',t=>{
  const f=fixture(t), opened=new Set();
  const io=new Proxy(fs,{get(target,key){
    if(key==='openSync') return (...args)=>{const fd=fs.openSync(...args);opened.add(fd);return fd;};
    if(key==='closeSync') return fd=>{fs.closeSync(fd);opened.delete(fd);};
    if(key==='fstatSync') return ()=>{throw Error('injected fstat failure');};
    return target[key];
  }});
  try {
    assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out,{io}),/fstat/);
    assert.equal(opened.size,0,'all owned descriptors must close');
    assert.equal(fs.existsSync(f.out),false);
    assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out,{isAlive:()=>false}),/Unowned/);
    const common=f.git(f.worktree,'rev-parse','--path-format=absolute','--git-common-dir');
    assert.equal(fs.readdirSync(path.join(common,'objects')).some(n=>n.includes('write-probe')),false);
  } finally {for(const fd of opened) fs.closeSync(fd);}
});

test('dead process recovery tolerates interruption before and during every shared marker publication',t=>{
  for(const stage of [1,2,3]) for(const mode of ['before','during']) {
    const f=fixture(t);
    interrupt(f,stage,mode);
    assert.equal(fs.existsSync(f.out),false);
    probeGitWrites(f.worktree,'codex/fixture',f.out);
    assert.equal(JSON.parse(fs.readFileSync(f.out)).ok,true);
  }
});


test('same-content replacement has no ownership even when the stale journal is valid',t=>{
  const f=fixture(t);
  interrupted(f,4);
  const common=f.git(f.worktree,'rev-parse','--path-format=absolute','--git-common-dir');
  const folder=path.join(common,'objects');
  const marker=path.join(folder,fs.readdirSync(folder).find(n=>n.includes('write-probe')));
  const content=fs.readFileSync(marker,'utf8');
  // Keep the old inode allocated: unlink/recreate may reuse it on Linux.
  const held=path.join(f.root,'original-probe-marker');
  fs.renameSync(marker,held);
  const originalIdentity=fs.statSync(held,{bigint:true});
  fs.writeFileSync(marker,content,{flag:'wx'});
  const replacementIdentity=fs.statSync(marker,{bigint:true});
  assert.notDeepEqual([replacementIdentity.dev,replacementIdentity.ino],[originalIdentity.dev,originalIdentity.ino]);
  assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out),/cleanup incomplete/);
  assert.equal(fs.readFileSync(marker,'utf8'),content);
  assert.equal(fs.existsSync(f.out),false);
  const privateDir=f.git(f.worktree,'rev-parse','--path-format=absolute','--git-dir');
  assert.equal(fs.readdirSync(privateDir).some(n=>n.includes('owner-')),true);
});

test('interrupted private ownership journal is preserved and never grants permission',t=>{
  for(const partial of [false,true]) {
    const f=fixture(t),moduleUrl=new URL('./codex-git-write-probe.mjs',import.meta.url).href;
    const code=`import fs from 'node:fs';import {probeGitWrites} from ${JSON.stringify(moduleUrl)};
      const io=new Proxy(fs,{get(target,key){
        if(key==='writeFileSync') return (fd,data,...args)=>{if(${partial}) fs.writeFileSync(fd,data.slice(0,7),...args);process.exit(0);};
        return target[key];
      }});
      probeGitWrites(${JSON.stringify(f.worktree)},'codex/fixture',${JSON.stringify(f.out)},{io});`;
    execFileSync(process.execPath,['--input-type=module','-e',code]);
    const privateDir=f.git(f.worktree,'rev-parse','--path-format=absolute','--git-dir');
    const journal=path.join(privateDir,fs.readdirSync(privateDir).find(n=>n.includes('owner-')));
    const before=fs.readFileSync(journal,'utf8');
    assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out));
    assert.equal(fs.readFileSync(journal,'utf8'),before);
    assert.equal(fs.existsSync(f.out),false);
  }
});


test('crash before durable target identity blocks recovery and preserves its empty marker',t=>{
  for(const stage of [1,2,3]) {
    const f=fixture(t);
    interrupt(f,stage,'preidentity');
    assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out),/cleanup incomplete/);
    assert.equal(fs.existsSync(f.out),false);
    const privateDir=f.git(f.worktree,'rev-parse','--path-format=absolute','--git-dir');
    assert.equal(fs.readdirSync(privateDir).some(n=>n.includes('owner-')),true);
  }
});

test('target fstat failure closes descriptors and preserves unknown ownership on every retry',t=>{
  for(const stage of [2,3,4]) {
    const f=fixture(t),opened=new Set();let stats=0;
    const io=new Proxy(fs,{get(target,key){
      if(key==='openSync')return (...args)=>{const fd=fs.openSync(...args);opened.add(fd);return fd;};
      if(key==='closeSync')return fd=>{fs.closeSync(fd);opened.delete(fd);};
      if(key==='fstatSync')return (...args)=>{if(++stats===stage)throw Error('injected fstat');return fs.fstatSync(...args);};
      return target[key];
    }});
    assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out,{io}));
    assert.equal(opened.size,0);
    for(let retry=0;retry<2;retry++)assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out,{isAlive:()=>false}),/cleanup incomplete/);
    assert.equal(fs.existsSync(f.out),false);
  }
});

test('ordinary exclusive create or write denial in each target cannot emit permission proof',t=>{
  for(const stage of [1,2,3])for(const operation of ['open','write']) {
    const f=fixture(t);let markers=0,deniedFd;
    const io=new Proxy(fs,{get(target,key){
      if(key==='openSync')return (file,...args)=>{
        const selected=!file.includes('owner-') && ++markers===stage;
        if(selected && operation==='open')throw Error('injected target EACCES');
        const fd=fs.openSync(file,...args);if(selected)deniedFd=fd;return fd;
      };
      if(key==='writeFileSync')return (file,...args)=>{if(file===deniedFd)throw Error('injected target EACCES');return fs.writeFileSync(file,...args);};
      return target[key];
    }});
    assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out,{io}),/EACCES/);
    assert.equal(fs.existsSync(f.out),false);
    probeGitWrites(f.worktree,'codex/fixture',f.out);
  }
});


test('symbolic replacement and unknown v1 ownership journal remain untouched',t=>{
  const f=fixture(t);interrupted(f,4);
  const common=f.git(f.worktree,'rev-parse','--path-format=absolute','--git-common-dir');
  const folder=path.join(common,'objects');
  const marker=path.join(folder,fs.readdirSync(folder).find(n=>n.includes('write-probe')));
  const foreign=path.join(f.root,'foreign');fs.mkdirSync(foreign);fs.writeFileSync(path.join(foreign,'keep'),'foreign');
  fs.unlinkSync(marker);fs.symlinkSync(foreign,marker,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out),/cleanup incomplete/);
  assert.equal(fs.lstatSync(marker).isSymbolicLink(),true);
  assert.equal(fs.readFileSync(path.join(foreign,'keep'),'utf8'),'foreign');
  assert.equal(fs.existsSync(f.out),false);
  const privateDir=f.git(f.worktree,'rev-parse','--path-format=absolute','--git-dir');
  const journal=path.join(privateDir,fs.readdirSync(privateDir).find(n=>n.includes('owner-')));
  const owner=JSON.parse(fs.readFileSync(journal,'utf8'));owner.format='codex-write-probe-v1';
  fs.writeFileSync(journal,JSON.stringify(owner));
  assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out),/Unowned/);
  assert.equal(JSON.parse(fs.readFileSync(journal,'utf8')).format,'codex-write-probe-v1');
});


test('interrupted durable journal update blocks recovery at every creation stage',t=>{
  for(const stage of [1,2,3,4]) {
    const f=fixture(t),moduleUrl=new URL('./codex-git-write-probe.mjs',import.meta.url).href;
    const code=`import fs from 'node:fs';import {probeGitWrites} from ${JSON.stringify(moduleUrl)};let updates=0;
      const io=new Proxy(fs,{get(target,key){
        if(key==='writeSync')return (fd,data,...args)=>{
          if(++updates===${stage}){fs.writeSync(fd,data.slice(0,7),...args);process.exit(0);}
          return fs.writeSync(fd,data,...args);
        };
        return target[key];
      }});
      probeGitWrites(${JSON.stringify(f.worktree)},'codex/fixture',${JSON.stringify(f.out)},{io});`;
    execFileSync(process.execPath,['--input-type=module','-e',code]);
    assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out));
    assert.equal(fs.existsSync(f.out),false);
    const privateDir=f.git(f.worktree,'rev-parse','--path-format=absolute','--git-dir');
    assert.equal(fs.readdirSync(privateDir).some(n=>n.includes('owner-')),true);
  }
});


test('short durable journal writes cannot emit proof and synchronous cleanup permits retry',t=>{
  const f=fixture(t);
  const io=new Proxy(fs,{get(target,key){
    if(key==='writeSync')return (fd,data,...args)=>fs.writeSync(fd,data.slice(0,7),...args);
    return target[key];
  }});
  assert.throws(()=>probeGitWrites(f.worktree,'codex/fixture',f.out,{io}),/Incomplete ownership/);
  assert.equal(fs.existsSync(f.out),false);
  probeGitWrites(f.worktree,'codex/fixture',f.out);
});
