import test from 'node:test';
import assert from 'node:assert/strict';
import { needsFrontendBuild, SHARED_BUILD_INPUTS } from './vercel-build-decision.ts';

test('docs, backend and marketing changes alone do not rebuild the frontend', () => {
  for (const path of ['docs/NOW.md','backend/lib/example.js','database/example.sql','marketing/app/page.tsx','.claude/learnings/example.md','AGENTS.md']) assert.equal(needsFrontendBuild([path]),false,path);
});
test('frontend and possible shared build inputs always build', () => {
  for (const path of ['frontend/src/App.jsx','frontend/public/locales/en/help.json','frontend/package-lock.json','scripts/generate-assets.mjs','package-lock.json','.npmrc','shared/contracts.ts','new-package/index.js']) assert.equal(needsFrontendBuild([path]),true,path);
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
  const files=execFileSync('git',['-C',root,'ls-files','-z','--','frontend/src','frontend/scripts','frontend/vite-plugins','frontend/vite.config.js',...SHARED_BUILD_INPUTS],{encoding:'utf8'}).split('\0').filter(f=>/\.(?:[cm]?[jt]sx?|css)$/.test(f)&&!f.includes('.test.'));
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
  assert.equal(frontendDeploymentRequirement(sha, git('backend/lib/example.js\0')).required, false);
  for (const file of ['frontend/src/App.jsx', 'backend/lib/raceParticipationHistory.ts', 'package-lock.json', 'unknown/file']) {
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
