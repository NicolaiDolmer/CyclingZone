import { test, expect } from './e2e-base.js';
import { installNetworkMocks, stabilizePage, login, json, evidenceShotPath } from './fixtures.js';
import { SEED_TRAINING } from '../../src/preview/seedData.js';
import { trainingReceiptMock } from '../../src/preview/trainingReceiptMock.ts';

for (const flag of [false, undefined]) {
  test(`#6314 history stays a daily receipt when API flag is ${String(flag)}`, async ({ page }, testInfo) => {
    await page.clock.install({ time: new Date('2026-09-30T10:00:00Z') });
    await installNetworkMocks(page);
    // JSON omits undefined, exercising a genuinely absent wire field.
    const payload = { ...trainingReceiptMock(SEED_TRAINING, 'complete')!, dailyReceiptEnabled: flag };
    await page.route('**/api/training/me', route => json(route, payload));
    await stabilizePage(page);
    await login(page);
    await page.goto('/training?tab=report');
    const receipt = page.locator('[data-testid="daily-training-receipt"][data-date="2026-09-29"]');
    await expect(receipt).toBeVisible();
    await receipt.getByRole('button', { name: /Ada Pedersen/ }).click();
    await expect(receipt.getByTestId('daily-receipt-rider-details')).toBeVisible();
    await receipt.screenshot({ path: evidenceShotPath(`pr-screens/6314/${testInfo.project.name}-${String(flag)}.png`) });
  });
}
