import AxeBuilder from '@axe-core/playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './e2e-base.js';
import { installNetworkMocks, stabilizePage, TEST_USER, json } from './fixtures.js';
import { BASELINE_PATH, CASE_KEYS, SURFACES, fingerprints, compareFindings, validateBaseline, assertNoGrowth, reduceBaseline } from '../../../scripts/lib/axe-ratchet.mjs';
import { axeInputHash } from '../../../scripts/lib/axe-inputs.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
let inputHash: string;
// Collection also runs before the local webServer has produced dist.
test.beforeAll(() => { inputHash = axeInputHash(root); });
const runId = process.env.AXE_RUN_ID;
const capture = process.env.AXE_CAPTURE === '1';
if (capture && process.env.GITHUB_ACTIONS === 'true') throw Error('AXE_CAPTURE cannot bypass CI');
const baseline = capture ? null : JSON.parse(readFileSync(new URL('./axe-baseline.json', import.meta.url), 'utf8'));
if (baseline) {
  validateBaseline(baseline);
  const baseRef = process.env.AXE_BASE_SHA || 'origin/main';
  // Resolve the immutable base first: an unreadable base is never bootstrap.
  execFileSync('git', ['cat-file', '-e', `${baseRef}^{commit}`], { cwd: root, stdio: 'pipe' });
  const tracked = execFileSync('git', ['ls-tree', '--name-only', baseRef, '--', BASELINE_PATH], { cwd: root, encoding: 'utf8' }).trim();
  if (tracked) assertNoGrowth(JSON.parse(execFileSync('git', ['show', `${baseRef}:${BASELINE_PATH}`], { cwd: root, encoding: 'utf8' })), baseline);
}

