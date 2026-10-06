// Only known owned metadata markers are created; no commit/ref/config mutation.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function probeGitWrites(worktree, branch, output, { git = (...args) => execFileSync('git',['-C',worktree,...args],{encoding:'utf8',timeout:10000}).trim() } = {}) {
  if (!/^codex\/[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..')) throw Error('Invalid owned branch');
  const top = git('rev-parse','--show-toplevel');
  if (path.resolve(top) !== path.resolve(worktree) || git('branch','--show-current') !== branch) throw Error('Worktree/branch mismatch');
  const privateDir = git('rev-parse','--path-format=absolute','--git-dir');
  const common = git('rev-parse','--path-format=absolute','--git-common-dir');
  const ownerRoot = path.join(common,'worktrees');
  if (!path.resolve(privateDir).startsWith(path.resolve(ownerRoot)+path.sep)) throw Error('Private worktree metadata required');
  const suffix = `.codex-write-probe-${randomUUID()}`;
  const targets = [path.join(privateDir,suffix),path.join(common,'objects',suffix),path.join(common,'refs','heads',branch+suffix)];
  const created=[];
  try {
    for(const target of targets){fs.writeFileSync(target,'probe',{flag:'wx'});created.push(target);}
  } finally {for(const target of created) fs.unlinkSync(target);}
  fs.writeFileSync(output,JSON.stringify({ok:true,branch,worktree:path.resolve(worktree)})+'\n',{flag:'wx'});
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2), value=key=>args[args.indexOf(key)+1];
  try {probeGitWrites(value('--worktree'),value('--branch'),value('--out'));}
  catch {console.error('Git metadata write probe failed; no permission proof emitted');process.exitCode=1;}
}
