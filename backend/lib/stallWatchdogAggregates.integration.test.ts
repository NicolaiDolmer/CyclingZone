import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { PGlite } from '@electric-sql/pglite';
import type { WatchdogResultSummary } from './stallWatchdogAggregates.ts';

// Existing JS schema harness; load the committed base DDL, then the RAW proposal
// so role/grant tests exercise ACLs that the schema sanitizer intentionally strips.
const { createTestDb } = await import(new URL('./testdb/createTestDb.js', import.meta.url).href);
const { evaluateStallFindings } = await import(new URL('./stallWatchdog.js', import.meta.url).href);
const { splitStatements } = await import(new URL('../../scripts/lint-migration-idempotency.mjs', import.meta.url).href);
const id = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`;
const now = new Date('2026-10-04T12:00:00Z');
const at = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
const raceIds = Array.from({ length: 6 }, (_, i) => id(i + 1));
const fixtures = [
  { race_id: id(1), stage_number: 1, result_type: 'gc', imported_at: at(3), prize_money: 0 },
  { race_id: id(1), stage_number: 1, result_type: 'stage', imported_at: at(2), prize_money: null },
  { race_id: id(1), stage_number: null, result_type: 'points', imported_at: null, prize_money: -5 },
  { race_id: id(2), stage_number: 0, result_type: 'gc', imported_at: at(4), prize_money: 5 },
  { race_id: id(2), stage_number: -1, result_type: 'points', imported_at: at(3), prize_money: -5 },
  { race_id: id(3), stage_number: 1, result_type: 'gc', imported_at: null, prize_money: 0 },
  // id(4) has no rows; id(5) is a no-prize youth race, id(6) a senior no-prize race.
  { race_id: id(5), stage_number: 2, result_type: 'young', imported_at: at(5), prize_money: 0 },
  { race_id: id(6), stage_number: 1, result_type: 'stage', imported_at: at(3), prize_money: -5 },
];
let db: PGlite;
const proposal = await readFile(new URL('../../database/2026-10-07-6102-watchdog-result-summary.sql', import.meta.url), 'utf8');

before(async () => {
  db = await createTestDb({ files: ['schema.sql'] });
  for (const raceId of raceIds) await db.query('INSERT INTO races(id,name,created_at) VALUES($1,$2,$3)', [raceId, 'watchdog fixture', now.toISOString()]);
  for (const [i, row] of fixtures.entries()) await db.query(
    'INSERT INTO race_results(id,race_id,stage_number,result_type,imported_at,prize_money) VALUES($1,$2,$3,$4,$5,$6)',
    [id(100 + i), row.race_id, row.stage_number, row.result_type, row.imported_at, row.prize_money]);
  await db.exec(proposal);
  await db.exec(proposal);
  await db.exec('GRANT SELECT ON race_results TO service_role');
});
after(async () => { await db?.close(); });

async function summaries(ids = raceIds): Promise<WatchdogResultSummary[]> {
  const result = await db.query<WatchdogResultSummary>('SELECT * FROM stall_watchdog_result_summary($1::uuid[])', [ids]);
  return result.rows.map(row => ({ ...row, last_imported_at: row.last_imported_at === null ? null : new Date(row.last_imported_at).toISOString() }));
}

function legacyMetadata() {
  return raceIds.map(race_id => {
    const rows = fixtures.filter(row => row.race_id === race_id);
    let last_imported_at: string | null = null;
    for (const row of rows) if (!last_imported_at || (row.imported_at !== null && new Date(row.imported_at) > new Date(last_imported_at))) last_imported_at = row.imported_at;
    return { race_id, last_imported_at, has_prize: rows.some(row => (row.prize_money ?? 0) > 0),
      stage_numbers: [...new Set(rows.map(row => row.stage_number))].sort((a, b) => a === null ? 1 : b === null ? -1 : a - b) };
  });
}

test('raw proposal applied twice preserves full legacy metadata and every finding', async () => {
  const actual = await summaries();
  const legacy = legacyMetadata();
  assert.deepEqual(actual, legacy);
  const findingsFor = (rows: WatchdogResultSummary[]) => evaluateStallFindings({
    now, autoPrizeEnabled: true,
    finalizeCandidates: raceIds.map(raceId => ({ id: raceId, name: 'fixture' })),
    prizeCandidates: rows.filter(row => row.last_imported_at === null || row.has_prize).map(row => ({ id: row.race_id, name: 'fixture' })),
    lastResultByRace: Object.fromEntries(rows.map(row => [row.race_id, row.last_imported_at])),
    dueStages: rows.flatMap(row => [1, 2, 3, null].map(stage_number => ({ race_id: row.race_id, race_name: 'fixture',
      stage_number, scheduled_at: at(6), has_entries: row.race_id !== id(6), has_results: row.stage_numbers.includes(stage_number) }))),
    standings: { maxStandingsUpdated: at(4), maxResultsImported: null }, matviewHeartbeat: at(3),
  });
  assert.deepEqual(findingsFor(actual), findingsFor(legacy));
});

test('function is service_role-only and SECURITY INVOKER after both applications', async () => {
  const privileges = await db.query<{ role: string; allowed: boolean }>(
    "SELECT role,has_function_privilege(role,'stall_watchdog_result_summary(uuid[])','EXECUTE') AS allowed FROM unnest(ARRAY['anon','authenticated','service_role']) AS roles(role)");
  assert.deepEqual(privileges.rows, [{ role: 'anon', allowed: false }, { role: 'authenticated', allowed: false }, { role: 'service_role', allowed: true }]);
  assert.equal((await db.query<{ definer: boolean }>("SELECT prosecdef AS definer FROM pg_proc WHERE proname='stall_watchdog_result_summary'")).rows[0].definer, false);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    try { await assert.rejects(summaries(), /permission denied/); } finally { await db.exec('RESET ROLE'); }
  }
  await db.exec('SET ROLE service_role');
  try { assert.equal((await summaries()).length, 6); } finally { await db.exec('RESET ROLE'); }
});

test('SQL input is bounded, deduplicated and zero-result candidates still return one row', async () => {
  assert.equal((await summaries([id(4), id(4)])).length, 1);
  assert.deepEqual(await summaries([]), []);
  await assert.rejects(summaries(Array.from({ length: 301 }, () => id(1))), /at most 300/);
  await assert.rejects(db.query('SELECT * FROM stall_watchdog_result_summary(NULL)'), /non-null IDs/);
  await assert.rejects(db.query('SELECT * FROM stall_watchdog_result_summary(ARRAY[NULL]::uuid[])'), /non-null IDs/);
});

test('global latest-result NULL ordering remains untouched by the candidate refactor', async () => {
  const result = await db.query<{ imported_at: unknown }>('SELECT imported_at FROM race_results ORDER BY imported_at DESC LIMIT 1');
  assert.equal(result.rows[0].imported_at, null);
});

test('psql-style statement commits cannot leave a public function behind after a failed grant', async () => {
  await db.exec('DROP FUNCTION stall_watchdog_result_summary(uuid[])');
  const statements: { text: string }[] = splitStatements(proposal);
  try {
    await assert.rejects(async () => {
      for (const statement of statements) await db.exec(statement.text.replace(/\bTO service_role\b/, 'TO nonexistent_watchdog_role'));
    }, /nonexistent_watchdog_role/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query<{ fn: unknown }>("SELECT to_regprocedure('stall_watchdog_result_summary(uuid[])') AS fn")).rows[0].fn, null);
  } finally {
    await db.exec('ROLLBACK');
    await db.exec(proposal);
  }
});
