import test from 'node:test';
import assert from 'node:assert/strict';
import { missionReadyLabel, scoutCountdownParts } from './scoutCountdown.js';

// #6862: expected labels follow Copenhagen calendar dates, not elapsed days.
const cases = [
  ['autumn midnight before the fold', '2026-10-24T22:30:00Z', '2026-10-26T07:00:00Z', 'tomorrow'],
  ['autumn first 02 hour', '2026-10-25T00:30:00Z', '2026-10-26T07:00:00Z', 'tomorrow'],
  ['autumn second 02 hour', '2026-10-25T01:30:00Z', '2026-10-26T07:00:00Z', 'tomorrow'],
  ['spring eve does not skip tomorrow', '2026-03-28T22:30:00Z', '2026-03-29T06:00:00Z', 'tomorrow'],
  ['spring eve does not call the day after tomorrow tomorrow', '2026-03-28T22:30:00Z', '2026-03-30T06:00:00Z', 'date'],
  ['spring midnight before the gap', '2026-03-28T23:30:00Z', '2026-03-30T06:00:00Z', 'tomorrow'],
  ['spring after the gap', '2026-03-29T01:30:00Z', '2026-03-30T06:00:00Z', 'tomorrow'],
  ['autumn today stays today', '2026-10-24T22:30:00Z', '2026-10-25T07:00:00Z', 'today'],
  ['year boundary', '2026-12-31T22:30:00Z', '2027-01-01T07:00:00Z', 'tomorrow'],
] as const;

for (const [name, now, readyAt, state] of cases) {
  test(`missionReadyLabel: ${name}`, () => {
    const expected = state === 'date'
      ? { state, time: '08:00', date: new Date(readyAt) }
      : { state, time: '08:00' };
    assert.deepEqual(missionReadyLabel(readyAt, new Date(now)), expected);
  });
}

for (const date of ['2026-10-25', '2026-03-29']) {
  test(`countdown keeps elapsed minutes across the ${date} clock change`, () => {
    const now = new Date(`${date}T00:30:00Z`);
    assert.deepEqual(scoutCountdownParts(`${date}T01:30:00Z`, now), { state: 'counting', minutes: 60 });
    assert.deepEqual(missionReadyLabel(now.toISOString(), now), { state: 'due' });
  });
}