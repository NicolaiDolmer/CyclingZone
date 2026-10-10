// Standalone CLI always runs, including through worktree/junction aliases.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO, probeFrontendFreshness, readProductionBuildState } from './frontend-freshness.mjs';

process.exitCode = 1;
const root = fileURLToPath(new URL('../', import.meta.url));
const api = path => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }));
const result = await probeFrontendFreshness({
  readMain: () => api(`repos/${REPO}/commits/main`).sha,
  readVersion: async () => {
    const response = await fetch('https://cyclingzone.org/version.json', {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Version unavailable');
    return response.json();
  },
  refresh: () => execFileSync('git', ['-C', root, 'fetch', '--quiet', 'origin', 'main'], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }),
  git: args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }),
  observe: sha => readProductionBuildState(sha, api),
});
console.log(JSON.stringify(result));
process.exitCode = ['current', 'intentionally-unchanged', 'building'].includes(result.state) ? 0 : 1;
