#!/usr/bin/env node
// db-backup.mjs — take a verifiable logical backup of a Supabase/Postgres database.
//
//   infisical run --env=prod -- node scripts/db-backup.mjs
//
// Produces, under BACKUP_DIR/cyclingzone-<timestamp>/:
//   data.dump      custom-format pg_dump (-Fc) of the target schema(s), grants kept
//   manifest.json  host/db, schemas, pg_dump version, sha256, exact per-table row
//                  counts captured immediately before the dump, and the dump TOC
//                  ACL-entry count (proof column-level GRANTs were captured)
//
// The dump keeps privileges (CyclingZone relies on column-level GRANTs) and drops
// owner (--no-owner) so it restores into a target without the exact prod roles.
// Default scope is the `public` schema — exactly the data the relaunch reset hard-
// DELETEs (seasons/races/finance/standings/loans/...). auth & storage are Supabase-
// managed and covered by PITR/physical backups, not this logical dump.
//
// Env:
//   SUPABASE_DB_URL  (required) Session-pooler connection URI, via Infisical
//   BACKUP_DIR       (default ./.backups) where to write — point at OneDrive for off-site
//   BACKUP_SCHEMAS   (default public) comma-separated schema list
//   PG_BIN           (optional) dir containing pg_dump/psql if not auto-resolved

import { mkdirSync, writeFileSync, statSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { resolvePgBin, run, requireEnv, pgEnvFromDsn, describeTarget, psqlJson } from './db-lib.mjs';

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

const dsn = requireEnv('SUPABASE_DB_URL');
const pgEnv = pgEnvFromDsn(dsn);
const schemas = (process.env.BACKUP_SCHEMAS || 'public').split(',').map((s) => s.trim()).filter(Boolean);
const baseDir = process.env.BACKUP_DIR || path.join(process.cwd(), '.backups');
const outDir = path.join(baseDir, `cyclingzone-${stamp()}`);
mkdirSync(outDir, { recursive: true });

console.log(`▶ Backup target : ${describeTarget(pgEnv)}`);
console.log(`▶ Schemas       : ${schemas.join(', ')}`);
console.log(`▶ Out dir       : ${outDir}`);

// 1. Enumerate base tables in the target schemas and capture EXACT row counts in one query.
const schemaList = schemas.map((s) => `'${s.replace(/'/g, "''")}'`).join(',');
const tables = psqlJson(
  `SELECT table_schema AS schema, table_name AS name
     FROM information_schema.tables
    WHERE table_type='BASE TABLE' AND table_schema IN (${schemaList})
    ORDER BY 1,2`,
  pgEnv,
);
if (tables.length === 0) {
  console.error(`✗ No base tables found in schema(s) ${schemas.join(', ')} — aborting (nothing to back up).`);
  process.exit(1);
}

const countSql = tables
  .map((t) => `SELECT '${t.schema}.${t.name}' AS tbl, (SELECT count(*) FROM "${t.schema}"."${t.name}")::bigint AS n`)
  .join('\nUNION ALL\n');
const counts = psqlJson(`SELECT tbl, n FROM (${countSql}) c ORDER BY tbl`, pgEnv);
const countMap = Object.fromEntries(counts.map((r) => [r.tbl, Number(r.n)]));
const totalRows = counts.reduce((a, r) => a + Number(r.n), 0);
console.log(`▶ Captured counts for ${counts.length} tables (${totalRows.toLocaleString()} rows total).`);

// 2. pg_dump custom format — keep grants, drop owner.
const pgDump = resolvePgBin('pg_dump');
const dumpFile = path.join(outDir, 'data.dump');
const dumpArgs = ['-Fc', '--no-owner', '--quote-all-identifiers'];
for (const s of schemas) dumpArgs.push('--schema', s);
dumpArgs.push('-f', dumpFile);
console.log(`▶ Running pg_dump …`);
run(pgDump, dumpArgs, { env: pgEnv });
const dumpBytes = statSync(dumpFile).size;
const digest = await sha256(dumpFile);

// 3. Inspect the dump TOC: count ACL (GRANT) entries — proves column-level grants are captured.
const pgRestore = resolvePgBin('pg_restore');
const toc = run(pgRestore, ['-l', dumpFile]).stdout || '';
const aclEntries = toc.split('\n').filter((l) => / ACL /.test(l)).length;
const tocEntries = toc.split('\n').filter((l) => /^\d+;/.test(l.trim())).length;

// 4. pg_dump version, for restore-compatibility records.
const pgDumpVersion = (run(pgDump, ['--version']).stdout || '').trim();

// 5. Manifest.
const manifest = {
  tool: 'db-backup.mjs',
  created_at: new Date().toISOString(),
  created_at_local: new Date().toString(),
  target: { host: pgEnv.PGHOST, port: pgEnv.PGPORT, database: pgEnv.PGDATABASE, user: pgEnv.PGUSER },
  schemas,
  pg_dump_version: pgDumpVersion,
  dump_file: 'data.dump',
  dump_bytes: dumpBytes,
  dump_sha256: digest,
  toc_entries: tocEntries,
  acl_entries: aclEntries,
  table_count: counts.length,
  total_rows: totalRows,
  counts: countMap,
};
writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`\n✓ Backup complete`);
console.log(`  dump      : ${dumpFile}`);
console.log(`  size      : ${(dumpBytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`  sha256    : ${digest}`);
console.log(`  TOC/ACL   : ${tocEntries} entries, ${aclEntries} GRANT(ACL) entries`);
console.log(`  manifest  : ${path.join(outDir, 'manifest.json')}`);
console.log(`\n  Verify it is actually restorable:`);
console.log(`    node scripts/db-verify-restore.mjs --dir "${outDir}"`);
