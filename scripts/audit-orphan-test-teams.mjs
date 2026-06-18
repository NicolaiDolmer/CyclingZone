#!/usr/bin/env node
// audit-orphan-test-teams.mjs — READ-ONLY deletion-impact audit for the orphan
// test-teams that survived the season-1 relaunch (18/6 follow-up; #1471/#1472 spor).
//
//   infisical run --env=prod -- node scripts/audit-orphan-test-teams.mjs
//
// Why: 7 timestamp-named test-teams (WF01* / Step4p6* / WF Exec*) outlived the
// relaunch. beta-reset never deletes team ROWS (it only resets manager rosters,
// and these are is_ai/is_test_account/is_frozen — excluded from the manager query),
// so they linger holding 0 riders. teams is far more broadly FK-referenced than
// riders (finance/standings/races/auctions/loans/academy/notifications/...), many
// with ON DELETE NO ACTION/RESTRICT that BLOCK a delete unless cleared first.
//
// This script does NOT delete anything. It:
//   1. Resolves candidate teams by the documented discriminator.
//   2. Cross-checks against the 4 ids named in the follow-up + flags drift.
//   3. Per team: orphan-gate (owned_riders=0 AND ai_riders=0) + flags + linked user.
//   4. Lists EVERY FK pointing at teams, its ON DELETE action, and how many rows of
//      the 7 teams each references — classified CASCADE / SET NULL / BLOCK.
//   5. Prints a GO/NO-GO verdict + the exact blocking refs to clear before deletion.
//
// Credentials come from SUPABASE_DB_URL via Infisical (PG* env, never printed) —
// same channel as db-backup.mjs. psqlJson only runs SELECTs.

import { requireEnv, pgEnvFromDsn, describeTarget, psqlJson } from './db-lib.mjs';

const log = (...a) => console.error(...a); // progress → stderr; report → stdout

const dsn = requireEnv('SUPABASE_DB_URL');
const pgEnv = pgEnvFromDsn(dsn);
log(`▶ Audit target : ${describeTarget(pgEnv)}`);
log(`▶ Mode         : READ-ONLY (no writes)\n`);

// The 4 ids explicitly named in the 18/6 follow-up (3 of the 7 were id-less there).
const NAMED_IDS = new Set([
  '8681f257-3532-4bd6-9326-b75066807b5b', // WF01 AI Seller
  '8d386ab0-773c-4010-b0a8-a1042daebbd3', // WF01 Old AI
  '8817fec7-0244-42b6-ac5c-c03e9db8096f', // WF01 Soon AI
  'eb9b232f-3cba-435c-8c86-c3430722f632', // Step4p6 Exec02 Team
]);

const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ── 1. Resolve candidate teams by the documented discriminator ─────────────────
const candidates = psqlJson(`
  SELECT id::text AS id, name, is_ai, is_bank, is_test_account, is_frozen,
         user_id::text AS user_id, division, balance, created_at
    FROM teams
   WHERE name ~ '[0-9]{10,}$' OR name ILIKE 'WF01%' OR name ILIKE 'Step4%'
   ORDER BY name
`, pgEnv);

if (candidates.length === 0) {
  console.log('No teams match the discriminator. Nothing to audit — already clean?');
  process.exit(0);
}

const ids = candidates.map((c) => c.id);
const idArray = `ARRAY[${ids.map(sqlStr).join(',')}]::uuid[]`;

console.log('═'.repeat(78));
console.log(`ORPHAN TEST-TEAM AUDIT — ${candidates.length} candidate team(s) matched`);
console.log('═'.repeat(78));
console.log(`\nDiscriminator: name ~ '[0-9]{10,}$' OR name ILIKE 'WF01%' OR name ILIKE 'Step4%'\n`);

// ── 2. Per-team rider gate (owned / ai / pending) ──────────────────────────────
const riderCounts = psqlJson(`
  SELECT t.id::text AS id,
    (SELECT count(*) FROM riders r WHERE r.team_id = t.id)::int         AS owned_riders,
    (SELECT count(*) FROM riders r WHERE r.ai_team_id = t.id)::int      AS ai_riders,
    (SELECT count(*) FROM riders r WHERE r.pending_team_id = t.id)::int AS pending_riders
  FROM teams t WHERE t.id = ANY(${idArray})
`, pgEnv);
const ridersById = Object.fromEntries(riderCounts.map((r) => [r.id, r]));

