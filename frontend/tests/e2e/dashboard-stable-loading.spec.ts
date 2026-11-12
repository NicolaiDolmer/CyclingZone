import { apiResponse } from "../../src/preview/mockHandlers.js";
import { test, expect } from './e2e-base.js';
import { installNetworkMocks, TEST_USER, TEST_TEAM, AUCTIONS, json, evidenceShotPath } from './fixtures.js';

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


test('#8019 an empty stage response after 500ms never collapses a visible strip', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/rest/v1/race_stage_schedule?**', async route => {
    if (!new URL(route.request().url()).searchParams.has('scheduled_at')) return route.fallback();
    await gate;
    await json(route, []);
  });
  await page.goto('/dashboard');
  try {
    await page.waitForTimeout(900);
    await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).not.toBeVisible();
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).toBeVisible();
  await expect(page.locator('a[href="/races/race-live-1?stage=4"]')).toHaveCount(0);
});

test('#8019 real stage cards and fixed modules reveal before slow profile enrichment', async ({ page }) => {
  await page.route('**/rest/v1/race_stage_schedule?**', route => {
    if (!new URL(route.request().url()).searchParams.has('scheduled_at')) return route.fallback();
    return json(route, [{ race_id: 'race-live-1', stage_number: 4, scheduled_at: '2026-11-11T11:00:00Z' }]);
  });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/rest/v1/race_stage_profiles?**', async route => { await gate; await route.fallback(); });
  await page.goto('/dashboard');
  try {
    await expect(page.locator('a[href="/races/race-live-1?stage=4"]')).toBeVisible();
    await expect(page.locator('[data-loading-region="transfers"]')).toHaveAttribute('aria-busy', 'false');
    const before = await page.locator('a[href="/races/race-live-1?stage=4"]').boundingBox();
    release();
    await expect(page.locator('a[href="/races/race-live-1?stage=4"]')).toHaveCount(1);
    await page.waitForTimeout(200);
    expect((await page.locator('a[href="/races/race-live-1?stage=4"]').boundingBox())!.height).toBe(before!.height);
  } finally { release(); }
});


test('#8019 latest-result presence settles before the initial dashboard layout', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/dashboard/my-latest-result', async route => { await gate; await route.fallback(); });
  await page.goto('/dashboard');
  try {
    await page.waitForTimeout(900);
    await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).not.toBeVisible();
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).toBeVisible();
  await expect(page.locator('[data-loading-region="auctions"]')).toHaveAttribute('aria-busy', 'false');
});