const raceId = '00000000-0000-4000-8000-000000004632';
const paths: Record<string, string> = {
  dashboard: '/dashboard', riders: '/riders', rider: '/riders/rider-1',
  race: `/races/${raceId}`, tactics: `/races/${raceId}?tab=tactics`,
  training: '/training', market: '/auctions', calendar: '/planning?tab=calendar',
};
async function seedRace(page: Page) {
  const race = { id: raceId, name: 'E2E Accessibility Race', race_type: 'stage_race', race_class: 'OtherWorldTourA', stages: 3, stages_completed: 0, edition_year: 2026, status: 'scheduled', season: { id: 'season-e2e', number: 1 }, pool_race: null };
  await page.route('**/rest/v1/races**', route => json(route, (route.request().headers().accept || '').includes('vnd.pgrst.object') ? race : [race]));
  await page.route('**/rest/v1/race_results**', route => json(route, []));
  await page.route('**/rest/v1/race_stage_profiles**', route => json(route, [1, 2, 3].map(stage_number => ({ stage_number, profile_type: 'flat', finale_type: 'bunch_sprint' }))));
  await page.route('**/rest/v1/race_stage_schedule**', route => json(route, [1, 2, 3].map(stage_number => ({ race_id: raceId, stage_number, scheduled_at: `2026-11-${11 + stage_number}T13:00:00Z` }))));
  await page.route(`**/api/races/${raceId}/stage-roles`, route => json(route, {
    enabled: true, intention_enabled: false, valid_efforts: ['protect', 'normal', 'save'], stages_completed: 0, stage_count: 3,
    riders: [{ rider_id: 'rider-1', name: 'Ada Pedersen', race_role: 'captain', abandoned: false }], overrides: [], role_scope_choice: false,
  }));
}
async function ready(page: Page, surface: string) {
  const main = page.locator('main');
  await expect(main).toBeVisible();
  if (surface === 'dashboard') await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).toBeVisible();
  else if (surface === 'race' || surface === 'tactics') {
    await expect(page.getByRole('heading', { name: 'E2E Accessibility Race', exact: true })).toBeVisible();
    if (surface === 'tactics') {
      await expect(page.getByTestId('race-tactics-tab')).toBeVisible();
      await expect(page.getByTestId('race-tactics-tab').getByText('Ada Pedersen').filter({ visible: true }).first()).toBeVisible();
    } else {
      await page.getByRole('tab', { name: 'Etape', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Etape 2', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Etape 3', exact: true })).toBeVisible();
    }
  } else if (surface === 'calendar') {
    await expect(page.getByText('MAN', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Mit hold', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Grand Prix de Namur/ }).first()).toBeVisible();
  } else if (surface === 'riders' || surface === 'market') {
    await expect(main.getByRole('link', { name: surface === 'market' ? 'Mikkel Hansen' : 'Ada Pedersen', exact: true }).filter({ visible: true }).first()).toBeVisible();
  } else await expect(main.getByText('Ada Pedersen', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await expect(main).not.toContainText('VITE_API_URL is not set');
}
for (const surface of SURFACES) test(`axe gate: ${surface}`, async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-11-11T12:00:00Z'));
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.addInitScript(user => {
    localStorage.setItem('cz-theme', 'light');
    localStorage.setItem('sb-cycling-zone-e2e-auth-token', JSON.stringify({ access_token: 'e2e-access-token', refresh_token: 'e2e-refresh-token', token_type: 'bearer', expires_at: 1794402000, user }));
  }, TEST_USER);
  if (surface === 'race' || surface === 'tactics') await seedRace(page);
  await page.goto(paths[surface]);
  await ready(page, surface);
  const scan = await new AxeBuilder({ page }).analyze();
  const key = `${testInfo.project.name}/${surface}`;
  const findings = fingerprints(scan.violations);
  const report = { key, revision, runId, inputHash, engineVersion: scan.testEngine.version, findings };
  writeFileSync(testInfo.outputPath('axe-scan.json'), JSON.stringify(report, null, 2));
  await testInfo.attach('axe-results', { body: JSON.stringify({ violations: scan.violations, incomplete: scan.incomplete }), contentType: 'application/json' });
  if (!capture) {
    expect(scan.testEngine.version).toBe(baseline.engineVersion);
    const diff = compareFindings(baseline.cases[key], findings);
    expect(diff.added, 'New axe findings cannot be baselined').toEqual([]);
    expect(diff.removed, 'Repaired debt: run node scripts/update-axe-baseline.mjs after all 24 scans, then commit the reduction').toEqual([]);
  }
});

test('axe ratchet removes a repaired real DOM finding and rejects recurrence', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-11-11T12:00:00Z'));
  const markup = (label: string) => `<!doctype html><html lang="en"><title>Ratchet fixture</title><body><main><h1>Fixture</h1><button id="save" ${label}>${label ? 'Save' : ''}</button></main></body></html>`;
  await page.setContent(markup(''));
  const before = await new AxeBuilder({ page }).analyze();
  expect(before.violations.some(v => v.id === 'button-name')).toBe(true);
  await page.setContent(markup('aria-label="Save"'));
  const after = await new AxeBuilder({ page }).analyze();
  const key = CASE_KEYS[0];
  const seed = { schemaVersion: 1, engineVersion: before.testEngine.version, cases: Object.fromEntries(CASE_KEYS.map(k => [k, k === key ? fingerprints(before.violations) : {}])) };
  const reports = CASE_KEYS.map(k => ({ key: k, revision, runId, inputHash, engineVersion: after.testEngine.version, findings: k === key ? fingerprints(after.violations) : {} }));
  const reduced = reduceBaseline(seed, reports);
  expect(compareFindings(seed.cases[key], reduced.cases[key]).removed.length).toBeGreaterThan(0);
  expect(compareFindings(reduced.cases[key], fingerprints(before.violations)).added.length).toBeGreaterThan(0);
  writeFileSync(testInfo.outputPath('axe-ratchet-proof.json'), JSON.stringify({ project: testInfo.project.name, revision, runId, inputHash, before: seed.cases[key], after: reduced.cases[key] }, null, 2));
  await testInfo.attach('axe-ratchet-proof', { body: JSON.stringify({ before: seed.cases[key], after: reduced.cases[key] }), contentType: 'application/json' });
});
