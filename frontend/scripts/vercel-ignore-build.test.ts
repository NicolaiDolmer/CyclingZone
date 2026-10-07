import test from 'node:test';
import assert from 'node:assert/strict';
import { needsFrontendBuild } from './vercel-build-decision.ts';
import { previewBuildDecision } from './vercel-build-decision.ts';

test('preview compares the cumulative whole-repo PR diff without an origin remote', () => {
  const calls: string[][] = [];
  const git = (paths: string) => (args: string[]) => {
    calls.push(args);
    if (args[0] === 'rev-parse') return 'b'.repeat(40);
    if (args[0] === 'merge-base') return 'a'.repeat(40);
    if (args[0] === 'diff') return paths;
    return '';
  };
  assert.equal(previewBuildDecision(undefined, git('docs/example.md\0backend/routes/x.js\0')).build, false);
  assert.ok(calls.some(args => args[0] === 'fetch' && args.includes('https://github.com/NicolaiDolmer/CyclingZone.git')));
  assert.ok(calls.some(args => args[0] === 'diff' && args.includes('--no-renames') && args.at(-1) === '--'));
  for (const file of ['frontend/src/App.jsx', 'backend/lib/x.ts', 'package-lock.json', 'scripts/x.mjs']) {
    assert.equal(previewBuildDecision(undefined, git(file + '\0docs/latest.md\0')).build, true, file);
  }
});

test('preview comparison failures and same-commit manual redeploys build', () => {
  assert.equal(previewBuildDecision(undefined, () => { throw new Error('fetch unavailable'); }).build, true);
  const sha = 'a'.repeat(40);
  assert.equal(previewBuildDecision(sha, () => sha).build, true);
  assert.equal(previewBuildDecision(undefined, args => args[0] === 'merge-base' ? '' : 'b'.repeat(40)).build, true);
});

