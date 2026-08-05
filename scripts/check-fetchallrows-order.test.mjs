// scripts/check-fetchallrows-order.test.mjs
// Regression tests for the fetchAllRows(...) .order() forward-guard (#3391).
// Run: node --test scripts/check-fetchallrows-order.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, stripCommentsKeepStrings } from './check-fetchallrows-order.mjs';

test('flags a fetchAllRows(...) call with .from(...) but no .order(...) (synthetic #3391 shape)', () => {
  const src = `const rows = await fetchAllRows(() =>
    supabase.from("teams").select("id").eq("is_ai", false));`;
  const f = scan(src, 'x.js');
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 1);
});

test('does NOT flag a fetchAllRows(...) call with a stable .order("id")', () => {
  const src = `const rows = await fetchAllRows(() =>
    supabase.from("teams").select("id").eq("is_ai", false).order("id"));`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag a fetchAllRows(...) call ordered on a non-id unique key (e.g. team_id PK on a snapshot table)', () => {
  const src = `fetchAllRows(() => supabase
    .from("global_rank_weekly_snapshot").select("team_id, global_rank").order("team_id"));`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag fetchAllRows(...) with no .from(...) inside it (e.g. a mocked buildQuery in a test)', () => {
  const src = `const rows = await fetchAllRows(() => queryFor(rowsFor(chunk)));`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag fetchAllRowsChunkedIn(...) — out of scope for this guard, distinct identifier', () => {
  const src = `const rows = await fetchAllRowsChunkedIn(ids, (chunk) =>
    supabase.from("riders").select("id").in("team_id", chunk));`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag a fetchAllRows(...) call inside a // comment', () => {
  const src = `// const rows = await fetchAllRows(() => supabase.from("teams").select("id"));
  const ok = 1;`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag a fetchAllRows(...) call inside a /* */ block comment', () => {
  const src = `/* const rows = await fetchAllRows(() => supabase.from("teams").select("id")); */
  const ok = 1;`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('recognises .order(...) chained several lines below the .from(...) call', () => {
  const src = `const rows = await fetchAllRows(() =>
    supabase
      .from("riders")
      .select("id, firstname, lastname")
      .eq("is_academy", true)
      .order("id"));`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('flags each violating fetchAllRows(...) call independently in one file', () => {
  const src = `const a = await fetchAllRows(() => supabase.from("teams").select("id"));
  const b = await fetchAllRows(() => supabase.from("riders").select("id").order("id"));
  const c = await fetchAllRows(() => supabase.from("training_plans").select("id"));`;
  const f = scan(src, 'x.js');
  assert.equal(f.length, 2);
  assert.deepEqual(f.map((x) => x.line), [1, 3]);
});

test('stripCommentsKeepStrings preserves line count and string content (shared tokeniser sanity check)', () => {
  const src = 'a\n// b\nconst s = "teams";\n/* d\ne */\nf';
  const stripped = stripCommentsKeepStrings(src);
  assert.equal(stripped.split('\n').length, src.split('\n').length);
  assert.ok(stripped.includes('"teams"'));
});

// ── Repo-wide lock-in: the guard must stay green against the real tree ────────
// Runs the actual scan against backend/ + frontend/src/ (the same dirs the CLI
// defaults to) so a future regression — a new fetchAllRows(...) call site
// missing .order(), or someone quietly loosening scan()'s regex — fails this
// test locally, not just in CI's separate lint step.
test('#3391 repo-wide: zero fetchAllRows(...) call sites missing .order() in backend/ + frontend/src/', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join, extname } = await import('node:path');
  const SCAN_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
  const TEST_FILE_RE = /\.test\.[cm]?[jt]sx?$/;

  function walk(dir, acc) {
    let entries;
    try { entries = readdirSync(dir); } catch { return acc; }
    for (const e of entries) {
      if (e === 'node_modules' || e === 'dist' || e === 'build' || e === '.git') continue;
      const p = join(dir, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, acc);
      else if (st.isFile() && SCAN_EXTS.has(extname(p)) && !TEST_FILE_RE.test(p)) acc.push(p);
    }
    return acc;
  }

  const files = ['backend', 'frontend/src'].flatMap((d) => walk(d, []));
  assert.ok(files.length > 100, 'sanity check: expected the real repo tree, not an empty/partial scan');

  const findings = [];
  for (const f of files) {
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    findings.push(...scan(src, f));
  }
  assert.deepEqual(
    findings.map((f) => `${f.file}:${f.line}`),
    [],
    'a fetchAllRows(...) call site is missing a stable .order() — see #3391',
  );
});