test('#8019 failed stage enrichment retains the real base card', async ({ page }) => {
  await page.route('**/rest/v1/race_stage_schedule?**', route => {
    if (!new URL(route.request().url()).searchParams.has('scheduled_at')) return route.fallback();
    return json(route, [{ race_id: 'race-live-1', stage_number: 4, scheduled_at: '2026-11-11T11:00:00Z' }]);
  });
  await page.route('**/rest/v1/race_stage_profiles?**', route => json(route, { message: 'unavailable' }, 503));
  await page.goto('/dashboard');
  await expect(page.locator('a[href="/races/race-live-1?stage=4"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator('a[href="/races/race-live-1?stage=4"]')).toBeVisible();
});

for (const width of [375, 1440]) {
  test(`#8019 auction actions keep their row while balance arrives at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/rest/v1/auctions?**', async route => { await gate; await route.fallback(); });
    await page.goto('/auctions?tab=all');
    const history = page.locator('main header a[href="/auctions/history"]');
    try {
      await expect(history).toBeVisible();
      const before = await history.boundingBox();
      release();
      await expect(page.locator('main [role="status"][aria-label]')).toHaveCount(0);
      await expect.poll(async () => (await history.boundingBox())!.y).toBe(before!.y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    } finally { release(); }
  });
}


test('#8019 a failed optional profile does not discard a known winner or entry count', async ({ page }) => {
  const raceId = 'race-one-day-8019';
  await page.route('**/rest/v1/race_stage_schedule?**', route => {
    if (!new URL(route.request().url()).searchParams.has('scheduled_at')) return route.fallback();
    return json(route, [{ race_id: raceId, stage_number: 1, scheduled_at: '2026-11-11T09:00:00Z' }]);
  });
  await page.route('**/rest/v1/races?**', route => {
    if (!decodeURIComponent(route.request().url()).includes(raceId)) return route.fallback();
    return json(route, [{ id: raceId, name: 'Fixture one-day race', race_type: 'single', stages: 1, stages_completed: 1, status: 'completed' }]);
  });
  await page.route('**/rest/v1/race_entries?**', route => {
    if (!decodeURIComponent(route.request().url()).includes(raceId)) return route.fallback();
    return json(route, Array.from({ length: 3 }, () => ({ race_id: raceId })));
  });
  await page.route('**/rest/v1/race_results?**', route => {
    if (!decodeURIComponent(route.request().url()).includes(raceId)) return route.fallback();
    return json(route, [{ race_id: raceId, stage_number: 1, result_type: 'gc', rank: 1, rider_name: 'Fixture winner' }]);
  });
  await page.route('**/rest/v1/race_stage_profiles?**', route => json(route, { message: 'unavailable' }, 503));
  await page.goto('/dashboard');
  const card = page.locator(`a[href="/races/${raceId}?stage=1"]`);
  await expect(card).toContainText('Fixture winner');
  await expect(card).toContainText('3');
  await expect(card).not.toContainText('Ingen resultater');
});

test('#8019 an absent team cannot leave the secondary-presence loader running', async ({ page }) => {
  await page.route('**/rest/v1/teams?**', route => {
    if (!new URL(route.request().url()).searchParams.has('user_id')) return route.fallback();
    return json(route, null);
  });
  await page.goto('/dashboard');
  await expect(page.locator('main header')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dagens etaper', exact: true })).toHaveCount(0);
});


test('#8019 the first auction content frame uses the resolved default tab', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => {
    const observed = window as Window & { firstAuctionFrame?: { cards: number; tab: string | null } };
    function sample() {
      if (document.querySelector('[data-testid="auctions-sidebar-feed"]')) {
        observed.firstAuctionFrame = {
          cards: document.querySelectorAll('[data-auction-row]').length,
          tab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? null,
        };
        return;
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await page.route(/\/rest\/v1\//, async route => {
    await new Promise(resolve => setTimeout(resolve, 650));
    await route.fallback();
  });
  await page.goto('/auctions');
  await expect(page.locator('[data-auction-row]').first()).toBeVisible();
  const first = await page.evaluate(() => (window as Window & { firstAuctionFrame?: { cards: number; tab: string | null } }).firstAuctionFrame);
  expect(first?.tab).toMatch(/^Alle /);
  expect(first?.cards).toBeGreaterThan(0);
});


test('#8019 the resolved default preserves an explicit or manually selected empty tab', async ({ page }) => {
  await page.goto('/auctions?tab=my-situation');
  const mine = page.getByRole('tab', { name: /^Mine auktioner/ });
  await expect(mine).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-testid="auctions-sidebar-feed"]')).toBeVisible();
  await expect(mine).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /^Alle / }).click();
  await expect(page.getByRole('tab', { name: /^Alle / })).toHaveAttribute('aria-selected', 'true');
  await mine.click();
  await expect(mine).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(300);
  await expect(mine).toHaveAttribute('aria-selected', 'true');
});

test('#8019 a long balance wraps honestly without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/rest/v1/teams?**', route => {
    if (new URL(route.request().url()).searchParams.get('select')?.replaceAll(' ', '') !== 'id,balance,division') return route.fallback();
    return json(route, { ...TEST_TEAM, balance: 123456789012345 });
  });
  await page.goto('/auctions?tab=all');
  await expect(page.locator('main header')).toContainText('123.456.789.012.345');
  await expect(page.locator('main header a[href="/auctions/history"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});


test('#8019 completing the last owned auction preserves the initial Mine tab', async ({ page }) => {
  await page.addInitScript(() => {
    const key = 'sb-cycling-zone-e2e-auth-token';
    const session = JSON.parse(localStorage.getItem(key)!);
    // A synthetic JWT arms the real session-gated realtime client; the socket is local-mocked.
    session.access_token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ exp: 1893456000, role: 'authenticated' }))}.fixture-signature`;
    localStorage.setItem(key, JSON.stringify(session));
  });
  const owned = { ...AUCTIONS[0], seller_team_id: TEST_TEAM.id, current_bidder_id: 'fixture-rival', is_guaranteed_sale: false,
    rider: { ...AUCTIONS[0].rider, team_id: TEST_TEAM.id } };
  await page.route('**/rest/v1/auctions?**', route => json(route, [owned]));
  let complete: (() => void) | undefined;
  await page.routeWebSocket(/realtime\/v1\/websocket/, socket => {
    socket.onMessage(message => {
      if (typeof message !== 'string') return;
      const [joinRef, ref, topic, event, payload] = JSON.parse(message);
      if (event === 'phx_join') {
        const changes = (payload.config?.postgres_changes ?? []).map((change: Record<string, unknown>, i: number) => ({ ...change, id: i + 1 }));
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: changes } }]));
        if (topic === 'realtime:auctions-live') {
          const auctionChange = changes.find((change: { table: string; event: string }) => change.table === 'auctions' && change.event === 'UPDATE');
          complete = () => socket.send(JSON.stringify([joinRef, null, topic, 'postgres_changes', {
            ids: [auctionChange.id], data: { schema: 'public', table: 'auctions', type: 'UPDATE',
              commit_timestamp: '2026-11-11T12:01:00Z', columns: [], old_record: owned, record: { ...owned, status: 'completed' } },
          }]));
        }
      } else if (event === 'heartbeat' || event === 'phx_leave') {
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
      }
    });
  });
  await page.goto('/auctions');
  const mine = page.getByRole('tab', { name: /^Mine auktioner/ });
  await expect(mine).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-auction-row]:visible').first()).toBeVisible();
  await expect.poll(() => typeof complete).toBe('function');
  complete!();
  await expect(page.locator('[data-auction-row]')).toHaveCount(0);
  await expect(mine).toHaveAttribute('aria-selected', 'true');
});

