#!/usr/bin/env node
// unsafe-delete-guard.mjs - ingen sletning af worktrees eller delte mapper uden om de sikre scripts (#7837).
//
// Hvorfor (haendelse 7/11, PC1): en session ryddede 178 worktrees med raa
// `git worktree remove --force --force` og en `rmSync`-fallback i et ad hoc-script i stedet
// for scripts/remove-worktree.ps1. Paa Windows foelger begge junctions: hovedcheckoutets
// node_modules, 30 delte caches og filer i OneDrive `balance-internals/1857` blev slettet.
// Ignorerede filer i worktrees (PR-tekster, maalinger, billeder) blev ikke arkiveret, fordi
// `git status` ikke ser dem. Ejer 7/11: nul tolerance for slettet arbejde.
//
// Reglen: et worktree fjernes KUN af scripts/remove-worktree.ps1 eller
// scripts/prune-merged-worktrees.ps1 (via close-out-cleanup.ps1). De fjerner links foerst,
// arkiverer alt ikke-versioneret til OneDrive og verificerer arkivet, foer noget slettes.
//
// Hooken (PreToolUse Bash + PowerShell) blokerer:
//   1. `git ... worktree remove` direkte i en kommando.
//   2. Rekursiv sletning (rm -r, Remove-Item -Recurse, rmdir /s, rd /s, rimraf, rmSync,
//      fs.rm, rmdirSync recursive, shutil.rmtree, Directory.Delete) mod en beskyttet sti:
//      worktree-mapper, OneDrive, CyclingZone-context, balance-internals, node-modules-cache.
//   3. Det samme INDE i et ad hoc-script, som kommandoen koerer (node/pwsh/bash/python <fil>):
//      scriptet laeses, og raa worktree-fjernelse eller rekursiv sletning sammen med
//      "worktree" eller en beskyttet sti blokeres. Versionerede scripts i repoet er undtaget,
//      fordi de er reviewet, men test-filen haandhaever, at kun allowlisten maa indeholde
//      `worktree remove`.
// Fail-open ved uventede fejl (en vagt maa ikke spaerre for arbejdet), fail-closed ved match.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve, relative, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SAFE_REMOVERS = [
  'scripts/remove-worktree.ps1',
  'scripts/prune-merged-worktrees.ps1',
  'scripts/close-out-cleanup.ps1',
  'scripts/close-out-cleanup-junctions.ps1',
];

