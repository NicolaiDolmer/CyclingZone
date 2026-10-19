import { test, expect } from './e2e-base.js';
import { installNetworkMocks, stabilizePage, login, json, evidenceShotPath } from './fixtures.js';

const scenarios = [
  { name: 'autumn', now: '2026-10-24T22:30:00Z', ready: '2026-10-26T07:00:00Z' },
  { name: 'spring', now: '2026-03-28T22:30:00Z', ready: '2026-03-29T06:00:00Z' },
];

test.use({ timezoneId: 'Europe/Copenhagen' });

for (const scenario of scenarios) {
  test(`#6862 scouting uses tomorrow across the ${scenario.name} DST change`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date(scenario.now));
    await stabilizePage(page);
    await installNetworkMocks(page);
    await page.route('**/api/scouting/me', route => json(route, {
      scoutSystemEnabled: true, slots: { total: 1, used: 1, remaining: 0 }, maxLevel: 3, levels: {},
    }));
    await page.route('**/api/scouting/central', route => json(route, {
      scout: { overall: 40, roleSkills: { evaluation: 40, reach: 40 }, isDefault: true },
      active: [{ id: 'dst-mission', kind: 'mission', status: 'active',
        mission_criteria: { scope: 'country', value: 'DK' }, ready_at: scenario.ready }],
      completed: [], teamHistory: [], capacity: 1,
      jobConfig: { targetEtaMinutes: 30, targetCostPerLevel: 1000, missionDays: 2, missionCost: 6000 },
    }));
    await login(page);
    await page.goto('/scouting');
    const report = page.getByText(/^Rapport klar /);
    await expect(report).toBeVisible();
    await report.scrollIntoViewIfNeeded();
    // Capture the real page before asserting, so a failing baseline records the defect too.
    await page.screenshot({ path: evidenceShotPath(`pr-screens/6862-${scenario.name}-${testInfo.project.name}.png`) });
    await expect(report).toHaveText('Rapport klar omkring kl. 08:00 i morgen');
  });
}