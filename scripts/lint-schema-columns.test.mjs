// scripts/lint-schema-columns.test.mjs
// Tests for the schema-column forward-guard (#3586). Run: node --test
//
// The fixture snapshot below is a small hand-written stand-in for
// database/schema-snapshot.json — the tests must assert on the SCANNER, not on
// whatever prod happens to look like today. A separate test at the bottom
// checks the real committed snapshot's shape and the two documented bugs it
// must still describe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  scan,
  buildSnapshot,
  checkSelectList,
  evalLiteral,
  extractConstants,
  extractNamedImports,
  normalizeColumnToken,
  resolveEmbedTarget,
  splitTopLevel,
  indexOfAliasColon,
  stripCommentsKeepStrings,
  isTestFile,
  KNOWN_FINDINGS,
} from './lint-schema-columns.mjs';

const SNAPSHOT = {
  relations: {
    riders: { kind: 'table', columns: ['id', 'firstname', 'lastname', 'team_id', 'salary', 'market_value'] },
    teams: { kind: 'table', columns: ['id', 'name', 'balance', 'user_id', 'is_ai'] },
    season_standings: { kind: 'table', columns: ['id', 'season_id', 'team_id', 'total_points'] },
    race_results: { kind: 'table', columns: ['id', 'race_id', 'rider_id', 'team_id', 'imported_at', 'rank'] },
    races: { kind: 'table', columns: ['id', 'name', 'season_id'] },
    rider_derived_abilities: { kind: 'table', columns: ['rider_id', 'climbing', 'sprint'] },
    users: { kind: 'table', columns: ['id', 'email', 'consent_preferences'] },
    team_standings_ext_mv: { kind: 'matview', columns: ['season_id', 'team_id', 'podiums'] },
  },
  foreignKeys: {
    'riders.team_id': 'teams',
    'race_results.race_id': 'races',
    'race_results.team_id': 'teams',
    'rider_derived_abilities.rider_id': 'riders',
    'teams.user_id': 'users',
  },
};

const run = (src, file = 'backend/x.js', lookup = () => null) => scan(src, file, SNAPSHOT, lookup);

// ---------------------------------------------------------------------------
// The two bug shapes the guard exists for.
// ---------------------------------------------------------------------------

test('#3572 shape: flags season_standings.prize_money', () => {
  const src = `const { data } = await supabase
    .from("season_standings")
    .select("team_id, total_points, prize_money")
    .eq("season_id", seasonId);`;
  const { findings } = run(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].relation, 'season_standings');
  assert.equal(findings[0].column, 'prize_money');
  assert.equal(findings[0].line, 2);
});

test('Day-1 shape: flags race_results.created_at', () => {
  const src = `await supabase.from("race_results").select("id, race_id, created_at").limit(1);`;
  const { findings } = run(src);
  assert.deepEqual(findings.map((f) => `${f.relation}.${f.column}`), ['race_results.created_at']);
});

test('does NOT flag a select where every column exists', () => {
  const src = `await supabase.from("riders").select("id, firstname, lastname, salary");`;
  assert.equal(run(src).findings.length, 0);
});

test('reports every unknown column in one select, not just the first', () => {
  const src = `await supabase.from("riders").select("id, nope_one, nope_two");`;
  const { findings } = run(src);
  assert.deepEqual(findings.map((f) => f.column), ['nope_one', 'nope_two']);
});

// ---------------------------------------------------------------------------
// Never guess: unresolvable input is skipped, not reported.
// ---------------------------------------------------------------------------

test('skips a dynamic table argument instead of guessing', () => {
  const src = `await supabase.from(tableName).select("whatever_column");`;
  const { findings, stats } = run(src);
  assert.equal(findings.length, 0);
  assert.equal(stats.skippedDynamicTable, 1);
});

test('skips a relation that is not in the snapshot', () => {
  const src = `await supabase.from("some_future_table").select("who_knows");`;
  const { findings, stats } = run(src);
  assert.equal(findings.length, 0);
  assert.equal(stats.skippedUnknownRelation, 1);
});

test('skips a dynamic select argument instead of guessing', () => {
  const src = `await supabase.from("riders").select(buildColumns(opts));`;
  const { findings, stats } = run(src);
  assert.equal(findings.length, 0);
  assert.equal(stats.skippedDynamicSelect, 1);
});

