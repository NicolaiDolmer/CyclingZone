// scripts/strip-backup-tables-from-types.test.mjs
// ============================================================
// Forward-guard for #4333.
//
// Three things are pinned here:
//
//   1. The classifier (scripts/lib/operational-backup-relations.mjs) keeps
//      matching the naming conventions actually observed in prod, and keeps
//      its hands off the four LIVE tables whose names contain "snapshot".
//      A naive %backup%/%snapshot% match would have eaten all four.
//   2. The committed frontend/src/types/database.types.ts contains zero
//      operational backup relations. This is the test that fails if a
//      `supabase gen types typescript` is committed without the strip step
//      that `npm run types:gen` now chains on.
//   3. check-database-types-drift.mjs filters backups out of BOTH sides, so
//      the snapshot keeping them (deliberate, see the doc block in
//      scripts/lib/operational-backup-relations.mjs) does not resurface as
//      drift noise.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isOperationalBackupRelation,
  partitionOperationalBackups,
} from './lib/operational-backup-relations.mjs';
import { stripBackupRelations, findBackupRelations } from './strip-backup-tables-from-types.mjs';
import { extractTypeSectionKeys } from './check-database-types-drift.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const typesPath = join(root, 'frontend', 'src', 'types', 'database.types.ts');
const snapshotPath = join(root, 'database', 'schema-snapshot.json');

// Real names, copied from prod's information_schema on 31/8/2026.
const REAL_BACKUP_NAMES = [
  'backup_2407_20260715_pending_removal',
  'backup_2456_derived_20260715',
  'backup_2590_season_budget_20260719',
  'backup_4227_seasons_2026_08_25',
  'backup_4236_race_entries',
  'backup_fairplay_20260722_riders',
  'cutover_3645_backup_20260823',
  'rider_caps_3746_backup_20260816',
  'rider_derived_abilities_3570_backup_20260811',
  'riders_3570_backup_20260811',
  'riders_type_backfill_snapshot_20260805',
];

// LIVE application tables. If any of these ever classify as a backup, the
// generated types lose a table the app actually reads.
const LIVE_TABLES_THAT_LOOK_LIKE_BACKUPS = [
  'board_plan_snapshots',
  'global_rank_season_start_snapshot',
  'global_rank_weekly_snapshot',
  'growth_metric_snapshots',
];

test('classifier: known prod backup relations are recognised', () => {
  for (const name of REAL_BACKUP_NAMES) {
    assert.equal(isOperationalBackupRelation(name), true, `${name} burde vaere en backup-relation`);
  }
});

test('classifier: live snapshot-named tables are NOT backups', () => {
  for (const name of LIVE_TABLES_THAT_LOOK_LIKE_BACKUPS) {
    assert.equal(isOperationalBackupRelation(name), false, `${name} er en levende tabel, ikke en backup`);
  }
});

test('classifier: ordinary tables and junk input are not backups', () => {
  for (const name of ['riders', 'teams', 'race_entries', 'rider_peak_plans', 'seasons']) {
    assert.equal(isOperationalBackupRelation(name), false);
  }
  assert.equal(isOperationalBackupRelation(''), false);
  assert.equal(isOperationalBackupRelation(undefined), false);
  assert.equal(isOperationalBackupRelation(null), false);
});

test('partitionOperationalBackups splits and sorts both halves', () => {
  const { backups, rest } = partitionOperationalBackups([
    'teams', 'backup_4236_race_entries', 'riders', 'riders_3570_backup_20260811', 'board_plan_snapshots',
  ]);
  assert.deepEqual(backups, ['backup_4236_race_entries', 'riders_3570_backup_20260811']);
  assert.deepEqual(rest, ['board_plan_snapshots', 'riders', 'teams']);
});

test('stripBackupRelations removes whole relation blocks and leaves the rest intact', () => {
  const source = [
    'export type Database = {',
    '  public: {',
    '    Tables: {',
    '      backup_4236_race_entries: {',
    '        Row: {',
    '          id: string',
    '        }',
    '        Relationships: []',
    '      }',
    '      riders: {',
    '        Row: {',
    '          firstname: string',
    '        }',
    '        Relationships: []',
    '      }',
    '    }',
    '    Views: {',
    '      riders_type_backfill_snapshot_20260805: {',
    '        Row: {',
    '          id: string',
    '        }',
    '      }',
    '      global_rank_weekly_snapshot: {',
    '        Row: {',
    '          id: string',
    '        }',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n');

  const result = stripBackupRelations(source);
  assert.deepEqual(result.removed, ['backup_4236_race_entries', 'riders_type_backfill_snapshot_20260805']);
  assert.deepEqual(result.sectionsSeen, ['Tables', 'Views']);
  assert.match(result.source, /riders: \{/);
  assert.match(result.source, /global_rank_weekly_snapshot: \{/);
  assert.doesNotMatch(result.source, /backup_4236_race_entries/);
  assert.doesNotMatch(result.source, /riders_type_backfill_snapshot_20260805/);
  // firstname survived: the block boundary was found, not the file end.
  assert.match(result.source, /firstname: string/);
  assert.deepEqual(findBackupRelations(result.source), []);
});

test('stripBackupRelations is a no-op on a source without backups', () => {
  const source = [
    '    Tables: {',
    '      riders: {',
    '        Row: {',
    '          id: string',
    '        }',
    '      }',
    '    }',
  ].join('\n');
  const result = stripBackupRelations(source);
  assert.deepEqual(result.removed, []);
  assert.equal(result.source, source);
});

test('committed database.types.ts contains no backup relations (#4333)', () => {
  const source = readFileSync(typesPath, 'utf8');
  const found = findBackupRelations(source);
  assert.deepEqual(
    found, [],
    'database.types.ts indeholder backup-relationer. Koer: node scripts/strip-backup-tables-from-types.mjs',
  );
});

// The snapshot KEEPS its backup relations on purpose: backend one-off repair
// scripts select from them, and the schema-column guard must stay able to
// verify those columns (filtering the snapshot measured a drop from 1587 to
// 1581 verified selects). The invariant to pin is the asymmetry (types side
// clean, snapshot side not), because that is what makes the drift guard's
// both-sides filter necessary rather than cosmetic.
//
// This is deliberately NOT an assertion that the two mirrors line up exactly:
// check-database-types-drift.mjs is advisory (WARN, exit 0) precisely because
// a refresh needs prod/Supabase access that CI does not have, and a migration
// legitimately drifts them apart until someone refreshes.
test('the two mirrors have the asymmetry #4333 established', () => {
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const { backups: snapshotBackups } = partitionOperationalBackups(Object.keys(snapshot.relations ?? {}));
  assert.ok(
    snapshotBackups.length > 0,
    'schema-snapshot.json har ingen backup-relationer laengere. Er de droppet i prod? Saa kan '
    + 'drift-guardens filter og denne test forenkles.',
  );

  const typesSource = readFileSync(typesPath, 'utf8');
  const typeKeys = [
    ...extractTypeSectionKeys(typesSource, 'Tables'),
    ...extractTypeSectionKeys(typesSource, 'Views'),
  ];
  const { backups: typeBackups } = partitionOperationalBackups(typeKeys);
  assert.deepEqual(typeBackups, [], 'database.types.ts indeholder stadig backup-relationer.');
});
