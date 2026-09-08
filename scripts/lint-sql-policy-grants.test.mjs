// scripts/lint-sql-policy-grants.test.mjs
// Tests for the policy/grant forward-guard (#4943).
// Run: node --test scripts/lint-sql-policy-grants.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanCorpus, findPolicies, findGrants, findCreateTables } from './lint-sql-policy-grants.mjs';

const CREATE_POST_CUTOVER = `CREATE TABLE IF NOT EXISTS public.widgets (id UUID PRIMARY KEY);`;
const CREATE_PRE_CUTOVER = `CREATE TABLE IF NOT EXISTS public.widgets (id UUID PRIMARY KEY);`;

// Fixture 1 — the #4943 shape: a policy TO authenticated with NO matching
// GRANT anywhere in the corpus, on a table created after the #2830 cutover.
const FIXTURE_WITHOUT_GRANT = `
CREATE TABLE IF NOT EXISTS public.widgets (id UUID PRIMARY KEY);
ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can insert own widgets" ON public.widgets;
CREATE POLICY "Users can insert own widgets"
  ON public.widgets FOR INSERT
  TO authenticated
  WITH CHECK (true);
`;

// Fixture 2 — same policy, but with a matching table grant present.
const FIXTURE_WITH_GRANT = `
CREATE TABLE IF NOT EXISTS public.widgets (id UUID PRIMARY KEY);
ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can insert own widgets" ON public.widgets;
CREATE POLICY "Users can insert own widgets"
  ON public.widgets FOR INSERT
  TO authenticated
  WITH CHECK (true);
GRANT INSERT ON public.widgets TO authenticated;
`;

test('fixture WITHOUT a matching grant is flagged (the #4943 shape)', () => {
  const sources = [{ file: '2026-08-20-widgets.sql', source: FIXTURE_WITHOUT_GRANT }];
  const { findings } = scanCorpus(sources, sources);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].table, 'widgets');
  assert.equal(findings[0].op, 'INSERT');
  assert.equal(findings[0].policyName, 'Users can insert own widgets');
});

test('fixture WITH a matching grant in the same file is NOT flagged', () => {
  const sources = [{ file: '2026-08-20-widgets.sql', source: FIXTURE_WITH_GRANT }];
  const { findings } = scanCorpus(sources, sources);
  assert.equal(findings.length, 0);
});

test('a grant in an EARLIER migration for the same table also satisfies the policy', () => {
  const earlier = {
    file: '2026-08-15-widgets-grant.sql',
    source: `GRANT INSERT ON public.widgets TO authenticated;`,
  };
  const later = {
    file: '2026-08-20-widgets-policy.sql',
    source: `
CREATE TABLE IF NOT EXISTS public.widgets (id UUID PRIMARY KEY);
CREATE POLICY "Users can insert own widgets" ON public.widgets FOR INSERT TO authenticated WITH CHECK (true);
`,
  };
  const all = [earlier, later];
  const { findings } = scanCorpus(all, [later]);
  assert.equal(findings.length, 0);
});

test('a table created BEFORE the #2830 cutover is not checked (default write-privileges applied)', () => {
  const src = `
CREATE TABLE IF NOT EXISTS public.widgets (id UUID PRIMARY KEY);
CREATE POLICY "Users can insert own widgets" ON public.widgets FOR INSERT TO authenticated WITH CHECK (true);
`;
  const sources = [{ file: '2026-07-01-widgets.sql', source: src }]; // pre-cutover date
  const { findings } = scanCorpus(sources, sources);
  assert.equal(findings.length, 0);
});

test('a table with unknown creation date (not in corpus, e.g. bootstrap schema.sql) is not checked', () => {
  const src = `CREATE POLICY "x" ON public.ancient_table FOR INSERT TO authenticated WITH CHECK (true);`;
  const sources = [{ file: '2026-09-01-policy-only.sql', source: src }];
  const { findings } = scanCorpus(sources, sources);
  assert.equal(findings.length, 0);
});

test('SELECT policies are never flagged (default-granted per #2830)', () => {
  const src = `
CREATE TABLE IF NOT EXISTS public.widgets (id UUID PRIMARY KEY);
CREATE POLICY "read" ON public.widgets FOR SELECT TO authenticated USING (true);
`;
  const sources = [{ file: '2026-08-20-widgets.sql', source: src }];
  const { findings } = scanCorpus(sources, sources);
  assert.equal(findings.length, 0);
});

test('FOR ALL expands to INSERT/UPDATE/DELETE (not SELECT) and flags each missing op', () => {
  const src = `
CREATE TABLE IF NOT EXISTS public.widgets (id UUID PRIMARY KEY);
CREATE POLICY "own_rows" ON public.widgets FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON public.widgets TO authenticated;
`;
  const sources = [{ file: '2026-08-20-widgets.sql', source: src }];
  const { findings } = scanCorpus(sources, sources);
  const ops = findings.map((f) => f.op).sort();
  assert.deepEqual(ops, ['DELETE', 'UPDATE']);
});

