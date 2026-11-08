// Ejer 4/11 (#7660, Codex P2): finder det worktree, en `git push` faktisk koerer fra.
// Laeser hook-input (JSON) paa stdin og printer mappen fra `cd <dir> && ...` eller
// `git -C <dir> push`, med shell-quoting fjernet. Intet output = sessionens cwd.
// Med --dest printes i stedet destinations-branchen fra en eksplicit refspec (ejer 8/11).
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

// Ejer 8/11: vagterne doemte pushets maal ud fra den lokale branch, saa
// `git push origin HEAD:wip/x` fra feat/y blev tjekket som feat/y. Finder
// destinations-branchen i en eksplicit refspec (`<src>:<dst>`). null = den
// lokale branch er maalet.
export function pushDestBranch(command) {
  const cmd = String(command ?? '');
  const m = cmd.match(new RegExp(String.raw`git\s+(?:-C\s+${ARG}\s+)?push\b([^&;|]*)`));
  if (!m) return null;
  const args = m[4].trim().split(/\s+/).filter((a) => a && !a.startsWith('-'));
  const spec = args[1]; // args[0] = remote
  if (!spec || !spec.includes(':')) return null;
  const dst = spec.slice(spec.indexOf(':') + 1).replace(/^\+/, '').replace(/^refs\/heads\//, '');
  return dst || null;
}

// Backup-branches uden PR: preflight og CI-loop-vagten har intet at beskytte der.
export const BACKUP_BRANCH_RE = /^(wip|backup)\//;

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const command = input?.tool_input?.command;
    const out = process.argv.includes('--dest') ? pushDestBranch(command) : pushTargetDir(command);
    if (out) process.stdout.write(out);
  } catch { /* fail-soft: intet output */ }
}