const WORKTREE_REMOVE = /\bgit\b(?:\s+-C\s+(?:"[^"]*"|'[^']*'|\S+))?[^\n|;&]*?\bworktree['"]?\s*,?\s*['"]?remove\b/i;
const RECURSIVE_DELETE = [
  /\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/,
  /\bRemove-Item\b[^\n]*-Recurse\b/i,
  /\b(?:ri|rmdir|rd|del)\b[^\n]*\s-Recurse\b/i,
  /\b(?:rmdir|rd)\s+(?:\/[sq]\s+)*\/s\b/i,
  /\brimraf\b/,
  /\brmSync\s*\(/,
  /\b(?:fs|fsp|promises)\.rm\s*\(/,
  /\brmdirSync\s*\([^)]*recursive/,
  /\bshutil\.rmtree\b/,
  /\bDirectory\]?::Delete\s*\(|\bDirectory\.Delete\s*\(/,
];
const PROTECTED_PATH = /CyclingZone-worktrees|[\\/]\.codex[\\/]+worktrees|[\\/]\.claude[\\/]+worktrees|[\\/]CZ-|cz-wt|OneDrive|CyclingZone-context|balance-internals|node-modules-cache|\.wave-scratch/i;
const SCRIPT_RUNNER = /\b(?:node|tsx|bun|deno(?:\s+run)?|pwsh|powershell(?:\.exe)?|bash|sh|python3?|py)\b(?:\s+-{1,2}[A-Za-z-]+(?:\s+\S+)?)*\s+(?:-File\s+)?("[^"]+\.(?:mjs|cjs|js|ts|ps1|sh|py)"|'[^']+\.(?:mjs|cjs|js|ts|ps1|sh|py)'|[^\s;&|]+\.(?:mjs|cjs|js|ts|ps1|sh|py))/gi;

const hasRecursiveDelete = (s) => RECURSIVE_DELETE.some((re) => re.test(s));

// Ren: afgoer om en kommandotekst (og indholdet af de scripts den koerer) er en usikker sletning.
// readScript(path) -> string|null; isTracked(path) -> boolean (versioneret, reviewet script).
export function checkCommand(command, { cwd = process.cwd(), readScript = defaultReadScript, isTracked = defaultIsTracked, listWorktrees = defaultListWorktrees } = {}) {
  let wtCache = null;
  const worktreeRoots = () => (wtCache ??= listWorktrees(cwd));
  // Tekst der kun BESKRIVER en kommando (gh-kommentarer, commit-beskeder, echo) koerer intet.
  // Hvert led i en pipeline vurderes for sig (#7839-review: `printf x | git worktree remove`).
  const segments = String(command || '')
    .split(/\r?\n|&&|\|\|?|;/)
    .filter((seg) => !/^\s*(?:gh\s|git\s+(?:-C\s+\S+\s+)?commit\b|echo\b|printf\b|Write-(?:Host|Output)\b)/i.test(seg));
  const cmd = segments.join('\n');
  if (WORKTREE_REMOVE.test(cmd)) {
    return block('raa `git worktree remove` i kommandoen');
  }
  if (hasRecursiveDelete(cmd) && PROTECTED_PATH.test(cmd)) {
    return block('rekursiv sletning mod en beskyttet sti (worktree, OneDrive eller delt cache)');
  }
  // Relative maal oploeses mod cwd (#7839-review: `rm -rf ../fix-1` inde fra et worktree).
  for (const seg of segments) {
    if (!hasRecursiveDelete(seg)) continue;
    for (const target of deleteOperands(seg)) {
      if (protectedTarget(resolve(cwd, target.replace(/\\/g, '/')), resolve(cwd), worktreeRoots())) return block(`rekursiv sletning af ${target} rammer et worktree eller en delt mappe`);
    }
  }
  for (const m of cmd.matchAll(SCRIPT_RUNNER)) {
    const raw = m[1].replace(/^["']|["']$/g, '');
    const native = gitBashToNative(raw);
    const abs = isAbsolute(native) ? native : resolve(cwd, native);
    // Review #7854: et sikkert NAVN er ikke nok. Ogsaa remove-worktree.ps1 skal vaere
    // versioneret og uaendret, ellers laeses den (en omskrevet kopi i et andet worktree
    // maa ikke slippe igennem uden scanning).
    if (isTracked(abs)) continue;
    const body = readScript(abs);
    if (body == null) continue;
    if (WORKTREE_REMOVE.test(body)) return block(`scriptet ${raw} fjerner worktrees direkte`);
    if (hasRecursiveDelete(body) && (PROTECTED_PATH.test(body) || /worktree/i.test(body))) {
      return block(`scriptet ${raw} sletter rekursivt i worktrees eller delte mapper`);
    }
    // #7839-review P1: faste stier i scriptets slettekald oploeses mod cwd.
    for (const target of scriptDeleteTargets(body)) {
      if (protectedTarget(resolve(cwd, target.replace(/\\/g, '/')), resolve(cwd), worktreeRoots())) {
        return block(`scriptet ${raw} sletter ${target}, som rammer et worktree eller en delt mappe`);
      }
    }
  }
  return { blocked: false };
}

// Operander efter en slettekommando (rm, Remove-Item, rmdir, rd, del, ri), uden flag.
export function deleteOperands(seg) {
  const m = seg.match(/\b(?:rm|Remove-Item|rmdir|rd|del|ri)\b(.*)$/i);
  if (!m) return [];
  const toks = m[1].match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return toks
    .map((t) => t.replace(/^["']|["']$/g, ''))
    .filter((t) => t && !/^-|^\/[a-zA-Z]$/.test(t) && !/^\$/.test(t) && !/^(?:Force|Recurse|Path|LiteralPath)$/i.test(t));
}

// Beskyttet = et worktree-rod eller en mappe over det, eller en beskyttet sti uden for
// det worktree, kommandoen koerer i. Sletning INDE i eget worktree (fx frontend/dist) er fri.
export function protectedTarget(abs, cwd, worktreeRoots = []) {
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const a = norm(abs);
  const c = norm(cwd);
  // #7839-review P1: en mappe, der INDEHOLDER arbejdsmappen eller et registreret worktree
  // (fx `rm -rf ../..`), sletter alt derunder.
  const containsOrIs = (p) => p === a || p.startsWith(a + '/');
  if (containsOrIs(c)) return true;
  if (worktreeRoots.some((r) => containsOrIs(norm(r)))) return true;
  const roots = /^(.*?\/(?:cyclingzone-worktrees|\.codex\/worktrees|\.claude\/worktrees))(\/[^/]+)?/;
  const mine = c.match(roots);
  const own = mine && mine[2] ? mine[1] + mine[2] : null;
  const hit = a.match(roots);
  if (hit && (!hit[2] || a === hit[1] + hit[2])) return true; // selve worktree-mappen eller en hel worktree
  if (own && a.startsWith(own + '/')) return false; // inde i eget worktree, fx frontend/dist
  return PROTECTED_PATH.test(a);
}

// Faste (literal) stier i rekursive slettekald i et script: rmSync('../x', ...), `rm -rf ../x` m.fl.
export function scriptDeleteTargets(body) {
  const out = [];
  const re = /\b(?:rmSync|rmdirSync|rimraf(?:\.sync)?|rmtree|(?:fs|fsp|promises)\.rm)\s*\(\s*(['"`])([^'"`$]+)\1/g;
  for (const m of String(body).matchAll(re)) out.push(m[2]);
  for (const line of String(body).split(/\r?\n/)) if (hasRecursiveDelete(line)) out.push(...deleteOperands(line));
  return out;
}

function block(reason) {
  return {
    blocked: true,
    reason,
    message: [
      `BLOKERET (#7837): ${reason}.`,
      'Worktrees fjernes KUN med scripts/remove-worktree.ps1 -Branch <b> eller',
      'scripts/prune-merged-worktrees.ps1 -Execute. De fjerner links foerst (ellers foelger',
      'sletningen junctions ind i node_modules-caches og OneDrive) og arkiverer alt',
      'ikke-versioneret, ogsaa ignorerede filer, til OneDrive private-recovery/worktree-archive.',
      'Haendelse 7/11: .claude/learnings/2026-11-07-worktree-oprydning-slettede-arbejde.md',
    ].join('\n'),
  };
}

// Roden for det repo/worktree, SCRIPTET ligger i, ikke hookens cwd: et script i
// C:/Dev/CyclingZone-worktrees/<spor>/scripts er versioneret i sporets worktree,
// og skal genkendes som det (bølge 7/11: guard-commit-branch.sh blev blokeret,
// fordi den blev slået op i hovedmappens repo og så scannet som ad hoc-script).
// Codex P1 (#7854): undtagelsen gælder KUN scripts i samme repo som vagten selv
// (samme fælles .git, dvs. hovedmappen eller et af dens worktrees). Et script i et
// fremmed repo bliver altid gennemlæst, også hvis det hedder som et sikkert script.
// Git Bash-stier (/c/dev/x) er ikke absolutte for Windows' resolve(); uden denne
// oversaettelse blev scriptet slaaet op i C:\c\dev\x, ikke fundet og sprunget over (fail-open).
export function gitBashToNative(p) {
  const m = process.platform === 'win32' && String(p).match(/^\/([a-zA-Z])(\/.*)?$/);
  return m ? `${m[1].toUpperCase()}:${m[2] || '/'}` : p;
}
function gitOut(dir, args) {
  try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}
const normPath = (p) => (p ? resolve(p).replace(/\\/g, '/').toLowerCase() : null);
// Doven: kun kommandoer der koerer et script betaler for git-kaldet (review #7854).
let guardCommonDir;
const GUARD_COMMON_DIR_OF = () => (guardCommonDir === undefined
  ? (guardCommonDir = normPath(gitOut(dirname(fileURLToPath(import.meta.url)), ['rev-parse', '--path-format=absolute', '--git-common-dir'])))
  : guardCommonDir);
function repoRoot(abs) {
  if (!abs) return gitOut(process.cwd(), ['rev-parse', '--show-toplevel']);
  const dir = dirname(abs);
  const common = normPath(gitOut(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const guardCommon = GUARD_COMMON_DIR_OF();
  if (!common || !guardCommon || common !== guardCommon) return null;
  return gitOut(dir, ['rev-parse', '--show-toplevel']);
}
function defaultListWorktrees(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9).trim());
  } catch { return []; }
}
function defaultReadScript(abs) {
  try { if (!existsSync(abs) || statSync(abs).size > 2e6) return null; return readFileSync(abs, 'utf8'); } catch { return null; }
}
function defaultIsTracked(abs) {
  const root = repoRoot(abs);
  if (!root) return false;
  const rel = relative(root, abs).replace(/\\/g, '/');
  if (rel.startsWith('..')) return false;
  try {
    execFileSync('git', ['-C', root, 'ls-files', '--error-unmatch', rel], { stdio: 'ignore' });
    // Versioneret OG uaendret: en lokalt aendret version er ikke reviewet.
    execFileSync('git', ['-C', root, 'diff', '--quiet', 'HEAD', '--', rel], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

// Hook-mode: laeser PreToolUse-JSON paa stdin, exit 2 + stderr ved blokering.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv[2] === 'hook') {
  let raw = '';
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    try {
      const j = JSON.parse(raw || '{}');
      const name = j.tool_name || '';
      if (name !== 'Bash' && name !== 'PowerShell') process.exit(0);
      const v = checkCommand(j.tool_input?.command, { cwd: j.cwd || process.cwd() });
      if (v.blocked) { process.stderr.write(v.message + '\n'); process.exit(2); }
      process.exit(0);
    } catch { process.exit(0); }
  });
}
