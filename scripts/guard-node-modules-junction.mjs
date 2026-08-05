#!/usr/bin/env node
// guard-node-modules-junction.mjs
//
// Naegter at koere en destruktiv npm-operation naar `node_modules` er en junction
// (Windows) eller et symlink. `npm ci` SLETTER node_modules foer den geninstallerer,
// og sletningen foeres igennem junctionen ind i det delte maal.
//
// Hvorfor et wrapper-script og ikke en `preinstall`-lifecycle-hook: `npm ci` sletter
// node_modules FOER `preinstall` koerer (verificeret paa npm 11.13.0, 2026-08-05 —
// sentinel-filen var allerede vaek da preinstall fyrede). En preinstall-guard ville
// derfor foerst raabe op efter skaden var sket. Guarden skal ligge FOER npm startes.
//
// Brug:
//   node scripts/guard-node-modules-junction.mjs            # tjekker ., backend, frontend
//   node scripts/guard-node-modules-junction.mjs frontend   # kun frontend
//
// Exit 0 = ingen junctions, sikkert at installere. Exit 1 = blokeret (med opskrift).
//
// Refs #3367 (#2967 er samme faelde, reaktivt loest).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PACKAGE_DIRS = ['.', 'backend', 'frontend'];

/**
 * Finder de package-mapper hvis node_modules er en junction/symlink.
 *
 * @param {string} root repo-rod
 * @param {string[]} packageDirs relative package-mapper
 * @param {(p: string) => {isSymbolicLink: () => boolean}} lstat injicerbar for test
 * @returns {{dir: string, nodeModules: string, target: string|null}[]}
 */
export function findJunctionedNodeModules(root, packageDirs = DEFAULT_PACKAGE_DIRS, lstat = fs.lstatSync, readlink = fs.readlinkSync) {
  const hits = [];
  for (const dir of packageDirs) {
    const nodeModules = path.join(root, dir, 'node_modules');
    let stat;
    try {
      stat = lstat(nodeModules);
    } catch {
      continue; // findes ikke — intet at beskytte
    }
    if (!stat.isSymbolicLink()) continue;
    let target = null;
    try {
      target = readlink(nodeModules);
    } catch {
      /* junction uden laesbart maal — stadig en junction */
    }
    hits.push({ dir, nodeModules, target });
  }
  return hits;
}

export function formatBlockMessage(hits) {
  const lines = [
    '',
    '  BLOKERET: node_modules er en junction til et delt install.',
    '',
    '  npm ci sletter node_modules foer den geninstallerer, og sletningen foeres',
    '  igennem junctionen ind i maalet. Det oedelaegger installet for alle andre',
    '  worktrees der deler det (og har tidligere tomt hoved-checkoutet midt i en boelge).',
    '',
  ];
  for (const hit of hits) {
    lines.push(`  - ${hit.dir === '.' ? '<repo-rod>' : hit.dir}/node_modules -> ${hit.target ?? '(junction)'}`);
  }
  lines.push(
    '',
    '  Saadan goer du i stedet:',
    '',
    '  1) Skal du bare koere tests/build/lint? Goer intet — det delte install virker.',
    '     Junctionen er sikker at LAESE fra.',
    '',
    '  2) Har du aendret package.json/package-lock.json og har reelt brug for et',
    '     eget install? Bryd junctionen og installer isoleret i ET sammenhaengende kald:',
    '',
    ...hits.map((hit) => {
      const rel = hit.dir === '.' ? '' : `${hit.dir}\\`;
      return `       cmd /c rmdir /Q ${rel}node_modules && npm ci${hit.dir === '.' ? '' : ` --prefix ${hit.dir}`}`;
    }),
    '',
    '     (rmdir fjerner selve junction-punktet, ikke maalet. Brug ALDRIG',
    '      Remove-Item -Recurse — den foelger junctionen og sletter maalet.)',
    '',
    '  3) Vil du bare have worktreet i en kendt god tilstand?',
    '',
    '       pwsh -File scripts/setup-worktree.ps1 -Rebuild',
    '',
    '  Refs #3367 · docs/WORKTREE_WORKFLOW.md',
    '',
  );
  return lines.join('\n');
}

function main(argv) {
  const dirs = argv.length > 0 ? argv : DEFAULT_PACKAGE_DIRS;
  const hits = findJunctionedNodeModules(process.cwd(), dirs);
  if (hits.length === 0) return 0;
  console.error(formatBlockMessage(hits));
  return 1;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
