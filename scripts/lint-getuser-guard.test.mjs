// scripts/lint-getuser-guard.test.mjs
// Tests for the getUser()→null-deref forward-guard. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, stripCommentsAndStrings } from './lint-getuser-guard.mjs';

test('flags raw getUser() deref with NO guard', () => {
  const src = `const { data: { user } } = await supabase.auth.getUser();
const team = await load(user.id);`;
  const f = scan(src, 'x.jsx');
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 2);
});

test('does NOT flag the canonical #1792 guarded shape', () => {
  const src = `const { data: { user } } = await supabase.auth.getUser();
if (!user) { return; }
const team = await load(user.id);`;
  assert.equal(scan(src, 'x.jsx').length, 0);
});

test('does NOT flag the Promise.all destructure shape (DashboardPage)', () => {
  const src = `const [{ data: { user } }, { data: { session } }] = await Promise.all([
  supabase.auth.getUser(),
  supabase.auth.getSession(),
]);
if (!user) { return; }
const x = user.id;`;
  assert.equal(scan(src, 'x.jsx').length, 0);
});

test('does NOT flag when only optional-chaining is used', () => {
  const src = `const { data: { user } } = await supabase.auth.getUser();
const id = user?.id ?? null;`;
  assert.equal(scan(src, 'x.jsx').length, 0);
});

test('flags the helper form const user = await getAuthedUser() with no guard', () => {
  const src = `const user = await getAuthedUser();
doThing(user.id);`;
  const f = scan(src, 'x.jsx');
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 2);
});

test('does NOT flag the helper form when guarded', () => {
  const src = `const user = await getAuthedUser();
if (!user) return;
doThing(user.id);`;
  assert.equal(scan(src, 'x.jsx').length, 0);
});

test('does NOT flag the helper definition itself (return user ?? null)', () => {
  const src = `export async function getAuthedUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user ?? null;
}`;
  assert.equal(scan(src, 'getAuthedUser.js').length, 0);
});

test('honours a renamed destructure { data: { user: u } }', () => {
  const bad = `const { data: { user: u } } = await supabase.auth.getUser();
sink(u.id);`;
  assert.equal(scan(bad, 'x.jsx').length, 1);
  const ok = `const { data: { user: u } } = await supabase.auth.getUser();
if (!u) return;
sink(u.id);`;
  assert.equal(scan(ok, 'x.jsx').length, 0);
});

test('does NOT flag a deref inside a comment or string', () => {
  const src = `const { data: { user } } = await supabase.auth.getUser();
// stop før user.id når sessionen er udløbet
if (!user) { return; }
const s = "user.id placeholder";`;
  assert.equal(scan(src, 'x.jsx').length, 0);
});

test('respects the getuser-guard-ok opt-out', () => {
  const src = `const { data: { user } } = await supabase.auth.getUser(); // getuser-guard-ok intentional
const x = user.id;`;
  assert.equal(scan(src, 'x.jsx').length, 0);
});

test('stripCommentsAndStrings preserves line count', () => {
  const src = 'a\n// b\nc\n/* d\ne */\nf';
  assert.equal(stripCommentsAndStrings(src).split('\n').length, src.split('\n').length);
});
