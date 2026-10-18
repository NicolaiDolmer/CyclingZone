import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, paramsForScale, summarize, renderMarkdown, run } from './tenx-dryrun.mjs';

test('parseArgs: default er skala 1 og 10, normal-scenariet', () => {
  const { errors, options } = parseArgs([]);
  assert.deepEqual(errors, []);
  assert.deepEqual(options, { scales: [1, 10], scenario: 'normal', json: false });
});

test('parseArgs: afviser ukendte flag, tomme værdier og skalaer over 20', () => {
  assert.ok(parseArgs(['--foo']).errors.includes('USAGE_UNKNOWN_ARG:--foo'));
  assert.ok(parseArgs(['--scales']).errors.includes('USAGE_MISSING_VALUE:scales'));
  assert.ok(parseArgs(['--scales', '1,21']).errors.includes('USAGE_INVALID_SCALES'));
  assert.ok(parseArgs(['--scales', '0']).errors.includes('USAGE_INVALID_SCALES'));
  assert.ok(parseArgs(['--scenario', 'x']).errors.includes('USAGE_INVALID_SCENARIO'));
  assert.deepEqual(parseArgs(['--scales', '1,1,10', '--json']).options.scales, [1, 10]);
});

test('paramsForScale: hold og ungdomsgrupper vokser lineært', () => {
  assert.deepEqual(paramsForScale(1), { teamsPerSeniorPool: 20, youthGroups: 10, teams: 410 });
  assert.deepEqual(paramsForScale(10), { teamsPerSeniorPool: 200, youthGroups: 100, teams: 4100 });
});

test('summarize + renderMarkdown: fejlede checks og aftentræningens varighed vises', () => {
  const result = {
    passed: false,
    checks: [{ id: 'coverage', ok: false, note: 'mangler: {"u23":3}' }, { id: 'errors', ok: true, note: '' }],
    metrics: {
      teams: 2400, stagesExpected: 237, stagesRan: 124, missing: 113, dailyStageCap: 62,
      peakCallsPerMinute: 5340, maxTickDurationMs: 720361, stageDelayMsMax: 1,
      trainingClose: null, concurrentJobs: [{ kind: 'training_close', durationMs: 120000 }],
    },
  };
  const row = summarize(10, result);
  assert.equal(row.trainingCloseMinutes, 2);
  assert.deepEqual(row.failed, ['coverage']);
  const md = renderMarkdown([row], 'normal');
  assert.match(md, /\| 10x \| 2400 \| 124\/237 \|/);
  assert.match(md, /Daglig etape-cap: 62/);
});

test('run: skala 1 afregner prods ca. 410 hold i aftentræningen (#6766)', async () => {
  const [row] = await run({ scales: [1], scenario: 'normal' });
  assert.equal(row.teams, 410);
  assert.ok(row.failed.includes('training_close_duration'));
});
