// #7638: prisordet (Let / Middel / Hård / Meget hård) i wireframets farver på alle ordrer
// med en pris, bag tactics_ready_7864: enkeltstartens indsatstrin, holdets udbrudsholdning,
// de gamle knapper Forsøg udbrud / Sprint-tog og etapeplanens opgaver.
// I CI: én lys gennemgang i desktop-chromium (regression). Med SHOT_7638=before|after tages
// før/efter-billederne ved 1440 og 390, lys og mørk, med ændringsområdet markeret.
import { test, expect } from './e2e-base.js';
import type { Locator, Page, Route } from '@playwright/test';
import { installNetworkMocks, login, stabilizePage, evidenceShotPath, json, corsHeaders, raceResultsRoute } from './fixtures.js';

const RACE = '00000000-0000-4000-8000-000000007638';
const RIDERS = [
  { rider_id: 'r1', name: 'Rytter Et', race_role: 'captain', abandoned: false, stage_fit: { 2: 70 } },
  { rider_id: 'r2', name: 'Rytter To', race_role: 'sprint_captain', abandoned: false, stage_fit: { 2: 60 } },
  { rider_id: 'r3', name: 'Rytter Tre', race_role: 'helper', abandoned: false, stage_fit: { 2: 95 } },
  { rider_id: 'r4', name: 'Rytter Fire', race_role: 'helper', abandoned: false, stage_fit: { 2: 80 } },
];
type Scenario = 'itt' | 'orders' | 'plan';
const MODE = process.env.SHOT_7638 === 'before' || process.env.SHOT_7638 === 'after' ? process.env.SHOT_7638 : null;
const WORDS = ['Let', 'Middel', 'Hård', 'Meget hård'];

async function setup(page: Page, scenario: Scenario, { on = true, theme = 'light' }: { on?: boolean; theme?: 'light' | 'dark' } = {}) {
  await stabilizePage(page);
  await page.clock.setFixedTime(new Date('2026-11-10T10:00:00Z'));
  await installNetworkMocks(page);
  const profileType = scenario === 'itt' ? 'itt' : 'flat';
  const profile = (stage_number: number) => ({ race_id: RACE, stage_number, profile_type: stage_number === 2 ? profileType : 'flat', finale_type: 'bunch_sprint', distance_km: stage_number === 2 && scenario === 'itt' ? 32 : 160, elevation_gain_m: 300, climbs: [], sprints: [], segments: [{ kind: 'flat', from_km: 0, to_km: 160 }], weather: { kind: 'sun', wind_exposure: 0.1 } });
  const race = { id: RACE, name: '7638 Synthetic Preview', race_type: 'stage_race', race_class: 'OtherWorldTourA', stages: 3, stages_completed: 1, edition_year: 2026, status: 'running', engine_rules_revision: 's5_profiles_v3', season: { id: 'season-e2e', number: 1 }, pool_race: null };
  const overrides = scenario === 'plan' ? [] : [
    { stage_number: 2, rider_id: 'r1', race_role: 'captain', effort: 'all_out' },
    { stage_number: 2, rider_id: 'r2', race_role: 'sprint_captain', effort: 'save' },
  ];
  const orders = scenario === 'orders' ? [{ stage_number: 2, breakaway_stance: 'neutral', riders: [{ rider_id: 'r3', try_break: true }, { rider_id: 'r4', leadout: true }] }] : [];
  await page.route('**/rest/v1/races**', (route) => json(route, (route.request().headers().accept || '').includes('vnd.pgrst.object') ? race : [race]));
  await page.route('**/rest/v1/race_results**', raceResultsRoute([]));
  await page.route('**/rest/v1/race_stage_profiles**', (route) => json(route, [1, 2, 3].map(profile)));
  await page.route('**/rest/v1/race_stage_schedule**', (route) => json(route, []));
  await page.route('**/api/feature-flags', (route) => json(route, { flags: { tactics_ready_7864: on } }));
  await page.route(`**/api/races/${RACE}/stage-roles`, async (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, { enabled: true, intention_enabled: true, valid_efforts: ['grupetto', 'save', 'normal', 'protect', 'all_out'], stages_completed: 1, stage_count: 3, riders: RIDERS, overrides, role_scope_choice: true, special_roles_allowed: true });
  });
  await page.route(`**/api/races/${RACE}/team-orders**`, async (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, { stage_count: 3, stages_completed: 1, riders: RIDERS, stage_plan_enabled: scenario === 'plan', atomic_stage_save: false, saved_stage_numbers: [], stages: [1, 2, 3].map((n) => ({ stage_number: n, locked: n === 1, scheduled_at: null })), orders });
  });
  await login(page);
  await page.addInitScript(([lang, th]) => { localStorage.setItem('cz_lang', lang); localStorage.setItem('cz-theme', th); }, ['da', theme]);
  await page.goto(`/races/${RACE}?tab=tactics`);
  await expect(page.getByTestId('race-tactics-tab')).toBeVisible();
}