test('skips a template select whose placeholder cannot be resolved', () => {
  const src = 'await supabase.from("riders").select(`id, ${extraColumns}`);';
  const { findings, stats } = run(src);
  assert.equal(findings.length, 0);
  assert.equal(stats.skippedDynamicSelect, 1);
});

test('counts wildcards instead of pretending they were verified', () => {
  const src = `await supabase.from("riders").select("*");`;
  const { findings, stats } = run(src);
  assert.equal(findings.length, 0);
  assert.equal(stats.wildcards, 1);
  assert.equal(stats.selectsVerified, 1);
});

test('ignores mutations that only echo rows back (.insert(...).select())', () => {
  const src = `await supabase.from("riders").insert(payload).select("nonexistent_column");`;
  const { findings, stats } = run(src);
  assert.equal(findings.length, 0);
  assert.equal(stats.selectsSeen, 0);
});

test('ignores .from().update() / .delete() entirely', () => {
  const src = `
    await supabase.from("riders").update({ salary: 1 }).eq("id", id);
    await supabase.from("riders").delete().eq("id", id);`;
  assert.equal(run(src).stats.selectsSeen, 0);
});

// ---------------------------------------------------------------------------
// Comments and strings.
// ---------------------------------------------------------------------------

test('does not trip on a select written inside a comment', () => {
  const src = `// await supabase.from("riders").select("id, ghost_column");
    await supabase.from("riders").select("id");`;
  assert.equal(run(src).findings.length, 0);
});

test('stripCommentsKeepStrings preserves string contents and length', () => {
  const src = `const a = "riders"; // from("teams")\nconst b = 1;`;
  const out = stripCommentsKeepStrings(src);
  assert.equal(out.length, src.length);
  assert.ok(out.includes('"riders"'));
  assert.ok(!out.includes('teams'));
});

// A regex literal containing a quote used to desync the tokeniser: the quote
// opened a phantom string, so every later // comment stopped being blanked.
// Real occurrence: backend/lib/emailTemplates.js does .replace(/"/g, "&quot;").
test('a regex containing a quote does not desync the tokeniser', () => {
  const src = `const esc = (s) => s.replace(/"/g, "&quot;");\n`
    + `// await supabase.from("riders").select("id, ghost_column");\n`
    + `await supabase.from("riders").select("id");`;
  const out = stripCommentsKeepStrings(src);
  assert.equal(out.length, src.length);
  assert.ok(!out.includes('ghost_column'), 'the commented-out select must still be blanked');
  assert.equal(run(src).findings.length, 0);
});

test('a select commented out after a quote-carrying regex is not scanned', () => {
  const src = `const esc = (s) => s.replace(/'/g, "&#39;");\n`
    + `// await supabase.from("riders").select("id, not_a_column");\n`
    + `await supabase.from("riders").select("firstname");`;
  assert.equal(run(src).findings.length, 0);
});

test('division is not mistaken for a regex literal', () => {
  const src = `const share = total / count; const pct = share / 100;\n`
    + `// from("riders").select("ghost")\n`
    + `await supabase.from("riders").select("id");`;
  const out = stripCommentsKeepStrings(src);
  assert.equal(out.length, src.length);
  assert.ok(out.includes('total'), 'code before the division survives');
  assert.ok(out.includes('count'), 'code after the division survives');
  assert.ok(!out.includes('ghost'), 'the comment is still blanked');
  assert.equal(run(src).findings.length, 0);
});

test('a slash inside a regex character class does not close the regex', () => {
  const src = `const seg = path.split(/[/\\\\]/).pop();\n`
    + `await supabase.from("riders").select("id");`;
  const out = stripCommentsKeepStrings(src);
  assert.equal(out.length, src.length);
  assert.equal(run(src).findings.length, 0);
});

test('a real select is still caught on the line after a regex', () => {
  const src = `const esc = (s) => s.replace(/"/g, "&quot;");\n`
    + `await supabase.from("riders").select("id, ghost_column");`;
  const findings = run(src).findings;
  assert.equal(findings.length, 1, 'the guard must not go blind after a regex');
  assert.ok(findings[0].column === 'ghost_column' || JSON.stringify(findings[0]).includes('ghost_column'));
});

