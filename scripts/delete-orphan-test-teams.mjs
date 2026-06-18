#!/usr/bin/env node
// delete-orphan-test-teams.mjs — DESTRUCTIVE, owner-confirmed cleanup of the 7 empty
// orphan test-teams that survived the season-1 relaunch (18/6 follow-up; #1471/#1472).
//
//   # dry-run (prints plan, writes nothing):
//   infisical run --env=prod -- node scripts/delete-orphan-test-teams.mjs
//   # apply (requires the exact confirm token):
//   infisical run --env=prod -- node scripts/delete-orphan-test-teams.mjs --confirm "DELETE ORPHAN TEST TEAMS"
//
// Safety: TAKE A BACKUP FIRST (npm run db:backup). This script re-verifies the orphan
// gate at apply-time and runs the whole change in ONE transaction so nothing can land
// half-applied. See scripts/audit-orphan-test-teams.mjs for the full read-only audit.
//
// What it does, atomically:
//   1. Re-resolve candidates by the documented discriminator.
//   2. HARD-ABORT unless every candidate is riderless (owned=0, ai_parked=0, pending=0)
//      and no candidate links a real (non-test/non-frozen/non-ai) player team.
//   3. BEGIN; null admin_log.target_team_id (NO ACTION FK — would block the delete);
//      DELETE the teams (CASCADE clears board_profiles/finance_transactions); COMMIT.
//   4. Re-verify 0 candidates remain.

import { requireEnv, pgEnvFromDsn, describeTarget, psqlJson, psqlExec } from './db-lib.mjs';

const args = new Set(process.argv.slice(2));
const confirmIdx = process.argv.indexOf('--confirm');
const confirmToken = confirmIdx >= 0 ? process.argv[confirmIdx + 1] : null;
const APPLY = confirmToken === 'DELETE ORPHAN TEST TEAMS';
const log = (...a) => console.error(...a);
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

const dsn = requireEnv('SUPABASE_DB_URL');
const pgEnv = pgEnvFromDsn(dsn);
log(`▶ Target : ${describeTarget(pgEnv)}`);
log(`▶ Mode   : ${APPLY ? 'APPLY (will delete)' : 'DRY-RUN (no writes — pass --confirm "DELETE ORPHAN TEST TEAMS" to apply)'}\n`);

// 1. Re-resolve candidates + orphan/real-user gates in one read.
const teams = psqlJson(`
  SELECT t.id::text AS id, t.name, t.is_ai, t.is_test_account, t.is_frozen, t.user_id::text AS user_id,
    (SELECT count(*) FROM riders r WHERE r.team_id = t.id)::int         AS owned,
    (SELECT count(*) FROM riders r WHERE r.ai_team_id = t.id)::int      AS ai_parked,
    (SELECT count(*) FROM riders r WHERE r.pending_team_id = t.id)::int AS pending,
    (SELECT count(*) FROM teams o
       WHERE o.user_id = t.user_id AND o.id <> t.id
         AND NOT o.is_ai AND NOT o.is_test_account AND NOT o.is_frozen)::int AS real_sibling_teams
  FROM teams t
  WHERE t.name ~ '[0-9]{10,}$' OR t.name ILIKE 'WF01%' OR t.name ILIKE 'Step4%'
  ORDER BY t.name
`, pgEnv);

if (teams.length === 0) {
  console.log('✓ No orphan test-teams match the discriminator. Already clean — nothing to do.');
  process.exit(0);
}

const problems = [];
for (const t of teams) {
  if (t.owned || t.ai_parked || t.pending) problems.push(`${t.name}: holds riders (owned=${t.owned}, ai=${t.ai_parked}, pending=${t.pending})`);
  if (t.real_sibling_teams > 0) problems.push(`${t.name}: linked user also owns ${t.real_sibling_teams} REAL team(s)`);
}

console.log(`Candidates (${teams.length}):`);
for (const t of teams) {
  const flags = [t.is_ai && 'ai', t.is_test_account && 'test', t.is_frozen && 'frozen'].filter(Boolean).join('/') || '—';
  console.log(`  • ${t.name.padEnd(42)} [${flags}]  riders=${t.owned + t.ai_parked + t.pending}  id=${t.id}`);
}

if (problems.length) {
  console.error(`\n✗ ABORT — ${problems.length} safety-gate violation(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('\nNo rows changed. Resolve the above (or re-run the audit) before deleting.');
  process.exit(1);
}
console.log(`\n✓ Gate passed: all ${teams.length} are riderless and link no real player.`);

const ids = teams.map((t) => t.id);
const idArray = `ARRAY[${ids.map(sqlStr).join(',')}]::uuid[]`;

if (!APPLY) {
  console.log('\nDRY-RUN — would run, in one transaction:');
  console.log(`  UPDATE admin_log SET target_team_id = NULL WHERE target_team_id = ANY(<7 ids>);`);
  console.log(`  DELETE FROM teams WHERE id = ANY(<7 ids>) AND <still riderless>;   -- CASCADE clears board_profiles/finance_transactions`);
  console.log('\nRe-run with --confirm "DELETE ORPHAN TEST TEAMS" to apply.');
  process.exit(0);
}

// 3. Atomic apply. ON_ERROR_STOP=1 (psqlExec) + BEGIN/COMMIT → all-or-nothing.
log('▶ Applying in a single transaction …');
const tx = `
BEGIN;
  UPDATE admin_log SET target_team_id = NULL WHERE target_team_id = ANY(${idArray});
  DELETE FROM teams t
   WHERE t.id = ANY(${idArray})
     AND NOT EXISTS (
       SELECT 1 FROM riders r
        WHERE r.team_id = t.id OR r.ai_team_id = t.id OR r.pending_team_id = t.id
     );
COMMIT;
`;
psqlExec(tx, pgEnv);

// 4. Re-verify.
const remaining = psqlJson(`
  SELECT count(*)::int AS n FROM teams
   WHERE name ~ '[0-9]{10,}$' OR name ILIKE 'WF01%' OR name ILIKE 'Step4%'
`, pgEnv);
const left = remaining[0]?.n ?? -1;
console.log(`\n✓ Done. Orphan test-teams remaining by discriminator: ${left}`);
if (left !== 0) {
  console.error('⚠ Expected 0 remaining — investigate (a candidate may have gained riders and been skipped by the guard).');
  process.exit(1);
}
console.log('✓ Field is clean.');
