#!/usr/bin/env node
// db-selftest.mjs — local, deterministic proof that the backup + verify-restore
// tooling works end to end, without touching prod.
//
//   node scripts/db-selftest.mjs
//
// Spins up a throwaway "source" Postgres, seeds a tiny schema (incl. a column-level
// GRANT to exercise ACL capture and an FK to exercise integrity checks), runs
// db-backup against it, then db-verify-restore, and asserts both succeed. Requires
// the PostgreSQL client/server binaries locally (scoop install postgresql). Not run
// in CI — it is a dev-machine smoke test for the ops scripts themselves.

import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePgBin, run, psqlExec, localPgEnv } from './db-lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_PORT = 55101;

const initdb = resolvePgBin('initdb');
const pgCtl = resolvePgBin('pg_ctl');

const srcDir = mkdtempSync(path.join(os.tmpdir(), 'cz-selftest-src-'));
const backupDir = mkdtempSync(path.join(os.tmpdir(), 'cz-selftest-backups-'));
let started = false;
let exitCode = 0;

function teardown() {
  if (started) { run(pgCtl, ['-D', srcDir, '-m', 'immediate', '-w', 'stop'], { allowFail: true }); started = false; }
  for (const d of [srcDir, backupDir]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
}

function node(script, env) {
  return spawnSync(process.execPath, [path.join('scripts', script)], {
    cwd: repoRoot, encoding: 'utf8', env: { ...process.env, ...env }, stdio: 'pipe',
  });
}

try {
  // 1. source instance + seed
  console.log('▶ initdb + start source instance …');
  run(initdb, ['-D', srcDir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C', '--no-instructions']);
  run(pgCtl, ['-D', srcDir, '-l', path.join(srcDir, 'log'), '-o', `-p ${SRC_PORT} -c listen_addresses=127.0.0.1`, '-w', 'start'], { stdio: 'ignore' });
  started = true;

  const admin = localPgEnv({ port: SRC_PORT, db: 'postgres' });
  const src = localPgEnv({ port: SRC_PORT, db: 'src' });
  psqlExec('CREATE DATABASE src', admin);
  psqlExec(`
    CREATE TABLE teams (id int PRIMARY KEY, name text NOT NULL);
    CREATE TABLE riders (id int PRIMARY KEY, team_id int REFERENCES teams(id), name text NOT NULL, abilities jsonb);
    INSERT INTO teams VALUES (1,'Alpha'),(2,'Bravo'),(3,'Charlie');
    INSERT INTO riders
      SELECT g, ((g-1) % 3)+1, 'Rider '||g, jsonb_build_object('climb', (g*7)%100)
      FROM generate_series(1,17) g;
    CREATE ROLE anon NOLOGIN;
    GRANT SELECT (name) ON riders TO anon;
  `, src);
  console.log('  seeded: 3 teams, 17 riders, 1 column-level GRANT (riders.name → anon)');

  const dsn = `postgresql://postgres@127.0.0.1:${SRC_PORT}/src?sslmode=disable`;

  // 2. backup
  console.log('\n▶ db-backup …');
  const b = node('db-backup.mjs', { SUPABASE_DB_URL: dsn, BACKUP_DIR: backupDir, BACKUP_SCHEMAS: 'public' });
  process.stdout.write(b.stdout || '');
  if (b.status !== 0) { console.error(b.stderr || ''); throw new Error(`db-backup exited ${b.status}`); }

  // 3. verify-restore
  console.log('▶ db-verify-restore …');
  const v = node('db-verify-restore.mjs', { BACKUP_DIR: backupDir, BACKUP_COUNT_TOLERANCE: '0' });
  process.stdout.write(v.stdout || '');
  if (v.status !== 0) { console.error(v.stderr || ''); throw new Error(`db-verify-restore exited ${v.status}`); }

  console.log('\n✓ SELFTEST PASSED — backup + verify-restore work end to end against a live Postgres.');
} catch (e) {
  console.error(`\n✗ SELFTEST FAILED: ${e.message}`);
  exitCode = 1;
} finally {
  teardown();
}
process.exit(exitCode);
