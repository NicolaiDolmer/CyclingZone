import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeWorkflow,
  checkDirectory,
  classifyCancel,
  KNOWN_EXCEPTIONS,
} from './check-workflow-concurrency.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = path.join(here, '..', '.github', 'workflows');

const SAFE_BLOCK = [
  'concurrency:',
  "  group: ${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.event.pull_request.number || github.run_id }}",
  "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
].join('\n');

const JOBS = 'jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n';

function rules(text, file = 'x.yml') {
  return analyzeWorkflow(file, text).findings.map((f) => f.rule);
}

test('alle workflows i repoet overholder concurrency-reglerne (#7582)', () => {
  const { errors } = checkDirectory(WORKFLOWS);
  assert.deepEqual(errors, []);
});

test('undtagelser har en begrundelse', () => {
  for (const [file, ex] of Object.entries(KNOWN_EXCEPTIONS)) {
    assert.ok(ex.reason && ex.reason.length > 10, `${file} mangler begrundelse`);
    assert.ok(ex.rules.length > 0, `${file} mangler regler`);
  }
});

test('review-gate.yml er undtaget fra reglerne (røres ikke, #7582)', () => {
  const text = fs.readFileSync(path.join(WORKFLOWS, 'review-gate.yml'), 'utf8');
  assert.deepEqual(rules(text, 'review-gate.yml'), []);
  // Samme indhold under et andet navn ville give fund: undtagelsen er navnebundet.
  assert.notDeepEqual(rules(text, 'andet-navn.yml'), []);
});

test('classifyCancel', () => {
  assert.equal(classifyCancel(undefined), 'never');
  assert.equal(classifyCancel(false), 'never');
  assert.equal(classifyCancel('false'), 'never');
  assert.equal(classifyCancel(true), 'always');
  assert.equal(classifyCancel("${{ github.event_name == 'pull_request' }}"), 'pr-only');
  assert.equal(classifyCancel('${{github.event_name=="pull_request"}}'), 'pr-only');
  assert.equal(classifyCancel("${{ github.event_name != 'push' }}"), 'always');
  assert.equal(classifyCancel("${{ github.ref != 'refs/heads/main' }}"), 'always');
});

test('pull_request-workflow uden concurrency fejler', () => {
  assert.deepEqual(rules(`on:\n  pull_request:\n${JOBS}`), ['pr-cancel-missing']);
});

test('pull_request-workflow med cancel-in-progress: false fejler', () => {
  const text = `on:\n  pull_request:\nconcurrency:\n  group: g-\${{ github.ref }}\n  cancel-in-progress: false\n${JOBS}`;
  assert.deepEqual(rules(text), ['pr-cancel-missing']);
});

test('sikker blok består for PR + push + schedule + dispatch + merge_group', () => {
  const text = `on:\n  pull_request:\n  push:\n    branches: [main]\n  schedule:\n    - cron: '0 3 * * 1'\n  workflow_dispatch:\n  merge_group:\n${SAFE_BLOCK}\n${JOBS}`;
  assert.deepEqual(rules(text), []);
});

test('cancel-in-progress: true på et workflow med push fejler', () => {
  const text = `on:\n  pull_request:\n  push:\n    branches: [main]\nconcurrency:\n  group: g-\${{ github.sha }}\n  cancel-in-progress: true\n${JOBS}`;
  assert.deepEqual(rules(text), ['non-pr-cancel']);
});

test('cancel-in-progress: true på et workflow med schedule fejler', () => {
  const text = `on:\n  schedule:\n    - cron: '0 3 * * 1'\nconcurrency:\n  group: fast\n  cancel-in-progress: true\n${JOBS}`;
  assert.deepEqual(rules(text), ['non-pr-cancel']);
});

