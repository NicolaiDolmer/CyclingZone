import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryFindings, missingPrMetadata } from './check-pr-delivery.mjs';

const findings = (input) => deliveryFindings({ files: [], title: '', body: '', migrations: [], ...input });

test('multiple Refs must be comma-separated on each Refs line', () => {
  assert.match(findings({ body: 'Refs #10 #11' })[0], /komma/);
  assert.deepEqual(findings({ body: 'Refs: #10, #11\n\nRefs #30' }), []);
});

test('a fix needs its own production-effect heading and populated before and after', () => {
  assert.match(findings({ title: 'fix(core): check later', body: 'Før: A\nEfter: B' })[0], /Fejlens effekt i prod/);
  assert.match(findings({ title: 'fix: outage', body: '## Fejlens effekt i prod\nFør: Timeout\n## Test\nEfter: OK' })[0], /Før og Efter/);
  assert.deepEqual(findings({ title: 'fix: outage', body: '## Fejlens effekt i prod\n- **Før:** Timeout\n- **Efter:** Svar' }), []);
});

test('UI source needs a linked before/after image, while UI tests alone do not', () => {
  const files = ['frontend/src/components/TrainingPanel.tsx'];
  assert.match(findings({ files, body: 'Før/efter er set' })[0], /før\/efter-billede/);
  assert.deepEqual(findings({ files, body: '[Før/efter](pr-screens/training.png)' }), []);
  assert.deepEqual(findings({ files: ['frontend/src/components/TrainingPanel.test.tsx'] }), []);
});

test('migration SQL rejects dotted settings, preserving ordinary SET and comments', () => {
  const path = 'supabase/migrations/20261126_test.sql';
  assert.match(findings({ migrations: [{ path, sql: "SET LOCAL cz.foo = 'on';" }] })[0], /cz\.foo/);
  assert.match(findings({ migrations: [{ path, sql: "CREATE FUNCTION test() RETURNS void LANGUAGE plpgsql SET \"cz.foo\" TO 'on' AS $$ BEGIN END; $$;" }] })[0], /cz\.foo/);
  assert.deepEqual(findings({ migrations: [{ path, sql: "SET search_path = public;\n-- SET cz.fake = 'on';\n/* SET cz.ignore TO on; */" }] }), []);
});

test('unknown PR type or body fails changed branches, while a clean checkout can run offline', () => {
  const files = ['backend/lib/training.js'];
  assert.match(missingPrMetadata({ files, title: '', bodyKnown: false }), /PrTitle og -PrBodyFile/);
  assert.match(missingPrMetadata({ files, title: 'fix: tests', bodyKnown: false }), /PrBodyFile/);
  assert.equal(missingPrMetadata({ files, title: 'fix: tests', bodyKnown: true }), null);
  assert.equal(missingPrMetadata({ files: [], title: '', bodyKnown: false }), null);
});
