// Git policy for staged documentation; independent of any agent's tool payload.
// Budgets: CLAUDE.md close-out (30 lines, 1200 approximate tokens).
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const paths = git('diff', '--cached', '--name-only', '--no-renames', '-z').split('\0').filter(Boolean);
const archived = paths.filter(path => path.toLowerCase().startsWith('docs/archive/'));
if (archived.length) {
  console.error(`STAGED-DOCS BLOCKED: archive is protected: ${archived.join(', ')}`);
  console.error('Keep active work outside docs/archive/. Historical content remains in Git.');
  process.exit(1);
}
for (const path of paths.filter(path => path.toLowerCase() === 'docs/now.md')) {
  // A deletion has no staged blob to measure.
  if (!git('ls-files', '--stage', '--', path).trim()) continue;
  const content = git('show', `:${path}`).replace(/\r\n/g, '\n');
  const lines = content ? content.split('\n').length - Number(content.endsWith('\n')) : 0;
  const tokens = Math.ceil(content.length / 4);
  if (lines > 30 || tokens > 1200) {
    console.error(`STAGED-DOCS BLOCKED: ${path}: ${lines} lines, ${tokens} approx tokens; maximum 30 lines / 1200 tokens.`);
    console.error('Trim the staged content. Do not move it into docs/archive/.');
    process.exit(1);
  }
}
