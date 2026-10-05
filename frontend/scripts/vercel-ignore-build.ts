// #6202: Vercel's inverse exit convention: 0 skips, 1 builds.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHARED_BUILD_INPUTS: ReadonlySet<string> = new Set(["backend/lib/raceParticipationHistory.ts"]);
const NON_FRONTEND_PREFIXES = ['backend/', 'database/', 'docs/', 'marketing/', 'pr-screens/', '.claude/', '.agents/', '.github/'];
const NON_FRONTEND_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md', 'ARCHITECTURE.md', 'LICENSE', 'LICENSE.md']);

// Unknown paths build. In particular, root scripts, shared packages, lockfiles,
// toolchain settings and newly introduced directories never silently skip.
export function needsFrontendBuild(paths: string[]): boolean {
  return paths.some(path => SHARED_BUILD_INPUTS.has(path) || !NON_FRONTEND_FILES.has(path) && !NON_FRONTEND_PREFIXES.some(prefix => path.startsWith(prefix)));
}

type Git = (args: string[]) => string;
export function productionBuildDecision(previousSha: string | undefined, git: Git): { build: boolean; reason: string } {
  if (!previousSha || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(previousSha)) return { build: true, reason: 'No trustworthy previous successful deployment' };
  try {
    const head = git(['rev-parse', 'HEAD']).trim();
    if (head === previousSha) return { build: true, reason: 'Same-commit redeploy: retain manual rebuilds and environment updates' };
    try { git(['cat-file', '-e', `${previousSha}^{commit}`]); }
    catch {
      // Fetch only the recorded successful deployment, not an arbitrary parent.
      git(['fetch', '--no-tags', '--depth=1', 'origin', previousSha]);
      git(['cat-file', '-e', `${previousSha}^{commit}`]);
    }
    // Disabling rename detection retains BOTH sides of cross-directory moves.
    const paths = git(['diff', '--name-only', '--no-renames', '-z', previousSha, 'HEAD', '--']).split('\0').filter(Boolean);
    const build = needsFrontendBuild(paths);
    return { build, reason: build ? 'Frontend or possible build dependency changed' : 'Only known non-frontend files changed' };
  } catch { return { build: true, reason: 'Git comparison unavailable: build conservatively' }; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 15000 }).trim();
    const git: Git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = productionBuildDecision(process.env.VERCEL_GIT_PREVIOUS_SHA, git);
    console.log(`${result.build ? 'BUILD' : 'SKIP'}: ${result.reason}`);
    process.exitCode = result.build ? 1 : 0;
  } catch { console.log('BUILD: unable to inspect repository'); process.exitCode = 1; }
}