test('job-level cancel der kan ramme push fejler', () => {
  const text = `on:\n  pull_request:\n  push:\n${SAFE_BLOCK}\njobs:\n  a:\n    runs-on: ubuntu-latest\n    concurrency:\n      group: j-\${{ github.run_id }}\n      cancel-in-progress: true\n    steps:\n      - run: echo hi\n`;
  assert.deepEqual(rules(text), ['non-pr-cancel']);
});

test('ukendt cancel-udtryk på push-workflow fejler', () => {
  const text = `on:\n  pull_request:\n  push:\nconcurrency:\n  group: g-\${{ github.sha }}\n  cancel-in-progress: \${{ github.ref != 'refs/heads/main' }}\n${JOBS}`;
  assert.deepEqual(rules(text), ['non-pr-cancel']);
});

test('push-workflow med gruppe pr. github.ref fejler (ventende main-kørsel kan erstattes)', () => {
  const text = `on:\n  pull_request:\n  push:\n    branches: [main]\nconcurrency:\n  group: g-\${{ github.ref }}\n  cancel-in-progress: \${{ github.event_name == 'pull_request' }}\n${JOBS}`;
  assert.deepEqual(rules(text), ['non-pr-group-shared']);
});

test('merge_group-workflow med fast gruppe fejler, også uden cancel', () => {
  const text = `on:\n  merge_group:\nconcurrency:\n  group: fast\n  cancel-in-progress: false\n${JOBS}`;
  assert.deepEqual(rules(text), ['non-pr-group-shared']);
});

test('push-workflow med gruppe pr. SHA består', () => {
  const text = `on:\n  pull_request:\n  push:\nconcurrency:\n  group: \${{ github.workflow }}-\${{ github.event_name == 'pull_request' && github.head_ref || github.sha }}\n  cancel-in-progress: \${{ github.event_name == 'pull_request' }}\n${JOBS}`;
  assert.deepEqual(rules(text), []);
});

test('schedule-only workflow må serialisere med fast gruppe uden cancel', () => {
  const text = `on:\n  schedule:\n    - cron: '0 3 * * 1'\n  workflow_dispatch:\nconcurrency:\n  group: fast\n  cancel-in-progress: false\n${JOBS}`;
  assert.deepEqual(rules(text), []);
});

test('ren PR-workflow må bruge cancel-in-progress: true', () => {
  const text = `on:\n  pull_request:\n    types: [opened, synchronize]\nconcurrency:\n  group: g-\${{ github.event.pull_request.number }}\n  cancel-in-progress: true\n${JOBS}`;
  assert.deepEqual(rules(text), []);
});

test('PR-gruppe uden PR-afgrænsning fejler', () => {
  const text = `on:\n  pull_request:\nconcurrency:\n  group: fast-gruppe\n  cancel-in-progress: true\n${JOBS}`;
  assert.deepEqual(rules(text), ['pr-group-not-scoped']);
});

test('workflow uden pull_request (fx kun issue_comment) kræver ingen concurrency', () => {
  assert.deepEqual(rules(`on:\n  issue_comment:\n    types: [created]\n  pull_request_review:\n${JOBS}`), []);
});

test('on som liste og streng genkendes', () => {
  assert.deepEqual(rules(`on: [pull_request, push]\n${JOBS}`), ['pr-cancel-missing']);
  assert.deepEqual(rules(`on: pull_request\n${JOBS}`), ['pr-cancel-missing']);
});

test('forældet undtagelse fejler (listen kan kun skrumpe)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-conc-'));
  try {
    fs.writeFileSync(path.join(dir, 'ok.yml'), `on:\n  pull_request:\n${SAFE_BLOCK}\n${JOBS}`);
    const { errors } = checkDirectory(dir, { 'ok.yml': { rules: ['pr-cancel-missing'], reason: 'test-undtagelse' } });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /ikke længere nødvendig/);
    const missing = checkDirectory(dir, { 'findes-ikke.yml': { rules: ['pr-cancel-missing'], reason: 'test-undtagelse' } });
    assert.match(missing.errors.join('\n'), /ikke findes/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
