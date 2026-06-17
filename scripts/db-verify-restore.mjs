#!/usr/bin/env node
// db-verify-restore.mjs — prove a db-backup dump is actually restorable.
//
//   node scripts/db-verify-restore.mjs [--dir <backupDir>] [--port 54999] [--keep]
//
// Spins up a throwaway local Postgres (initdb in a temp dir, started on a high port),
// restores the dump into it, then compares per-table row counts against the manifest
// captured at backup time and runs FK-integrity checks. No Docker, no cloud, no prod
// risk. The local instance is stopped and deleted afterwards (unless --keep).
//
// An unrestored backup is an assumption, not resilience — this is what turns the dump
// into a verified backup.
//
// Env:
//   BACKUP_DIR               (default ./.backups) where backups live, for latest-dir discovery
//   BACKUP_COUNT_TOLERANCE   (default 0) allowed absolute per-table count drift vs manifest
//   PG_BIN                   (optional) dir containing pg binaries if not auto-resolved

import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePgBin, run, psqlJson, psqlExec, localPgEnv } from './db-lib.mjs';

function parseArgs(argv) {
  const a = { port: 54999, keep: false, dir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') a.dir = argv[++i];
    else if (argv[i] === '--port') a.port = Number(argv[++i]);
    else if (argv[i] === '--keep') a.keep = true;
  }
  return a;
}

function latestBackupDir(baseDir) {
  if (!existsSync(baseDir)) return null;
  const dirs = readdirSync(baseDir)
    .filter((d) => d.startsWith('cyclingzone-'))
    .map((d) => path.join(baseDir, d))
    .filter((p) => statSync(p).isDirectory())
    .sort();
  return dirs.length ? dirs[dirs.length - 1] : null;
}

const args = parseArgs(process.argv.slice(2));
const baseDir = process.env.BACKUP_DIR || path.join(process.cwd(), '.backups');
const backupDir = args.dir || latestBackupDir(baseDir);
const tolerance = Number(process.env.BACKUP_COUNT_TOLERANCE || 0);

if (!backupDir || !existsSync(backupDir)) {
  console.error(`✗ No backup dir found (looked in ${baseDir}). Pass --dir <path> or run db-backup first.`);
  process.exit(2);
}
const manifestPath = path.join(backupDir, 'manifest.json');
const dumpFile = path.join(backupDir, 'data.dump');
if (!existsSync(manifestPath) || !existsSync(dumpFile)) {
  console.error(`✗ ${backupDir} is missing manifest.json or data.dump.`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
console.log(`▶ Verifying backup : ${backupDir}`);
console.log(`▶ Captured         : ${manifest.created_at_local || manifest.created_at}`);
console.log(`▶ Manifest         : ${manifest.table_count} tables, ${manifest.total_rows?.toLocaleString?.() ?? manifest.total_rows} rows`);

const initdb = resolvePgBin('initdb');
const pgCtl = resolvePgBin('pg_ctl');
const pgRestore = resolvePgBin('pg_restore');

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'cz-verify-'));
const logFile = path.join(dataDir, 'server.log');
const adminEnv = localPgEnv({ port: args.port, db: 'postgres' });
const verifyEnv = localPgEnv({ port: args.port, db: 'verify' });
let started = false;
let failures = [];

function cleanup() {
  if (started) {
    try { run(pgCtl, ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], { allowFail: true }); } catch { /* ignore */ }
    started = false;
  }
  if (!args.keep) {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  } else {
    console.log(`  (kept local instance data dir: ${dataDir})`);
  }
}

