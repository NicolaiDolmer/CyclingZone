// scripts/check-maybesingle-unique-scope.test.mjs
// Regression tests for the .maybeSingle() unique-scope forward-guard (#4496).
// Run: node --test scripts/check-maybesingle-unique-scope.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scan,
  stripCommentsKeepStrings,
  parseUniqueConstraintsFromSql,
  buildUniqueConstraintMap,
} from './check-maybesingle-unique-scope.mjs';

// Minimal relations fixture mirroring the shape of
// database/schema-snapshot.json's `relations` map, scoped to what these
// tests need.
const RELATIONS = {
  academy_graduation: { columns: ['id', 'team_id', 'rider_id', 'season_id', 'status', 'deadline', 'created_at', 'resolved_at'] },
  teams: { columns: ['id', 'user_id', 'name'] },
  season_standings: { columns: ['id', 'season_id', 'team_id', 'points'] },
};
const KNOWN_TABLES = new Set(Object.keys(RELATIONS));
const UNIQUE_MAP = { academy_graduation: [['rider_id', 'season_id']], season_standings: [['season_id', 'team_id']] };

// ── The four #4484 patterns, verbatim from the pre-fix commit (see PR #4494's
// parent, cd9a62bb0^) — resolveGraduation, resolvePendingGraduationOnSale,
// academyTransfer.promote, and api.js's academy-release all shared this exact
// shape: .eq("team_id", …).eq("rider_id", …).maybeSingle() against
// academy_graduation, which is UNIQUE(rider_id, season_id) — season_id never
// covered. ─────────────────────────────────────────────────────────────────

test('#4484 pattern 1/4 — resolveGraduation: team_id+rider_id only, missing season_id', () => {
  const src = `const { data: grad, error: gradError } = await supabase.from("academy_graduation")
    .select("id, status").eq("team_id", teamId).eq("rider_id", riderId).maybeSingle();`;
  const { findings } = scan(src, 'x.js', UNIQUE_MAP, KNOWN_TABLES);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].table, 'academy_graduation');
  assert.deepEqual(findings[0].missing, ['season_id']);
});

test('#4484 pattern 2/4 — resolvePendingGraduationOnSale: same shape inside a try block', () => {
  const src = `try {
    const { data: grad, error: selectError } = await supabase.from("academy_graduation")
      .select("id, status").eq("team_id", teamId).eq("rider_id", riderId).maybeSingle();
    if (selectError) throw new Error(selectError.message);
  } catch (e) { /* best-effort */ }`;
  const { findings } = scan(src, 'x.js', UNIQUE_MAP, KNOWN_TABLES);
  assert.equal(findings.length, 1);
});

test('#4484 pattern 3/4 — academyTransfer.promote: destructures only `data`', () => {
  const src = `const { data: grad } = await supabase.from("academy_graduation")
    .select("id, status").eq("team_id", teamId).eq("rider_id", riderId).maybeSingle();
  if (grad && grad.status === "pending") { /* ... */ }`;
  const { findings } = scan(src, 'x.js', UNIQUE_MAP, KNOWN_TABLES);
  assert.equal(findings.length, 1);
});

test('#4484 pattern 4/4 — api.js academy-release: req.team.id / rider.id property-access args', () => {
  const src = `const { data: grad, error: gradErr } = await supabase.from("academy_graduation") // best-effort
    .select("id, status").eq("team_id", req.team.id).eq("rider_id", rider.id).maybeSingle();
  if (gradErr) throw new Error(gradErr.message);`;
  const { findings } = scan(src, 'x.js', UNIQUE_MAP, KNOWN_TABLES);
  assert.equal(findings.length, 1);
});

// ── Negative cases ──────────────────────────────────────────────────────────

test('negative 1/2 — does NOT flag the actual #4494 fix (findPendingGraduation: status filter + .limit(1))', () => {
  const src = `export async function findPendingGraduation(supabase, { teamId, riderId } = {}) {
    const { data, error } = await supabase.from("academy_graduation")
      .select("id, status")
      .eq("team_id", teamId).eq("rider_id", riderId).eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(\`findPendingGraduation: \${error.message}\`);
    return data ?? null;
  }`;
  const { findings } = scan(src, 'x.js', UNIQUE_MAP, KNOWN_TABLES);
  assert.equal(findings.length, 0);
});

test('negative 2/2 — does NOT flag a full composite-key scope (season_id + rider_id both present)', () => {
  const src = `const { data } = await supabase.from("academy_graduation")
    .select("id").eq("rider_id", riderId).eq("season_id", seasonId).maybeSingle();`;
  const { findings } = scan(src, 'x.js', UNIQUE_MAP, KNOWN_TABLES);
  assert.equal(findings.length, 0);
});

// ── Coverage-shape edge cases ────────────────────────────────────────────────

