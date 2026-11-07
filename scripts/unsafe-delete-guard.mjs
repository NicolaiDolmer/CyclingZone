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
import { isAbsolute, resolve, relative } from 'node:path';
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
export function checkCommand(command, { cwd = process.cwd(), readScript = defaultReadScript, isTracked = defaultIsTracked } = {}) {
  // Tekst der kun BESKRIVER en kommando (gh-kommentarer, commit-beskeder, echo) koerer intet.
  const cmd = String(command || '')
    .split(/\r?\n|&&|\|\||;/)
    .filter((seg) => !/^\s*(?:gh\s|git\s+(?:-C\s+\S+\s+)?commit\b|echo\b|printf\b|Write-(?:Host|Output)\b)/i.test(seg))
    .join('\n');
  if (WORKTREE_REMOVE.test(cmd)) {
    return block('raa `git worktree remove` i kommandoen');
  }
  if (hasRecursiveDelete(cmd) && PROTECTED_PATH.test(cmd)) {
    return block('rekursiv sletning mod en beskyttet sti (worktree, OneDrive eller delt cache)');
  }
  for (const m of cmd.matchAll(SCRIPT_RUNNER)) {
    const raw = m[1].replace(/^["']|["']$/g, '');
    const abs = isAbsolute(raw) ? raw : resolve(cwd, raw);
    const rel = relativeToRepo(abs);
    if (rel && SAFE_REMOVERS.includes(rel)) continue;
    if (isTracked(abs)) continue;
    const body = readScript(abs);
    if (body == null) continue;
    if (WORKTREE_REMOVE.test(body)) return block(`scriptet ${raw} fjerner worktrees direkte`);
    if (hasRecursiveDelete(body) && (PROTECTED_PATH.test(body) || /worktree/i.test(body))) {
      return block(`scriptet ${raw} sletter rekursivt i worktrees eller delte mapper`);
    }
  }
  return { blocked: false };
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

function repoRoot() {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}
function relativeToRepo(abs) {
  const root = repoRoot();
  if (!root) return null;
  const rel = relative(root, abs).replace(/\\/g, '/');
  return rel.startsWith('..') ? null : rel;
}
function defaultReadScript(abs) {
  try { if (!existsSync(abs) || statSync(abs).size > 2e6) return null; return readFileSync(abs, 'utf8'); } catch { return null; }
}
function defaultIsTracked(abs) {
  const root = repoRoot();
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
