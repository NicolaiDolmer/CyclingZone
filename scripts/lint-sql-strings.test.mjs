// scripts/lint-sql-strings.test.mjs
// ============================================================
// Tests for the SQL string-literal forward-guard (#639).
//
// Run:  node --test scripts/lint-sql-strings.test.mjs
//
// Test cases mirror the acceptance criteria from #639:
//   1. Detects unescaped apostrophe in COMMENT-style string (the #635 bug shape).
//   2. Zero false-positives on the current database/*.sql tree.
//   3. Dollar-quoted PL/pgSQL function bodies are not scanned.
//   4. Line comments and block comments are not scanned.
//   5. Escaped apostrophe ('') is allowed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from './lint-sql-strings.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DB_DIR = join(HERE, '..', 'database');

test('detects unescaped apostrophe in COMMENT-style literal (acceptance #1, #635 shape)', () => {
  const src =
    "COMMENT ON COLUMN foo.bar IS 'claim'et med unescaped apostrof';\n";
  const findings = scan(src, '/tmp/test-bad.sql');
  assert.equal(findings.length, 1, 'should flag exactly one unescaped apostrophe');
  assert.equal(findings[0].line, 1);
  assert.match(findings[0].snippet, /<<HERE>>/);
});

test('detects the exact #635 bug-shape with multi-line literal', () => {
  // mirror of the original buggy line, slightly synthesised
  const src = `COMMENT ON CONSTRAINT foo_c ON foo IS
  'Completed_at kræver started_at — sikrer at fase-rækkefølge er korrekt og at completed_at ikke kan sættes uden at have claim'et.';
`;
  const findings = scan(src, '/tmp/test-635.sql');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 2);
});

test('accepts properly escaped apostrophe ("")', () => {
  const src =
    "COMMENT ON COLUMN foo.bar IS 'Manageren''s valgte klub-DNA.';\n";
  const findings = scan(src, '/tmp/test-ok.sql');
  assert.equal(findings.length, 0);
});

test('accepts string-literals terminated by operator/punctuation/whitespace', () => {
  // These are all legitimate SQL — no unescaped quote.
  const cases = [
    "INSERT INTO t (s) VALUES ('hello');",
    "SELECT 'a' || 'b';",
    "SELECT 'foo', 'bar';",
    "SELECT 'baz' FROM t;",
    "SELECT 'x'::text;",
    "WHERE col = 'value';",
  ];
  for (const src of cases) {
    const findings = scan(src, '/tmp/test-ok2.sql');
    assert.equal(
      findings.length,
      0,
      `should not flag: ${src} (got ${JSON.stringify(findings)})`
    );
  }
});

test('skips line comments (-- to EOL)', () => {
  const src = `-- This isn't a string; the apostrophe in "isn't" should not be flagged.
SELECT 1;
`;
  const findings = scan(src, '/tmp/test-cmt.sql');
  assert.equal(findings.length, 0);
});

test('skips block comments (/* ... */)', () => {
  const src = `/* Block comment with 'apostrophe' inside isn't a string */
SELECT 1;
`;
  const findings = scan(src, '/tmp/test-blk.sql');
  assert.equal(findings.length, 0);
});

test('skips dollar-quoted strings ($$ ... $$) — acceptance #3', () => {
  // PL/pgSQL function body where 'rider_id' and 'pending' are legitimately
  // bare-apostrophe-on-letter, but only because they sit inside a dollar-
  // quoted block where each is its own '...' string. Outside the $$ block
  // they would still tokenize correctly; this test makes sure we don't
  // recurse into $$.
  const src = `CREATE FUNCTION foo() RETURNS uuid AS $$
DECLARE
BEGIN
  RAISE EXCEPTION 'race_id required';
  RETURN 'pending';
END;
$$ LANGUAGE plpgsql;
`;
  const findings = scan(src, '/tmp/test-dollar.sql');
  assert.equal(findings.length, 0);
});

test('skips tagged dollar-quoted strings ($func$ ... $func$)', () => {
  const src = `CREATE FUNCTION foo() RETURNS text AS $func$
  SELECT 'this isn''t parsed by the SQL lexer; inner apostrophe ok';
$func$ LANGUAGE sql;
`;
  const findings = scan(src, '/tmp/test-tag.sql');
  assert.equal(findings.length, 0);
});

