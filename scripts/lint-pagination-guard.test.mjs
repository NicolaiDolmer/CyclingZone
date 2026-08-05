// scripts/lint-pagination-guard.test.mjs
// Tests for the PostgREST silent-1000-row-cap forward-guard. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, stripCommentsKeepStrings, DENY_TABLES, compareAgainstBaseline } from './lint-pagination-guard.mjs';

test('flags a naive unpaginated select against a deny-listed table (synthetic #3315 shape)', () => {
  const src = `const { data, error } = await supabase
    .from("race_results")
    .select("id, points, rider_id")
    .eq("race_id", race.id);`;
  const f = scan(src, 'sponsorRaceDayIncome.js');
  assert.equal(f.length, 1);
  assert.equal(f[0].table, 'race_results');
  assert.equal(f[0].line, 2);
});

test('flags a naive unpaginated select against riders (synthetic #770 shape)', () => {
  const src = `const { data } = await supabase.from("riders").select("id, firstname, lastname, team_id");`;
  const f = scan(src, 'pcmRiderMatcher.js');
  assert.equal(f.length, 1);
  assert.equal(f[0].table, 'riders');
});

test('does NOT flag a select bounded by .range()', () => {
  const src = `const { data } = await supabase
    .from("race_results")
    .select("id")
    .eq("race_id", id)
    .range(0, 999);`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag a select bounded by .limit()', () => {
  const src = `const { data } = await supabase.from("notifications").select("*").eq("team_id", teamId).limit(50);`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag .single()', () => {
  const src = `const { data } = await supabase.from("riders").select("*").eq("id", riderId).single();`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag .maybeSingle()', () => {
  const src = `const { data } = await supabase.from("race_entries").select("*").eq("id", entryId).maybeSingle();`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag a select delegated to fetchAllRows(...)', () => {
  const src = `const rows = await fetchAllRows(() =>
    supabase.from("riders").select("id, firstname, lastname, team_id").order("id", { ascending: true })
  );`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag a select delegated to a local fetchAllRowsOrThrow(...) wrapper', () => {
  const src = `const riders = await fetchAllRowsOrThrow(() => (
    supabaseClient
      .from("riders")
      .select("*")
      .order("id", { ascending: true })
  ), "load riders");`;
  assert.equal(scan(src, 'economyEngine.js').length, 0);
});

