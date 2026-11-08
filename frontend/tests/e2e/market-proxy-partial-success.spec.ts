import { test, expect } from './e2e-base.js';
import { installNetworkMocks, login, stabilizePage, json, corsHeaders, evidenceShotPath } from './fixtures.js';

test('a placed bid with a rejected optional proxy stays successful and shows the existing warning', async ({ page }, testInfo) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
  await page.route('**/api/auctions/auction-1/bid', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    return json(route, { success: true, bid_placed: true, new_price: 50000, warnings: [{
      code: 'proxy_rejected', errorCode: 'insufficient_balance_after_proxy', errorParams: { available: 700 },
    }] });
  });
  await login(page);
  await page.goto('/auctions');
  const card = page.locator('[data-auction-row="auction-1"]').filter({ visible: true });
  await card.getByRole('button', { name: /Afgiv bud|Place bid/i }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^(Byd|Place bid)$/i }).click();
  const warning = card.locator('.text-cz-warning').filter({ hasText: '700' });
  await expect(warning).toBeVisible();
  await expect(card.locator('.text-cz-danger').filter({ hasText: '700' })).toHaveCount(0);
  // Existing auction feedback stays in the success state; no new player copy.
  await expect(card.locator('button.text-cz-success')).toBeVisible();
  await page.evaluate(() => {
    const label = document.createElement('div');
    label.textContent = 'MOCK API · #7875';
    label.style.cssText = 'position:fixed;top:0;right:0;z-index:99999;background:black;color:white;padding:4px;font:12px sans-serif';
    document.body.append(label);
  });
  await page.screenshot({ path: evidenceShotPath(`pr-screens/7875-proxy-warning-${testInfo.project.name}.png`), fullPage: false });
});
