// Ejer 4/11 (#7660, Codex P2): finder det worktree, en `git push` faktisk koerer fra.
// Laeser hook-input (JSON) paa stdin og printer mappen fra `cd <dir> && ...` eller
// `git -C <dir> push`, med shell-quoting fjernet. Intet output = sessionens cwd.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Enkeltquotet, dobbeltquotet (med \-escapes) eller uquotet argument.
const ARG = String.raw`(?:'([^']*)'|"((?:[^"\\]|\\.)*)"|([^\s&;|'"]+))`;

function pick(m) {
  if (!m) return null;
  if (m[1] !== undefined) return m[1];
  if (m[2] !== undefined) return m[2].replace(/\\(.)/g, '$1');
  return m[3] ?? null;
}

export function pushTargetDir(command) {
  const cmd = String(command ?? '');
  const viaC = pick(cmd.match(new RegExp(String.raw`git\s+-C\s+${ARG}\s+push\b`)));
  if (viaC) return viaC;
  return pick(cmd.match(new RegExp(String.raw`^\s*cd\s+${ARG}\s*&&`)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const dir = pushTargetDir(input?.tool_input?.command);
    if (dir) process.stdout.write(dir);
  } catch { /* fail-soft: intet output */ }
}