test('does NOT flag a select delegated to fetchAllRowsChunkedIn(...)', () => {
  const src = `const rows = await fetchAllRowsChunkedIn(ids, (chunk) =>
    supabase.from("race_entries").select("*").in("race_id", chunk).order("id", { ascending: true })
  );`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag a mutation (.update) with no .select() — not a read', () => {
  const src = `const { error } = await supabase.from("riders").update({ team_id: null }).not("id", "is", null);`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag a mutation (.insert) with no .select() — not a read', () => {
  const src = `const { error } = await supabase.from("race_entries").insert(rows);`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag a mutation (.delete) with no .select() — not a read', () => {
  const src = `const { error } = await supabase.from("race_results").delete().eq("race_id", id);`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag an .insert(...).select() echo — write is not row-capped, only its echo', () => {
  const src = `const { data, error } = await supabase.from("riders").insert(batch).select("id");`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag a deferred query bounded by a later `return query.limit(1)` (synthetic notificationService.js shape)', () => {
  const src = `function buildLookup({ supabase, userId }) {
  let query = supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  query = userId ? query.eq("x", 1) : query.is("x", null);

  return query.limit(1);
}`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag a deferred query bounded by `query = query.order(...).range(...)` (real api.js admin/finance-transactions shape)', () => {
  const src = `let query = supabase
    .from("finance_transactions")
    .select("id, team_id, type, amount");

  if (type) query = query.eq("type", type);
  if (teamId) query = query.eq("team_id", teamId);

  query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag a deferred query read directly via `await query.order(...).range(...)` with no reassignment (real FinancePage.jsx shape)', () => {
  const src = `let query = supabase.from("finance_transactions").select("*")
    .eq("team_id", team.id);
  if (historySeasonId) query = query.eq("season_id", historySeasonId);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .range(from, to);`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('DOES flag a deferred query that is never actually bounded downstream', () => {
  const src = `function buildLookup({ supabase, userId }) {
  let query = supabase
    .from("riders")
    .select("id")
    .eq("team_id", userId);

  return query;
}`;
  assert.equal(scan(src, 'x.js').length, 1);
});

test('respects a pagination-safe comment above a JSDoc + async function whose first statement destructures { data, error } (real notificationService.js shape)', () => {
  const src = `/**
 * JSDoc block above the function.
 */
async function defaultFetchStageParticipants({ supabase, raceId, stageNumber }) {
  // pagination-safe: bounded by race field size, verified max 192 rows (#3331)
  const { data, error } = await supabase
    .from("race_results")
    .select("rank")
    .eq("race_id", raceId)
    .eq("stage_number", stageNumber);
  if (error) throw error;
  return data;
}`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag a { count: "exact", head: true } count-only query — never returns row data', () => {
  const src = `const { count } = await supabase.from("riders").select("id", { count: "exact", head: true }).eq("team_id", teamId);`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('DOES flag a { count: "exact" } query WITHOUT head:true — still returns row data, still in scope', () => {
  const src = `const { data, count } = await supabase.from("race_results").select("id", { count: "exact" }).eq("race_id", id);`;
  assert.equal(scan(src, 'x.js').length, 1);
});

test('does NOT flag a table outside the deny-list', () => {
  const src = `const { data } = await supabase.from("teams").select("*").eq("id", teamId);`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag a deref inside a comment', () => {
  const src = `// const { data } = await supabase.from("race_results").select("*");
  const ok = 1;`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('respects the pagination-safe opt-out on the call line', () => {
  const src = `const { data } = await supabase.from("race_entries").select("*").eq("id", entryId); // pagination-safe: id is a unique PK, at most one row`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('respects the pagination-safe opt-out on the line above', () => {
  const src = `// pagination-safe: race_stage_schedule for a single race has < 30 rows, structurally bounded
  const { data } = await supabase
    .from("race_stage_schedule")
    .select("*")
    .eq("race_id", raceId);`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('respects the pagination-safe opt-out trailing on a chain line', () => {
  const src = `const { data } = await supabase
    .from("finance_transactions")
    .select("*")
    .eq("id", txId); // pagination-safe: single row by unique id
  `;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('flags each deny-listed table independently in one file', () => {
  const src = `const a = await supabase.from("race_results").select("*").eq("race_id", id);
  const b = await supabase.from("notifications").select("*").eq("team_id", teamId);`;
  const f = scan(src, 'x.js');
  assert.equal(f.length, 2);
  assert.deepEqual(f.map((x) => x.table).sort(), ['notifications', 'race_results']);
});

test('DENY_TABLES includes the tables named in #3331', () => {
  for (const t of ['race_results', 'riders', 'race_entries', 'race_stage_schedule', 'race_stage_profiles', 'finance_transactions', 'notifications']) {
    assert.ok(DENY_TABLES.includes(t), `missing ${t}`);
  }
});

// --- baseline-ratchet ------------------------------------------------------

test('compareAgainstBaseline: a finding exactly matching the baseline count is NOT a new violation', () => {
  const findings = [{ file: 'a.js', line: 1, table: 'riders', snippet: '' }];
  const baseline = { files: { 'a.js': { riders: 1 } } };
  const { newViolations } = compareAgainstBaseline(findings, baseline);
  assert.deepEqual(newViolations, []);
});

test('compareAgainstBaseline: a finding in a file NOT in the baseline is a new violation', () => {
  const findings = [{ file: 'new-file.js', line: 1, table: 'riders', snippet: '' }];
  const baseline = { files: {} };
  const { newViolations } = compareAgainstBaseline(findings, baseline);
  assert.equal(newViolations.length, 1);
  assert.match(newViolations[0], /new-file\.js/);
});

test('compareAgainstBaseline: MORE findings than the baseline allows for the same file+table is a new violation', () => {
  const findings = [
    { file: 'a.js', line: 1, table: 'riders', snippet: '' },
    { file: 'a.js', line: 2, table: 'riders', snippet: '' },
  ];
  const baseline = { files: { 'a.js': { riders: 1 } } };
  const { newViolations } = compareAgainstBaseline(findings, baseline);
  assert.equal(newViolations.length, 1);
  assert.match(newViolations[0], /\+1 ny/);
});

test('compareAgainstBaseline: a NEW table violation in an already-baselined file is still caught (per-table, not per-file)', () => {
  const findings = [
    { file: 'a.js', line: 1, table: 'riders', snippet: '' },
    { file: 'a.js', line: 2, table: 'race_results', snippet: '' },
  ];
  const baseline = { files: { 'a.js': { riders: 1 } } }; // no race_results allowance
  const { newViolations } = compareAgainstBaseline(findings, baseline);
  assert.equal(newViolations.length, 1);
  assert.match(newViolations[0], /race_results/);
});

test('compareAgainstBaseline: FEWER findings than baseline is reported as stale, not a violation', () => {
  const findings = [];
  const baseline = { files: { 'a.js': { riders: 3 } } };
  const { newViolations, stale } = compareAgainstBaseline(findings, baseline);
  assert.deepEqual(newViolations, []);
  assert.equal(stale.length, 1);
  assert.match(stale[0], /0\/3/);
});

test('stripCommentsKeepStrings preserves line count and string content', () => {
  const src = 'a\n// b\nconst s = "race_results";\n/* d\ne */\nf';
  const stripped = stripCommentsKeepStrings(src);
  assert.equal(stripped.split('\n').length, src.split('\n').length);
  assert.ok(stripped.includes('"race_results"'));
});
