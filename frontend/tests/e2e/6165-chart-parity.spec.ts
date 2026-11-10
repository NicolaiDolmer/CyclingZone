import { test, expect } from './e2e-base.js';
import type { Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';

// Opt-in measurement harness: use a dedicated config without the app's global
// setup/webServer. Both static fixture builds run inside the verify-lock slot.
const scratch = process.env.CZ_6165_SCRATCH;
const baseline = process.env.CZ_6165_BASELINE ?? '6c52c88f258c7a997157a6477e3be2ff0280700d';
const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repo = path.dirname(frontend);
const clock = new Date('2030-01-15T12:00:00.000Z');
const chartFiles = [
  'src/components/admin/growth/TrendLineChart.jsx',
  'src/components/SeasonFinanceReportPanel.jsx',
  'src/components/admin/survey/surveyCharts.jsx',
];
let server: Server;
let origin: string;

async function stableImage(locator: Locator, file: string) {
  let previous = await locator.screenshot({ animations: 'disabled' });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await locator.screenshot({ animations: 'disabled' });
    if (current.equals(previous)) {
      writeFileSync(file, current);
      return current;
    }
    previous = current;
  }
  throw new Error('Chart image did not settle across consecutive captures');
}

test.skip(!scratch, 'Set CZ_6165_SCRATCH and use the dedicated static-fixture config.');

