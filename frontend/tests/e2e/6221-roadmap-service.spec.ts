import { test, expect } from './e2e-base.js';
import { installNetworkMocks, login, json, stabilizePage, evidenceShotPath, TEST_USER } from './fixtures.js';

test('#6221: admin stats and visible split controls use backend routes', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-10-06T06:00:00Z'));
  await stabilizePage(page);
  await installNetworkMocks(page);
  let directCalls = 0;
  let splitCalls = 0;
  const itemId = '00000000-0000-0000-0000-000000000001';
  await page.route('**/rest/v1/rpc/roadmap_*', route => {
    directCalls++;
    return route.fulfill({ status: 403, body: '{}' });
  });
  await page.route(/\/rest\/v1\/(users|roadmap_item_scores|roadmap_items|known_issue_scores|known_issue_updates)/, route => {
    const url = route.request().url();
    if (url.includes('/users')) {
      const user = { ...TEST_USER, role: 'admin', username: 'Admin fixture' };
      return json(route, (route.request().headers().accept || '').includes('vnd.pgrst.object') ? user : [user]);
    }
    if (url.includes('/roadmap_item_scores')) return json(route, [{ item_id: itemId, engine: 'club', approved: true,
      title_en: 'Fixture item', title_da: 'Testpunkt', status: 'planned', horizon: 'next', sort_order: 10,
      votes: 2, avg_importance: 5, steering_score: 5, sd_importance: 0 }]);
    if (url.includes('/roadmap_items')) return json(route, [{ id: itemId, flag_key: null, beta_soon: false, live_soon: false }]);
    return json(route, []);
  });
  await page.route('**/api/admin/roadmap/stats', route => json(route, { stats: { voters: 42, voters_14d: 31, votes_total: 80, voted_all: 19, managed_teams: 118 } }));
  await page.route('**/api/admin/feature-flags*', route => json(route, { flags: [] }));
  await page.route('**/api/admin/roadmap/split', route => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    splitCalls++;
    expect(route.request().postDataJSON()).toMatchObject({ source: itemId, title_en: 'Rest EN', title_da: 'Rest DA', status: 'planned', horizon: 'next' });
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    return json(route, { id: '00000000-0000-0000-0000-000000000002' });
  });
  await login(page);
  await page.goto('/admin/growth?tab=roadmap');
  await expect(page.getByText('af 118 hold', { exact: true })).toBeVisible();
  await expect(page.getByText('Testpunkt', { exact: true })).toBeVisible();
  await page.screenshot({ path: evidenceShotPath(`pr-screens/6221/admin-${testInfo.project.name}.png`), fullPage: true });
  // The existing table folds the action column out of mobile entirely.
  // Verify its stats transport without claiming mobile split coverage.
  if (testInfo.project.name.startsWith('mobile-')) {
    expect(directCalls).toBe(0);
    return;
  }
  await page.getByRole('button', { name: 'Del', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Restens titel (EN)').fill('Rest EN');
  await dialog.getByLabel('Restens titel (DA)').fill('Rest DA');
  await dialog.getByRole('button', { name: 'Del punkt', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(splitCalls).toBe(1);
  expect(directCalls).toBe(0);
});
