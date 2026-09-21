import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseCalendarDraw } from './calendarFinaleDraw.js';

test('keeps the original draws when the full season already passes', () => {
  const baseline = [{ attempt: 1 }, { attempt: 0 }];
  const result = chooseCalendarDraw({ baseline, choices: [], accepts: () => true });
  assert.equal(result.draws, baseline);
  assert.equal(result.exhausted, false);
});

test('searches existing variants deterministically across divisions', () => {
  const baseline = [{ attempt: 0 }, { attempt: 0 }];
  const choices = [[{ attempt: 0 }, { attempt: 2 }], [{ attempt: 0 }, { attempt: 3 }, { attempt: 4 }]];
  const accepts = draws => draws[0].attempt === 2 && draws[1].attempt >= 3;
  const a = chooseCalendarDraw({ baseline, choices, accepts });
  const b = chooseCalendarDraw({ baseline, choices, accepts });
  assert.deepEqual(a.draws.map(d => d.attempt), [2, 3]);
  assert.deepEqual(a, b);
  assert.equal(a.exhausted, false);
});

test('exhaustion returns the original failing plan without disguising it as success', () => {
  const baseline = [{ attempt: 0 }];
  const result = chooseCalendarDraw({ baseline, choices: [[{ attempt: 0 }, { attempt: 1 }]], accepts: () => false });
  assert.equal(result.draws, baseline);
  assert.equal(result.exhausted, true);
});
