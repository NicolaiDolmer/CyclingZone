// Reproducible screenshot evidence. Uses compiled app HTML and mocked auth/data;
// never edits HTML, supplies real credentials or calls production APIs.
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { installNetworkMocks, stabilizePage, TEST_USER, json } from '../frontend/tests/e2e/fixtures.js';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const sirv = require('sirv');
const stage = process.argv[2];
if (!['before', 'after'].includes(stage)) throw Error('Expected before or after');
const serve = sirv(path.resolve('frontend/dist'), { single: 'app.html', dev: true });
const server = http.createServer(serve);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const results = [];
await mkdir('pr-screens/5250', { recursive: true });
try {
  for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 393, height: 852 }]]) {
    const page = await browser.newPage({ viewport });
    await page.clock.setFixedTime(new Date('2026-11-11T12:00:00Z'));
    await stabilizePage(page);
    await installNetworkMocks(page);
    await page.addInitScript(user => {
      if (!localStorage.getItem('sb-cycling-zone-e2e-auth-token:cookie-migrated')) localStorage.setItem('sb-cycling-zone-e2e-auth-token', JSON.stringify({ access_token: 'e2e-access-token', refresh_token: 'e2e-refresh-token', expires_at: 1, token_type: 'bearer', user }));
    }, TEST_USER);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/auth/v1/token?**', async route => { await gate; await json(route, { error: 'invalid_grant' }, 400); });
    try {
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
      const target = stage === 'before' ? '#main > section h1' : '[data-auth-loading="static"]';
      await page.locator(target).waitFor({ state: 'visible' });
      await page.screenshot({ path: `pr-screens/5250/${stage}-${name}.png` });
      results.push({ stage, viewport, pathname: new URL(page.url()).pathname, observed: target, auth: 'refresh held pending; deterministic fixture, no production account' });
    } finally { release(); await page.close(); }
  }
  await writeFile(`pr-screens/5250/${stage}-observations.json`, JSON.stringify(results, null, 2) + '\n');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
console.log(`Captured ${stage}: desktop and mobile; browser and server stopped.`);