// Each case holds exactly one request while other modules can finish.
for (const endpoint of [
  '**/api/dashboard/my-latest-result',
  '**/api/me/onboarding-progress',
  '**/api/races/*/selection',
  '**/rest/v1/race_entries?**',
  '**/rest/v1/season_standings?**',
]) {
  test(`#8022 ready cards render within the mount budget with ${endpoint} stalled`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let held = false;
    await page.route(endpoint, async route => {
      // Only the dependent presence query, not squad-count inputs or strip enrichment.
      if (endpoint.includes('race_entries') && new URL(route.request().url()).searchParams.get('select') !== 'race_id') return route.fallback();
      held = true;
      await gate;
      await route.fallback();
    });
    await page.goto('/dashboard');
    try {
      await expect.poll(() => held).toBe(true);
      await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).toBeVisible({ timeout: 2500 });
      const auctions = page.locator('[data-loading-region="auctions"]');
      await expect(auctions).toHaveAttribute('aria-busy', 'false', { timeout: 500 });
      await expect(auctions.locator('a').first()).toBeVisible();
      if (endpoint.includes('season_standings')) {
        await expect(page.locator('[data-loading-region="standings"]')).toHaveAttribute('aria-busy', 'true');
        await expect(page.locator('main header a[href="/finance"]')).not.toContainText('0 CZ$');
      }
    } finally { release(); }
  });
}

