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

// --- #5326: aarsag i blokeringsbeskeden + stort payload paa stdin -----------
//
// Symptomet var en Edit afbrudt med 'output scan failed' og intet andet: Python
// exitede non-zero, men stderr blev kastet vaek med 2>/dev/null. Uden aarsagen
// starter fejlsoegningen forfra hver gang.
//
// Bemaerk: hypotesen om Windows' env-var-graense blev IKKE reproduceret (payloads
// op til 2,8 MB med aeoeaa gik igennem den gamle env-var-rute paa denne PC).
// Testene nedenfor gaelder de to ting fixet faktisk garanterer: aarsagen er
// synlig, og stoerrelse/encoding kan ikke laengere vaere fejlkilden.

const sanitize = '.claude/hooks/sanitize-secrets.sh';

test(`${sanitize}: scanner failure names its exit code in the block message (#5326)`, () => {
  const dir = mkdtempSync(join(root, '.codex.local/python-cause-'));
  try {
    // Probe'n skal bestaa, selve scanningen skal fejle - praecis #5326-formen.
    writeFileSync(join(dir, 'python'),
      '#!/bin/sh\ncase "$*" in *CZ_HOOK_PYTHON_OK*) printf CZ_HOOK_PYTHON_OK;; *) echo "boom: simulated scanner crash" >&2; exit 19;; esac\n',
      { mode: 0o755 });
    const result = run(sanitize,
      JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'x.js' }, tool_response: 'harmless '.repeat(20) }),
      dir + delimiter + utilities);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /SECRET GUARD BLOCKED: output scan failed/);
    assert.match(result.stderr, /cause:/);
    assert.match(result.stderr, /scanner exit=19/);
    assert.match(result.stderr, /boom: simulated scanner crash/);
    assert.doesNotMatch(result.stderr, /SECRET LEAK DETECTED/);
  } finally { assert.ok(dir.startsWith(join(root, '.codex.local'))); rmSync(dir, { recursive: true, force: true }); }
});

test(`${sanitize}: scanner stderr is redacted before it is shown (#5326)`, () => {
  const dir = mkdtempSync(join(root, '.codex.local/python-redact-'));
  const token = 'A'.repeat(20) + 'b'.repeat(20) + '1234567890';
  try {
    writeFileSync(join(dir, 'python'),
      `#!/bin/sh\ncase "$*" in *CZ_HOOK_PYTHON_OK*) printf CZ_HOOK_PYTHON_OK;; *) echo "leaked ${token}" >&2; exit 7;; esac\n`,
      { mode: 0o755 });
    const result = run(sanitize,
      JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'x.js' }, tool_response: 'harmless '.repeat(20) }),
      dir + delimiter + utilities);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /REDACTED-LONG-TOKEN/);
    assert.ok(!result.stderr.includes(token), 'scanner-stderr maa ikke baere en lang token videre');
  } finally { assert.ok(dir.startsWith(join(root, '.codex.local'))); rmSync(dir, { recursive: true, force: true }); }
});

test(`${sanitize}: large Danish payload passes on stdin, no false block (#5326)`, () => {
  // >32 KB (den formodede Windows-env-var-graense) med aeoeaa, i den form et
  // rigtigt Edit-kald har. Ingen secret-patterns -> skal vaere tavs exit 0.
  const line = 'Patch note med danske tegn æøå ÆØÅ og lidt fyld 0123456789 abcdef\n';
  const payload = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: 'frontend/src/data/patchNotes.js', new_string: line.repeat(3000) },
    tool_response: 'ok',
  });
  assert.ok(payload.length > 32768, `payload skal overstige 32 KB (var ${payload.length})`);
  const result = run(sanitize, payload);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test(`${sanitize}: a real secret in a large Danish payload still blocks (#5326)`, () => {
  // Modproeven: stoerrelses-fixet maa ikke goere vagten blind. Fixturen samles
  // ved runtime, saa denne fil ikke selv indeholder et komplet pattern.
  const line = 'Patch note med danske tegn æøå ÆØÅ og lidt fyld 0123456789 abcdef\n';
  // FIXTURE_DO_NOT_USE er allow-listet i high-entropy-fallbacken og i
  // .gitleaks.toml; det navngivne supabase-secret-pattern koerer FOER den
  // allow-liste, saa fixturen blokerer stadig - den stoejer bare ikke i
  // uvedkommende tool-output.
  const fake = 'sb' + '_secret_' + 'FIXTURE_DO_NOT_USE_1234567890abcdefghij';
  const payload = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: 'frontend/src/data/patchNotes.js', new_string: line.repeat(3000) + fake },
    tool_response: 'ok',
  });
  assert.ok(payload.length > 32768);
  const result = run(sanitize, payload);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /SECRET LEAK DETECTED/);
  assert.match(result.stderr, /supabase-secret/);
});
