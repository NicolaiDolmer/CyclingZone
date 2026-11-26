import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/lighthouse-ci.yml', import.meta.url), 'utf8');
const coreNames = ['Check out repository', 'Set up Node.js', 'Install frontend dependencies', 'Build frontend', 'Bundle-size budget (hard gate)', 'Run bundle gate regression tests'];

function steps(source) {
  return [...source.matchAll(/^      - name: (.+)\r?\n([\s\S]*?)(?=^      - name:|$(?![\s\S]))/gm)]
    .map(([, name, body]) => ({ name, body, condition: body.match(/^        if: (.+)$/m)?.[1].trim() }));
}

function runs(condition, event, author, build = 'true') {
  if (!condition) return true;
  const expression = condition.replace(/\$\{\{|\}\}/g, '')
    .replaceAll('steps.changes.outputs.build', JSON.stringify(build))
    .replaceAll('env.IS_DEPENDABOT_PR', JSON.stringify(String(event === 'pull_request' && author === 'dependabot[bot]')))
    .replaceAll('github.event_name', JSON.stringify(event));
  assert.match(expression, /^[\w\s'"=!&|()[\].-]+$/);
  return Function(`return (${expression})`)();
}

function assertCoreRuns(source, event, author) {
  // Job-level gates must not bypass the hard gate either. The one allowed gate is
  // the draft skip (#8802): a draft cannot merge, and ready_for_review reruns it.
  for (const [, jobIf] of source.split('    steps:')[0].matchAll(/^    if: (.+)$/gm)) {
    assert.equal(jobIf.trim(), '${{ !github.event.pull_request.draft }}', `job-level if bypasses the hard gate: ${jobIf}`);
  }
  assert.doesNotMatch(source, /\$\{\{\s*secrets\./);
  const parsed = steps(source);
  for (const name of coreNames) {
    const step = parsed.find(s => s.name === name);
    assert.ok(step, `missing ${name}`);
    assert.ok(runs(step.condition, event, author), `${event}/${author}: skipped ${name}`);
    assert.doesNotMatch(step.body, /continue-on-error:\s*true|\|\|\s*true/);
  }
  assert.match(parsed.find(s => s.name === coreNames[4]).body, /run: node scripts\/check-bundle-budget\.mjs/);
  assert.match(parsed.find(s => s.name === 'Run bundle gate regression tests').body, /run: node --test scripts\/dependabot-perf-gate\.test\.mjs/);
  assert.match(parsed.find(s => s.name === coreNames[2]).body, /run: npm ci/);
  assert.match(parsed.find(s => s.name === coreNames[3]).body, /run: npm run build/);
  assert.match(parsed.find(s => s.name === coreNames[0]).body, /persist-credentials: false/);
}

for (const [event, author] of [['pull_request', 'dependabot[bot]'], ['pull_request', 'contributor'], ['push', '']]) {
  test(`secret-free hard gate runs for ${event}/${author || 'main'}`, () => assertCoreRuns(workflow, event, author));
  test(`advisory permissions stay gated for ${event}/${author || 'main'}`, () => {
    for (const step of steps(workflow).filter(s => /Lighthouse \(advisory\)|Comment on Lighthouse/.test(s.name))) {
      assert.equal(runs(step.condition, event, author), event === 'pull_request' && author !== 'dependabot[bot]');
      assert.match(step.body, /continue-on-error: true/);
    }
    assert.equal(steps(workflow).filter(s => /Lighthouse \(advisory\)|Comment on Lighthouse/.test(s.name)).length, 2);
  });
}

test('negative control catches Dependabot step and job skips', () => {
  for (const name of coreNames) {
    const skipped = workflow.replace(`- name: ${name}`, `- name: ${name}\n        if: env.IS_DEPENDABOT_PR != 'true'`);
    assert.throws(() => assertCoreRuns(skipped, 'pull_request', 'dependabot[bot]'), /skipped/);
  }
  assert.throws(() => assertCoreRuns(workflow.replace('    steps:', '    if: false\n    steps:'), 'push', ''), assert.AssertionError);
});

test('one perf-gate reports for PRs, merge groups and main', () => {
  assert.doesNotMatch(workflow, /^  pull_request_target:/m);
  assert.equal((workflow.match(/^  perf-gate:/gm) || []).length, 1);
  assert.match(workflow, /pull_request:\s*\n +types: \[opened, synchronize, reopened, ready_for_review\]/);
  assert.match(workflow, /^  merge_group:/m);
  assert.match(workflow, /branches:\s*\n\s*- main/);
});

test('a deferred Lighthouse run only executes the filter and green stub', () => {
  const executed = steps(workflow).filter(step => runs(step.condition, 'pull_request', 'contributor', 'false'));
  assert.deepEqual(executed.map(step => step.name), ['Decide whether to build', 'Bundle unaffected or audit deferred']);
});