test('still catches bug OUTSIDE a dollar-quoted block in same file', () => {
  const src = `CREATE FUNCTION foo() RETURNS uuid AS $$
  -- inside dollar-quoting — anything goes
  RAISE 'bare apostrophe ok here';
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION foo() IS 'doesn't escape here';
`;
  const findings = scan(src, '/tmp/test-mixed.sql');
  assert.equal(findings.length, 1, 'should catch the COMMENT line only');
  assert.equal(findings[0].line, 6);
});

test('zero false-positives on current database/*.sql tree (acceptance #2)', () => {
  const entries = readdirSync(DB_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => join(DB_DIR, f))
    .filter((p) => statSync(p).isFile());

  assert.ok(entries.length > 50, `expected many SQL files, got ${entries.length}`);

  const allFindings = [];
  for (const f of entries) {
    const src = readFileSync(f, 'utf8');
    const findings = scan(src, f);
    if (findings.length > 0) {
      allFindings.push(...findings);
    }
  }

  if (allFindings.length > 0) {
    const summary = allFindings
      .slice(0, 5)
      .map((f) => `${f.file}:${f.line} — ${f.snippet}`)
      .join('\n');
    assert.fail(
      `Expected zero findings on current tree, got ${allFindings.length}:\n${summary}`
    );
  }
});

test('matches verified post-#635-fix file (acceptance #2 spot-check)', () => {
  // Specifically check the file that was the source of #635 (now fixed).
  const f = join(DB_DIR, '2026-05-24-squad-enforcement-started-at.sql');
  const src = readFileSync(f, 'utf8');
  const findings = scan(src, f);
  assert.equal(findings.length, 0, 'fixed file should have no findings');
});

test('matches reference file with correctly escaped Manageren\'\'s', () => {
  const f = join(DB_DIR, '2026-05-05-board-club-dna.sql');
  const src = readFileSync(f, 'utf8');
  const findings = scan(src, f);
  assert.equal(findings.length, 0, "reference Manageren''s file should be clean");
});

// ----- Race-fix #790: audit-on-workflow_run integration (acceptance #4) -----
// feature-liveness-audit.yml previously triggered on push-to-main, but that
// RACED auto-migrate's ~3-min deploy-delay: Detector C read schema_migrations
// before auto-migrate had written the row, falsely flagging every just-merged
// migration as "committed men ikke applied" (#790 churned on every merge). The
// trigger now keys off the Auto-migrate workflow COMPLETING instead, so the
// audit runs only once the migration is actually applied.
test('feature-liveness-audit.yml triggers on workflow_run(Auto-migrate) with --skip=A,B,D,E', () => {
  const yml = readFileSync(
    join(HERE, '..', '.github', 'workflows', 'feature-liveness-audit.yml'),
    'utf8'
  );

  // workflow_run trigger keyed off Auto-migrate completing on main
  assert.match(
    yml,
    /workflow_run:\s*\n\s*workflows:\s*\['Auto-migrate'\]\s*\n\s*types:\s*\[completed\]\s*\n\s*branches:\s*\[main\]/,
    'workflow should trigger on Auto-migrate workflow_run completing on main'
  );

  // no lingering push-to-main trigger (the racy shape #790 removed)
  assert.doesNotMatch(
    yml,
    /^\s*push:\s*\n\s*branches:\s*\[main\]/m,
    'push-to-main trigger should be gone (raced auto-migrate, #790)'
  );

  // Detector C-only when workflow_run (post-migration runs skip A, B, D, E)
  assert.match(
    yml,
    /github\.event_name.*['"]workflow_run['"][^]*--skip=A,B,D,E/,
    'workflow_run runs should skip detectors A, B, D, E (only C runs)'
  );

  // tracking-issue step fires on schedule OR workflow_run
  assert.match(
    yml,
    /github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_run'/,
    'tracking-issue step should fire on schedule and workflow_run'
  );

  // sanity: top-level YAML structure intact
  assert.match(yml, /^name: Feature-liveness audit/m);
  assert.match(yml, /^jobs:\s*$/m);
  assert.match(yml, /^\s*audit:\s*$/m);
});
