// scripts/lint-sql-insert-arity.test.mjs
// ============================================================
// Tests for the SQL INSERT column/value arity forward-guard (#4943).
//
// Run:  node --test scripts/lint-sql-insert-arity.test.mjs
//
// Test cases:
//   1. Detects the exact #4943 bug shape (4 columns, 3 values).
//   2. Zero false-positives on the current database/*.sql tree.
//   3. Accepts a correct single-row INSERT.
//   4. Detects a mismatch in one tuple of a multi-row VALUES list, while a
//      correct sibling tuple in the same list is not flagged.
//   5. Commas inside a string literal (including an escaped '') don't split
//      a value.
//   6. Commas inside a nested call/cast (`numeric(10,2)`, `now()`,
//      `ARRAY[1,2,3]`) don't split a value.
//   7. `INSERT INTO t (cols) SELECT ... FROM (VALUES ...) AS q(...)` is out
//      of scope (not flagged) — see script header for why.
//   8. Line comments / block comments around an INSERT don't confuse the
//      parser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from './lint-sql-insert-arity.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DB_DIR = join(HERE, '..', 'database');

test('detects the #4943 bug shape (4 columns, 3 values)', () => {
  const src = `INSERT INTO public.surveys (slug, title_en, title_da, status)
VALUES (
  '2026-09-features',
  'What should I build next?',
  'Hvad skal jeg bygge næste gang?'
)
ON CONFLICT (slug) DO UPDATE SET title_en = EXCLUDED.title_en;
`;
  const findings = scan(src, '/tmp/test-4943.sql');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].expected, 4);
  assert.equal(findings[0].actual, 3);
  assert.equal(findings[0].table, 'public.surveys');
  // Line points at the mismatched VALUES tuple itself (line 2 — "VALUES ("),
  // not the INSERT INTO keyword on line 1, which is more useful for locating
  // the actual fix.
  assert.equal(findings[0].line, 2);
});

test('zero false-positives on the current database/*.sql tree', () => {
  const files = readdirSync(DB_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => join(DB_DIR, f))
    .filter((p) => statSync(p).isFile());
  assert.ok(files.length > 0, 'expected at least one database/*.sql file');

  const allFindings = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    allFindings.push(...scan(src, f));
  }
  assert.deepEqual(
    allFindings,
    [],
    `unexpected arity findings:\n${JSON.stringify(allFindings, null, 2)}`
  );
});

test('accepts a correct single-row INSERT', () => {
  const src = "INSERT INTO t (a, b, c) VALUES (1, 2, 3);\n";
  assert.deepEqual(scan(src, '/tmp/test-ok.sql'), []);
});

test('flags only the mismatched tuple in a multi-row VALUES list', () => {
  const src = 'INSERT INTO t (a, b) VALUES (1, 2), (3, 4, 5), (6, 7);\n';
  const findings = scan(src, '/tmp/test-multirow.sql');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tupleIndex, 1);
  assert.equal(findings[0].expected, 2);
  assert.equal(findings[0].actual, 3);
});

test('does not split on commas inside a string literal (incl. escaped apostrophe)', () => {
  const src =
    "INSERT INTO t (a, b, c) VALUES ('x, y''s comma, here', 'plain', 3);\n";
  assert.deepEqual(scan(src, '/tmp/test-string-comma.sql'), []);
});

test('does not split on commas inside a nested call/cast/array', () => {
  const src =
    "INSERT INTO t (a, b, c) VALUES (now(), 3::numeric(10,2), ARRAY[1,2,3]);\n";
  assert.deepEqual(scan(src, '/tmp/test-nested-comma.sql'), []);
});

test('SELECT-based INSERT (VALUES-as-table seed pattern) is out of scope', () => {
  const src = `WITH s AS (SELECT id FROM public.surveys WHERE slug = 'x')
INSERT INTO public.survey_questions (survey_id, sort_order, key)
SELECT s.id, q.sort_order, q.key
FROM s, (VALUES
  (10, 'a', 'b', 'c'),
  (20, 'd', 'e')
) AS q(sort_order, key, extra)
ON CONFLICT (survey_id, key) DO UPDATE SET sort_order = EXCLUDED.sort_order;
`;
  assert.deepEqual(scan(src, '/tmp/test-select-based.sql'), []);
});

test('line comments and block comments around an INSERT do not confuse the parser', () => {
  const src = `-- seed row, see #4943
INSERT INTO t (a, b) /* two columns */ VALUES (1, 2); -- ok
`;
  assert.deepEqual(scan(src, '/tmp/test-comments.sql'), []);
});

test('nested block comments (PostgreSQL semantics) do not leak SQL-looking text into the scan', () => {
  // PostgreSQL block comments NEST, unlike C: `/* outer /* inner */ still
  // comment */` is ONE comment start-to-end. A scanner that (incorrectly)
  // closes on the FIRST `*/` would treat the text after "inner */" as live
  // SQL — and here that text is a genuinely mismatched INSERT (2 columns,
  // 1 value), which is still fully inside the (correctly nested) outer
  // comment and must NOT be flagged. CodeRabbit review finding on the
  // #4943 PR: the original implementation used a boolean flag instead of a
  // nesting-depth counter and would report a false positive here.
  const src =
    '/* outer comment /* inner */ INSERT INTO t (a, b) VALUES (1) still comment */\n' +
    'INSERT INTO t (a, b) VALUES (1, 2);\n';
  assert.deepEqual(scan(src, '/tmp/test-nested-comment.sql'), []);
});
