import { test, expect } from './e2e-base.js';
import { installNetworkMocks, TEST_USER, TEST_TEAM, AUCTIONS, json } from './fixtures.js';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-11T12:00:00Z'));
  await installNetworkMocks(page);
  await page.addInitScript(user => {
    localStorage.setItem('cz_lang', 'da');
    localStorage.setItem('cz_consent_v1', JSON.stringify({ version: 1, necessary: true, analytics: false, marketing: false, email_marketing: false, updated_at: '2026-05-13T00:00:00Z' }));
    localStorage.setItem('sb-cycling-zone-e2e-auth-token', JSON.stringify({ access_token: 'e2e-access-token', refresh_token: 'e2e-refresh-token', token_type: 'bearer', expires_at: 1794402000, user }));
  }, TEST_USER);
});

test('a delayed transfers card does not hold back ready cards', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/transfers/my-offers', async route => { await gate; await route.fallback(); });
  await page.goto('/dashboard');
  try {
    await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).toBeVisible();
    await expect(page.locator('[data-loading-region="auctions"]')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('[data-loading-region="transfers"]')).toHaveAttribute('aria-busy', 'true');
  } finally { release(); }
  await expect(page.locator('[data-loading-region="transfers"]')).toHaveAttribute('aria-busy', 'false');
});

test('result placeholders are static and keep their body size after an empty response', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/dashboard/recent-results', async route => { await gate; await json(route, { races: [] }); });
  await page.goto('/dashboard');
  const region = page.locator('[data-loading-region="recentResults"]');
  try {
    await expect(region).toHaveAttribute('aria-busy', 'true');
    const before = await region.boundingBox();
    const animation = await region.locator('[aria-hidden="true"] span').first().evaluate(el => [getComputedStyle(el).animationName, getComputedStyle(el, '::after').animationName]);
    expect(animation).toEqual(['none', 'none']);
    release();
    await expect(region).toHaveAttribute('aria-busy', 'false');
    const after = await region.boundingBox();
    expect(after!.height).toBe(before!.height);
    expect(after!.width).toBe(before!.width);
  } finally { release(); }
});

test('rate-limited results finish loading instead of leaving a permanent placeholder', async ({ page }) => {
  await page.route('**/api/dashboard/recent-results', route => json(route, { error: 'limited' }, 429));
  await page.goto('/dashboard');
  await expect(page.locator('[data-loading-region="recentResults"]')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).toBeVisible();
});

test('a stalled secondary stage query cannot hold the dashboard', async ({ page }) => {
  await page.route('**/rest/v1/race_stage_schedule?**', route => {
    if (!new URL(route.request().url()).searchParams.has('scheduled_at')) return route.fallback();
    return json(route, [{ race_id: 'race-live-1', stage_number: 4, scheduled_at: '2026-11-11T11:00:00Z' }]);
  });
  let release!: () => void;
  let held = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/rest/v1/race_stage_profiles?**', async route => { held = true; await gate; await route.fallback(); });
  await page.goto('/dashboard');
  try {
    await expect.poll(() => held).toBe(true);
    await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).toBeVisible();
    await expect(page.locator('[data-loading-region="transfers"]')).toHaveAttribute('aria-busy', 'false');
  } finally { release(); }
  await expect(page.locator('a[href="/races/race-live-1?stage=4"]')).toBeVisible();
});

test('all five results fit the reservation', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/dashboard/recent-results', async route => {
    await gate;
    await json(route, { races: Array.from({ length: 5 }, (_, i) => ({ race_id: `race-${i}`, name: `Fixture race ${i}`, race_type: 'one_day', winner: { result_type: 'gc', rider_id: `rider-${i}`, firstname: 'Ada', lastname: 'Pedersen', team_name: 'E2E Racing' } })) });
  });
  await page.goto('/dashboard');
  const region = page.locator('[data-loading-region="recentResults"]');
  try {
    await expect(region).toHaveAttribute('aria-busy', 'true');
    const before = await region.boundingBox();
    release();
    await expect(region.getByTestId('recent-result-open')).toHaveCount(5);
    expect((await region.boundingBox())!.height).toBe(before!.height);
  } finally { release(); }
});

test('a late urgent auction keeps the action-card footprint and avoids false all-clear', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/rest/v1/auctions?**', async route => {
    if (!new URL(route.request().url()).searchParams.get('select')?.includes('rider:rider_id')) return route.fallback();
    await gate;
    await json(route, [{ ...AUCTIONS[0], current_bidder_id: TEST_TEAM.id, calculated_end: '2026-11-11T12:30:00Z' }]);
  });
  await page.goto('/dashboard');
  const region = page.locator('[data-loading-region="nextActions"]');
  try {
    await expect(region).toHaveAttribute('aria-busy', 'true');
    const before = await region.boundingBox();
    release();
    await expect(region.locator('a[href="/auctions"]')).toBeVisible();
    expect((await region.boundingBox())!.height).toBe(before!.height);
  } finally { release(); }
});
