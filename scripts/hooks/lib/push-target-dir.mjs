// Ejer 4/11 (#7660, Codex P2): finder det worktree, en `git push` faktisk koerer fra.
// Laeser hook-input (JSON) paa stdin og printer mappen fra `cd <dir> && ...` eller
// `git -C <dir> push`, med shell-quoting fjernet. Intet output = sessionens cwd.
// Med --dest printes i stedet pushets maal, som vagterne skal tjekke (ejer 8/11).
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

export const LOCAL_BRANCH = '__LOCAL__';
export const ALL_BACKUP = '__ALL_BACKUP__';

// Backup-branches uden PR: preflight og CI-loop-vagten har intet at beskytte der.
export const BACKUP_BRANCH_RE = /^(wip|backup)\//;

// Argumenterne efter `push`, til foerste uquotede &, ; eller |. Shell-quoting fjernes (Codex P2).
function argsAfterPush(cmd, from) {
  const args = [];
  const re = new RegExp(String.raw`\s*${ARG}`, 'y');
  re.lastIndex = from;
  for (;;) {
    const m = re.exec(cmd);
    if (!m) break;
    args.push(pick(m));
    // Redirects som `2>&1` indeholder & og maa ikke afslutte argumenterne.
    const redirect = cmd.slice(re.lastIndex).match(/^\s*\d*>>?&?\S*/);
    if (redirect) re.lastIndex += redirect[0].length;
  }
  return args;
}

function destinationsOf(args) {
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-o' || a === '--push-option' || a === '--repo') { i++; continue; }
    if (a.startsWith('-')) continue;
    positional.push(a);
  }
  const specs = positional.slice(1); // positional[0] = remote
  if (!specs.length) return [LOCAL_BRANCH];
  return specs.map((raw) => {
    const spec = raw.replace(/^\+/, '');
    const dst = spec.includes(':') ? spec.slice(spec.indexOf(':') + 1) : spec;
    if (!dst || dst === 'HEAD') return LOCAL_BRANCH;
    return dst.replace(/^refs\/heads\//, '');
  });
}

// Ejer 8/11: vagterne doemte pushets maal ud fra den lokale branch, saa
// `git push origin HEAD:wip/x` fra feat/y blev tjekket som feat/y. Returnerer ALLE
// maal i ALLE `git push` i kommandoen (Codex P2); LOCAL_BRANCH = den lokale branch.
export function pushDestinations(command) {
  const cmd = String(command ?? '');
  const re = new RegExp(String.raw`\bgit\s+(?:-C\s+${ARG}\s+)?push\b`, 'g');
  const out = [];
  for (const m of cmd.matchAll(re)) out.push(...destinationsOf(argsAfterPush(cmd, m.index + m[0].length)));
  return out;
}

// Det vagterne skal tjekke: ALL_BACKUP naar hvert eneste maal er en backup-branch,
// ellers de ikke-backup-maal der er tilbage.
export function guardTargets(command) {
  const all = pushDestinations(command);
  if (all.length && all.every((d) => BACKUP_BRANCH_RE.test(d))) return [ALL_BACKUP];
  return [...new Set(all.filter((d) => !BACKUP_BRANCH_RE.test(d)))];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const command = input?.tool_input?.command;
    const out = process.argv.includes('--dest') ? guardTargets(command).join('\n') : pushTargetDir(command);
    if (out) process.stdout.write(out);
  } catch { /* fail-soft: intet output */ }
}
