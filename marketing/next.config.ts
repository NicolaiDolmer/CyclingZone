import type { NextConfig } from "next";
import path from "node:path";

// Turbopack/file-tracing må ikke gå op i repo-roden: i worktrees er roden's
// node_modules en junction til delt cache uden for projektet, hvilket vælter
// Turbopacks resolver ("points out of the filesystem root"). marketing/ er
// selvstændig med egne node_modules + lockfile.
const projectRoot = path.resolve(process.cwd());

const nextConfig: NextConfig = {
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
  // Next 16 genererer ellers sin egen AGENTS.md/CLAUDE.md i marketing/ ved
  // hver dev-start, som kolliderer med repoets egne (rod-)CLAUDE.md-filer.
  agentRules: false,
};

export default nextConfig;