for (const identity of ['teams', 'seasons']) {
  for (const empty of [false, true]) {
    test(`#8022 unresolved ${identity} reserves the strip until identity settles, empty=${empty}`, async ({ page }) => {
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let releaseStages!: () => void;
      const stageGate = new Promise<void>(resolve => { releaseStages = resolve; });
      let held = false;
      await page.route(`**/rest/v1/${identity}?**`, async route => {
        const params = new URL(route.request().url()).searchParams;
        if (identity === 'teams' ? !params.has('user_id') : params.get('status') !== 'eq.active') return route.fallback();
        held = true;
        await gate;
        await route.fallback();
      });
      await page.route('**/rest/v1/race_stage_schedule?**', async route => {
        if (!new URL(route.request().url()).searchParams.has('scheduled_at')) return route.fallback();
        await stageGate;
        return json(route, empty ? [] : [{ race_id: 'race-live-1', stage_number: 4, scheduled_at: '2026-11-11T11:00:00Z' }]);
      });
      await page.goto('/dashboard');
      try {
        await expect.poll(() => held).toBe(true);
        await expect(page.locator('main header')).toBeVisible({ timeout: 2500 });
        await expect(page.getByRole('heading', { name: 'Dagens etaper', exact: true })).toBeVisible();
        await expect(page.locator('main header a[href="/finance"]')).not.toContainText('0 CZ$');
        await page.evaluate(() => {
          const samples: boolean[] = [];
          Reflect.set(window, '__stripPresence', samples);
          const sample = () => samples.push([...document.querySelectorAll('main h2')].some(el => el.textContent === 'Dagens etaper'));
          new MutationObserver(sample).observe(document.querySelector('main')!, { childList: true, subtree: true });
          let remaining = 30;
          const frame = () => { sample(); if (--remaining) requestAnimationFrame(frame); };
          requestAnimationFrame(frame);
        });
        release();
        await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).toBeVisible();
        await page.waitForTimeout(300);
        const samples: boolean[] = await page.evaluate(() => Reflect.get(window, '__stripPresence'));
        expect(samples.length).toBeGreaterThan(0);
        expect(samples.every(Boolean)).toBe(true);
        releaseStages();
        if (empty) await expect(page.getByRole('heading', { name: 'Dagens etaper', exact: true })).toHaveCount(0);
        else await expect(page.locator('a[href="/races/race-live-1?stage=4"]')).toBeVisible();
      } finally { release(); releaseStages(); }
    });
  }
}

