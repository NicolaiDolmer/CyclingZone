// scripts/lint-riders-column-grant.test.mjs
// Tests for the riders/rider_derived_abilities column-grant forward-guard
// (#2241). Run: node --test scripts/lint-riders-column-grant.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scanCorpus,
  findTableRevokes,
  findColumnGrants,
  findAddColumns,
  findCreateTableColumns,
  WHITELIST_FILES,
  ALLOWLIST_HIDDEN_COLUMNS,
} from './lint-riders-column-grant.mjs';

const GATE = `REVOKE SELECT ON public.riders FROM anon, authenticated;\n`;

test('does NOT flag ADD COLUMN on a table that was never gated', () => {
  const src = `ALTER TABLE public.races ADD COLUMN IF NOT EXISTS league_division_id INTEGER;`;
  const { findings } = scanCorpus([{ file: 'x.sql', source: src }]);
  assert.equal(findings.length, 0);
});

test('flags ADD COLUMN on a gated table with no grant anywhere in the file (the #2238 shape)', () => {
  const src = `ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS owner_is_ai boolean NOT NULL DEFAULT false;`;
  const { findings } = scanCorpus([
    { file: 'gate.sql', source: GATE },
    { file: 'add.sql', source: src },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].table, 'riders');
  assert.equal(findings[0].column, 'owner_is_ai');
  assert.equal(findings[0].file, 'add.sql');
});

test('does NOT flag ADD COLUMN on a gated table with a matching same-file grant', () => {
  const src = `
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS owner_is_ai boolean NOT NULL DEFAULT false;
GRANT SELECT (owner_is_ai) ON public.riders TO authenticated, anon;
`;
  const { findings } = scanCorpus([
    { file: 'gate.sql', source: GATE },
    { file: 'add-and-grant.sql', source: src },
  ]);
  assert.equal(findings.length, 0);
});

test('flags one column when a multi-column ADD COLUMN only grants one of them', () => {
  const src = `
ALTER TABLE public.rider_derived_abilities
  ADD COLUMN IF NOT EXISTS season_budget_baseline jsonb,
  ADD COLUMN IF NOT EXISTS totally_new_visible_field integer;
GRANT SELECT (totally_new_visible_field) ON public.rider_derived_abilities TO anon, authenticated;
`;
  const gate = `REVOKE SELECT ON public.rider_derived_abilities FROM anon, authenticated;`;
  const { findings } = scanCorpus([
    { file: 'gate.sql', source: gate },
    { file: 'partial.sql', source: src },
  ]);
  // season_budget_baseline is allowlisted (fail-closed by design) so only
  // the OTHER un-granted column should be missing here — but we granted it,
  // so nothing is flagged. Sanity: allowlist doesn't mask real gaps.
  assert.equal(findings.length, 0);
});

test('flags a real gap even when a DIFFERENT column in the same multi-add is granted', () => {
  const src = `
ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS granted_field integer,
  ADD COLUMN IF NOT EXISTS forgotten_field integer;
GRANT SELECT (granted_field) ON public.riders TO anon, authenticated;
`;
  const { findings } = scanCorpus([
    { file: 'gate.sql', source: GATE },
    { file: 'partial2.sql', source: src },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].column, 'forgotten_field');
});

test('allowlisted hidden columns never require a grant', () => {
  const src = `ALTER TABLE public.rider_derived_abilities ADD COLUMN IF NOT EXISTS season_budget_baseline jsonb, ADD COLUMN IF NOT EXISTS season_budget_season integer;`;
  const gate = `REVOKE SELECT ON public.rider_derived_abilities FROM anon, authenticated;`;
  const { findings } = scanCorpus([
    { file: 'gate.sql', source: gate },
    { file: 'hidden.sql', source: src },
  ]);
  assert.equal(findings.length, 0);
});

test('a `-- riders-column-grant-ok:` comment on the line above opts out', () => {
  const src = `
-- riders-column-grant-ok: intentionally deferred, tracked in #9999
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS deliberately_ungranted integer;
`;
  const { findings } = scanCorpus([
    { file: 'gate.sql', source: GATE },
    { file: 'optout.sql', source: src },
  ]);
  assert.equal(findings.length, 0);
});

