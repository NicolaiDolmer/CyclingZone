import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const execPath = spawnSync('git',['--exec-path'],{encoding:'utf8'}).stdout.trim();
const gitRoot = resolve(execPath, '../../..');
const bash = join(gitRoot,'bin',process.platform === 'win32' ? 'bash.exe' : 'bash');
const utilities = join(gitRoot,'usr/bin');
const run = (script, payload, path = process.env.PATH) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
  env.PATH = path;
  return spawnSync(bash,['--noprofile','--norc',script],{cwd:root,input:payload,encoding:'utf8',env});
};
for (const name of ['dangerous-cat-env','dangerous-env','safe-git-status','safe-railway']) {
  test(`existing Claude fixture: ${name}`, () => {
    const result=run('.claude/hooks/block-dangerous-secret-commands.sh',readFileSync(join(root,`.claude/hooks/test-fixtures/${name}.json`),'utf8'));
    assert.equal(result.status,name.startsWith('dangerous') ? 2 : 0,result.stderr);
    if(name.startsWith('dangerous')) assert.match(result.stderr,/BLOCKED by block-dangerous-secret-commands/);
  });
}
for (const script of ['.claude/hooks/block-dangerous-secret-commands.sh','.claude/hooks/sanitize-secrets.sh']) {
  test(`${script}: WindowsApps alias is explicitly rejected even with a forged marker`, () => {
    const dir=mkdtempSync(join(root,'.codex.local/python-alias-'));
    try {
      const aliases=join(dir,'WindowsApps'); mkdirSync(aliases);
      writeFileSync(join(aliases,'python'),'#!/bin/sh\nprintf CZ_HOOK_PYTHON_OK\n',{mode:0o755});
      const result=run(script,'{}',aliases+delimiter+utilities);
      assert.equal(result.status,2,result.stderr); assert.match(result.stderr,/Windows Store aliases rejected/);
    } finally { assert.ok(dir.startsWith(join(root,'.codex.local'))); rmSync(dir,{recursive:true,force:true}); }
  });
  test(`${script}: scanner failure after successful probe still blocks`, () => {
    const dir=mkdtempSync(join(root,'.codex.local/python-crash-'));
    try {
      writeFileSync(join(dir,'python'),'#!/bin/sh\ncase "$*" in *CZ_HOOK_PYTHON_OK*) printf CZ_HOOK_PYTHON_OK;; *) exit 19;; esac\n',{mode:0o755});
      const result=run(script,JSON.stringify({tool_name:'Bash',tool_input:{command:'git status'},tool_response:'harmless '.repeat(20)}),dir+delimiter+utilities);
      assert.equal(result.status,2,result.stderr); assert.match(result.stderr,/SECRET GUARD BLOCKED: .*scan failed/);
    } finally { assert.ok(dir.startsWith(join(root,'.codex.local'))); rmSync(dir,{recursive:true,force:true}); }
  });
  test(`${script}: absent Python blocks safe input, does not claim a secret`, () => {
    const result=run(script,JSON.stringify({tool_name:'Bash',tool_input:{command:'git --no-pager status -sb'},tool_response:'harmless '.repeat(20)}),utilities);
    assert.equal(result.status,2,result.stderr); assert.match(result.stderr,/SECRET GUARD BLOCKED: no working Python/);
    assert.doesNotMatch(result.stderr,/SECRET LEAK DETECTED/);
  });
  test(`${script}: stub exiting zero without the runtime marker is rejected`, () => {
    const dir=mkdtempSync(join(root,'.codex.local/python-stub-'));
    try {
      for (const name of ['python','python3','py']) writeFileSync(join(dir,name),'#!/bin/sh\nexit 0\n',{mode:0o755});
      const result=run(script,JSON.stringify({tool_name:'Bash',tool_input:{command:'git status'},tool_response:'harmless '.repeat(20)}),dir+delimiter+utilities);
      assert.equal(result.status,2,result.stderr); assert.match(result.stderr,/SECRET GUARD BLOCKED: no working Python/);
    } finally { assert.ok(dir.startsWith(join(root,'.codex.local'))); rmSync(dir,{recursive:true,force:true}); }
  });
}