test('#8022 a dependent-row timeout on realtime refresh retains a known ongoing race', async ({ page }) => {
  await page.addInitScript(() => {
    const key = 'sb-cycling-zone-e2e-auth-token';
    const session = JSON.parse(localStorage.getItem(key)!);
    session.access_token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ exp: 1893456000, role: 'authenticated' }))}.fixture-signature`;
    localStorage.setItem(key, JSON.stringify(session));
  });
  let refresh: (() => void) | undefined;
  await page.routeWebSocket(/realtime\/v1\/websocket/, socket => {
    socket.onMessage(message => {
      if (typeof message !== 'string') return;
      const [joinRef, ref, topic, event, payload] = JSON.parse(message);
      if (event === 'phx_join') {
        const changes = (payload.config?.postgres_changes ?? []).map((change: Record<string, unknown>, i: number) => ({ ...change, id: i + 1 }));
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: changes } }]));
        if (topic === 'realtime:dashboard-live') {
          const raceChange = changes.find((change: { table: string }) => change.table === 'races');
          refresh = () => socket.send(JSON.stringify([joinRef, null, topic, 'postgres_changes', {
            ids: [raceChange.id], data: { schema: 'public', table: 'races', type: 'UPDATE',
              commit_timestamp: '2026-11-11T12:01:00Z', columns: [], old_record: { id: 'race-live-1' }, record: { id: 'race-live-1', stages_completed: 3 } },
          }]));
        }
      } else if (event === 'heartbeat' || event === 'phx_leave') {
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
      }
    });
  });
  // Isolate the dependent loader: the strip has no slots and makes no
  // membership request, even if fixtures normally return all race IDs.
  await page.route('**/rest/v1/race_stage_schedule?**', route => {
    if (!new URL(route.request().url()).searchParams.has('scheduled_at')) return route.fallback();
    return json(route, []);
  });
  let dependentReads = 0;
  await page.route('**/rest/v1/race_entries?**', async route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('select') !== 'race_id' || !params.get('race_id')?.includes('race-live-1')) return route.fallback();
    // The strip's membership request is separately scoped to today's slots.
    if (!params.get('race_id')?.includes('race-up-1')) return route.fallback();
    dependentReads += 1;
    if (dependentReads === 1) return json(route, [{ race_id: 'race-live-1' }]);
    return route.abort("timedout");
  });
  await page.goto('/dashboard');
  const known = page.locator('[data-loading-region="races"] a[href="/races/race-live-1"]');
  await expect(known).toBeVisible();
  await expect.poll(() => typeof refresh).toBe('function');
  refresh!();
  await expect.poll(() => dependentReads).toBe(2);
  // Exhaust the SDK's three retries, then observe its error/data:null result.
  await expect.poll(() => dependentReads).toBe(5);
  await page.waitForTimeout(100);
  await expect(known).toBeVisible();
});

for (const seen of [false, true]) {
  test(`#8022 result badge matches server state on its first DOM commit, seen=${seen}`, async ({ page }) => {
    const payload = apiResponse('/api/dashboard/my-latest-result') as { race: Record<string, unknown> };
    await page.route('**/api/dashboard/my-latest-result', route => json(route, { ...payload, race: { ...payload.race, seen } }));
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (Reflect.get(window, '__firstResultBadge') !== undefined) return;
        const title = [...document.querySelectorAll('main h2')].find(el => el.textContent === 'Sådan gik det for dit hold');
        if (title?.parentElement?.parentElement?.parentElement?.querySelector('[data-loading-region="myLatestResult"]')) return;
        if (title) Reflect.set(window, '__firstResultBadge', [...title.parentElement!.querySelectorAll('span')].some(el => el.textContent === 'Nyt'));
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto('/dashboard');
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__firstResultBadge'))).toBe(!seen);
  });
}

for (const width of [375, 1440]) {
  test(`#8022 pending core header keeps its settled row geometry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/board/status', async route => { await gate; await route.fallback(); });
    await page.goto('/dashboard');
    const header = page.locator('main header').first();
    try {
      await expect(header).toBeVisible();
      const before = await header.boundingBox();
      release();
      await expect(page.locator('[data-loading-region="standings"]')).toHaveAttribute('aria-busy', 'false');
      const after = await header.boundingBox();
      expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(1);
    } finally { release(); }
  });

  test(`#8022 pending latest result matches measured card anatomy at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/dashboard/my-latest-result', async route => { await gate; await route.fallback(); });
    await page.goto('/dashboard');
    const heading = page.getByRole('heading', { name: 'Sådan gik det for dit hold', exact: true });
    const card = heading.locator('..').locator('..').locator('..');
    try {
      await expect(page.locator('[data-loading-region="myLatestResult"]')).toHaveAttribute('aria-busy', 'true');
      const before = await card.boundingBox();
      release();
      await expect(page.locator('[data-loading-region="myLatestResult"]')).toHaveCount(0);
      await expect(card).toContainText('Giro di Preview');
      const after = await card.boundingBox();
      expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(8);
    } finally { release(); }
  });
}


