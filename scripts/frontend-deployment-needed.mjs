// Read-only, local deployment requirement. Unknown inputs require Vercel.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { frontendDeploymentRequirement } from '../frontend/scripts/vercel-build-decision.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
console.log(JSON.stringify(frontendDeploymentRequirement(process.argv[2] || '', git)));
