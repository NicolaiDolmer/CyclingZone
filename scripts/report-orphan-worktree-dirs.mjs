#!/usr/bin/env node
// scripts/report-orphan-worktree-dirs.mjs
// ============================================================
// Melder mapper i worktree-roden der IKKE staar i `git worktree list`
// (#5391, forward-guard mod at #4924's 855-mappe-bunke vokser igen).
//
// WHY: #4924's afsluttede audit (docs/audits/2026-09-18-orphan-worktrees-
// uge38.md) fandt 855 forældreløse mappeskeletter under
// C:\Dev\CyclingZone-worktrees - efterladt af worktree-fjernelser der ikke
// naaede `git worktree remove` fuldt ud. Uden en tilbagevendende raport
// vokser bunken bare igen. Dette script kaldes fra
// scripts/close-out-cleanup.ps1's nye "Orphan worktree-mapper"-sektion.
//
// KUN RAPPORTERING - dette script SLETTER ALDRIG noget, hverken mapper eller
// git-state, og tager ingen -Execute/-Force-parameter. Sletning af de
// allerede identificerede 855 mapper er et separat, ejer-gated skridt
// (#4924's punkt 2) - IKKE del af denne rutines opgave. At udvide til
// sletning her ville ogsaa risikere at ramme en mappe der matcher en AKTIV
// boelges branch, hvis den (midlertidigt) ikke er registreret som worktree -
// rent read-only er scriptet uskadeligt uanset den slags racing.
//
// "Orphan" = en direkte undermappe af --worktree-root der IKKE er path'en
// for en registreret worktree (sammenlignet paa mappenavn/basename, robust
// mod forward/backslash-forskelle mellem git's porcelain-output og Windows'
// egne stier). Skjulte mapper (starter med '.', fx `.wave-scratch`,
// bølgernes egen scratch-rod) er ALDRIG orphans - de er legitim
// infrastruktur, ikke gamle checkouts.
//
// Usage:
//   node scripts/report-orphan-worktree-dirs.mjs --worktree-root "C:\Dev\CyclingZone-worktrees"
//
// Refs #5391, #4924.

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const DEFAULT_WORKTREE_ROOT = 'C:\\Dev\\CyclingZone-worktrees';

// ---------------------------------------------------------------------------
// Rene funktioner (ingen fs/exec-kald)
// ---------------------------------------------------------------------------

/**
 * Normaliserer en sti til sammenligning: forward slashes, ingen afsluttende
 * slash, lowercased (Windows-stier er case-insensitive).
 * @param {string} p
 */
export function normalizePath(p) {
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Parser `git worktree list --porcelain`-output til en Set af basenames for
 * alle registrerede worktrees hvis PARENT-mappe matcher `worktreeRoot`
 * (dvs. selve hoved-checkoutet under C:\Dev\CyclingZone og andre rødder
 * udelades naturligt - de matcher ikke parent-stien).
 * @param {string} porcelainOutput
 * @param {string} worktreeRoot
 * @returns {Set<string>}
 */
export function getRegisteredWorktreeNames(porcelainOutput, worktreeRoot) {
  const rootNorm = normalizePath(worktreeRoot);
  const names = new Set();
  for (const line of porcelainOutput.split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    const wtPath = normalizePath(line.slice('worktree '.length).trim());
    const lastSlash = wtPath.lastIndexOf('/');
    if (lastSlash === -1) continue;
    const parent = wtPath.slice(0, lastSlash);
    const base = wtPath.slice(lastSlash + 1);
    if (parent === rootNorm && base) names.add(base);
  }
  return names;
}

/**
 * @param {string[]} childDirNames direkte undermapper (kun navne, ikke fulde stier)
 * @param {Set<string>} registeredNames fra getRegisteredWorktreeNames
 * @returns {string[]} sorteret liste af orphan-mappenavne
 */
export function findOrphanDirs(childDirNames, registeredNames) {
  const orphans = [];
  for (const name of childDirNames) {
    if (name.startsWith('.')) continue; // scratch-infrastruktur, fx .wave-scratch
    if (registeredNames.has(name.toLowerCase())) continue;
    orphans.push(name);
  }
  // Ren ASCII-sortering (IKKE localeCompare) - default-locale afhænger af
  // maskinen (fx da-DK), og Danmarks kollations-regler kan give overraskende
  // rækkefølge for bindestreg-navne (fanget under verifikation: 'aaa-older'
  // > 'zzz-old' under da-DK). Mappenavne er ASCII, så en simpel < / >-sortering
  // er deterministisk uanset kørende maskines locale.
  return orphans.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * @param {string[]} orphanNames
 * @param {string} worktreeRoot
 */
export function formatOrphanReport(orphanNames, worktreeRoot) {
  const lines = [];
  if (orphanNames.length === 0) {
    lines.push(`  (ingen forældreløse mapper fundet under ${worktreeRoot})`);
    return lines.join('\n');
  }
  lines.push(`  ${orphanNames.length} forældreløs(e) mappe(r) under ${worktreeRoot} (staar IKKE i 'git worktree list', RØRES IKKE af dette script):`);
  for (const name of orphanNames) {
    lines.push(`    - ${name}`);
  }
  lines.push('  Se docs/audits/2026-09-18-orphan-worktrees-uge38.md for #4924s fulde audit + ejer-gated sletteflow.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// exec/fs-kald (injicerbare for test-skyld)
// ---------------------------------------------------------------------------

export function defaultExecGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

/**
 * @param {string} root
 * @returns {string[]} navne paa direkte undermapper, eller [] hvis roden ikke findes (ENOENT/ENOTDIR)
 * @throws videresender andre fejl (fx EACCES/EPERM permission-fejl, I/O-fejl) -
 *   en fejlende scan maa ALDRIG stille rapporteres som "ingen orphans fundet"
 *   (CodeRabbit-review, #5391): det ville skjule at rapporten reelt ikke naaede
 *   at koere, ikke at der ikke er noget at melde.
 */
export function defaultListChildDirs(root) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return [];
    throw err;
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = { worktreeRoot: DEFAULT_WORKTREE_ROOT, cwd: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--worktree-root') { args.worktreeRoot = argv[i + 1]; i += 1; }
    else if (arg === '--cwd') { args.cwd = argv[i + 1]; i += 1; }
  }
  return args;
}

export function main(argv, deps = {}) {
  const execGit = deps.execGit || defaultExecGit;
  const listChildDirs = deps.listChildDirs || defaultListChildDirs;
  const log = deps.log || console.log;

  const { worktreeRoot, cwd } = parseArgs(argv);

  let porcelain;
  try {
    porcelain = execGit(['worktree', 'list', '--porcelain'], cwd);
  } catch (err) {
    log(`  [warn] 'git worktree list --porcelain' fejlede: ${err.message} - springer orphan-mappe-rapport over`);
    return 1;
  }

  const registered = getRegisteredWorktreeNames(porcelain, worktreeRoot);

  let childDirs;
  try {
    childDirs = listChildDirs(worktreeRoot);
  } catch (err) {
    // Aldrig lad en reel fejl (permission/I-O) stille blive til "0 orphans
    // fundet" - det ville skjule at scanningen fejlede, ikke at roden er ren.
    log(`  [warn] kunne ikke liste ${worktreeRoot}: ${err.message} - orphan-mappe-scanningen naaede IKKE at koere`);
    return 1;
  }
  const orphans = findOrphanDirs(childDirs, registered);

  log(formatOrphanReport(orphans, worktreeRoot));
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
