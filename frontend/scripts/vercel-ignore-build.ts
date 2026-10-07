// Standalone CLI: inverse Vercel exit convention, 0 skips and 1 builds.
// Do not add an isMain path guard: a junction alias must still make a decision.
import { execFileSync } from 'node:child_process';
import { productionBuildDecision, previewBuildDecision, type Git } from './vercel-build-decision.ts';

process.exitCode = 1;
try {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 15000 }).trim();
  const git: Git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  const result = !branch ? { build: true, reason: 'No branch metadata: build conservatively' }
    : branch === 'main' ? productionBuildDecision(process.env.VERCEL_GIT_PREVIOUS_SHA, git)
    : previewBuildDecision(process.env.VERCEL_GIT_PREVIOUS_SHA, git);
  console.log(`${result.build ? 'BUILD' : 'SKIP'}: ${result.reason}`);
  process.exitCode = result.build ? 1 : 0;
} catch { console.log('BUILD: unable to inspect repository'); }