test('real originless Git checkout includes frontend changes before the latest docs commit', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const prefix = join(tmpdir(), 'cz-preview-originless-');
  const fixture = mkdtempSync(prefix);
  const git = (args: string[]) => execFileSync('git', ['-C', fixture, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const commit = (message: string) => {
    git(['add', '.']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=NUL', 'commit', '-m', message]);
  };
  try {
    git(['init', '--initial-branch=main']);
    mkdirSync(join(fixture, 'docs'));
    writeFileSync(join(fixture, 'docs', 'base.md'), 'base');
    commit('base');
    git(['switch', '-c', 'preview']);
    mkdirSync(join(fixture, 'frontend'));
    writeFileSync(join(fixture, 'frontend', 'input.ts'), 'export const input = 1;');
    commit('frontend input');
    writeFileSync(join(fixture, 'docs', 'latest.md'), 'later docs');
    commit('later docs');
    assert.equal(git(['remote']).trim(), '');
    assert.equal(git(['diff', '--name-only', 'HEAD^', 'HEAD']).trim(), 'docs/latest.md');
    const decision = previewBuildDecision(undefined, args => {
      if (args[0] === 'fetch') {
        assert.equal(args[3], 'https://github.com/NicolaiDolmer/CyclingZone.git');
        return git([...args.slice(0, 3), fixture, ...args.slice(4)]);
      }
      return git(args);
    });
    assert.equal(decision.build, true, decision.reason);
    assert.equal(git(['remote']).trim(), '');
  } finally {
    if (!resolve(fixture).startsWith(resolve(prefix))) throw new Error('Unsafe fixture cleanup path');
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('docs, backend and marketing changes alone do not rebuild the frontend', () => {
  for (const path of ['docs/NOW.md','backend/routes/example.js','database/example.sql','marketing/app/page.tsx','.claude/learnings/example.md','AGENTS.md']) assert.equal(needsFrontendBuild([path]),false,path);
});
test('frontend and possible shared build inputs always build', () => {
  for (const path of ['backend/lib/x.ts','backend/lib/nested/x.js','backend/lib/raceParticipationHistory.ts','frontend/src/App.jsx','frontend/public/locales/en/help.json','frontend/package-lock.json','scripts/generate-assets.mjs','package-lock.json','.npmrc','shared/contracts.ts','new-package/index.js']) assert.equal(needsFrontendBuild([path]),true,path);
});
test('a deleted or renamed frontend path still triggers a build', () => {
  assert.equal(needsFrontendBuild(['frontend/src/old.ts','backend/old.ts']),true);
  assert.equal(needsFrontendBuild([]),false);
});

test('production decisions use the last successful SHA across multi-commit pushes', async () => {
  const { productionBuildDecision } = await import('./vercel-build-decision.ts');
  const base='a'.repeat(40), head='b'.repeat(40), calls: string[][]=[];
  const git=(args: string[])=>{calls.push(args);if(args[0]==='rev-parse')return head;if(args[0]==='diff')return 'docs/NOW.md\0frontend/src/App.jsx\0';return '';};
  assert.equal(productionBuildDecision(base,git).build,true);
  assert.ok(calls.some(args=>args[0]==='diff'&&args.includes(base)&&args.includes('--no-renames')));
  assert.equal(productionBuildDecision(base,args=>args[0]==='rev-parse'?head:args[0]==='diff'?'docs/NOW.md\0':'').build,false);
});
test('first build, broken Git and same-commit redeploys always build', async () => {
  const { productionBuildDecision } = await import('./vercel-build-decision.ts');
  for (const sha of [undefined,'','not-a-sha']) assert.equal(productionBuildDecision(sha,()=>{throw Error('not called');}).build,true);
  const sha='a'.repeat(40);
  assert.equal(productionBuildDecision(sha,()=>sha).build,true);
  assert.equal(productionBuildDecision(sha,()=>{throw Error('Git unavailable');}).build,true);
});
test('a shallow checkout fetches only the exact previous deployment and builds if that fails', async () => {
  const { productionBuildDecision } = await import('./vercel-build-decision.ts');
  const base='a'.repeat(40), head='b'.repeat(40);let fetched=false;
  const git=(args: string[])=>{
    if(args[0]==='rev-parse') return head;
    if(args[0]==='cat-file'&&!fetched)throw Error('missing');
    if(args[0]==='fetch'){assert.equal(args.at(-1),base);fetched=true;}
    if(args[0]==='diff')return 'docs/readme.md\0';
    return '';
  };
  assert.equal(productionBuildDecision(base,git).build,false);
  assert.equal(fetched,true);
  assert.equal(productionBuildDecision(base,args=>{if(args[0]==='rev-parse')return head;throw Error('missing or fetch failed');}).build,true);
});
test('literal relative imports outside frontend remain build inputs', async () => {
  const {execFileSync}=await import('node:child_process');
  const fs=await import('node:fs'); const path=await import('node:path');const {fileURLToPath}=await import('node:url');
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const files=execFileSync('git',['-C',root,'ls-files','-z','--','frontend/src','frontend/scripts','frontend/vite-plugins','frontend/vite.config.js','backend/lib/raceParticipationHistory.ts'],{encoding:'utf8'}).split('\0').filter(f=>/\.(?:[cm]?[jt]sx?|css)$/.test(f)&&!f.includes('.test.'));
  for(const file of files){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    for(const m of source.matchAll(/(?:from\s*|import\s*\(?|@import\s*)["'](\.[^"']*)["']/g)){
      const target=path.relative(root,path.resolve(root,path.dirname(file),m[1])).replaceAll('\\','/');
      assert.equal(needsFrontendBuild([target]),true,file+' imports '+target);
    }
  }
});

test('CLI path mismatch cannot silently exit zero and skip the build', async () => {
  const { spawnSync } = await import('node:child_process');
  const cliUrl = new URL('./vercel-ignore-build.ts', import.meta.url).href;
  const script = `process.argv[1] = 'junction-alias/vercel-ignore-build.ts'; await import(${JSON.stringify(cliUrl)});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: '' },
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /BUILD:/);
});

test('deployment verification follows known build inputs and fails closed', async () => {
  const { frontendDeploymentRequirement } = await import('./vercel-build-decision.ts');
  const sha = 'b'.repeat(40), parent = 'a'.repeat(40);
  const git = (files: string) => (args: string[]) => args[0] === 'rev-parse' ? parent : files;
  assert.equal(frontendDeploymentRequirement(sha, git('backend/routes/example.js\0')).required, false);
  for (const file of ['frontend/src/App.jsx', 'backend/lib/x.ts', 'backend/lib/raceParticipationHistory.ts', 'package-lock.json', 'unknown/file']) {
    assert.equal(frontendDeploymentRequirement(sha, git(file+'\0')).required, true, file);
  }
  assert.equal(frontendDeploymentRequirement(sha, () => { throw Error('unavailable'); }).required, true);
  assert.equal(frontendDeploymentRequirement('invalid', () => parent).required, true);
});

test('independent merges do not require source maps for a frontend build that is not required', async () => {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const verifyPath = fileURLToPath(new URL('../../scripts/verify-deploy.ps1', import.meta.url));
  const code = `$ErrorActionPreference='Stop';
    $ast=[Management.Automation.Language.Parser]::ParseFile('${verifyPath.replaceAll("'", "''")}',[ref]$null,[ref]$null);
    $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-SentrySourceMaps'},$true);
    Invoke-Expression $fn.Extent.Text;
    $script:RequiresVercelDeployment=$false; $script:Sha='a'*40;
    $env:SENTRY_AUTH_TOKEN='synthetic-test-token'; $env:SENTRY_ORG='synthetic-test-org'; $env:SENTRY_PROJECT='synthetic-test-project';
    function Invoke-WebRequest { throw 'NETWORK_MUST_NOT_BE_CALLED' };
    Test-SentrySourceMaps; Write-Output 'SOURCE_MAP_SKIP_PASSED';`;
  const output = execFileSync('pwsh', ['-NoProfile', '-Command', code], { encoding: 'utf8' });
  assert.match(output, /SOURCE_MAP_SKIP_PASSED/);
});

test('backend library imports are covered while other backend imports are rejected', () => {
  assert.equal(needsFrontendBuild(['backend/lib/new-shared.ts']), true);
  assert.equal(needsFrontendBuild(['backend/routes/new-route.js']), false);
});
