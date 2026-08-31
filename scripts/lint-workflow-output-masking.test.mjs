// scripts/lint-workflow-output-masking.test.mjs
// Tests for workflow-output-vagten (#4463).
//
// Den vigtigste test i filen er "ville have fanget 30/8": den koerer vagten mod
// den PRAECISE step-form nat-vagten havde da den gik groen uden at maale noget,
// og bekraefter at den flages. En forward-guard der ikke beviseligt fanger
// haendelsen den blev foedt af, er en paastand - ikke en vagt.

import test from 'node:test';
import assert from 'node:assert/strict';
import { scanWorkflow, splitSteps, defaultFiles } from './lint-workflow-output-masking.mjs';
import { readFileSync } from 'node:fs';

// ------------------------------------------------------------ selve fejlklassen

test('ville have fanget 30/8: tee uden pipefail i et step der skriver GITHUB_OUTPUT', () => {
  const yml = [
    'jobs:',
    '  audit:',
    '    steps:',
    '      - name: Calendar invariants against prod',
    '        id: invariants',
    '        run: |',
    '          node backend/scripts/verify-invariants.js --json > invariants.json || true',
    "          node --input-type=module - <<'NODE' | tee invariants.txt",
    '            appendFileSync(process.env.GITHUB_OUTPUT, `kalender_brud=${n}\\n`);',
    '          NODE',
  ].join('\n');
  const found = scanWorkflow(yml, 'fixture.yml');
  assert.equal(found.length, 1);
  assert.match(found[0].step, /Calendar invariants against prod/);
  assert.match(found[0].message, /tee/);
});

test('samme step MED set -o pipefail er intet fund', () => {
  const yml = [
    '      - name: Audit',
    '        shell: bash',
    '        run: |',
    '          set -o pipefail',
    '          node audit.js | tee audit.txt',
    '          echo "total=1" >> "$GITHUB_OUTPUT"',
  ].join('\n');
  assert.deepEqual(scanWorkflow(yml, 'fixture.yml'), []);
});

test('set -euo pipefail taeller ogsaa', () => {
  const yml = [
    '      - name: Audit',
    '        run: |',
    '          set -euo pipefail',
    '          node audit.js | wc -l',
    '          echo "total=1" >> "$GITHUB_OUTPUT"',
  ].join('\n');
  assert.deepEqual(scanWorkflow(yml, 'fixture.yml'), []);
});

test('shell: bash -o pipefail {0} daekker hele steppet', () => {
  const yml = [
    '      - name: Audit',
    '        shell: bash -o pipefail {0}',
    '        run: |',
    '          node audit.js | tee audit.txt',
    '          echo "total=1" >> "$GITHUB_OUTPUT"',
  ].join('\n');
  assert.deepEqual(scanWorkflow(yml, 'fixture.yml'), []);
});

// ------------------------------------------------------------- afgraensninger

test('en pipe UDEN GITHUB_OUTPUT i samme step er intet fund', () => {
  const yml = [
    '      - name: Rapport',
    '        run: |',
    '          node audit.js | tee audit.txt',
  ].join('\n');
  assert.deepEqual(scanWorkflow(yml, 'fixture.yml'), []);
});

test('GITHUB_OUTPUT uden pipe er intet fund', () => {
  const yml = [
    '      - name: Tael',
    '        run: |',
    '          echo "total=$(node audit.js --count)" >> "$GITHUB_OUTPUT"',
  ].join('\n');
  assert.deepEqual(scanWorkflow(yml, 'fixture.yml'), []);
});

test('et nabostep uden pipefail smitter ikke af paa et step der har den', () => {
  const yml = [
    '      - name: Ren',
    '        run: |',
    '          set -o pipefail',
    '          node a.js | tee a.txt',
    '          echo "a=1" >> "$GITHUB_OUTPUT"',
    '      - name: Maskeret',
    '        run: |',
    '          node b.js | tee b.txt',
    '          echo "b=1" >> "$GITHUB_OUTPUT"',
  ].join('\n');
  const found = scanWorkflow(yml, 'fixture.yml');
  assert.equal(found.length, 1);
  assert.match(found[0].step, /Maskeret/);
});

test('splitSteps deler paa listepunkter og bevarer linjenummeret', () => {
  const yml = ['jobs:', '  a:', '    steps:', '      - name: Et', '        run: x', '      - name: To', '        run: y'].join('\n');
  const steps = splitSteps(yml);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].name, 'Et');
  assert.equal(steps[0].line, 4);
  assert.equal(steps[1].name, 'To');
});

// -------------------------------------------------------------- repoet selv

test('alle workflows i repoet er fri for fejlklassen', () => {
  const findings = defaultFiles().flatMap((f) => scanWorkflow(readFileSync(f, 'utf8'), f));
  assert.deepEqual(
    findings.map((f) => `${f.file}:${f.line} ${f.step}`), [],
    'et nyt step maskerer sin maalings exit-kode - se #4463'
  );
});