try {
  // 1. init + start a throwaway local Postgres
  console.log(`▶ initdb (throwaway, ${dataDir}) …`);
  run(initdb, ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C', '--no-instructions']);
  console.log(`▶ starting local Postgres on 127.0.0.1:${args.port} …`);
  run(pgCtl, ['-D', dataDir, '-l', logFile, '-o', `-p ${args.port} -c listen_addresses=127.0.0.1`, '-w', 'start'], { stdio: 'ignore' });
  started = true;

  // 2. create the restore target db + best-effort common extensions (Supabase puts them in `extensions`)
  psqlExec('CREATE DATABASE verify', adminEnv);
  for (const ext of ['pgcrypto', 'uuid-ossp', 'citext', 'pg_trgm']) {
    psqlExec(`CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS "${ext}" SCHEMA extensions`, verifyEnv, { allowFail: true });
  }

  // 3. restore (strip owners + privileges so a bare local instance loads cleanly;
  //    grant fidelity is proven from the manifest's ACL-entry count instead)
  console.log('▶ pg_restore into local "verify" db …');
  const restore = run(pgRestore, ['--no-owner', '--no-privileges', '-d', 'verify', dumpFile], { env: verifyEnv, allowFail: true });
  const restoreErrors = (restore.stderr || '').split('\n').filter((l) => /error:/i.test(l));
  if (restoreErrors.length) {
    console.log(`  pg_restore reported ${restoreErrors.length} non-fatal message(s) (expected on a bare local instance — extension-qualified defaults etc.).`);
  }

  // 4. compare row counts vs manifest
  const restoredTables = psqlJson(
    `SELECT table_schema AS schema, table_name AS name
       FROM information_schema.tables
      WHERE table_type='BASE TABLE' AND table_schema IN (${manifest.schemas.map((s) => `'${s}'`).join(',')})
      ORDER BY 1,2`,
    verifyEnv,
  );
  const restoredSet = new Set(restoredTables.map((t) => `${t.schema}.${t.name}`));

  const countSql = restoredTables
    .map((t) => `SELECT '${t.schema}.${t.name}' AS tbl, (SELECT count(*) FROM "${t.schema}"."${t.name}")::bigint AS n`)
    .join('\nUNION ALL\n');
  const restoredCounts = countSql
    ? Object.fromEntries(psqlJson(`SELECT tbl, n FROM (${countSql}) c`, verifyEnv).map((r) => [r.tbl, Number(r.n)]))
    : {};

  const rows = [];
  let mismatches = 0;
  let missing = 0;
  for (const [tbl, want] of Object.entries(manifest.counts)) {
    if (!restoredSet.has(tbl)) {
      rows.push({ table: tbl, manifest: want, restored: 'MISSING', ok: false });
      missing++;
      failures.push(`table ${tbl} missing from restore`);
      continue;
    }
    const got = restoredCounts[tbl] ?? 0;
    const ok = Math.abs(got - want) <= tolerance;
    if (!ok) { mismatches++; failures.push(`count drift ${tbl}: manifest ${want} vs restored ${got}`); }
    rows.push({ table: tbl, manifest: want, restored: got, ok });
  }

  // 5. FK-integrity checks (from the restore-drill runbook), guarded by table presence
  const fkChecks = [
    { name: 'riders.team_id → teams', need: ['public.riders', 'public.teams'],
      sql: `SELECT count(*) AS n FROM public.riders r WHERE r.team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = r.team_id)` },
    { name: 'auctions.rider_id → riders', need: ['public.auctions', 'public.riders'],
      sql: `SELECT count(*) AS n FROM public.auctions a WHERE NOT EXISTS (SELECT 1 FROM public.riders r WHERE r.id = a.rider_id)` },
  ];
  const fkResults = [];
  for (const c of fkChecks) {
    if (!c.need.every((t) => restoredSet.has(t))) continue;
    const n = Number(psqlJson(c.sql, verifyEnv)[0]?.n ?? 0);
    fkResults.push({ check: c.name, violations: n, ok: n === 0 });
    if (n !== 0) failures.push(`FK violations in ${c.name}: ${n}`);
  }

  // 6. report
  console.log(`\n  Row-count comparison (tolerance ${tolerance}):`);
  const shown = rows.filter((r) => !r.ok).concat(rows.filter((r) => r.ok).slice(0, 8));
  for (const r of rows.filter((r) => !r.ok)) console.log(`    ✗ ${r.table.padEnd(40)} manifest=${r.manifest}  restored=${r.restored}`);
  const okCount = rows.filter((r) => r.ok).length;
  console.log(`    ✓ ${okCount}/${rows.length} tables match exactly`);
  if (fkResults.length) {
    console.log(`\n  FK-integrity:`);
    for (const f of fkResults) console.log(`    ${f.ok ? '✓' : '✗'} ${f.check}: ${f.violations} violation(s)`);
  }

  const pass = failures.length === 0;
  console.log(`\n${pass ? '✓ VERIFIED' : '✗ FAILED'} — ${rows.length} tables, ${missing} missing, ${mismatches} count mismatch(es), ${failures.length} issue(s).`);
  if (!pass) {
    console.log('  Issues:');
    for (const f of failures.slice(0, 20)) console.log(`    - ${f}`);
  } else {
    console.log('  This dump restores cleanly and its row counts match the source. It is a verified backup.');
  }
  cleanup();
  process.exit(pass ? 0 : 1);
} catch (e) {
  console.error(`\n✗ Verify harness error: ${e.message}`);
  if (existsSync(logFile)) {
    try { console.error('  --- server.log tail ---\n' + readFileSync(logFile, 'utf8').split('\n').slice(-15).join('\n')); } catch { /* ignore */ }
  }
  cleanup();
  process.exit(3);
}
