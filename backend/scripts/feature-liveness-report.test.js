import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatFeatureLivenessReport } from './feature-liveness-report.js';

const generated_at = '2026-10-05T12:00:00.000Z';
test('report CLI works without credentials and fails closed on invalid input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feature-liveness-report-'));
  try {
    const path = join(dir, 'audit.json');
    const report = { generated_at, detectors_run: ['C'], total_findings: 0,
      by_detector: { A: 0, B: 0, C: 0, D: 0, E: 0 }, findings: [] };
    writeFileSync(path, JSON.stringify(report));
    const cli = fileURLToPath(new URL('./feature-liveness-report.js', import.meta.url));
    const env = { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '' };
    assert.equal(execFileSync(process.execPath, [cli, path], { env, encoding: 'utf8' }),
      formatFeatureLivenessReport(report));
    writeFileSync(path, '{');
    assert.throws(() => execFileSync(process.execPath, [cli, path], { env, stdio: 'pipe' }));
    assert.throws(() => execFileSync(process.execPath, [cli], { env, stdio: 'pipe' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('empty audit retains its timestamp, enabled detectors and success message', () => {
  const report = { generated_at, detectors_run: ['A', 'B', 'D'], total_findings: 0,
    by_detector: { A: 0, B: 0, C: 0, D: 0, E: 0 }, findings: [] };
  assert.equal(formatFeatureLivenessReport(report),
    `Feature-liveness audit — ${generated_at}\nDetectors: A, B, D\nTotal findings: 0 (A=0 B=0 C=0 D=0 E=0)\n\nOK — no liveness findings.\n\n`);
});

test('all detector details render from the same snapshot without mutating it', () => {
  const report = { generated_at, detectors_run: ['A', 'B', 'C', 'D', 'E'], total_findings: 5,
    by_detector: { A: 1, B: 1, C: 1, D: 1, E: 1 }, findings: [
      { detector: 'A', table: 'plans', reason: 'empty but written', backend_files: ['lib/a.js', 'lib/b.js'] },
      { detector: 'B', method: 'GET', path: '/api/orphan' },
      { detector: 'C', filename: 'migration.sql', reason: 'missing migration' },
      { detector: 'D', table: 'extra_table', reason: 'unknown table' },
      { detector: 'E', event_name: 'page_view', reason: 'zero impressions' },
    ] };
  const before = structuredClone(report);
  const output = formatFeatureLivenessReport(report);
  for (const expected of ['Detector A — write-but-no-data (1):', '    backend: lib/a.js, lib/b.js',
    '  GET /api/orphan', '  migration.sql\n    missing migration',
    '  extra_table\n    unknown table', '  page_view\n    zero impressions']) {
    assert.ok(output.includes(expected), expected);
  }
  assert.ok(!output.includes('OK —'));
  assert.deepEqual(report, before);
});
