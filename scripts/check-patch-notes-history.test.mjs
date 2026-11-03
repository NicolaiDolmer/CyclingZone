import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHistory } from './check-patch-notes-history.mjs';

const entry = (version, title = 'A ring of riders') => ({ version, date: '2026-10-01', changes: [{ en: { title, body: 'History' } }] });
const source = entries => `export const PATCHES = ${JSON.stringify(entries)};`;
test('published prose cannot be rewritten by a class codemod', () => {
  assert.match(checkHistory(source([entry('1.0')]), source([entry('1.0', 'A ring-3 of riders')])).join(), /1\.0/);
});
test('new versions may only be prepended; formatting and object key order are harmless', () => {
  const old = entry('1.0');
  assert.deepEqual(checkHistory(source([old]), source([entry('1.1'), old])), []);
  assert.deepEqual(checkHistory(source([old]), source([{ changes: old.changes, date: old.date, version: old.version }])), []);
  assert.ok(checkHistory(source([old]), source([old, entry('1.1')])).length);
});
test('deletion, reordering and duplicate versions fail', () => {
  const base = [entry('1.1'), entry('1.0')];
  for (const entries of [[], [base[1], base[0]], [base[0], base[0], base[1]]]) {
    assert.ok(checkHistory(source(base), source(entries)).length);
  }
});
test('corrections require a standalone version-specific audit marker and reason', () => {
  const before = source([entry('1.0')]);
  const after = source([entry('1.0', 'Correction')]);
  assert.deepEqual(checkHistory(before, after, '[patch-history-correction:1.0] Reason: issue #123 approved correction'), []);
  for (const message of ['', 'quoted [patch-history-correction:1.0] Reason: issue #123', '[patch-history-correction:1.1] Reason: issue #123', '[patch-history-correction:1.0]']) {
    assert.ok(checkHistory(before, after, message).length);
  }
  assert.ok(checkHistory(before, source([]), '[patch-history-correction:1.0] Reason: issue #123').length);
});
test('never execute patch note source; malformed/dynamic data fails closed', () => {
  assert.throws(() => checkHistory(source([entry('1.0')]), 'export const PATCHES = getNotes();'));
  assert.throws(() => checkHistory('broken syntax !', source([])));
});

test('executable mutations and alternate exports cannot evade static history', () => {
  const before = source([entry('1.0')]);
  for (const tail of [
    'PATCHES[0].changes[0].en.body="Changed";',
    'PATCHES.push({version:"2.0"});',
    'export default [];',
    'export { PATCHES as default };',
    'export const other = [];',
  ]) assert.throws(() => checkHistory(before, before + tail), /static|literal|PATCHES/);
});
