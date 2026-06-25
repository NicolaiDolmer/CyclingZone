// scripts/lint-postgrest-in-cap.test.mjs
// Tests for the PostgREST 1000-row-cap forward-guard. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, stripCommentsAndStrings } from './lint-postgrest-in-cap.mjs';

test('flags the canonical .in("col", ids.slice(0, 1000)) shape', () => {
  const src = `const { data } = await supabase
    .from("race_stage_profiles").select("race_id").in("race_id", raceIds.slice(0, 1000));`;
  const f = scan(src, 'x.js');
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 2);
});

test('flags non-1000 caps too — any fixed slice truncates the id-list', () => {
  assert.equal(scan('q.in("id", ids.slice(0, 500))', 'x.js').length, 1);
  assert.equal(scan('q.in("id", ids.slice(0,300))', 'x.js').length, 1);
});

test('does NOT flag the pattern inside a line comment', () => {
  const src = '// Det gamle `.in(race_ids.slice(0,1000))` ramte 1000-grænsen';
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag the pattern inside a block comment', () => {
  const src = '/*\n  legacy: .in("id", ids.slice(0, 1000))\n*/\nconst ok = 1;';
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag the pattern inside a string literal', () => {
  assert.equal(scan('const s = ".in(x.slice(0, 1000))";', 'x.js').length, 0);
  assert.equal(scan('const s = `q.in("id", ids.slice(0, 1000))`;', 'x.js').length, 0);
});

test('does NOT flag range-pagination / id-chunk helpers', () => {
  const src = `const chunk = raceIds.slice(i, i + ID_CHUNK);
    await supabase.from("t").select("*").in("race_id", chunk).range(from, from + PAGE - 1);`;
  assert.equal(scan(src, 'x.js').length, 0);
});

test('does NOT flag .slice(0, N) that is not an .in() argument', () => {
  assert.equal(scan('const top = riders.slice(0, 1000);', 'x.js').length, 0);
});

test('honours the postgrest-cap-ok opt-out on the same line', () => {
  const src = 'q.in("id", ids.slice(0, 5)); // postgrest-cap-ok: kun top-5 vises bevidst';
  assert.equal(scan(src, 'x.js').length, 0);
});

test('honours the postgrest-cap-ok opt-out on the line above', () => {
  const src = '// postgrest-cap-ok: bevidst top-N\nq.in("id", ids.slice(0, 5));';
  assert.equal(scan(src, 'x.js').length, 0);
});

test('handles a nested paren inside the .in() args (balanced scan)', () => {
  const src = 'q.in("id", ids.filter((x) => x).slice(0, 1000));';
  assert.equal(scan(src, 'x.js').length, 1);
});

test('reports multiple findings across one file', () => {
  const src = `a.in("id", a.slice(0, 1000));
b.in("id", b.slice(0, 1000));`;
  assert.equal(scan(src, 'x.js').length, 2);
});

test('stripCommentsAndStrings preserves length and newlines', () => {
  const src = 'a // c\n"str"\n`t`';
  const out = stripCommentsAndStrings(src);
  assert.equal(out.length, src.length);
  assert.equal(out.split('\n').length, src.split('\n').length);
});
