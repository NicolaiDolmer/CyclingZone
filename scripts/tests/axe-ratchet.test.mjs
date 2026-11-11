import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprints, compareFindings, reduceBaseline, assertNoGrowth, CASE_KEYS } from '../lib/axe-ratchet.mjs';
const known = fingerprints([{ id: 'button-name', nodes: [{ target: ['#save'] }] }]);
const baseline = () => ({ schemaVersion: 1, engineVersion: 'test', cases: Object.fromEntries(CASE_KEYS.map(key => [key, { ...known }])) });
const reports = () => CASE_KEYS.map(key => ({ key, revision: 'test', runId: 'test-run', inputHash: 'test-inputs', engineVersion: 'test', findings: { ...known } }));
test('new rules, targets and additional occurrences fail; same known node passes', () => {
  assert.deepEqual(compareFindings(known, known), { added: [], removed: [] });
  for (const violations of [
    [{ id: 'image-alt', nodes: [{ target: ['#save'] }] }],
    [{ id: 'button-name', nodes: [{ target: ['#other'] }] }],
    [{ id: 'button-name', nodes: [{ target: ['#save'] }, { target: ['#save'] }] }],
  ]) assert.ok(compareFindings(known, fingerprints(violations)).added.length);
});
test('complete scan removes repaired debt and rejects its return', () => {
  const before = baseline(); const scans = reports(); scans[0].findings = {};
  const after = reduceBaseline(before, scans);
  assert.deepEqual(after.cases[CASE_KEYS[0]], {});
  assert.ok(compareFindings(after.cases[CASE_KEYS[0]], known).added.length);
  assertNoGrowth(before, after);
  assert.throws(() => assertNoGrowth(after, before), /growth/);
});
test('incomplete, duplicate and wrong-version scans fail closed', () => {
  assert.throws(() => reduceBaseline(baseline(), reports().slice(1)), /matrix/);
  assert.throws(() => reduceBaseline(baseline(), [...reports(), reports()[0]]), /duplicate/);
  const wrong = reports(); wrong[0].engineVersion = 'other';
  assert.throws(() => reduceBaseline(baseline(), wrong), /version/);
});
test('normal updater cannot accept new debt', () => {
  const scans = reports(); scans[0].findings = fingerprints([{ id: 'new-rule', nodes: [{ target: ['body'] }] }]);
  assert.throws(() => reduceBaseline(baseline(), scans), /new findings/);
});
test('malformed counts and missing baseline cases fail closed', () => {
  const broken = baseline(); delete broken.cases[CASE_KEYS[0]];
  assert.throws(() => reduceBaseline(broken, reports()), /matrix/);
  assert.throws(() => compareFindings({ bad: -1 }, {}), /count/);
});
test('same-HEAD reports from mixed runs or inputs cannot reduce debt', () => {
  for (const field of ['runId', 'inputHash', 'revision']) {
    const scans = reports(); scans[0][field] = 'different';
    assert.throws(() => reduceBaseline(baseline(), scans), /Mixed/);
  }
});