// ── 3. Linked users for has_user teams ─────────────────────────────────────────
const userIds = [...new Set(candidates.map((c) => c.user_id).filter(Boolean))];
let usersById = {};
let otherTeamsByUser = {};
if (userIds.length > 0) {
  const uArr = `ARRAY[${userIds.map(sqlStr).join(',')}]::uuid[]`;
  const users = psqlJson(`
    SELECT id::text AS id, email, username, role, last_seen, created_at
      FROM users WHERE id = ANY(${uArr})
  `, pgEnv);
  usersById = Object.fromEntries(users.map((u) => [u.id, u]));
  // Does any linked user own OTHER teams that are NOT in our orphan set?
  const other = psqlJson(`
    SELECT user_id::text AS user_id, id::text AS id, name,
           is_ai, is_test_account, is_frozen
      FROM teams
     WHERE user_id = ANY(${uArr}) AND NOT (id = ANY(${idArray}))
     ORDER BY user_id, name
  `, pgEnv);
  for (const t of other) (otherTeamsByUser[t.user_id] ||= []).push(t);
}

// ── Per-team report ────────────────────────────────────────────────────────────
let nonOrphan = 0;
let realUserAbort = 0;
for (const t of candidates) {
  const rc = ridersById[t.id] || { owned_riders: 0, ai_riders: 0, pending_riders: 0 };
  const flags = [
    t.is_ai && 'is_ai',
    t.is_test_account && 'is_test_account',
    t.is_frozen && 'is_frozen',
    t.is_bank && 'is_bank',
  ].filter(Boolean).join(', ') || '(none)';
  const isOrphan = rc.owned_riders === 0 && rc.ai_riders === 0;
  const named = NAMED_IDS.has(t.id) ? '★ named-in-followup' : '… not-in-named-4';
  if (!isOrphan) nonOrphan++;

  console.log(`\n● ${t.name}`);
  console.log(`    id           : ${t.id}  (${named})`);
  console.log(`    flags        : ${flags}`);
  console.log(`    division     : ${t.division ?? '—'}   balance: ${t.balance ?? '—'}`);
  console.log(`    created_at   : ${t.created_at}`);
  console.log(`    riders       : owned=${rc.owned_riders}  ai_parked=${rc.ai_riders}  pending=${rc.pending_riders}  → ${isOrphan ? 'ORPHAN ✓' : 'NOT ORPHAN ✗ (do not delete)'}`);

  if (t.user_id) {
    const u = usersById[t.user_id];
    const others = otherTeamsByUser[t.user_id] || [];
    if (u) {
      // A linked user is a red flag only if it looks like a REAL player: i.e. it also
      // owns a non-test, non-frozen, non-ai team. Otherwise it's a synthetic fixture.
      const realOther = others.find((o) => !o.is_ai && !o.is_test_account && !o.is_frozen);
      console.log(`    user_id      : ${t.user_id}`);
      console.log(`      email      : ${u.email}`);
      console.log(`      username   : ${u.username}   role: ${u.role}   last_seen: ${u.last_seen ?? 'never'}`);
      console.log(`      other teams: ${others.length === 0 ? '(none)' : others.map((o) => `${o.name}${o.is_test_account ? '[test]' : ''}${o.is_frozen ? '[frozen]' : ''}${o.is_ai ? '[ai]' : ''}`).join(', ')}`);
      if (realOther) {
        realUserAbort++;
        console.log(`      ⚠ ABORT-FLAG: linked user also owns a REAL team "${realOther.name}" — this is not a pure test fixture.`);
      }
    } else {
      console.log(`    user_id      : ${t.user_id}  (⚠ no matching users row — orphaned auth user?)`);
    }
  }
}

// ── 4. FK audit: every constraint pointing at teams + ref counts ───────────────
const fks = psqlJson(`
  SELECT con.conname::text AS constraint_name,
         child.relname::text AS child_table,
         child_att.attname::text AS child_column,
         CASE con.confdeltype
           WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
           WHEN 'c' THEN 'CASCADE'   WHEN 'n' THEN 'SET NULL'
           WHEN 'd' THEN 'SET DEFAULT' ELSE con.confdeltype::text END AS delete_action
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
    JOIN pg_attribute child_att ON child_att.attrelid = con.conrelid AND child_att.attnum = ck.attnum
   WHERE con.contype = 'f' AND child_ns.nspname = 'public'
     AND con.confrelid = 'public.teams'::regclass
   ORDER BY child.relname, child_att.attname
`, pgEnv);

