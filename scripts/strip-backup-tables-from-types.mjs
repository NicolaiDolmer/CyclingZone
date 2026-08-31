#!/usr/bin/env node
// scripts/strip-backup-tables-from-types.mjs
// ============================================================
// Post-processor for `npm run types:gen` (#4333).
//
// `supabase gen types typescript` emits every relation in `public`, including
// the 66 operational backup tables left behind by past incident cleanups
// (measured against prod 31/8/2026). They are noise in
// frontend/src/types/database.types.ts: nothing in the app selects from them,
// they add 2.730 lines, and they bury the real diff whenever the types are
// regenerated.
//
// The tables themselves are NOT touched. Dropping them is a destructive
// class, owner-gated under #2259. This script only removes their blocks from
// the generated file, using the classifier in
// scripts/lib/operational-backup-relations.mjs.
//
// Method: an indentation-based scan of the Supabase CLI's stable output
// layout (2 spaces per level). Inside `Database.public.Tables` / `.Views`,
// each relation is a `      <key>: {` line at 6-space indent, closed by a
// `      }` line at the same indent. We drop the whole span for a backup key.
// This is not a TS/AST parse. It is the same assumption the sibling guard
// scripts/check-database-types-drift.mjs already makes, and the script fails
// loudly (exit 1) if the layout no longer matches.
//
// Usage:
//   node scripts/strip-backup-tables-from-types.mjs [path]   # rewrite in place
//   node scripts/strip-backup-tables-from-types.mjs --check  # exit 1 if any remain
//
// Wired into frontend/package.json's `types:gen`, so a regeneration can never
// silently reintroduce them. The forward-guard test
// scripts/strip-backup-tables-from-types.test.mjs fails if the committed file
// ever contains a backup relation again.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isOperationalBackupRelation } from './lib/operational-backup-relations.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TYPES_PATH = join(__dirname, '..', 'frontend', 'src', 'types', 'database.types.ts');

const SECTION_NAMES = ['Tables', 'Views'];

/**
 * Remove every operational-backup relation block from the `Tables` and `Views`
 * sections of a Supabase-generated database.types.ts source.
 *
 * @param {string} source full file contents
 * @returns {{ source: string, removed: string[], sectionsSeen: string[] }}
 */
export function stripBackupRelations(source) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);

  const keep = new Array(lines.length).fill(true);
  const removed = [];
  const sectionsSeen = [];

  for (const sectionName of SECTION_NAMES) {
    const start = lines.findIndex((l) => l === `    ${sectionName}: {`);
    if (start === -1) continue;
    sectionsSeen.push(sectionName);

    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      // A new 4-space section, or the close of `public: {`, ends this section.
      if (/^ {4}\w+: \{$/.test(line) || /^ {4}\}$/.test(line)) break;

      const m = line.match(/^ {6}(\w+): \{$/);
      if (!m) continue;
      const relation = m[1];
      if (!isOperationalBackupRelation(relation)) continue;

      // Find the matching `      }` at the same indent level.
      let end = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^ {6}\}$/.test(lines[j])) { end = j; break; }
        // Bail out rather than eat the rest of the file on an unexpected layout.
        if (/^ {4}\w+: \{$/.test(lines[j]) || /^ {4}\}$/.test(lines[j])) break;
      }
      if (end === -1) {
        throw new Error(
          `strip-backup-tables-from-types: fandt ikke afslutningen paa blokken "${relation}" `
          + `i ${sectionName} (linje ${i + 1}). Generator-layoutet er aendret. Opdater scriptet.`,
        );
      }

      for (let j = i; j <= end; j++) keep[j] = false;
      removed.push(relation);
      i = end;
    }
  }

  return {
    source: lines.filter((_, idx) => keep[idx]).join(eol),
    removed: removed.sort(),
    sectionsSeen,
  };
}

/**
 * List the operational-backup relations still present in a generated types
 * source. Used by --check and by the forward-guard test.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function findBackupRelations(source) {
  const lines = source.split(/\r?\n/);
  const found = [];
  for (const sectionName of SECTION_NAMES) {
    const start = lines.findIndex((l) => l === `    ${sectionName}: {`);
    if (start === -1) continue;
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^ {4}\w+: \{$/.test(line) || /^ {4}\}$/.test(line)) break;
      const m = line.match(/^ {6}(\w+): \{$/);
      if (m && isOperationalBackupRelation(m[1])) found.push(m[1]);
    }
  }
  return found.sort();
}

function main(argv) {
  const checkOnly = argv.includes('--check');
  const pathArg = argv.find((a) => !a.startsWith('--'));
  const typesPath = pathArg ? pathArg : DEFAULT_TYPES_PATH;

  let source;
  try {
    source = readFileSync(typesPath, 'utf8');
  } catch (err) {
    console.error(`strip-backup-tables-from-types: kunne ikke laese ${typesPath} (${err.message}).`);
    process.exit(1);
  }

  if (checkOnly) {
    const remaining = findBackupRelations(source);
    if (remaining.length === 0) {
      console.log(`strip-backup-tables-from-types: OK, ingen backup-relationer i ${typesPath}.`);
      return;
    }
    console.error(
      `strip-backup-tables-from-types (#4333): ${remaining.length} backup-relation(er) i ${typesPath}:`,
    );
    for (const name of remaining) console.error(`  - ${name}`);
    console.error('  Koer: node scripts/strip-backup-tables-from-types.mjs');
    process.exit(1);
  }

  const result = stripBackupRelations(source);
  if (result.sectionsSeen.length === 0) {
    console.error(
      `strip-backup-tables-from-types: fandt hverken "Tables"- eller "Views"-blokken i ${typesPath}. `
      + 'Generator-layoutet er aendret. Opdater scriptet.',
    );
    process.exit(1);
  }

  if (result.removed.length === 0) {
    console.log(`strip-backup-tables-from-types: ingen backup-relationer at fjerne i ${typesPath}.`);
    return;
  }

  writeFileSync(typesPath, result.source, 'utf8');
  console.log(
    `strip-backup-tables-from-types (#4333): fjernede ${result.removed.length} backup-relation(er) `
    + `fra ${typesPath}.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
