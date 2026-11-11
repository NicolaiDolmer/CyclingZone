// #2230: browser LAB evidence, never a substitute for production field data.
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { installNetworkMocks, TEST_USER, json } from '../frontend/tests/e2e/fixtures.js';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const sirv = require('sirv');
const stage = process.argv[2];
if (!['before', 'after'].includes(stage)) throw Error('Expected before or after');
const server = http.createServer(sirv(path.resolve(process.argv[3] || 'frontend/dist'), { single: 'app.html', dev: true }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const results = [];
await mkdir('pr-screens/2230', { recursive: true });
try {
  for (const [profile, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 393, height: 852 }]]) {
    for (const scenario of ['landing', 'dashboard-empty', 'dashboard-race', 'dashboard-results']) {
      const route = scenario === 'landing' ? '/' : '/dashboard';
      for (let repeat = 1; repeat <= 5; repeat++) {
        const page = await browser.newPage({ viewport, reducedMotion: 'no-preference' });
        await page.clock.setFixedTime(new Date('2026-11-11T12:00:00Z'));
        await installNetworkMocks(page);
        // The generic fixture ignores scheduled_at filters. Model the real API
        // explicitly: an empty day or one actual stage on the injected date.
        await page.route('**/rest/v1/race_stage_schedule?**', intercepted => {
          if (!new URL(intercepted.request().url()).searchParams.has('scheduled_at')) return intercepted.fallback();
          return json(intercepted, scenario === 'dashboard-race'
            ? [{ race_id: 'race-live-1', stage_number: 4, scheduled_at: '2026-11-11T11:00:00Z' }]
            : []);
        });
        if (scenario === 'dashboard-results') await page.route('**/api/dashboard/recent-results', intercepted => json(intercepted, {
          races: Array.from({ length: 5 }, (_, i) => ({ race_id: `race-${i}`, name: `Fixture race ${i}`, race_type: 'one_day', winner: { result_type: 'gc', rider_id: `rider-${i}`, firstname: 'Ada', lastname: 'Pedersen', team_name: 'E2E Racing' } })),
        }));
        // Identical deterministic response latency. Slow results exercise independent cards.
        await page.route(/\/(rest\/v1|api)\//, async intercepted => {
          const slow = /recent-results|rider-ranking/.test(intercepted.request().url());
          await new Promise(resolve => setTimeout(resolve, slow ? 3000 : 300));
          await intercepted.fallback();
        });
        await page.addInitScript(({ user, authenticated }) => {
          localStorage.setItem('cz_lang', 'da');
          localStorage.setItem('cz_consent_v1', JSON.stringify({ version: 1, necessary: true, analytics: false, marketing: false, email_marketing: false, updated_at: '2026-05-13T00:00:00.000Z' }));
          if (authenticated) localStorage.setItem('sb-cycling-zone-e2e-auth-token', JSON.stringify({ access_token: 'e2e-access-token', refresh_token: 'e2e-refresh-token', token_type: 'bearer', expires_at: 1794402000, user }));
          const shifts = [];
          window.__loadingEvidence = { shifts, cls: 0, lcp: 0 };
          let sessionStart = 0, last = 0, sum = 0;
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
              if (entry.hadRecentInput) continue;
              if (entry.startTime - last > 1000 || entry.startTime - sessionStart > 5000) { sessionStart = entry.startTime; sum = 0; }
              sum += entry.value;
              last = entry.startTime;
              window.__loadingEvidence.cls = Math.max(window.__loadingEvidence.cls, sum);
              shifts.push({ time: entry.startTime, value: entry.value, sources: (entry.sources || []).map(s => ({ tag: s.node?.tagName, className: s.node?.className, previous: s.previousRect.toJSON(), current: s.currentRect.toJSON() })) });
            }
          }).observe({ type: 'layout-shift', buffered: true });
          new PerformanceObserver(list => { window.__loadingEvidence.lcp = list.getEntries().at(-1).startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
        }, { user: TEST_USER, authenticated: route !== '/' });
        await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
        await page.locator(route === '/' ? '#main > section h1' : 'h1').filter({ hasText: route === '/' ? /./ : 'E2E Racing' }).waitFor();
        if (scenario === 'dashboard-results') await page.getByRole('heading', { name: 'Seneste resultater', exact: true }).scrollIntoViewIfNeeded();
        if (repeat === 1) {
          await page.screenshot({ path: `pr-screens/2230/${stage}-${profile}-${scenario}-loading.png`, fullPage: true });
          if (scenario === 'dashboard-results') await page.screenshot({ path: `pr-screens/2230/${stage}-${profile}-results-loading-viewport.png` });
        }
        await page.waitForTimeout(6000);
        const evidence = await page.evaluate(() => window.__loadingEvidence);
        results.push({ stage, profile, viewport, route, scenario, repeat, ...evidence });
        if (repeat === 1) {
          await page.screenshot({ path: `pr-screens/2230/${stage}-${profile}-${scenario}.png`, fullPage: true });
          if (scenario === 'dashboard-results') await page.screenshot({ path: `pr-screens/2230/${stage}-${profile}-results-settled-viewport.png` });
        }
        await page.close();
      }
    }
  }
  await writeFile(`pr-screens/2230/${stage}-measurements.json`, JSON.stringify({ protocol: 2, browser: browser.version(), fixedTime: '2026-11-11T12:00:00Z', apiLatencyMs: 300, delayedCardsMs: 3000, observationAfterHeadingMs: 6000, results }, null, 2) + '\n');
  console.log(JSON.stringify(results.map(({profile,scenario,repeat,cls,lcp}) => ({profile,scenario,repeat,cls,lcp}))));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