// Count rows of the 7 teams referenced by each FK column.
const refSql = fks.map((fk, i) =>
  `SELECT ${i} AS idx, (SELECT count(*) FROM "${fk.child_table}" WHERE "${fk.child_column}" = ANY(${idArray}))::bigint AS n`
).join('\nUNION ALL\n');
const refRows = fks.length ? psqlJson(`SELECT idx, n FROM (${refSql}) q`, pgEnv) : [];
const refByIdx = Object.fromEntries(refRows.map((r) => [Number(r.idx), Number(r.n)]));

const BLOCKS = new Set(['NO ACTION', 'RESTRICT']);
const blockers = [];   // NO ACTION/RESTRICT with refs > 0 → must clear before delete
const cascades = [];   // CASCADE with refs > 0 → child rows deleted with the team
const setnulls = [];   // SET NULL with refs > 0 → column nulled

console.log(`\n${'═'.repeat(78)}`);
console.log(`FK AUDIT — ${fks.length} constraint(s) reference teams; refs = rows belonging to the ${ids.length} teams`);
console.log('═'.repeat(78));
console.log(`\n  ${'child_table.child_column'.padEnd(46)} ${'ON DELETE'.padEnd(11)} refs`);
console.log(`  ${'-'.repeat(46)} ${'-'.repeat(11)} ----`);
for (let i = 0; i < fks.length; i++) {
  const fk = fks[i];
  const n = refByIdx[i] ?? 0;
  const col = `${fk.child_table}.${fk.child_column}`;
  const mark = n > 0 ? (BLOCKS.has(fk.delete_action) ? ' ⛔' : (fk.delete_action === 'CASCADE' ? ' ⇊' : ' ∅')) : '';
  console.log(`  ${col.padEnd(46)} ${fk.delete_action.padEnd(11)} ${String(n).padStart(4)}${mark}`);
  if (n > 0) {
    if (BLOCKS.has(fk.delete_action)) blockers.push({ ...fk, n });
    else if (fk.delete_action === 'CASCADE') cascades.push({ ...fk, n });
    else setnulls.push({ ...fk, n });
  }
}

// ── 5. Verdict ─────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(78)}`);
console.log('VERDICT');
console.log('═'.repeat(78));
console.log(`\n  candidate teams        : ${candidates.length}  (expected 7 in follow-up)`);
console.log(`  non-orphan (have riders): ${nonOrphan}  ${nonOrphan ? '✗ exclude these' : '✓'}`);
console.log(`  linked-real-user aborts : ${realUserAbort}  ${realUserAbort ? '✗ ABORT — real player' : '✓'}`);
console.log(`  FK blockers (must clear): ${blockers.length}`);
if (blockers.length) {
  console.log(`\n  ⛔ These NO ACTION/RESTRICT refs would block a teams delete — null/delete child first:`);
  for (const b of blockers) console.log(`     ${b.child_table}.${b.child_column} (${b.delete_action})  ${b.n} row(s)`);
}
if (cascades.length) {
  console.log(`\n  ⇊ CASCADE — these child rows are deleted automatically with the team:`);
  for (const c of cascades) console.log(`     ${c.child_table}.${c.child_column}  ${c.n} row(s)`);
}
if (setnulls.length) {
  console.log(`\n  ∅ SET NULL — these columns are nulled automatically:`);
  for (const s of setnulls) console.log(`     ${s.child_table}.${s.child_column}  ${s.n} row(s)`);
}

const safe = nonOrphan === 0 && realUserAbort === 0;
console.log(`\n  ${safe ? '✓ All candidates are riderless, no real-user link.' : '✗ Do NOT bulk-delete — review exclusions above.'}`);
console.log(`  ${blockers.length ? `Deletion needs ${blockers.length} blocking ref(s) cleared first (see above).` : 'No blocking FK refs — CASCADE/SET NULL handle the rest.'}`);
console.log(`\n  (Read-only audit. No rows changed. Deletion is a separate, owner-confirmed step.)\n`);
