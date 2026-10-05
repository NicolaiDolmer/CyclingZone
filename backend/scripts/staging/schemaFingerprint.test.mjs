import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parse, summarize, compare, runCli } from './schemaFingerprint.mjs';

const md5 = s => createHash('md5').update(s).digest('hex');
const FULL = [
  '[staging-env] branch=x ref=y (log-linje ignoreres)',
  'table|riders|aaa',
  'table|races|bbb',
  'function|f(a int)|ccc',
  'backup_table|backup_1|-',
].join('\n');

test('summarize sorterer bytevist og hasher pr. kind som SQL-resuméet', () => {
  const s = summarize(['table|riders|aaa', 'table|races|bbb']);
  assert.deepEqual(s.get('table'), { count: 2, md5: md5('table|races|bbb\ntable|riders|aaa') });
});

test('parse genkender resumé-format og fuld liste', () => {
  const full = parse(FULL);
  assert.equal(full.full.length, 4);
  const summaryText = [...full.summary].map(([k, v]) => `${k} ${v.count} ${v.md5}`).join('\n');
  const summary = parse(summaryText);
  assert.equal(summary.full, null);
  assert.deepEqual([...summary.summary], [...full.summary]);
});

test('compare: identisk app-schema trods forskellige backup-tabeller', () => {
  const a = parse(FULL);
  const b = parse(`${FULL}\nbackup_table|backup_2|-`);
  const r = compare(a, b);
  assert.equal(r.identical, true);
  assert.deepEqual(r.backupTables, { a: 1, b: 2 });
});

test('compare: afvigende definition og manglende objekt rapporteres med objekt-diff', () => {
  const a = parse(FULL);
  const b = parse(FULL.replace('table|races|bbb', 'table|races|zzz').replace('function|f(a int)|ccc\n', ''));
  const r = compare(a, b);
  assert.equal(r.identical, false);
  assert.deepEqual(r.mismatched.map(m => m.kind), ['function', 'table']);
  assert.deepEqual(r.objectDiff.onlyA, ['table|races|bbb', 'function|f(a int)|ccc']);
  assert.deepEqual(r.objectDiff.onlyB, ['table|races|zzz']);
});

test('compare: kind der kun findes paa den ene side er en afvigelse', () => {
  const r = compare(parse('table|t|a'), parse('table|t|a\nview|v|b'));
  assert.equal(r.identical, false);
  assert.deepEqual(r.mismatched, [{ kind: 'view', a: 0, b: 1 }]);
});

test('parse: prods resumé som én ;-separeret celle', () => {
  const full = parse(FULL);
  const oneCell = [...full.summary].map(([k, v]) => `${k} ${v.count} ${v.md5}`).join(';');
  assert.deepEqual([...parse(oneCell).summary], [...full.summary]);
});

test('tomt eller ugenkendt input er en fejl, aldrig "identical" (exit 2)', () => {
  assert.throws(() => parse(''), /FINGERPRINT_INPUT_EMPTY_OR_UNRECOGNISED/);
  assert.throws(() => parse('noget helt andet'), /FINGERPRINT_INPUT_EMPTY_OR_UNRECOGNISED/);
  const out = [];
  assert.equal(runCli(['compare', 'a', 'b'], { read: () => '', write: s => out.push(s) }), 2);
  assert.match(out.join(''), /"identical":false/);
});

test('runCli: exit-koder 0/1/2', () => {
  const files = { a: FULL, b: FULL, c: 'table|t|x' };
  const out = [];
  const io = { read: p => files[p], write: s => out.push(s) };
  assert.equal(runCli(['compare', 'a', 'b'], io), 0);
  assert.equal(runCli(['compare', 'a', 'c'], io), 1);
  assert.equal(runCli(['nope'], io), 2);
  assert.equal(runCli(['summary', 'a'], io), 0);
});