test('does NOT flag an "id"-scoped lookup regardless of the table\'s composite UNIQUE', () => {
  const src = `const { data } = await supabase.from("academy_graduation").select("*").eq("id", gradId).maybeSingle();`;
  assert.equal(scan(src, 'x.js', UNIQUE_MAP, KNOWN_TABLES).findings.length, 0);
});

test('does NOT flag a table with no known composite UNIQUE', () => {
  const src = `const { data } = await supabase.from("teams").select("*").eq("user_id", userId).maybeSingle();`;
  assert.equal(scan(src, 'x.js', UNIQUE_MAP, KNOWN_TABLES).findings.length, 0);
});

test('does NOT flag a call whose .from(...) is inside a // comment', () => {
  const src = `// supabase.from("academy_graduation").eq("team_id", teamId).eq("rider_id", riderId)
  x.maybeSingle();`;
  // no real .from(...) reaches the .maybeSingle() statement — out of scope, not a finding
  assert.equal(scan(src, 'x.js', UNIQUE_MAP, KNOWN_TABLES).findings.length, 0);
});

test('honours the maybesingle-scope-ok: escape hatch', () => {
  const src = `// maybesingle-scope-ok: legacy row, season_id introduced after this table — verified 1 row max in prod 2/9
  const { data } = await supabase.from("academy_graduation")
    .select("id").eq("team_id", teamId).eq("rider_id", riderId).maybeSingle();`;
  assert.equal(scan(src, 'x.js', UNIQUE_MAP, KNOWN_TABLES).findings.length, 0);
});

test('flags each independent under-scoped call in one file, and reports the right line', () => {
  const src = `const a = await supabase.from("academy_graduation").select("id").eq("team_id", t).eq("rider_id", r).maybeSingle();
  const b = await supabase.from("academy_graduation").select("id").eq("rider_id", r).eq("season_id", s).maybeSingle();
  const c = await supabase.from("season_standings").select("id").eq("season_id", s).maybeSingle();`;
  const { findings } = scan(src, 'x.js', UNIQUE_MAP, KNOWN_TABLES);
  assert.deepEqual(findings.map((f) => f.line), [1, 3]);
});

test('fails loudly (unknownTables) on a .from(...) table missing from the snapshot, instead of silently skipping', () => {
  const src = `const { data } = await supabase.from("some_new_table").select("id").eq("a", x).maybeSingle();`;
  const { findings, unknownTables } = scan(src, 'x.js', UNIQUE_MAP, KNOWN_TABLES);
  assert.equal(findings.length, 0);
  assert.equal(unknownTables.length, 1);
  assert.equal(unknownTables[0].table, 'some_new_table');
});

test('stripCommentsKeepStrings preserves line count and string content (shared tokeniser sanity check)', () => {
  const src = 'a\n// b\nconst s = "academy_graduation";\n/* d\ne */\nf';
  const stripped = stripCommentsKeepStrings(src);
  assert.equal(stripped.split('\n').length, src.split('\n').length);
  assert.ok(stripped.includes('"academy_graduation"'));
});

// ── SQL constraint extraction ────────────────────────────────────────────────

test('parseUniqueConstraintsFromSql: table-level UNIQUE(...) inside CREATE TABLE', () => {
  const sql = `CREATE TABLE public.academy_graduation (
    id uuid PRIMARY KEY,
    rider_id uuid NOT NULL,
    season_id int NOT NULL,
    UNIQUE (rider_id, season_id)
  );`;
  const found = parseUniqueConstraintsFromSql(sql);
  assert.deepEqual(found, [{ table: 'academy_graduation', cols: ['rider_id', 'season_id'] }]);
});

test('parseUniqueConstraintsFromSql: named CONSTRAINT UNIQUE(...) inside CREATE TABLE', () => {
  const sql = `CREATE TABLE public.training_plans (
    team_id uuid, rider_id uuid, season_id int,
    CONSTRAINT training_plans_team_rider_season_uniq UNIQUE (team_id, rider_id, season_id)
  );`;
  const found = parseUniqueConstraintsFromSql(sql);
  assert.deepEqual(found, [{ table: 'training_plans', cols: ['team_id', 'rider_id', 'season_id'] }]);
});

test('parseUniqueConstraintsFromSql: ALTER TABLE ... ADD CONSTRAINT ... UNIQUE(...)', () => {
  const sql = `ALTER TABLE public.board_profiles
    ADD CONSTRAINT board_profiles_team_id_plan_type_key UNIQUE (team_id, plan_type);`;
  const found = parseUniqueConstraintsFromSql(sql);
  assert.deepEqual(found, [{ table: 'board_profiles', cols: ['team_id', 'plan_type'] }]);
});

