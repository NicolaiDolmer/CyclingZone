import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPrFiles } from './merge-queue-files.mjs';

// Ejer 10/10 (valg B): kun aendret PRODUKTIONSKODE i backend/ skal vente paa
// deploy-verifikation alene; tests, dev-scripts og docs gor ikke.

test('backend-produktionskode taeller som backend', () => {
  assert.deepEqual(classifyPrFiles(['backend/lib/squads.js']), { touchesBackend: true, touchesRailway: true });
  assert.deepEqual(classifyPrFiles(['backend/routes/api.js']), { touchesBackend: true, touchesRailway: true });
  assert.deepEqual(classifyPrFiles(['backend/lib/engine/v4/groups.ts']), { touchesBackend: true, touchesRailway: true });
  assert.deepEqual(classifyPrFiles(['backend/cron.js']), { touchesBackend: true, touchesRailway: true });
});

test('backend-tests og dev-scripts er ikke backend-produktion, men Railway bygger stadig', () => {
  for (const p of [
    'backend/lib/youthSelectionRescue.6124.test.js',
    'backend/lib/engine/v4/officialTimesV3Descent6200.test.ts',
    'backend/test/engine/resultChain6285.test.ts',
    'backend/scripts/dev/tourDryRun.mjs',
    'backend/scripts/dev/lib/tourScorecard.mjs',
    'backend/lib/engine/v4/test-data/officialTimesV2Frozen6200.json',
  ]) {
    assert.deepEqual(classifyPrFiles([p]), { touchesBackend: false, touchesRailway: true }, p);
  }
});

test('docs og pr-screens udloeser hverken backend eller Railway', () => {
  assert.deepEqual(classifyPrFiles(['docs/NOW.md', 'pr-screens/6400/x.png', 'README.md']), { touchesBackend: false, touchesRailway: false });
});

test('en enkelt produktionsfil i en ellers test-tung PR goer den til backend', () => {
  assert.deepEqual(classifyPrFiles(['backend/lib/x.test.js', 'backend/lib/x.js']), { touchesBackend: true, touchesRailway: true });
});

test('ukendt eller tom filliste behandles som backend (fail-safe)', () => {
  assert.deepEqual(classifyPrFiles(null), { touchesBackend: true, touchesRailway: true });
  assert.deepEqual(classifyPrFiles([]), { touchesBackend: true, touchesRailway: true });
});

test('database/-migrationer taeller som backend (auto-migrate + deploy skal bevises)', () => {
  assert.deepEqual(classifyPrFiles(['database/2026-10-10-x.sql']), { touchesBackend: true, touchesRailway: true });
});
