import test from 'node:test';
import assert from 'node:assert/strict';
import { trainingRunResponse } from './trainingRunResponse.ts';

test('training/me returns explicit empty arrays when no runs or recorded days exist', () => {
  assert.deepEqual(trainingRunResponse(null), { todayRun: null, todayRuns: [] });
  assert.deepEqual(trainingRunResponse(undefined), { todayRun: null, todayRuns: [] });
  const result = trainingRunResponse([{ tick_date: '2026-10-07', report: null }]);
  assert.ok(result.todayRun);
  assert.deepEqual(result.todayRun.game_days, []);
  assert.equal(result.todayRun.report, null, 'missing evidence is not fabricated as an empty completed report');
});

test('recorded day zero and legacy report day survive without claiming expected days were recorded', () => {
  const rows = [
    { tick_date: '2026-10-07', game_day: 0, report: { date_game_days: [0,1,2,3,4], riders: [] } },
    { tick_date: '2026-10-06', report: { game_day: 3, riders: [] } },
  ];
  const original = structuredClone(rows);
  const response = trainingRunResponse(rows);
  assert.deepEqual(response.todayRuns.map(row => row.game_days), [[0], [3]]);
  assert.deepEqual(rows, original);
  assert.equal(response.todayRun, response.todayRuns[0]);
});