test.beforeAll(async () => {
  test.setTimeout(120_000);
  if (!scratch) return;
  mkdirSync(scratch, { recursive: true });
  const quote = (file: string) => JSON.stringify(path.join(frontend, file).replaceAll('\\', '/'));
  const fixture = path.join(scratch, 'fixture.tsx');
  writeFileSync(fixture, `
import React from ${quote('node_modules/react/index.js')};
import { createRoot } from ${quote('node_modules/react-dom/client.js')};
import TrendLineChart from ${quote(chartFiles[0])};
import { Donut } from ${quote(chartFiles[1])};
import { BarList, DualBar, DayBars, QuadrantChart } from ${quote(chartFiles[2])};
import i18n from ${quote('src/i18n/index.js')};
import ${quote('src/index.css')};
const query = new URLSearchParams(location.search);
const empty = query.get('state') === 'empty';
const zero = query.get('state') === 'zero';
await i18n.changeLanguage(query.get('lang') || 'en');
document.documentElement.dataset.theme = query.get('theme') || 'dark';
const data = empty ? [] : [
  { snapshot_date: '2030-01-01', first: 0, second: 1 },
  { snapshot_date: '2030-01-02', first: zero ? 0 : 4, second: zero ? 0 : 3 },
  { snapshot_date: '2030-01-03', first: null, second: zero ? 0 : 2 },
  { snapshot_date: '2030-01-04', first: zero ? 0 : 8, second: 0 },
];
const slices = empty ? [] : [
  { reason_code: 'fixture_a', label: 'Fixture A', value: zero ? 0 : 70 },
  { reason_code: 'fixture_b', label: 'Fixture B', value: zero ? 0 : 30 },
];
createRoot(document.getElementById('root')).render(<div className="bg-cz-app text-cz-1 p-4" style={{width:'100%'}}>
  <section id="line"><TrendLineChart data={data} lines={[
    {key:'first',label:'Fixture A',color:'rgb(var(--cz-chart-1))'},
    {key:'second',label:'Fixture B',color:'rgb(var(--cz-chart-2))'},
  ]} /></section>
  <section id="donut"><Donut title="Fixture" data={slices} emptyLabel="Empty fixture" /></section>
  <section id="survey" className="space-y-4">
    <BarList items={empty ? [] : [{key:'a',label:'Fixture A',value:zero ? 0 : 7,valueLabel:'Fixture'}]} emptyLabel="Empty fixture" />
    <DualBar primary={zero ? 0 : 4} secondary={zero ? 0 : 3} primaryTitle="Fixture A" secondaryTitle="Fixture B" />
    <DayBars data={empty ? [] : [{date:'2030-01-01',started:zero ? 0 : 8,completed:zero ? 0 : 4}]} label="Fixture" emptyLabel="Empty fixture" />
    <QuadrantChart points={empty ? [] : [{key:'a',label:'Fixture A',x:3,y:4,n:1,rank:1}]} axisXLabel="Fixture X" axisYLabel="Fixture Y" cornerLabel="Fixture" />
  </section>
</div>);
window.__chartFixtureReady = true;
`);
  // Importing the real build config preserves the installed React/CSS pipeline;
  // env files and Sentry transforms/uploads are disabled for these fixtures.
  const { default: config } = await import('../../vite.config.js');
  for (const variant of ['before', 'after']) {
    const frozen = new Map(chartFiles.map(file => [
      path.join(frontend, file).replaceAll('\\', '/'),
      execFileSync('git', ['-C', repo, 'show', `${baseline}:frontend/${file}`], { encoding: 'utf8' }),
    ]));
    const plugin: Plugin = {
      name: '6165-frozen-chart-fixture',
      enforce: 'pre',
      load(id) {
        return variant === 'before' ? frozen.get(id.replaceAll('\\', '/')) : undefined;
      },
      transform(code, id) {
        if (id.replaceAll('\\', '/').endsWith('/src/components/SeasonFinanceReportPanel.jsx')) {
          return { code: `${code}\nexport { Donut };`, map: null };
        }
      },
    };
    await build({
      ...config,
      configFile: false,
      root: frontend,
      envDir: false,
      publicDir: false,
      logLevel: 'error',
      resolve: {
        alias: [{ find: /^react\/jsx-runtime$/, replacement: path.join(frontend, 'node_modules/react/jsx-runtime.js') }],
      },
      define: {
        ...config.define,
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://fixture.invalid'),
        'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('synthetic-fixture'),
        'import.meta.env.VITE_API_URL': JSON.stringify('https://fixture.invalid'),
      },
      plugins: [plugin, ...config.plugins.filter((p: { name?: string }) => !p?.name?.includes('sentry'))],
      build: {
        ...config.build,
        sourcemap: false,
        emptyOutDir: false,
        outDir: path.join(scratch, variant),
        rolldownOptions: {
          ...config.build.rolldownOptions,
          input: fixture,
          output: { ...config.build.rolldownOptions.output, entryFileNames: 'fixture.js' },
        },
      },
    });
  }
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture.invalid');
    if (/^\/fonts\/[a-zA-Z0-9._-]+$/.test(url.pathname)) {
      try {
        response.setHeader('Content-Type', 'font/woff2');
        response.end(readFileSync(path.join(frontend, 'public', url.pathname)));
      } catch { response.writeHead(404).end(); }
      return;
    }
    const parts = url.pathname.split('/').filter(Boolean);
    const variant = parts.shift();
    if (!['before', 'after'].includes(variant ?? '') || parts.includes('..')) {
      response.writeHead(404).end(); return;
    }
    const dir = path.join(scratch, variant!);
    if (!parts.length) {
      const css = readdirSync(path.join(dir, 'assets')).filter(file => file.endsWith('.css'));
      response.setHeader('Content-Type', 'text/html');
      response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(file => `<link rel="stylesheet" href="/${variant}/assets/${file}">`).join('')}</head><body><div id="root"></div><script type="module" src="/${variant}/fixture.js"></script></body></html>`);
      return;
    }
    const file = path.join(dir, ...parts);
    try {
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
      response.end(readFileSync(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Static fixture server did not bind');
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    expect(server.listening).toBe(false);
  }
});

for (const state of ['populated', 'empty', 'zero']) {
  for (const lang of ['en', 'da']) {
    for (const theme of ['light', 'dark']) {
      test(`${state}, ${lang}, ${theme}: frozen chart pixels and interactions`, async ({ page }, testInfo) => {
        await page.clock.install({ time: clock });
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
        const images = new Map<string, Buffer>();
        const texts = new Map<string, string>();
        for (const variant of ['before', 'after']) {
          await page.goto(`${origin}/${variant}/?state=${state}&lang=${lang}&theme=${theme}`);
          await page.waitForFunction(() => (window as unknown as { __chartFixtureReady?: boolean }).__chartFixtureReady);
          await page.evaluate(() => document.fonts.ready);
          expect(await page.evaluate(() => window.innerWidth)).toBe(page.viewportSize()!.width);
          await expect(page.locator('#line .recharts-surface[role="application"]')).toBeVisible();
          if (state === 'populated') {
            await expect(page.locator('#line .recharts-line-curve')).toHaveCount(2);
            await expect(page.locator('#donut .recharts-pie-sector')).toHaveCount(2);
          }
          for (const section of ['line', 'donut', 'survey']) {
            const locator = page.locator(`#${section}`);
            const bytes = await stableImage(locator, path.join(scratch!, `${testInfo.project.name}-${state}-${lang}-${theme}-${section}-${variant}.png`));
            const text = await locator.innerText();
            if (variant === 'before') { images.set(section, bytes); texts.set(section, text); }
            else { expect(bytes.equals(images.get(section)!)).toBe(true); expect(text).toBe(texts.get(section)); }
          }
          if (state === 'populated') {
            for (const section of ['line', 'donut']) {
              if (section === 'line') await page.locator('#line .recharts-wrapper').hover({ position: { x: 100, y: 80 } });
              else {
                const sector = page.locator('#donut .recharts-pie-sector path').first();
                await sector.scrollIntoViewIfNeeded();
                // A sector's bounding-box centre can be inside the donut hole.
                // Move to a point inside the painted ring instead of forcing hover.
                const point = await sector.evaluate((element: SVGPathElement) => {
                  const edge = element.getPointAtLength(20);
                  const svg = element.ownerSVGElement!;
                  const centreX = svg.viewBox.baseVal.width / 2;
                  const centreY = svg.viewBox.baseVal.height / 2;
                  const screen = new DOMPoint(centreX + (edge.x - centreX) * 0.8, centreY + (edge.y - centreY) * 0.8).matrixTransform(element.getScreenCTM()!);
                  return { x: screen.x, y: screen.y };
                });
                await page.mouse.move(point.x, point.y);
              }
              await expect(page.locator(`#${section} .recharts-tooltip-wrapper`)).toBeVisible();
              const tooltip = page.locator(`#${section} .recharts-tooltip-wrapper`);
              const text = await tooltip.innerText();
              expect(text).toContain('Fixture');
              const image = await stableImage(page.locator(`#${section}`), path.join(scratch!, `${testInfo.project.name}-${state}-${lang}-${theme}-${section}-hover-${variant}.png`));
              const key = `${section}-hover`;
              if (variant === 'before') { images.set(key, image); texts.set(key, text); }
              else { expect(image.equals(images.get(key)!)).toBe(true); expect(text).toBe(texts.get(key)); }
              await page.mouse.move(0, 0);
            }
          }
        }
        expect(errors).toEqual([]);
      });
    }
  }
}