test('example DDL quoted inside a -- comment is never mistaken for real DDL', () => {
  const src = `
-- reminder: a later \`ALTER TABLE riders ADD COLUMN foo\` needs
--   \`GRANT SELECT (foo) ON public.riders TO anon, authenticated;\`
-- in the same migration, or PostgREST 403s the whole request.
SELECT 1;
`;
  const { findings } = scanCorpus([
    { file: 'gate.sql', source: GATE },
    { file: 'comment-only.sql', source: src },
  ]);
  assert.equal(findings.length, 0);
});

test('a table-wide dynamic REVOKE embedded in a DO $$ ... $$ block still gates the table', () => {
  const src = `
DO $$
BEGIN
  EXECUTE 'REVOKE SELECT ON public.riders FROM anon, authenticated';
END $$;
`;
  const { gatedTables } = scanCorpus([{ file: 'seed.sql', source: src }]);
  assert.ok(gatedTables.has('riders'));
});

test('a column-scoped REVOKE (e.g. hiding one previously-granted column) does NOT gate the table', () => {
  // races has never had a table-wide REVOKE, so a column-scoped revoke on it
  // (hypothetical) must not switch it into "gated" mode.
  const src = `REVOKE SELECT (some_col) ON public.races FROM anon, authenticated;`;
  const { gatedTables } = scanCorpus([{ file: 'x.sql', source: src }]);
  assert.equal(gatedTables.has('races'), false);
});

test('whitelisted historical files are skipped for finding-generation but still gate tables', () => {
  const base = Object.keys(WHITELIST_FILES)[0];
  assert.ok(base, 'expected at least one WHITELIST_FILES entry');
  const src = `ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS whatever_ungranted integer;`;
  const { findings } = scanCorpus([
    { file: 'gate.sql', source: GATE },
    { file: base, source: src },
  ]);
  assert.equal(findings.length, 0);
});

test('every WHITELIST_FILES / ALLOWLIST_HIDDEN_COLUMNS entry carries a non-empty reason', () => {
  for (const [file, reason] of Object.entries(WHITELIST_FILES)) {
    assert.ok(typeof reason === 'string' && reason.trim().length > 20, `missing reason for ${file}`);
  }
  for (const [key, reason] of Object.entries(ALLOWLIST_HIDDEN_COLUMNS)) {
    assert.ok(typeof reason === 'string' && reason.trim().length > 20, `missing reason for ${key}`);
  }
});

test('CREATE TABLE columns on an already-gated table are checked like ADD COLUMN', () => {
  const src = `
CREATE TABLE IF NOT EXISTS public.riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  granted_col TEXT,
  ungranted_col TEXT,
  CONSTRAINT riders_check CHECK (granted_col IS NOT NULL)
);
GRANT SELECT (id, granted_col) ON public.riders TO anon, authenticated;
`;
  const { findings } = scanCorpus([
    { file: 'gate.sql', source: GATE },
    { file: 'recreate.sql', source: src },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].column, 'ungranted_col');
});

// --- unit-level helper coverage -------------------------------------------

test('findTableRevokes ignores REVOKE that does not mention anon/authenticated', () => {
  assert.deepEqual(findTableRevokes('REVOKE SELECT ON public.riders FROM some_other_role'), []);
});

test('findColumnGrants ignores GRANT that does not mention anon/authenticated', () => {
  const grants = findColumnGrants('GRANT SELECT (foo) ON public.riders TO service_role');
  assert.equal(grants.size, 0);
});

test('findAddColumns extracts table + all comma-separated columns from one ALTER TABLE', () => {
  const cols = findAddColumns(
    'ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS a integer, ADD COLUMN IF NOT EXISTS b text'
  );
  assert.deepEqual(cols, [
    { table: 'riders', column: 'a' },
    { table: 'riders', column: 'b' },
  ]);
});

test('findCreateTableColumns skips constraint clauses and handles nested parens', () => {
  const cols = findCreateTableColumns(
    'CREATE TABLE IF NOT EXISTS public.foo (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), team_id UUID REFERENCES teams(id), PRIMARY KEY (id))'
  );
  const names = cols.map((c) => c.column);
  assert.deepEqual(names, ['id', 'team_id']);
});
