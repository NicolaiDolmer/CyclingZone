// Only known owned metadata markers are created; no commit/ref/config mutation.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function probeGitWrites(worktree, branch, output, {
  git = (...args) => execFileSync('git',['-C',worktree,...args],{encoding:'utf8',timeout:10000}).trim(),
  io = fs,
  isAlive = pid => { try { process.kill(pid,0); return true; } catch(error) { return error.code !== 'ESRCH'; } },
} = {}) {
  if (!/^codex\/[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..')) throw Error('Invalid owned branch');
  const top = git('rev-parse','--show-toplevel');
  if (path.resolve(top) !== path.resolve(worktree) || git('branch','--show-current') !== branch) throw Error('Worktree/branch mismatch');
  const privateDir = git('rev-parse','--path-format=absolute','--git-dir');
  const common = git('rev-parse','--path-format=absolute','--git-common-dir');
  const ownerRoot = path.join(common,'worktrees');
  if (!path.resolve(privateDir).startsWith(path.resolve(ownerRoot)+path.sep)) throw Error('Private worktree metadata required');
  const targetsFor = id => {
    const suffix = `.codex-write-probe-${id}`;
    return [path.join(privateDir,suffix),path.join(common,'objects',suffix),path.join(common,'refs','heads',branch+suffix)];
  };
  const journalFor = id => path.join(privateDir,`.codex-write-probe-owner-${id}.json`);
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  const journalPattern = new RegExp(`^\\.codex-write-probe-owner-(${uuid})\\.json$`);
  const readRegular = file => {
    const stat=io.lstatSync(file);
    if(!stat.isFile() || stat.isSymbolicLink()) throw Error('Unowned probe file');
    return {stat,content:io.readFileSync(file,'utf8')};
  };
  const remove = (file, content, identity) => {
    let found;
    try { found=readRegular(file); } catch(error) { if(error.code==='ENOENT') return; throw error; }
    if(found.content!==content || (identity && (found.stat.ino!==identity.ino || found.stat.dev!==identity.dev))) throw Error('Probe identity changed');
    io.unlinkSync(file);
  };
  const cleanup = (journal, content, targets) => {
    const errors=[];
    for(const target of targets) {
      try { remove(target.file, target.content, target.identity); } catch(error) { errors.push(error); }
    }
    if(!errors.length) {
      try { remove(journal,content); } catch(error) { errors.push(error); }
    }
    if(errors.length) throw new AggregateError(errors,'Probe cleanup incomplete');
  };
  // A dead PID is positive stale evidence. An alive/reused/inaccessible PID is never reclaimed.
  for(const name of io.readdirSync(privateDir)) {
    const match=journalPattern.exec(name);
    if(!match) continue;
    const journal=journalFor(match[1]), {content}=readRegular(journal);
    const owner=JSON.parse(content);
    if(owner.format!=='codex-write-probe-v1' || owner.id!==match[1] || owner.branch!==branch || owner.worktree!==path.resolve(worktree) || !Number.isSafeInteger(owner.pid) || owner.pid<=0) throw Error('Unowned probe journal');
    if(isAlive(owner.pid)) throw Error('Owned branch has an active probe');
    cleanup(journal,content,targetsFor(owner.id).map(file=>({file,content})));
  }
  // Legacy/unknown files have no trustworthy stale evidence: preserve them and fail closed.
  const leftovers=[...io.readdirSync(privateDir).filter(name=>name.startsWith('.codex-write-probe-')),
    ...io.readdirSync(path.dirname(targetsFor('check')[2])).filter(name=>name.startsWith(path.basename(branch)+'.codex-write-probe-'))];
  if(leftovers.length) throw Error('Unowned probe markers require manual inspection');
  const id=randomUUID(), journal=journalFor(id);
  const content=JSON.stringify({format:'codex-write-probe-v1',id,branch,worktree:path.resolve(worktree),pid:process.pid});
  const created=[];
  // Persist ownership before touching shared objects/refs. Never prune a directory or a ref namespace.
  const journalFd=io.openSync(journal,'wx');
  let journalContent='';
  try {
    try { io.writeFileSync(journalFd,content); } finally {
      try { journalContent=io.readFileSync(journal,'utf8'); } finally { io.closeSync(journalFd); }
    }
    for(const file of targetsFor(id)) {
      const fd=io.openSync(file,'wx');
      const target={file,content:'',identity:io.fstatSync(fd)};
      created.push(target);
      try { io.writeFileSync(fd,content); } finally {
        // Also clean a partial write, but only while this invocation owns the exact inode.
        try { target.content=io.readFileSync(file,'utf8'); } finally { io.closeSync(fd); }
      }
    }
  } finally { cleanup(journal,journalContent,created); }
  io.writeFileSync(output,JSON.stringify({ok:true,branch,worktree:path.resolve(worktree)})+'\n',{flag:'wx'});
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2), value=key=>args[args.indexOf(key)+1];
  try {probeGitWrites(value('--worktree'),value('--branch'),value('--out'));}
  catch {console.error('Git metadata write probe failed; no permission proof emitted');process.exitCode=1;}
}
