#!/usr/bin/env node
// scripts/check-schema-snapshot-staleness.mjs
// ============================================================
// Forward-guard for #4142: database/schema-snapshot.json is the committed
// mirror of prod's public schema that both the CI schema-column-guard
// (scripts/lint-schema-columns.mjs, #3586) and agents (CLAUDE.md: "slaa
// kolonnenavne op FOER ad-hoc SQL") rely on. Nothing detected when it went
// stale.
//
// Evidence (23/8, PR #4141): the snapshot was from 14/8. In the 9 days that
// followed, 34 migrations landed in database/ without a refresh. Drift at
// regeneration time: 167 -> 186 relations, plus column drift on 6 existing
// tables. The schema-column-guard silently skips relations/columns it does
// not know about, so a stale snapshot makes the guard cover less than it
// claims, and can make an agent conclude a column does not exist when it
// does (the #3769 class).
//
// This script is a WARN, not a FAIL: refreshing the snapshot requires prod
// DB access via infisical (scripts/lint-schema-columns.mjs --update-snapshot),
// which preflight cannot do and must not block on. It only flags that a
// human/agent with prod access should run the refresh soon.
//
// Method: compare every database/*.sql migration's authored date against the
// snapshot's generatedAt timestamp. "Authored date" prefers the YYYY-MM-DD
// filename prefix our migrations use (stable across clones/checkouts, unlike
// mtime which git resets on checkout); files without that prefix (schema.sql,
// supabase_setup.sql — full-schema dumps, not dated migrations) fall back to
// mtime.
//
// Usage:
//   node scripts/check-schema-snapshot-staleness.mjs
//
// Exit code is always 0 (advisory) — see #4142 "WARN, ikke FAIL".

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const databaseDir = join(root, 'database');
const snapshotPath = join(databaseDir, 'schema-snapshot.json');

const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})-/;
const REFRESH_CMD = 'infisical run --env=prod -- node scripts/lint-schema-columns.mjs --update-snapshot';

function main() {
  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  } catch (err) {
    console.warn(`WARN schema-snapshot-staleness: kunne ikke laese ${snapshotPath} (${err.message}) — springer tjek over.`);
    return;
  }

  const generatedAt = snapshot.generatedAt ? new Date(snapshot.generatedAt) : null;
  if (!generatedAt || Number.isNaN(generatedAt.getTime())) {
    console.warn('WARN schema-snapshot-staleness: schema-snapshot.json mangler et gyldigt "generatedAt" felt — springer tjek over.');
    return;
  }

  let entries;
  try {
    entries = readdirSync(databaseDir, { withFileTypes: true });
  } catch (err) {
    console.warn(`WARN schema-snapshot-staleness: kunne ikke laese ${databaseDir} (${err.message}) — springer tjek over.`);
    return;
  }

  const newerFiles = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;
    if (entry.name === 'schema.sql' || entry.name === 'supabase_setup.sql') continue; // full-schema dumps, not dated migrations

    const fullPath = join(databaseDir, entry.name);
    const prefixMatch = entry.name.match(DATE_PREFIX_RE);

    let authoredAt;
    let source;
    if (prefixMatch) {
      authoredAt = new Date(`${prefixMatch[1]}T00:00:00Z`);
      source = 'filnavn-dato';
    } else {
      try {
        authoredAt = statSync(fullPath).mtime;
      } catch {
        continue;
      }
      source = 'mtime';
    }

    if (Number.isNaN(authoredAt.getTime())) continue;

    if (authoredAt > generatedAt) {
      newerFiles.push({ name: entry.name, authoredAt, source });
    }
  }

  if (newerFiles.length === 0) {
    console.log(`schema-snapshot-staleness: OK — ingen migrationer nyere end snapshottets generatedAt (${snapshot.generatedAt}).`);
    return;
  }

  newerFiles.sort((a, b) => a.authoredAt - b.authoredAt);

  console.warn('');
  console.warn(`WARN schema-snapshot-staleness (#4142): ${newerFiles.length} migration(er) i database/ er nyere end schema-snapshot.json.`);
  console.warn(`  Snapshot generatedAt: ${snapshot.generatedAt}`);
  console.warn('  Nyere migrationer:');
  for (const f of newerFiles) {
    console.warn(`    - ${f.name} (${f.source}: ${f.authoredAt.toISOString()})`);
  }
  console.warn('  Snapshottet kan vaere forael, saa schema-column-guard (#3586) dækker mindre end det siger,');
  console.warn('  og agenter kan fejlagtigt konkludere at en kolonne ikke findes (#3769-klassen).');
  console.warn(`  Refresh (kraever prod-adgang, koeres af ejer/orkestrator post-merge): ${REFRESH_CMD}`);
  console.warn('');
}

main();