// ---------------------------------------------------------------------------
// Escape hatch.
// ---------------------------------------------------------------------------

test('respects a schema-columns-ok comment on the line above', () => {
  const src = `// schema-columns-ok: kolonnen kommer i en migration i naeste PR
    await supabase.from("riders").select("id, not_yet_there");`;
  assert.equal(run(src).findings.length, 0);
});

test('respects a schema-columns-ok comment trailing on the chain', () => {
  const src = `await supabase
      .from("riders")
      .select("id, not_yet_there"); // schema-columns-ok: begrundelse`;
  assert.equal(run(src).findings.length, 0);
});

// ---------------------------------------------------------------------------
// Embedded resources.
// ---------------------------------------------------------------------------

test('validates an embedded resource named directly after the relation', () => {
  const src = `await supabase.from("riders").select("id, rider_derived_abilities(climbing, bogus)");`;
  const { findings } = run(src);
  assert.deepEqual(findings.map((f) => `${f.relation}.${f.column}`), ['rider_derived_abilities.bogus']);
});

test('accepts a correct embedded resource', () => {
  const src = `await supabase.from("riders").select("id, rider_derived_abilities(climbing, sprint)");`;
  assert.equal(run(src).findings.length, 0);
});

test('resolves an aliased foreign-key embed (team:team_id(...)) via the FK map', () => {
  const src = `await supabase.from("riders").select("id, team:team_id(name, ghost)");`;
  const { findings } = run(src);
  assert.deepEqual(findings.map((f) => `${f.relation}.${f.column}`), ['teams.ghost']);
});

test('strips !inner / !left modifiers before resolving the embed', () => {
  const src = `await supabase.from("race_results").select("rank, races!inner(id, ghost)");`;
  const { findings } = run(src);
  assert.deepEqual(findings.map((f) => `${f.relation}.${f.column}`), ['races.ghost']);
});

test('validates nested embeds against the innermost relation', () => {
  const src = `await supabase.from("race_results").select("rank, races!inner(id), team_id");`;
  assert.equal(run(src).findings.length, 0);
});

test('skips (and counts) an embed whose target cannot be resolved exactly', () => {
  const src = `await supabase.from("riders").select("id, mystery_rel(a, b)");`;
  const { findings, stats } = run(src);
  assert.equal(findings.length, 0);
  assert.equal(stats.skippedEmbeds, 1);
});

test('skips a spread embed (...table(col)) rather than guessing', () => {
  const src = `await supabase.from("riders").select("id, ...teams(name)");`;
  const { findings, stats } = run(src);
  assert.equal(findings.length, 0);
  assert.equal(stats.skippedEmbeds, 1);
});

test('resolveEmbedTarget never guesses', () => {
  assert.equal(resolveEmbedTarget('rider_derived_abilities', 'riders', SNAPSHOT), 'rider_derived_abilities');
  assert.equal(resolveEmbedTarget('team:team_id', 'riders', SNAPSHOT), 'teams');
  assert.equal(resolveEmbedTarget('races!inner', 'race_results', SNAPSHOT), 'races');
  assert.equal(resolveEmbedTarget('team:team_id', 'season_standings', SNAPSHOT), null); // no FK in fixture
  assert.equal(resolveEmbedTarget('...teams', 'riders', SNAPSHOT), null);
});

// ---------------------------------------------------------------------------
// Token normalisation (alias / cast / JSON path).
// ---------------------------------------------------------------------------

test('accepts alias, cast and JSON-path decorated columns', () => {
  const src = `await supabase.from("users").select("id, mail:email, consent_preferences->marketing");`;
  assert.equal(run(src).findings.length, 0);
});

test('still flags an unknown column behind an alias', () => {
  const src = `await supabase.from("users").select("mail:no_such_column");`;
  const { findings } = run(src);
  assert.deepEqual(findings.map((f) => f.column), ['no_such_column']);
});

