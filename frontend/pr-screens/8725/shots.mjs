// #8725 (TASTE v2 M1): foer/efter-billeder af kittets små labels.
//
//   node frontend/pr-screens/8725/shots.mjs
//
// Foer = kontakten sentence_case_8725 slukket (= main), efter = taendt
// (?sentenceCase=on i preview-mocken). Samme kode, samme data, kun kontakten
// skifter. Starter selv Vite med preview-mocken (VITE_PREVIEW_MOCK, ingen login,
// ingen backend, ingen prod-data) i SAMME proces og lukker den igen.
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "../..");
const require = createRequire(resolve(FRONTEND, "package.json"));
const LANGS = (process.argv[2] || "da").split(",");

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

const CONSENT = JSON.stringify({ necessary: true, analytics: false, updated_at: "2026-11-26T00:00:00Z" });
const VIEW = { 390: { width: 390, height: 844 }, 1440: { width: 1440, height: 900 } };
const PAGES = [
  { key: "rytterdatabase", url: "/riders", wait: "main table tbody tr" },
  { key: "rytterprofil", url: "/riders/rider-1", wait: "main h1" },
  { key: "menu", url: "/riders", wait: "main table tbody tr", menu: true },
];

const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const { chromium } = require("playwright");
const port = Number(process.env.CZ_SHOT_PORT || 5297);
const server = await createServer({
  root: FRONTEND,
  configFile: resolve(FRONTEND, "vite.config.js"),
  server: { port, strictPort: true, host: "127.0.0.1", hmr: false, fs: { strict: false } },
  logLevel: "error",
});
await server.listen();
const base = `http://127.0.0.1:${port}`;
let browser = null;
try {
  browser = await chromium.launch({ executablePath: findChromium() });
  for (const lang of LANGS) {
    for (const p of PAGES) {
      for (const vw of [390, 1440]) {
        if (p.menu && vw === 1440) continue; // menuen staar i rytterdatabasens 1440-billede
        for (const state of ["foer", "efter"]) {
          const ctx = await browser.newContext({ viewport: VIEW[vw], deviceScaleFactor: 2 });
          await ctx.addInitScript(({ c, l }) => {
            try {
              localStorage.setItem("cz_consent_v1", c);
              localStorage.setItem("cz_lang", l);
              localStorage.setItem("cz-theme", "light");
            } catch { /* uden storage vises standarden */ }
          }, { c: CONSENT, l: lang });
          const page = await ctx.newPage();
          const q = state === "efter" ? "sentenceCase=on" : "sentenceCase=off";
          await page.goto(`${base}${p.url}${p.url.includes("?") ? "&" : "?"}${q}`, { waitUntil: "load" });
          await page.waitForSelector(p.wait, { timeout: 30000 });
          await page.waitForTimeout(2500);
          const on = await page.evaluate(() => document.documentElement.hasAttribute("data-sentence-case"));
          if (on !== (state === "efter")) throw new Error(`${p.key} ${vw} ${state}: data-sentence-case=${on}`);
          if (p.menu) {
            await page.locator('button[aria-label^="Åbn menu"], button[aria-label^="Open menu"]').first().click();
            await page.waitForTimeout(800);
          }
          const file = join(HERE, `${p.key}-${vw}-${state}${LANGS.length > 1 ? `-${lang}` : ""}.png`);
          await page.screenshot({ path: file, fullPage: p.key === "rytterprofil" });
          console.log(`ok ${file}`);
          await ctx.close();
        }
      }
    }
  }
} finally {
  if (browser) await browser.close();
  await server.close();
}
