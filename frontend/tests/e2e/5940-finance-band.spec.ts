import { test, expect } from './e2e-base.js';
import { installNetworkMocks, login, json, stabilizePage, evidenceShotPath, corsHeaders, TEST_TEAM } from './fixtures.js';
import { baseline as recordedBaselines } from './5940-finance-baseline.ts';
import { fileURLToPath, pathToFileURL } from 'node:url';

// JS null/[] defaults do not describe its accepted input types. Validate
// the current runtime response against the fixed historical baseline below.
const afterFile = fileURLToPath(new URL('../../../backend/lib/financeForecast.js', import.meta.url));
const { computeMultiSeasonForecast } = await import(pathToFileURL(afterFile).href);

for (const scenario of [{ name: 'strong', division: 1, estimate: 200000, realized: 0 }, { name: 'low-division', division: 4, estimate: 200, realized: 0 }, { name: 'realized-floor', division: 4, estimate: 200, realized: 1000 }] as const) {
  test(`#5940: ${scenario.name} prize range shows the owner-selected estimate band`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-10-05T12:00:00Z'));
    await stabilizePage(page);
    await installNetworkMocks(page);
    const args = { team: { ...TEST_TEAM, division: scenario.division }, currentSeasonNumber: 4,
      riders: [{ salary: 10000, prize_earnings_bonus: scenario.estimate, current_production_value: 100000 }],
      debtCeiling: 900000, seasonsAhead: 1, realizedSeasonPrize: scenario.realized };
    const baseline = recordedBaselines[scenario.name];
    const corrected = computeMultiSeasonForecast(args);
    expect(corrected.forecasts[0].projected_prize).toBe(baseline.forecasts[0].projected_prize);
    const point = Math.max(scenario.estimate, scenario.realized);
    expect(corrected.forecasts[0].prize_low).toBe(point * 0.8);
    expect(corrected.forecasts[0].prize_high).toBe(point * 1.2);
    let phase: 'before' | 'after' = 'before';
    await page.route('**/api/me/finance-forecast*', route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
      const payload = phase === 'before' ? baseline : corrected;
      return json(route, { ...payload.forecasts[0], ...payload });
    });
    await page.route('**/api/finance/season-switch-preview*', route => json(route, null));
    await login(page);
    for (const current of ['before', 'after'] as const) {
      phase = current;
      await page.goto('/finance');
      const heading = page.getByRole('heading', { name: 'Næste sæson · prognose', exact: true });
      await expect(heading).toBeVisible();
      const card = heading.locator('xpath=../../..');
      const data = (current === 'before' ? baseline : corrected).forecasts[0];
      const range = `${new Intl.NumberFormat('da-DK').format(data.prize_low)}–${new Intl.NumberFormat('da-DK').format(data.prize_high)} CZ$`;
      await expect(card.getByText(range, { exact: true })).toBeVisible();
      const description = scenario.realized > scenario.estimate
        ? 'Mit estimat bygger på holdets optjente præmier, plus/minus 20 %; ikke et målt spænd'
        : 'Mit estimat for dit hold, plus/minus 20 %; ikke et målt spænd';
      await expect(card.getByText(description, { exact: true })).toBeVisible();
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: evidenceShotPath(`pr-screens/6215/${scenario.name}-${current}-${testInfo.project.name}.png`) });
    }
  });
}