test('normalizeColumnToken strips decoration and rejects non-identifiers', () => {
  assert.equal(normalizeColumnToken(' alias:col '), 'col');
  assert.equal(normalizeColumnToken('col::text'), 'col');
  assert.equal(normalizeColumnToken('col->>key'), 'col');
  assert.equal(normalizeColumnToken('alias:col::int'), 'col');
  assert.equal(normalizeColumnToken('1bad'), null);
  assert.equal(normalizeColumnToken('a b'), null);
});

test('indexOfAliasColon ignores :: casts', () => {
  assert.equal(indexOfAliasColon('col::text'), -1);
  assert.equal(indexOfAliasColon('a:col::text'), 1);
});

test('splitTopLevel keeps embedded lists intact', () => {
  assert.deepEqual(
    splitTopLevel('id, rel(a, b), c').map((s) => s.trim()),
    ['id', 'rel(a, b)', 'c'],
  );
});

// ---------------------------------------------------------------------------
// Constant resolution (#3586 named these explicitly).
// ---------------------------------------------------------------------------

test('resolves a same-file string constant used as the select argument', () => {
  const src = `const BOARD_AUTO_ACCEPT_SELECT = "id, salary, ghost_col";
await supabase.from("riders").select(BOARD_AUTO_ACCEPT_SELECT);`;
  const { findings } = run(src);
  assert.deepEqual(findings.map((f) => f.column), ['ghost_col']);
});

test('resolves an array-of-columns constant joined into a select string', () => {
  const src = `const COLS = ["id", "firstname", "ghost"].join(", ");
await supabase.from("riders").select(COLS);`;
  const { findings } = run(src);
  assert.deepEqual(findings.map((f) => f.column), ['ghost']);
});

test('resolves a template select that interpolates constants and .join()', () => {
  const src = 'const RIDER_SELECT = "id, firstname";\n'
    + 'const ABILITY_KEYS = ["climbing", "ghost_ability"];\n'
    + 'await supabase.from("riders").select(`team_id, ${RIDER_SELECT}, rider_derived_abilities(${ABILITY_KEYS.join(", ")})`);';
  const { findings } = run(src);
  assert.deepEqual(findings.map((f) => `${f.relation}.${f.column}`), ['rider_derived_abilities.ghost_ability']);
});

test('resolves a constant imported from another module via the lookup hook', () => {
  const src = `import { SHARED_SELECT } from "./shared.js";
await supabase.from("riders").select(SHARED_SELECT);`;
  const lookup = (name) => (name === 'SHARED_SELECT' ? { kind: 'string', value: 'id, ghost' } : null);
  const { findings } = run(src, 'backend/x.js', lookup);
  assert.deepEqual(findings.map((f) => f.column), ['ghost']);
});

test('extractConstants only picks up module-level UPPER_SNAKE declarations', () => {
  const code = `const TOP_LEVEL = "a, b";
function f() {
  const TOP_LEVEL = "shadow, values";
  const lowerCase = "c, d";
}`;
  const consts = extractConstants(code);
  assert.deepEqual(consts.get('TOP_LEVEL'), { kind: 'string', value: 'a, b' });
  assert.equal(consts.get('lowerCase'), undefined);
});

test('extractNamedImports maps aliases and ignores bare package specifiers', () => {
  const code = `import { A, B as C } from "./local.js";
import { D } from "some-package";`;
  const map = extractNamedImports(code);
  assert.deepEqual(map.get('A'), { specifier: './local.js', exported: 'A' });
  assert.deepEqual(map.get('C'), { specifier: './local.js', exported: 'B' });
  assert.equal(map.get('D'), undefined);
});

test('evalLiteral refuses anything it cannot evaluate literally', () => {
  assert.deepEqual(evalLiteral('"a" + "b"', () => null), { kind: 'string', value: 'ab' });
  assert.deepEqual(evalLiteral('["a","b"]', () => null), { kind: 'array', value: ['a', 'b'] });
  assert.equal(evalLiteral('cols', () => null), null);
  assert.equal(evalLiteral('makeCols()', () => null), null);
  assert.equal(evalLiteral('"a" + suffix', () => null), null);
});

// ---------------------------------------------------------------------------
// checkSelectList contract.
// ---------------------------------------------------------------------------

test('checkSelectList is case-insensitive on column names', () => {
  const r = checkSelectList('ID, FirstName', 'riders', SNAPSHOT);
  assert.equal(r.unknown.length, 0);
  assert.equal(r.verified, 2);
});