test('parseUniqueConstraintsFromSql: CREATE UNIQUE INDEX ... ON table(...)', () => {
  const sql = `CREATE UNIQUE INDEX IF NOT EXISTS uniq_board_race
    ON public.board_satisfaction_events (board_id, race_id);`;
  const found = parseUniqueConstraintsFromSql(sql);
  assert.deepEqual(found, [{ table: 'board_satisfaction_events', cols: ['board_id', 'race_id'] }]);
});

test('parseUniqueConstraintsFromSql: skips a PARTIAL CREATE UNIQUE INDEX (has a WHERE clause)', () => {
  const sql = `CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_rider
    ON public.auctions (rider_id, team_id) WHERE status = 'active';`;
  assert.deepEqual(parseUniqueConstraintsFromSql(sql), []);
});

test('parseUniqueConstraintsFromSql: ignores a single-column UNIQUE (out of scope — only composite keys matter here)', () => {
  const sql = `CREATE TABLE public.users (id uuid, username text UNIQUE (username));`;
  assert.deepEqual(parseUniqueConstraintsFromSql(sql), []);
});

test('parseUniqueConstraintsFromSql: ignores a -- comment and a /* */ block comment', () => {
  const sql = `-- UNIQUE (a, b) inside a comment must not be picked up
  /* CREATE TABLE public.ghost (a int, b int, UNIQUE (a, b)); */
  CREATE TABLE public.real_table (a int, b int, UNIQUE (a, b));`;
  const found = parseUniqueConstraintsFromSql(sql);
  assert.deepEqual(found, [{ table: 'real_table', cols: ['a', 'b'] }]);
});

test('buildUniqueConstraintMap: drops a constraint whose table is absent from the schema snapshot', () => {
  const sqlSources = { 'x.sql': `CREATE TABLE public.ghost_table (a int, b int, UNIQUE (a, b));` };
  const map = buildUniqueConstraintMap(sqlSources, RELATIONS);
  assert.equal(map.ghost_table, undefined);
});

test('buildUniqueConstraintMap: drops a constraint referencing a column the snapshot does not have on that table', () => {
  const sqlSources = { 'x.sql': `CREATE TABLE public.teams (a int, b int, UNIQUE (a, b));` };
  const map = buildUniqueConstraintMap(sqlSources, RELATIONS);
  assert.equal(map.teams, undefined); // "a"/"b" aren't real columns of teams in RELATIONS
});

test('buildUniqueConstraintMap: dedupes an identical constraint declared in more than one migration file', () => {
  const sqlSources = {
    'a.sql': `CREATE TABLE public.academy_graduation (rider_id uuid, season_id int, UNIQUE (rider_id, season_id));`,
    'b.sql': `-- re-declared in a later baseline dump
      CREATE TABLE public.academy_graduation (rider_id uuid, season_id int, UNIQUE (rider_id, season_id));`,
  };
  const map = buildUniqueConstraintMap(sqlSources, RELATIONS);
  assert.deepEqual(map.academy_graduation, [['rider_id', 'season_id']]);
});

// ── Repo-wide lock-in: the guard must stay green against the real tree ────────
// Runs the actual scan against backend/ + frontend/src/ using the REAL
// database/schema-snapshot.json + database/*.sql, exactly like the CLI, so a
// future regression fails this test locally, not just in CI's separate step.
// #4496: the prototype found 4/4 hits before #4494's fix and 0 after —
// verify main is still clean.
test('#4496 repo-wide: zero under-scoped .maybeSingle() call sites in backend/ + frontend/src/', async () => {
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

  const relations = JSON.parse(readFileSync('database/schema-snapshot.json', 'utf8')).relations;
  const knownTables = new Set(Object.keys(relations));
  const sqlSources = {};
  for (const f of readdirSync('database')) {
    if (f.endsWith('.sql')) sqlSources[f] = readFileSync(join('database', f), 'utf8');
  }
  const uniqueMap = buildUniqueConstraintMap(sqlSources, relations);
  assert.ok(Object.keys(uniqueMap).length > 10, 'sanity check: expected real constraints parsed from database/*.sql');

  const files = ['backend', 'frontend/src'].flatMap((d) => walk(d, []));
  assert.ok(files.length > 100, 'sanity check: expected the real repo tree, not an empty/partial scan');

  const findings = [];
  const unknownTables = [];
  for (const f of files) {
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    const res = scan(src, f, uniqueMap, knownTables);
    findings.push(...res.findings);
    unknownTables.push(...res.unknownTables);
  }
  assert.deepEqual(
    findings.map((f) => `${f.file}:${f.line}`),
    [],
    'a .maybeSingle() call site is not scoped to its table\'s full UNIQUE key — see #4496',
  );
  assert.deepEqual(
    unknownTables.map((u) => `${u.file}:${u.line} "${u.table}"`),
    [],
    'a .from(...) table near .maybeSingle() is missing from database/schema-snapshot.json — refresh the snapshot',
  );
});
