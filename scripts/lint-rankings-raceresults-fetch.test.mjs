// scripts/lint-rankings-raceresults-fetch.test.mjs
// Tests for the rangliste race_results-fetch forward-guard (#2196 Del 2).
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, stripCommentsKeepStrings, DEFAULT_TARGETS } from './lint-rankings-raceresults-fetch.mjs';

test('flags a direct .from("race_results") fetch', () => {
  const src = `const { data } = await supabase
    .from("race_results").select("*").eq("season_id", id);`;
  const f = scan(src, 'x.js');
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 2);
});

test('flags single-quote and template-quote variants', () => {
  assert.equal(scan(`supabase.from('race_results').select('*')`, 'x.js').length, 1);
  assert.equal(scan('supabase.from(`race_results`).select(`*`)', 'x.js').length, 1);
});

test('flags .from( with whitespace before the quote', () => {
  assert.equal(scan('supabase.from(  "race_results" )', 'x.js').length, 1);
});

test('does NOT flag a realtime subscription array listing race_results', () => {
  // Ferskheds-signal, ikke en fetch — intet `.from(` foran strengen.
  const src = 'const REALTIME_TABLES = ["season_standings", "race_results"];';
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag matview queries (the correct post-Del-1 pattern)', () => {
  const src = `supabase.from("rider_rankings_mv").select("*").eq("season_id", id);
    supabase.from("team_standings_ext_mv").select("*");`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag race_results mentioned in a line comment', () => {
  const src = '// den gamle .from("race_results")-fetch er væk efter #2175';
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag race_results in a block comment', () => {
  const src = '/*\n  legacy: supabase.from("race_results").select("*")\n*/\nconst ok = 1;';
  assert.equal(scan(src, 'x.js').length, 0);
});

test('honours the rankings-raceresults-ok opt-out on the same line', () => {
  const src = 'supabase.from("race_results").select("id"); // rankings-raceresults-ok: bevidst let count';
  assert.equal(scan(src, 'x.js').length, 0);
});

test('honours the opt-out on the line above', () => {
  const src = '// rankings-raceresults-ok: bevidst\nsupabase.from("race_results").select("id");';
  assert.equal(scan(src, 'x.js').length, 0);
});

test('reports multiple findings across one file', () => {
  const src = `supabase.from("race_results").select("a");
supabase.from("race_results").select("b");`;
  assert.equal(scan(src, 'x.js').length, 2);
});

test('stripCommentsKeepStrings preserves length, newlines, and string content', () => {
  const src = 'a // c\n"race_results"\n`t`';
  const out = stripCommentsKeepStrings(src);
  assert.equal(out.length, src.length);
  assert.equal(out.split('\n').length, src.split('\n').length);
  // strengen bevares (til forskel fra postgrest-cap-guarden der blanker strings)
  assert.ok(out.includes('"race_results"'));
});

test('the real rangliste data-paths are clean today (no race_results fetch)', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of DEFAULT_TARGETS) {
    const src = readFileSync(f, 'utf8');
    assert.equal(scan(src, f).length, 0, `${f} bør ikke fetche race_results`);
  }
});