test('checkSelectList validates matview columns like any other relation', () => {
  const r = checkSelectList('season_id, podiums, ghost', 'team_standings_ext_mv', SNAPSHOT);
  assert.deepEqual(r.unknown.map((u) => u.column), ['ghost']);
});

// ---------------------------------------------------------------------------
// File selection.
// ---------------------------------------------------------------------------

test('test files are excluded — fixtures model tables that do not exist', () => {
  assert.equal(isTestFile('backend/lib/foo.test.js'), true);
  assert.equal(isTestFile('backend/lib/foo.test.mjs'), true);
  assert.equal(isTestFile('backend/__tests__/foo.js'), true);
  assert.equal(isTestFile('backend/test-setup.js'), true);
  assert.equal(isTestFile('backend/lib/foo.js'), false);
});

// ---------------------------------------------------------------------------
// Snapshot building.
// ---------------------------------------------------------------------------

test('buildSnapshot turns catalogue rows into the committed shape', () => {
  const snap = buildSnapshot(
    [
      { rel: 'teams', kind: 'table', cols: 'id,name' },
      { rel: 'a_view', kind: 'view', cols: 'x' },
    ],
    [{ src_table: 'riders', src_col: 'team_id', tgt_table: 'teams' }],
    { generatedAt: '2026-08-14T00:00:00.000Z' },
  );
  assert.deepEqual(Object.keys(snap.relations), ['a_view', 'teams']); // sorted
  assert.deepEqual(snap.relations.teams, { kind: 'table', columns: ['id', 'name'] });
  assert.deepEqual(snap.foreignKeys, { 'riders.team_id': 'teams' });
  assert.equal(snap.generatedAt, '2026-08-14T00:00:00.000Z');
});

test('buildSnapshot drops an ambiguous foreign key rather than guessing a target', () => {
  const snap = buildSnapshot(
    [{ rel: 't', kind: 'table', cols: 'id' }],
    [
      { src_table: 'x', src_col: 'ref_id', tgt_table: 'a' },
      { src_table: 'x', src_col: 'ref_id', tgt_table: 'b' },
      { src_table: 'x', src_col: 'ok_id', tgt_table: 'a' },
    ],
  );
  assert.equal(snap.foreignKeys['x.ref_id'], undefined);
  assert.equal(snap.foreignKeys['x.ok_id'], 'a');
});

// ---------------------------------------------------------------------------
// The committed snapshot + allow-list.
// ---------------------------------------------------------------------------

test('the committed snapshot has the shape the guard expects', () => {
  const snap = JSON.parse(readFileSync('database/schema-snapshot.json', 'utf8'));
  assert.ok(Object.keys(snap.relations).length > 100, 'expected a full-schema snapshot');
  for (const [name, rel] of Object.entries(snap.relations)) {
    assert.ok(Array.isArray(rel.columns) && rel.columns.length > 0, `${name} has no columns`);
    assert.ok(['table', 'view', 'matview', 'foreign'].includes(rel.kind), `${name} has kind ${rel.kind}`);
  }
  for (const [key, target] of Object.entries(snap.foreignKeys)) {
    assert.ok(key.includes('.'), `foreign key ${key} is not table.column`);
    assert.ok(snap.relations[target], `foreign key ${key} points at unknown relation ${target}`);
  }
});

test('the committed snapshot still lacks the two columns the guard was built for', () => {
  const snap = JSON.parse(readFileSync('database/schema-snapshot.json', 'utf8'));
  assert.equal(snap.relations.season_standings.columns.includes('prize_money'), false);
  assert.equal(snap.relations.race_results.columns.includes('created_at'), false);
  assert.equal(snap.relations.riders.columns.includes('name'), false);
});

test('every allow-listed finding carries a reason', () => {
  for (const [key, reason] of Object.entries(KNOWN_FINDINGS)) {
    assert.match(key, /^[^:]+:[a-z_0-9]+\.[a-z_0-9]+$/, `allow-list key ${key} is not file:relation.column`);
    assert.ok(typeof reason === 'string' && reason.length > 40, `allow-list entry ${key} needs a real reason`);
  }
});
