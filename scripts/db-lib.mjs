// Shared helpers for the DB backup + verify-restore ops scripts.
//
// These scripts shell out to the PostgreSQL client binaries (pg_dump, pg_restore,
// psql, initdb, pg_ctl). They never take a connection string on argv — credentials
// are passed to child processes via PG* env vars so the password never lands in a
// process listing and is never printed. See scripts/db-README.md.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Where scoop installs the PostgreSQL client on Windows. Override with PG_BIN.
const SCOOP_PG_BIN = path.join(os.homedir(), 'scoop', 'apps', 'postgresql', 'current', 'bin');

/** Resolve an absolute path to a pg client binary, or fall back to the bare name (PATH). */
export function resolvePgBin(tool) {
  const exe = process.platform === 'win32' ? `${tool}.exe` : tool;
  if (process.env.PG_BIN) {
    const p = path.join(process.env.PG_BIN, exe);
    if (existsSync(p)) return p;
  }
  const scoop = path.join(SCOOP_PG_BIN, exe);
  if (existsSync(scoop)) return scoop;
  return tool; // assume on PATH
}

/**
 * Run a command synchronously. Throws on failure unless allowFail.
 *
 * Pass stdio:'ignore' when starting a long-lived daemon (e.g. `pg_ctl start`):
 * otherwise the daemon inherits the captured stdout pipe and spawnSync blocks
 * forever waiting for that pipe to close (i.e. for the daemon to exit). The
 * server's own output still goes to its -l logfile, so nothing is lost.
 */
export function run(file, args, { input, env, allowFail = false, cwd, stdio } = {}) {
  const res = spawnSync(file, args, {
    input,
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 512,
    ...(stdio ? { stdio } : {}),
  });
  if (res.error) {
    if (allowFail) return res;
    throw new Error(`Failed to spawn ${file}: ${res.error.message}`);
  }
  if (!allowFail && res.status !== 0) {
    const tail = (res.stderr || '').split('\n').filter(Boolean).slice(-15).join('\n');
    throw new Error(`${path.basename(file)} exited ${res.status}\n${tail}`);
  }
  return res;
}

/** Read a required env var or exit with an actionable message (never prints the value). */
export function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`\n✗ Missing required env var ${name}.`);
    console.error(`  These scripts read it via Infisical, e.g.:`);
    console.error(`    infisical run --env=prod -- node scripts/db-backup.mjs`);
    console.error(`  If it is not in Infisical yet, add the Session-pooler connection`);
    console.error(`  string from Supabase Dashboard → Connect, as key ${name}.`);
    process.exit(2);
  }
  return v;
}

/**
 * Translate a Postgres connection URI into PG* env vars for child processes.
 * Keeps the password out of argv entirely. Defaults sslmode=require (Supabase).
 */
export function pgEnvFromDsn(dsn) {
  let u;
  try {
    u = new URL(dsn);
  } catch (e) {
    throw new Error(`SUPABASE_DB_URL is not a valid connection URI: ${e.message}`);
  }
  const env = {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
    PGUSER: decodeURIComponent(u.username || 'postgres'),
    PGPASSWORD: decodeURIComponent(u.password || ''),
    PGSSLMODE: u.searchParams.get('sslmode') || 'require',
    // pooler-friendly: avoid lingering prepared statements
    PGCONNECT_TIMEOUT: '15',
  };
  return env;
}

/** A redacted host:port/db descriptor safe to log. */
export function describeTarget(pgEnv) {
  return `${pgEnv.PGHOST}:${pgEnv.PGPORT}/${pgEnv.PGDATABASE} (user ${pgEnv.PGUSER}, password redacted)`;
}

/** Run a SQL statement via psql against PG* env, returning parsed JSON rows. */
export function psqlJson(sql, pgEnv) {
  const psql = resolvePgBin('psql');
  const wrapped = `SELECT coalesce(json_agg(t), '[]'::json) FROM (${sql}) t;`;
  const res = run(psql, ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', wrapped], { env: pgEnv });
  const out = (res.stdout || '').trim();
  return JSON.parse(out || '[]');
}

/** Run a SQL statement via psql against PG* env, no result parsing. */
export function psqlExec(sql, pgEnv, { allowFail = false } = {}) {
  const psql = resolvePgBin('psql');
  return run(psql, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], { env: pgEnv, allowFail });
}

/** Build a PG* env for a plain local TCP Postgres (used by the verify harness). */
export function localPgEnv({ port, db = 'postgres', user = 'postgres' }) {
  return {
    PGHOST: '127.0.0.1',
    PGPORT: String(port),
    PGDATABASE: db,
    PGUSER: user,
    PGPASSWORD: '',
    PGSSLMODE: 'disable',
  };
}
