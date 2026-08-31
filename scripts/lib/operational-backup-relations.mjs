// scripts/lib/operational-backup-relations.mjs
// ============================================================
// Single source of truth for "is this public-schema relation an operational
// backup, or a real application table?" (#4333).
//
// Why this exists: past incident cleanups (#2407, #2456, #2590, #3570, #3645,
// #4155, #4203, #4215, #4218, #4236, #4294 ...) each left a snapshot table
// behind in `public`. Measured against prod 31/8/2026: information_schema
// .tables lists 207 relations in public, and pg_matviews adds 4 materialized
// views it does not cover, so 211 in total, of which 66 are operational
// backups and 145 are real. They are dead weight in every generated mirror
// (frontend/src/types/database.types.ts, database/schema-snapshot.json) and
// they drown the drift signal in the guards that diff those mirrors.
//
// This module does NOT drop anything in the database. Dropping backup tables
// is a destructive class and is owner-gated under #2259 / hard rule 9. All we
// do here is keep them out of the generated artifacts.
//
// Where it is applied, and where it deliberately is NOT:
//
//   APPLIED  frontend/src/types/database.types.ts, via
//            scripts/strip-backup-tables-from-types.mjs, chained onto
//            `npm run types:gen`. Nothing in the app selects from a backup
//            table through the typed client, so their 2.730 lines are pure
//            noise in the generated file.
//   APPLIED  scripts/check-database-types-drift.mjs, on BOTH sides of the
//            comparison. Before this, the guard's entire reported drift was
//            backup relations; after, the two mirrors match exactly.
//   NOT      database/schema-snapshot.json. Measured: filtering the snapshot
//            drops schema-column-guard coverage from 1587 to 1581 verified
//            selects, because backend one-off repair scripts really do select
//            from riders_type_backfill_snapshot_20260805 and friends
//            (backend/scripts/measureCapsShift3372.js,
//            measurePeakTalent3372.js). The snapshot is a correctness guard,
//            not a table listing, and it must keep knowing those columns. The
//            drift guard filters at compare time instead, which gets the same
//            clean signal without the coverage loss.
//
// Naming conventions actually observed in prod (31/8/2026), and why the
// patterns are this narrow:
//
//   1. `backup_<issue|slug>_<...>`      59 tables, e.g. backup_4236_race_entries
//   2. `<table>_<issue>_backup_<YYYYMMDD>`  6 tables, e.g. riders_3570_backup_20260811
//   3. `<table>_..._snapshot_<YYYYMMDD>`    1 table,  riders_type_backfill_snapshot_20260805
//
// The trailing-datestamp requirement in patterns 2 and 3 is load-bearing.
// These four are LIVE application tables and must never be filtered out:
//
//   board_plan_snapshots
//   global_rank_season_start_snapshot
//   global_rank_weekly_snapshot
//   growth_metric_snapshots
//
// A naive `%snapshot%` match would have eaten all four. The tests in
// scripts/strip-backup-tables-from-types.test.mjs pin exactly that.

/**
 * Patterns that identify an operational backup/snapshot relation left behind
 * by an incident cleanup. Each entry is documented above; keep the list and
 * the doc block in sync when a new convention shows up in prod.
 */
export const OPERATIONAL_BACKUP_PATTERNS = Object.freeze([
  // 1. backup_* prefix, the dominant convention.
  /^backup_/,
  // 2. <table>_<issue>_backup_<YYYYMMDD>
  /_backup_\d{8}$/,
  // 2b. Same, with the underscore-separated date variant (backup_4227_seasons_
  //     2026_08_25 uses that date style, though it is already caught by
  //     pattern 1). Defensive: no relation matches this and only this in prod
  //     as of 31/8/2026.
  /_backup_\d{4}_\d{2}_\d{2}$/,
  // 3. <table>_..._snapshot_<YYYYMMDD>, datestamp required, see doc block.
  /_snapshot_\d{8}$/,
]);

/**
 * True when `name` is an operational backup relation rather than a real
 * application table.
 *
 * @param {string} name relation name as it appears in the public schema
 * @returns {boolean}
 */
export function isOperationalBackupRelation(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  return OPERATIONAL_BACKUP_PATTERNS.some((re) => re.test(name));
}

/**
 * Split a list of relation names into operational backups and the rest.
 * Both halves come back sorted, so callers can print stable output.
 *
 * @param {Iterable<string>} names
 * @returns {{ backups: string[], rest: string[] }}
 */
export function partitionOperationalBackups(names) {
  const backups = [];
  const rest = [];
  for (const name of names) {
    if (isOperationalBackupRelation(name)) backups.push(name);
    else rest.push(name);
  }
  backups.sort();
  rest.sort();
  return { backups, rest };
}
