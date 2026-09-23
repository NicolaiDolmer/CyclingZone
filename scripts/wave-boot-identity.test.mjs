import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBootId, sameBoot, measureBootId, SAME_BOOT_TOLERANCE_SECONDS } from './wave-boot-identity.mjs';

// Incident 23/9 (#5533): marker vs measurement in the same Windows boot.
const markerTicks = '639256957975000000'; // 19:43:17.5000000
const driftedTicks = '639256957975007720'; // 19:43:17.5007720 (+0.772 ms)
const second = 10_000_000n;
const shift = (ticks, delta) => (BigInt(ticks) + delta).toString();

test('normalization truncates Windows ticks to whole seconds and is idempotent', () => {
  assert.equal(normalizeBootId(markerTicks), '639256957970000000');
  assert.equal(normalizeBootId(driftedTicks), '639256957970000000');
  assert.equal(normalizeBootId(` ${driftedTicks}\r\n`), '639256957970000000');
  assert.equal(normalizeBootId(normalizeBootId(driftedTicks)), normalizeBootId(driftedTicks));
});

test('opaque ids (Linux boot_id, fixtures) pass through; missing ids stay unknown', () => {
  assert.equal(normalizeBootId('0f8a3c2e-1b7d-4e55-9a51-6c2f0d9e8b41\n'), '0f8a3c2e-1b7d-4e55-9a51-6c2f0d9e8b41');
  assert.equal(normalizeBootId('fixture-boot'), 'fixture-boot');
  for (const missing of [undefined, null, '', '   ', 639256957975000000]) assert.equal(normalizeBootId(missing), undefined);
});

test('sub-second drift in either direction is the same boot', () => {
  assert.equal(sameBoot(markerTicks, driftedTicks), true);
  assert.equal(sameBoot(driftedTicks, markerTicks), true);
  // A negative drift from the .5 s boot start stays in the same whole second.
  assert.equal(sameBoot(markerTicks, shift(markerTicks, -7720n)), true);
  assert.equal(normalizeBootId(shift(markerTicks, -7720n)), normalizeBootId(markerTicks));
  // A pre-#5533 marker (raw ticks) matches a fresh normalized measurement.
  assert.equal(sameBoot(markerTicks, normalizeBootId(driftedTicks)), true);
});

test('drift up to the tolerance is the same boot, beyond it is not', () => {
  const tolerance = BigInt(SAME_BOOT_TOLERANCE_SECONDS) * second;
  assert.equal(sameBoot(markerTicks, shift(markerTicks, tolerance)), true);
  assert.equal(sameBoot(markerTicks, shift(markerTicks, -tolerance)), true);
  assert.equal(sameBoot(markerTicks, shift(markerTicks, tolerance + second)), false);
});

test('a real restart minutes later is a new boot', () => {
  assert.equal(sameBoot(markerTicks, shift(markerTicks, 5n * 60n * second)), false);
  assert.equal(sameBoot(markerTicks, shift(markerTicks, 3n * 3600n * second + 123n)), false);
});

test('unknown, opaque and mixed ids never compare equal by accident', () => {
  assert.equal(sameBoot(undefined, undefined), false);
  assert.equal(sameBoot(markerTicks, undefined), false);
  assert.equal(sameBoot('', ''), false);
  assert.equal(sameBoot('fixture-boot', 'fixture-boot'), true);
  assert.equal(sameBoot('fixture-boot', 'next-boot'), false);
  assert.equal(sameBoot(markerTicks, 'fixture-boot'), false);
});

test('host measurement is normalized and stable across calls', { skip: !['win32', 'linux'].includes(process.platform) }, () => {
  const first = measureBootId();
  const again = measureBootId();
  assert.ok(first);
  assert.equal(again, first);
  if (process.platform === 'win32') assert.match(first, /^\d+0000000$/);
});