test('a policy scoped to anon (not authenticated) is ignored', () => {
  const src = `
CREATE TABLE IF NOT EXISTS public.widgets (id UUID PRIMARY KEY);
CREATE POLICY "x" ON public.widgets FOR INSERT TO anon WITH CHECK (true);
`;
  const sources = [{ file: '2026-08-20-widgets.sql', source: src }];
  const { findings } = scanCorpus(sources, sources);
  assert.equal(findings.length, 0);
});

test('opt-out comment above the CREATE POLICY suppresses the finding', () => {
  const src = `
CREATE TABLE IF NOT EXISTS public.widgets (id UUID PRIMARY KEY);
-- policy-grant-ok: write path is service_role only, this policy is a documented deny-all
CREATE POLICY "deny_all" ON public.widgets FOR ALL TO authenticated USING (false) WITH CHECK (false);
`;
  const sources = [{ file: '2026-08-20-widgets.sql', source: src }];
  const { findings } = scanCorpus(sources, sources);
  assert.equal(findings.length, 0);
});

test('GRANT ... ON TABLE <table> TO ... syntax is recognised', () => {
  const src = `
CREATE TABLE IF NOT EXISTS public.widgets (id UUID PRIMARY KEY);
CREATE POLICY "x" ON public.widgets FOR INSERT TO authenticated WITH CHECK (true);
GRANT SELECT, INSERT ON TABLE public.widgets TO authenticated;
`;
  const sources = [{ file: '2026-08-20-widgets.sql', source: src }];
  const { findings } = scanCorpus(sources, sources);
  assert.equal(findings.length, 0);
});

test('findPolicies: FOR omitted defaults to ALL per Postgres semantics', () => {
  const stmt = `CREATE POLICY "x" ON public.widgets TO authenticated USING (true)`;
  const found = findPolicies(stmt);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].ops.sort(), ['DELETE', 'INSERT', 'UPDATE']);
});

test('findGrants: GRANT ALL expands to all write ops', () => {
  const stmt = `GRANT ALL ON public.widgets TO authenticated`;
  const found = findGrants(stmt);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].ops.sort(), ['DELETE', 'INSERT', 'UPDATE']);
});

test('findGrants: column-scoped GRANT SELECT (col) is not mistaken for a table-level grant', () => {
  const stmt = `GRANT SELECT (owner_is_ai) ON public.riders TO authenticated`;
  const found = findGrants(stmt);
  assert.equal(found.length, 0);
});

test('findCreateTables: extracts table name from CREATE TABLE IF NOT EXISTS', () => {
  assert.deepEqual(findCreateTables(CREATE_POST_CUTOVER), ['widgets']);
  assert.deepEqual(findCreateTables(CREATE_PRE_CUTOVER), ['widgets']);
});

// #4943 del 2 (8/9 kl. 14:55): en upsert (`INSERT ... ON CONFLICT DO UPDATE`)
// mod en tabel kræver UPDATE-tabelret ogsaa ved den allerførste indsættelse —
// Postgres tjekker retten for at planlægge ON CONFLICT DO UPDATE-grenen,
// uafhængigt af om raekken findes. survey_completions havde et GRANT INSERT
// (del 1's hotfix) og en gyldig UPDATE-policy TO authenticated (fra den
// oprindelige migration), men intet GRANT UPDATE — upserten fejlede stadig
// med 42501. Denne fixture laaser fast at guarden fanger PRAECIS den form:
// INSERT grantet + UPDATE-policy til stede + UPDATE IKKE grantet → fund.
test('#4943 del 2: upsert-tabel med GRANT INSERT men uden GRANT UPDATE er stadig flagget (survey_completions-formen)', () => {
  const src = `
CREATE TABLE IF NOT EXISTS public.survey_completions (id UUID PRIMARY KEY);
ALTER TABLE public.survey_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert own survey completions"
  ON public.survey_completions FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY "Users can update own survey completions"
  ON public.survey_completions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
GRANT INSERT ON public.survey_completions TO authenticated;
`;
  const sources = [{ file: '2026-09-07-survey-completions.sql', source: src }];
  const { findings } = scanCorpus(sources, sources);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].table, 'survey_completions');
  assert.equal(findings[0].op, 'UPDATE');

  // Tilføjes GRANT UPDATE (del 2-hotfixen) i en senere migration, forsvinder
  // fundet — reproducerer den faktiske fix-form (grant tilføjet i en anden fil).
  const grantFile = {
    file: '2026-09-08-survey-completions-update-grant.sql',
    source: `GRANT UPDATE ON public.survey_completions TO authenticated;`,
  };
  const allWithFix = [sources[0], grantFile];
  const { findings: findingsAfterFix } = scanCorpus(allWithFix, [sources[0]]);
  assert.equal(findingsAfterFix.length, 0);
});
