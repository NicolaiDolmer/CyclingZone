import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { probeGitWrites } from './codex-git-write-probe.mjs';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cz-git-probe-'));
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
