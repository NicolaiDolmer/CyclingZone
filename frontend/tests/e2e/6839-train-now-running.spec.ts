import { SEED_TRAINING } from '../../src/preview/seedData.js';
import { test, expect } from './e2e-base.js';
import { installNetworkMocks, stabilizePage, login, json, evidenceShotPath } from './fixtures.js';

for (const width of [1440, 390]) test(`#6839 held date: running and automatic refresh ${width}px`, async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'explicit desktop/mobile viewports');
  await page.setViewportSize({ width, height: 900 });
  await page.clock.install({ time: new Date('2026-10-01T18:10:00Z') });
  await installNetworkMocks(page);
  await stabilizePage(page);
  let refreshes = 0;
  await page.route('**/api/training/me', route => {
    refreshes++;
    return json(route, { ...SEED_TRAINING, todayRun: null, todayRuns: [] });
  });
  let pressed = false, polls = 0;
  await page.route('**/api/training/train-now**', route => {
    if (route.request().method() === 'POST') {
      pressed = true;
      return json(route, { error: 'training_in_progress' }, 409);
    }
    if (pressed) polls++;
    const settled = pressed && polls >= 2;
    return json(route, { enabled: true, available: !settled, locked: false, settled, reason: settled ? 'date_settled' : null,
      tickDate: '2026-10-01', todayRaces: [], shortRaces: [] });
  });
  await login(page);
  await page.goto('/training');
  const button = page.getByTestId('training-primary');
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.scrollIntoViewIfNeeded();
  await page.screenshot({ path: evidenceShotPath(`pr-screens/6839/before-${width}.png`) });
  const beforeRefresh = refreshes;
  await button.click();
  await expect(button).toHaveText(/K\u00f8rer/);
  await expect(button).toBeDisabled();
  await page.screenshot({ path: evidenceShotPath(`pr-screens/6839/after-${width}.png`) });
  await page.clock.runFor(10_000);
  await expect.poll(() => polls).toBe(1);
  await expect(button).toHaveText(/K\u00f8rer/);
  await page.clock.runFor(10_000);
  await expect.poll(() => polls).toBeGreaterThanOrEqual(2);
  await expect(button).toHaveCount(0);
  await expect.poll(() => refreshes).toBeGreaterThan(beforeRefresh);
});