test('#8022 dashboard works when AbortSignal.timeout is unavailable', async ({ page }) => {
  await page.addInitScript(() => { Reflect.deleteProperty(AbortSignal, 'timeout'); });
  await page.route('**/rest/v1/race_stage_schedule?**', route => {
    if (!new URL(route.request().url()).searchParams.has('scheduled_at')) return route.fallback();
    return json(route, [{ race_id: 'race-live-1', stage_number: 4, scheduled_at: '2026-11-11T11:00:00Z' }]);
  });
  const selections: string[] = [];
  page.on('request', request => {
    if (/\/api\/races\/[^/]+\/selection/.test(request.url())) selections.push(request.url());
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).toBeVisible();
  await expect(page.locator('a[href="/races/race-live-1?stage=4"]')).toBeVisible();
  await expect.poll(() => selections.length).toBeGreaterThan(0);
  await expect(page.locator('[data-loading-region="myLatestResult"]')).toHaveCount(0);
  await expect(page.locator('a[href="/races/race-done-2"]').first()).toBeVisible();
});


test('#8022 an early empty stage read aborts pending profile enrichment', async ({ page }) => {
  let release!: () => void;
  let profileStarted!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { profileStarted = resolve; });
  let profileAborted = false;
  page.on('requestfailed', request => {
    if (request.url().includes('/rest/v1/race_stage_profiles?')) profileAborted = true;
  });
  await page.route('**/rest/v1/race_stage_schedule?**', route => {
    if (!new URL(route.request().url()).searchParams.has('scheduled_at')) return route.fallback();
    return json(route, [{ race_id: 'race-live-1', stage_number: 4, scheduled_at: '2026-11-11T11:00:00Z' }]);
  });
  await page.route('**/rest/v1/race_stage_profiles?**', async route => {
    profileStarted();
    await gate;
    await route.fallback();
  });
  await page.route('**/rest/v1/races?**', async route => {
    if (new URL(route.request().url()).searchParams.get('select') !== 'id,name,race_type,stages,stages_completed,status') return route.fallback();
    await started;
    await json(route, []);
  });
  await page.goto('/dashboard');
  try {
    await expect.poll(() => profileAborted).toBe(true);
    await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).toBeVisible();
  } finally { release(); }
});


for (const module of ['signup', 'onboarding', 'discord']) {
  test(`#8022 initial layout includes resolved ${module} presence within the mount budget`, async ({ page }) => {
    let release!: () => void;
    let held = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const path = module === 'signup' ? '/api/season/signup-status' : `/api/me/${module === 'discord' ? 'discord-status' : 'onboarding-progress'}`;
    await page.route('**/api/me/onboarding-progress', route => json(route, { established: true, completed_count: 4, total_count: 4, steps: [] }));
    await page.route(`**${path}`, async route => {
      held = true;
      await gate;
      await json(route, module === 'signup'
        ? { enabled: true, eligible: true, parked: false, signed_up: false, next_season_number: 4 }
        : module === 'discord' ? { discord_id: null }
          : { completed_count: 0, total_count: 4, steps: [] });
    });
    await page.goto('/dashboard');
    try {
      await expect.poll(() => held).toBe(true);
      await page.waitForTimeout(700);
      await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).not.toBeVisible();
      release();
      await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).toBeVisible();
      if (module === 'signup') await expect(page.getByTestId('season-signup-card')).toBeVisible();
      if (module === 'onboarding') await expect(page.getByText(/Kom i gang.*0\/4/)).toBeVisible();
      if (module === 'discord') await expect(page.locator('a[href="/profile?tab=notifications#discord"]')).toBeVisible();
    } finally { release(); }
  });
}

test('#8022 optional presence cannot extend the total mount budget or suppress late valid signup', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/season/signup-status', async route => {
    await gate;
    await json(route, { enabled: true, eligible: true, parked: false, signed_up: false, next_season_number: 4 });
  });
  await page.goto('/dashboard');
  try {
    await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).toBeVisible({ timeout: 2500 });
    await expect(page.getByTestId('season-signup-card')).toHaveCount(0);
    release();
    await expect(page.getByTestId('season-signup-card')).toBeVisible();
  } finally { release(); }
});


