import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeWorkflow,
  checkDirectory,
  DRAFT_ALLOWED,
  EXEMPT_FILES,
  excludesPullRequest,
} from './check-workflow-draft-skip.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = path.join(here, '..', '.github', 'workflows');

const rules = (text, file = 'x.yml') => analyzeWorkflow(file, text).findings.map((f) => `${f.rule}:${f.detail}`);
const wf = (on, jobs) => `on:\n${on}\njobs:\n${jobs}`;
const READY = '  pull_request:\n    types: [opened, synchronize, reopened, ready_for_review]';
const job = (name, extra = '') => `  ${name}:\n${extra}    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
const GUARD = '    if: ${{ !github.event.pull_request.draft }}\n';

test('alle workflows i repoet springer tunge jobs over paa kladder (#8802)', () => {
  const { errors } = checkDirectory(WORKFLOWS);
  assert.deepEqual(errors, []);
});

test('undtagelser og tilladte kladde-jobs har en begrundelse', () => {
  for (const [key, reason] of [...EXEMPT_FILES, ...Object.entries(DRAFT_ALLOWED)]) {
    assert.ok(reason.length > 20, `${key} mangler begrundelse`);
  }
});

test('default types (synchronize uden ready_for_review) er et fund', () => {
  assert.deepEqual(rules(wf('  pull_request:', job('a', GUARD))), ['ready-missing:pull_request.types mangler ready_for_review']);
});

test('et job uden kladde-skip er et fund; med skip er det rent', () => {
  assert.deepEqual(rules(wf(READY, job('a'))), ["draft-unguarded:job 'a' kan koere paa en kladde-PR"]);
  assert.deepEqual(rules(wf(READY, job('a', GUARD))), []);
  assert.deepEqual(rules(wf(READY, job('a', "    if: github.event_name != 'pull_request' || github.event.pull_request.draft == false\n"))), []);
});

test('et job arver skip via needs, men ikke med always()/!cancelled()', () => {
  const base = job('a', GUARD);
  assert.deepEqual(rules(wf(READY, base + job('b', '    needs: a\n'))), []);
  assert.deepEqual(rules(wf(READY, base + job('b', '    needs: a\n    if: always()\n'))), ["draft-unguarded:job 'b' kan koere paa en kladde-PR"]);
  assert.deepEqual(rules(wf(READY, base + job('b', "    needs: a\n    if: ${{ !cancelled() && needs.a.result == 'success' }}\n"))), ["draft-unguarded:job 'b' kan koere paa en kladde-PR"]);
});

test('jobs afgraenset til andre events end pull_request er rene', () => {
  assert.equal(excludesPullRequest("github.event_name != 'pull_request'"), true);
  assert.equal(excludesPullRequest("github.event_name != 'pull_request' && github.ref == 'refs/heads/main'"), true);
  assert.equal(excludesPullRequest("github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.x)"), true);
  assert.equal(excludesPullRequest("github.event_name == 'pull_request'"), false);
  assert.equal(excludesPullRequest("github.event_name != 'pull_request' || inputs.force"), false);
  assert.equal(excludesPullRequest("github.event.pull_request.user.login != 'dependabot[bot]'"), false);
  assert.equal(excludesPullRequest(''), false);
});

test('engangs-triggere (labeled/closed) og workflows uden pull_request maales ikke', () => {
  assert.deepEqual(rules(wf('  pull_request:\n    types: [labeled]', job('a'))), []);
  assert.deepEqual(rules(wf('  pull_request:\n    types: [closed]', job('a'))), []);
  assert.deepEqual(rules(wf('  push:\n    branches: [main]', job('a'))), []);
  assert.deepEqual(rules(wf('  pull_request_target:\n    types: [opened, synchronize]', job('a'))), []);
});

test('undtagne filer og tilladte kladde-jobs giver ingen fund', () => {
  assert.deepEqual(rules(wf('  pull_request:', job('a')), 'review-gate.yml'), []);
  assert.deepEqual(rules(wf(READY, job('gitleaks')), 'secret-scan.yml'), []);
});

test('en tilladt kladde-vagt giver ikke skip videre til jobs der har brug for den', () => {
  const text = wf(READY, job('registry-freshness') + job('next', '    needs: registry-freshness\n'));
  assert.deepEqual(rules(text, 'feature-registry-check.yml'), ["draft-unguarded:job 'next' kan koere paa en kladde-PR"]);
});

test('en DRAFT_ALLOWED-post der peger paa et forsvundet job fejler', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-skip-'));
  try {
    fs.writeFileSync(path.join(dir, 'secret-scan.yml'), wf(READY, job('other', GUARD)));
    const { errors } = checkDirectory(dir);
    assert.ok(errors.some((e) => e.rule === 'stale-allowlist' && e.detail.includes('secret-scan.yml:gitleaks')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
