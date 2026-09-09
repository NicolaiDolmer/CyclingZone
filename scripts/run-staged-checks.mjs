// Reuse the actual lint-staged globs, so the fast path cannot drift from policy.
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import config from '../lint-staged.config.mjs';

// Use lint-staged's own installed matching engine (including nested installs).
const require = createRequire(import.meta.url);
const picomatch = createRequire(require.resolve('lint-staged'))('picomatch');

const files = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
if (!Object.keys(config).some(pattern => files.some(picomatch(pattern, { cwd: process.cwd(), dot: true, matchBase: !pattern.includes('/'), posixSlashes: true, strictBrackets: true })))) {
  console.log('Staged lint: no matching files; lint-staged/ESLint not started.');
  process.exit(0);
}
const result = spawnSync(process.execPath, ['node_modules/lint-staged/bin/lint-staged.js', '--config', 'lint-staged.config.mjs'], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