test('#8022 failed finished-stage details keep the reserved status line empty', async ({ page }) => {
  await page.route('**/rest/v1/race_stage_schedule?**', route => {
    if (!new URL(route.request().url()).searchParams.has('scheduled_at')) return route.fallback();
    return json(route, [{ race_id: 'race-live-1', stage_number: 4, scheduled_at: '2026-11-11T11:00:00Z' }]);
  });
  await page.route('**/rest/v1/races?**', route => {
    if (new URL(route.request().url()).searchParams.get('select') !== 'id,name,race_type,stages,stages_completed,status') return route.fallback();
    return json(route, [{ id: 'race-live-1', name: 'Finished fixture', race_type: 'stage_race', stages: 4, stages_completed: 4, status: 'completed' }]);
  });
  let failed = false;
  await page.route('**/rest/v1/race_results?**', route => {
    if (new URL(route.request().url()).searchParams.get('rank') !== 'eq.1') return route.fallback();
    failed = true;
    return json(route, { message: 'unavailable' }, 503);
  });
  await page.goto('/dashboard');
  const stage = page.locator('a[href="/races/race-live-1?stage=4"]');
  await expect(stage).toBeVisible();
  await expect.poll(() => failed).toBe(true);
  // Enrichment has settled when the pending skeleton disappears.
  await expect(stage.locator('.cz-skeleton-static')).toHaveCount(0);
  await expect.poll(() => stage.evaluate(el => {
    const line = Array.from(el.querySelectorAll('div')).find(node => node.classList.contains('min-h-[18px]'))!;
    return { text: line.textContent?.trim(), minHeight: getComputedStyle(line).minHeight };
  })).toEqual({ text: '', minHeight: '18px' });
});


for (const change of ['progress', 'state']) {
  test(`#8022 changed stage ${change} drops stale enrichment while refreshing`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-11T12:00:00Z') });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let scheduleReads = 0;
    let winnerReads = 0;
    await page.route('**/rest/v1/race_stage_schedule?**', route => {
      if (!new URL(route.request().url()).searchParams.has('scheduled_at')) return route.fallback();
      scheduleReads += 1;
      const scheduled_at = change === 'state' && scheduleReads > 1 ? '2026-11-11T13:00:00Z' : '2026-11-11T11:00:00Z';
      return json(route, [{ race_id: 'race-live-1', stage_number: 4, scheduled_at }]);
    });
    await page.route('**/rest/v1/races?**', route => {
      if (new URL(route.request().url()).searchParams.get('select') !== 'id,name,race_type,stages,stages_completed,status') return route.fallback();
      return json(route, [{ id: 'race-live-1', name: 'Refresh fixture', race_type: 'stage_race', stages: 6,
        stages_completed: change === 'progress' && scheduleReads > 1 ? 5 : 4, status: 'active' }]);
    });
    await page.route('**/rest/v1/race_results?**', async route => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get('rank') === 'eq.1') {
        winnerReads += 1;
        const refreshed = winnerReads > 1;
        if (refreshed) await gate;
        return json(route, [{ race_id: 'race-live-1', stage_number: 4, result_type: 'stage', rank: 1,
          rider_name: refreshed ? 'Current Winner' : 'Previous Winner' }]);
      }
      if (params.get('race_id') !== 'eq.race-live-1') return route.fallback();
      const refreshed = scheduleReads > 1;
      return json(route, [
        { race_id: 'race-live-1', stage_number: refreshed && change === 'progress' ? 5 : 4, result_type: 'team', team_id: TEST_TEAM.id, rank: refreshed ? 1 : 2 },
        { race_id: 'race-live-1', stage_number: refreshed && change === 'progress' ? 5 : 4, result_type: 'team', team_id: 'other-team', rank: refreshed ? 2 : 1 },
      ]);
    });
    await page.goto('/dashboard');
    const stage = page.locator('a[href="/races/race-live-1?stage=4"]');
    try {
      await expect(stage.getByText(/Previous Winner/)).toBeVisible();
      await expect(stage.getByText('#2 af 2 samlet', { exact: true })).toBeVisible();
      await page.clock.fastForward(60_000);
      await expect.poll(() => winnerReads).toBe(2);
      await expect(stage.locator('.cz-skeleton-static')).toHaveCount(change === 'progress' ? 2 : 1);
      await expect(stage.getByText(/Previous Winner/)).toHaveCount(0);
      await expect(stage.getByText('#2 af 2 samlet', { exact: true })).toHaveCount(0);
      release();
      await expect(stage.getByText('#1 af 2 samlet', { exact: true })).toBeVisible();
      if (change === 'progress') await expect(stage.getByText(/Current Winner/)).toBeVisible();
    } finally { release(); }
  });
}


