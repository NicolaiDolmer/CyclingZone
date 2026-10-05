export const SHARED_BUILD_INPUTS: ReadonlySet<string> = new Set(["backend/lib/raceParticipationHistory.ts"]);
const NON_FRONTEND_PREFIXES = ['backend/', 'database/', 'docs/', 'marketing/', 'pr-screens/', '.claude/', '.agents/', '.github/'];
const NON_FRONTEND_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md', 'ARCHITECTURE.md', 'LICENSE', 'LICENSE.md']);

// Unknown paths build. In particular, root scripts, shared packages, lockfiles,
// toolchain settings and newly introduced directories never silently skip.
export function needsFrontendBuild(paths: string[]): boolean {
  return paths.some(path => SHARED_BUILD_INPUTS.has(path) || !NON_FRONTEND_FILES.has(path) && !NON_FRONTEND_PREFIXES.some(prefix => path.startsWith(prefix)));
}

export type Git = (args: string[]) => string;
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

// The verifier compares this commit to its first parent, not to local HEAD.
// Missing history is never evidence that a Vercel deployment can be omitted.
export function frontendDeploymentRequirement(sha: string, git: Git): { required: boolean; reason: string } {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha)) return { required: true, reason: 'Invalid commit: require Vercel' };
  try {
    const parent = git(['rev-parse', `${sha}^1`]).trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(parent)) return { required: true, reason: 'Missing parent: require Vercel' };
    const paths = git(['diff', '--name-only', '--no-renames', '-z', parent, sha, '--']).split('\0').filter(Boolean);
    const required = needsFrontendBuild(paths);
    return { required, reason: required ? 'Frontend or possible build input changed' : 'Only known independent paths changed' };
  } catch { return { required: true, reason: 'Comparison unavailable: require Vercel' }; }
}