/** Ændringsområdet: en magenta ramme om de dele, prisordet står i (før og efter samme steder). */
async function markAndShoot(page: Page, targets: Locator[], file: string, width: number) {
  const boxes = [];
  for (const target of targets) {
    for (const el of await target.all()) {
      if (!(await el.isVisible())) continue;
      const box = await el.evaluate((node) => { const r = node.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; });
      boxes.push(box);
    }
  }
  if (!boxes.length) throw new Error(`no change area for ${file}`);
  for (const b of boxes) {
    await page.evaluate((r) => {
      const d = document.createElement('div');
      d.setAttribute('data-shot-mark', '');
      Object.assign(d.style, { position: 'absolute', left: `${r.x - 4}px`, top: `${r.y - 4}px`, width: `${r.w + 8}px`, height: `${r.h + 8}px`, outline: '3px solid #d1007a', borderRadius: '6px', pointerEvents: 'none', zIndex: '9999' });
      document.body.appendChild(d);
    }, b);
  }
  const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - 80);
  const bottom = Math.max(...boxes.map((b) => b.y + b.h)) + 80;
  await page.screenshot({ path: evidenceShotPath(`pr-screens/7638-byg/${file}`), fullPage: true, scale: 'css', clip: { x: 0, y: top, width, height: Math.min(bottom - top, 2400) } });
  await page.evaluate(() => document.querySelectorAll('[data-shot-mark]').forEach((n) => n.remove()));
}

const SCENARIOS: Scenario[] = ['itt', 'orders', 'plan'];
const WIDTHS = MODE ? [1440, 390] : [1440];
const THEMES: Array<'light' | 'dark'> = MODE ? ['light', 'dark'] : ['light'];

for (const scenario of SCENARIOS) for (const width of WIDTHS) for (const theme of THEMES) {
  test(`#7638 ${scenario} ${width} ${theme}: price words in the wireframe colours`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'billederne og regressionen tages kun i desktop-chromium');
    await page.setViewportSize({ width, height: 900 });
    await setup(page, scenario, { theme });
    const tab = page.getByTestId('race-tactics-tab');
    let targets: Locator[] = [];
    if (scenario === 'itt') {
      await expect(page.getByTestId('time-trial-no-road-orders')).toBeVisible();
      await tab.getByRole('button', { name: /^(Skift|Sæt intention)$/ }).filter({ visible: true }).first().click();
      const picker = page.getByTestId('intention-picker').filter({ visible: true });
      await expect(picker).toBeVisible();
      targets = [picker];
      if (MODE !== 'before') {
        await expect(picker.getByTestId('intention-step-cost')).toHaveText(['Let', 'Middel', 'Meget hård']);
        await expect(tab.getByTestId('intention-cost').filter({ visible: true }).first()).toBeVisible();
      }
    } else if (scenario === 'orders') {
      const stance = page.getByTestId('breakaway-stance');
      await expect(stance).toBeVisible();
      targets = [stance, page.getByTestId('order-toggles').filter({ visible: true }).first()];
      if (MODE !== 'before') {
        await expect(stance.getByTestId('stance-cost')).toHaveText(['Hård', 'Middel', 'Let']);
        const toggles = page.getByTestId('order-toggles').filter({ visible: true }).first();
        await expect(toggles.getByTestId('order-toggle-cost')).toHaveText(['Hård', 'Middel']);
        await expect(toggles.getByRole('button').first()).toHaveAccessibleName(/, Hård$/);
        await expect(tab.getByTestId('intention-cost').filter({ visible: true }).first()).toBeVisible();
      }
    } else {
      await expect(page.getByTestId('stage-plan-board')).toBeVisible();
      await page.getByTestId('team-plan-sprint').click();
      const stance = page.getByTestId('breakaway-stance');
      const cost = page.getByTestId('stage-plan-task-cost').filter({ visible: true });
      targets = [stance, cost];
      if (MODE !== 'before') {
        await expect(stance.getByTestId('stance-cost')).toHaveText(['Hård', 'Middel', 'Let']);
        await expect(cost.first()).toBeVisible();
      }
    }
    if (MODE !== 'before') {
      // Samme ord, samme farve alle steder: farven følger ordet, ikke stedet.
      const colours = await page.locator('[data-price]').filter({ visible: true }).evaluateAll((els) => els.map((el) => [el.getAttribute('data-price'), getComputedStyle(el).color]));
      const byWord = new Map<string, Set<string>>();
      for (const [word, colour] of colours) byWord.set(String(word), (byWord.get(String(word)) ?? new Set()).add(String(colour)));
      for (const [word, set] of byWord) expect(set.size, `${word} has one colour`).toBe(1);
      for (const text of await page.locator('[data-price]').filter({ visible: true }).allTextContents()) expect(WORDS).toContain(text);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    if (MODE) await markAndShoot(page, targets, `${scenario}-${width}-${theme}-${MODE}.png`, width);
  });
}

test('#7638 flag off: no price words outside the stage plan', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium' || MODE !== null, 'regression kun i desktop-chromium');
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, 'orders', { on: false });
  await expect(page.getByTestId('breakaway-stance')).toBeVisible();
  await expect(page.locator('[data-price]')).toHaveCount(0);
});