test('#8022 confirmed no-team settles the title and dependent card placeholders', async ({ page }) => {
  await page.route('**/rest/v1/teams?**', route => {
    if (!new URL(route.request().url()).searchParams.has('user_id')) return route.fallback();
    return json(route, null);
  });
  await page.goto('/dashboard');
  await expect(page.locator('main header h1')).toHaveText('Dashboard');
  await expect(page.locator('main header h1 .cz-skeleton-static')).toHaveCount(0);
  await expect(page.locator('main [data-loading-region][aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Dagens etaper', exact: true })).toHaveCount(0);
});

test('#8022 a failed team read uses the existing error state instead of confirmed absence', async ({ page }) => {
  await page.route('**/rest/v1/teams?**', route => {
    if (!new URL(route.request().url()).searchParams.has('user_id')) return route.fallback();
    return json(route, { code: 'fixture-error', message: 'team read unavailable' }, 400);
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('alert').filter({ hasText: /^Kunne ikke indl/ })).toBeVisible();
  await expect(page.locator('main header a[href="/finance"]')).toHaveCount(0);
});


for (const scenario of [{ width: 1440, hold: 'board' }, { width: 1024, hold: 'board' }, { width: 1440, hold: 'team' }, { width: 375, hold: 'board' }]) {
  test(`#8022 pending desktop season and board match settled anatomy at ${scenario.width}px with ${scenario.hold} held`, async ({ page }) => {
    await page.setViewportSize({ width: scenario.width, height: 900 });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let held = false;
    const path = scenario.hold === 'board' ? '**/api/board/status' : '**/rest/v1/teams?**';
    await page.route(path, async route => {
      if (scenario.hold === 'team' && !new URL(route.request().url()).searchParams.has('user_id')) return route.fallback();
      held = true;
      await gate;
      await route.fallback();
    });
    await page.goto('/dashboard');
    const slot = page.locator('[data-loading-region="seasonBanner"]');
    const boardHeading = page.getByRole('heading', { name: 'Bestyrelsens status', exact: true });
    try {
      await expect.poll(() => held).toBe(true);
      await expect(page.locator('main header')).toBeVisible({ timeout: 2500 });
      const pendingSeason = await slot.count() ? await slot.boundingBox() : null;
      const pendingBoard = await boardHeading.count() ? await boardHeading.locator('xpath=../..').boundingBox() : null;
      await page.screenshot({ path: evidenceShotPath(`pr-screens/8019-review2-${test.info().project.name}-${scenario.width}-${scenario.hold}-pending.png`), fullPage: true });
      release();
      const seasonLink = page.locator('main a[href="/planning?tab=calendar"].group.block.h-full');
      await expect(seasonLink).toBeVisible();
      await expect(boardHeading).toBeVisible();
      const settledSeason = await seasonLink.boundingBox();
      const settledBoard = await boardHeading.locator('xpath=../..').boundingBox();
      await test.info().attach('canonical-season-board-geometry', { body: JSON.stringify({ scenario, pendingSeason, settledSeason, pendingBoard, settledBoard }), contentType: 'application/json' });
      await page.screenshot({ path: evidenceShotPath(`pr-screens/8019-review2-${test.info().project.name}-${scenario.width}-${scenario.hold}-settled.png`), fullPage: true });
      if (scenario.width >= 1024) {
        expect(pendingSeason).not.toBeNull();
        expect(pendingBoard).not.toBeNull();
        expect(Math.abs(pendingSeason!.height - settledSeason!.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(pendingBoard!.height - settledBoard!.height)).toBeLessThanOrEqual(1);
      } else {
        expect(pendingSeason).toBeNull();
        expect(pendingBoard).toBeNull();
      }
    } finally { release(); }
  });
}
