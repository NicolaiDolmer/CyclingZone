// #8280 (TASTE P21): foer/efter-billeder af tabellens titellinje.
//
//   node frontend/pr-screens/8280/shots.mjs efter       # nuvaerende kode
//   node frontend/pr-screens/8280/shots.mjs foer        # kode fra main (skift filerne foerst)
//
// Starter selv Vite med preview-mocken (VITE_PREVIEW_MOCK, ingen login, ingen backend,
// ingen prod-data) i SAMME proces, tager billederne med Playwright fra frontend/node_modules
// og lukker serveren igen. Uddata: denne mappe (billeder + maalinger-<tilstand>.json).
// "Chrome" = afstanden fra bunden af fanerne/sidehovedet til tabellens overskriftsraekke.
import { createRequire } from "node:module";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "../..");
const require = createRequire(resolve(FRONTEND, "package.json"));
const mode = process.argv[2] === "foer" ? "foer" : "efter";

process.env.VITE_PREVIEW_MOCK = "1";
process.env.VITE_SUPABASE_URL = "https://cycling-zone-e2e.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "e2e-anon-key";

function findChromium() {
  if (process.env.CZ_CHROMIUM) return process.env.CZ_CHROMIUM;
  const base = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "ms-playwright") : null;
  if (!base || !existsSync(base)) return undefined;
  const shell = readdirSync(base).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();
  const exe = shell ? join(base, shell, "chrome-headless-shell-win64", "chrome-headless-shell.exe") : null;
  return exe && existsSync(exe) ? exe : undefined;
}

const CONSENT = JSON.stringify({ necessary: true, analytics: false, updated_at: "2026-11-19T00:00:00Z" });
const VIEW = { 390: { width: 390, height: 844 }, 1440: { width: 1440, height: 900 } };
const PAGES = [
  { key: "rytterrangliste", url: "/standings?tab=riders" },
  { key: "rytterdatabase", url: "/riders" },
];

const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const { chromium } = require("playwright");
const port = Number(process.env.CZ_SHOT_PORT || 5293);
const server = await createServer({
  root: FRONTEND,
  configFile: resolve(FRONTEND, "vite.config.js"),
  server: { port, strictPort: true, host: "127.0.0.1", hmr: false, fs: { strict: false } },
  logLevel: "error",
});
await server.listen();
const base = `http://127.0.0.1:${port}`;
const results = [];
let browser = null;
try {
  browser = await chromium.launch({ executablePath: findChromium() });
  for (const p of PAGES) {
    for (const theme of ["light", "dark"]) {
      for (const vw of [390, 1440]) {
        const ctx = await browser.newContext({ viewport: VIEW[vw], deviceScaleFactor: 2 });
        await ctx.addInitScript(({ c, th }) => {
          try {
            localStorage.setItem("cz_consent_v1", c);
            localStorage.setItem("cz_lang", "en");
            localStorage.setItem("cz-theme", th);
          } catch { /* uden storage vises standarden */ }
        }, { c: CONSENT, th: theme });
        const page = await ctx.newPage();
        await page.goto(base + p.url, { waitUntil: "load" });
        await page.waitForSelector("main table tbody tr", { timeout: 30000 });
        await page.waitForTimeout(2000);
        const m = await page.evaluate(() => {
          const bottoms = [...document.querySelectorAll('main [role="tablist"], main header')].map((e) => e.getBoundingClientRect().bottom);
          const anchor = bottoms.length ? Math.max(...bottoms) : 0;
          const th = document.querySelector("main thead");
          const bar = document.querySelector('[data-testid="table-title-bar"]');
          return {
            anchor: Math.round(anchor),
            theadTop: th ? Math.round(th.getBoundingClientRect().top) : null,
            chrome: th ? Math.round(th.getBoundingClientRect().top - anchor) : null,
            barHeight: bar ? Math.round(bar.getBoundingClientRect().height) : null,
            hScroll: document.documentElement.scrollWidth > window.innerWidth,
          };
        });
        results.push({ page: p.key, theme, vw, ...m });
        await page.screenshot({ path: join(HERE, `${p.key}-${theme}-${vw}-${mode}.png`) });

        if (mode === "efter" && theme === "light") {
          // Kolonne-ark og filter-ark aaben (kun lys, begge bredder).
          for (const [label, selector] of [["kolonner", 'button[aria-label][aria-haspopup="dialog"] .tabular-nums'], ["filter", null]]) {
            let btn = null;
            if (label === "kolonner") {
              btn = page.locator('[data-testid="table-title-bar"] button[aria-haspopup="dialog"]').filter({ has: page.locator("svg") }).nth(p.key === "rytterdatabase" ? 1 : 0);
              if (p.key === "rytterrangliste") btn = page.locator('[data-testid="table-title-bar"] button[aria-haspopup="dialog"]').last();
            } else {
              btn = page.locator('[data-testid="table-title-bar"] button[aria-haspopup="dialog"]').first();
            }
            if (selector === undefined || !(await btn.count())) continue;
            await btn.click();
            await page.waitForTimeout(400);
            await page.screenshot({ path: join(HERE, `${p.key}-${label}-ark-${vw}.png`) });
            await page.keyboard.press("Escape");
            await page.waitForTimeout(200);
          }
        }
        await ctx.close();
      }
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
writeFileSync(join(HERE, `maalinger-${mode}.json`), JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
