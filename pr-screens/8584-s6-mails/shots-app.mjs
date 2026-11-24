// #8396: skaermbilleder af det nye i S6 til mailens topbillede.
//
//   node pr-screens/8584-s6-mails/shots-app.mjs <ud-mappe>
//
// Starter selv Vite med preview-mocken (VITE_PREVIEW_MOCK: ingen login, ingen backend,
// kun opdigtede ryttere og hold), tager billeder af tre flader paa telefonbredde i EN og DA
// og lukker serveren igen. Billederne er raamateriale til compose-hero.mjs.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const FRONTEND = join(ROOT, "frontend");
const require = createRequire(join(FRONTEND, "package.json"));
const OUT = resolve(process.argv[2] || join(HERE, ".raw"));
mkdirSync(OUT, { recursive: true });

process.env.VITE_PREVIEW_MOCK = "1";
process.env.VITE_SUPABASE_URL = "https://cycling-zone-e2e.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "e2e-anon-key";

export function findChromium() {
  if (process.env.CZ_CHROMIUM) return process.env.CZ_CHROMIUM;
  const base = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "ms-playwright") : null;
  if (!base || !existsSync(base)) return undefined;
  const shell = readdirSync(base).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();
  const exe = shell ? join(base, shell, "chrome-headless-shell-win64", "chrome-headless-shell.exe") : null;
  return exe && existsSync(exe) ? exe : undefined;
}

const CONSENT = JSON.stringify({ necessary: true, analytics: false, updated_at: "2026-11-23T00:00:00Z" });
// Hver flade aabnes med de preview-kontakter, der svarer til det, der er taendt for alle i prod.
const PAGES = [
  {
    key: "race",
    url: "/races/race-live-1?racePageV6=on&stage=2",
    click: { name: { en: /^Story/, da: /^Historie/ } },
  },
  { key: "training", url: "/training?trainingR5=1&trainingWeek=1" },
  { key: "development", url: "/riders/rider-1?potentialEstimate=on&tab=development" },
];

const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const { chromium } = require("playwright");
const port = Number(process.env.CZ_SHOT_PORT || 5296);
const server = await createServer({
  root: FRONTEND,
  configFile: join(FRONTEND, "vite.config.js"),
  server: { port, strictPort: true, host: "127.0.0.1", hmr: false, fs: { strict: false } },
  logLevel: "error",
});
await server.listen();
const base = `http://127.0.0.1:${port}`;
let browser = null;
try {
  browser = await chromium.launch({ executablePath: findChromium() });
  for (const lang of ["en", "da"]) {
    for (const p of PAGES) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 }, deviceScaleFactor: 2 });
      await ctx.addInitScript(({ c, l }) => {
        try {
          localStorage.setItem("cz_consent_v1", c);
          localStorage.setItem("cz_lang", l);
          localStorage.setItem("cz-theme", "light");
        } catch { /* uden storage vises standarden */ }
      }, { c: CONSENT, l: lang });
      const page = await ctx.newPage();
      await page.goto(base + p.url, { waitUntil: "load" });
      await page.waitForSelector("main", { timeout: 30000 });
      await page.waitForTimeout(3500);
      if (p.click) {
        const target = page.getByText(p.click.name[lang]).first();
        if (await target.count()) {
          await target.click();
          await page.waitForTimeout(2500);
        } else {
          console.warn("mangler", p.key, lang, p.click.name[lang]);
        }
      }
      // Den faste bundmenu daekker indholdet paa et stillbillede; den skjules kun i billedet.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll("body *")) {
          const s = getComputedStyle(el);
          if (s.position === "fixed" && el.getBoundingClientRect().bottom >= window.innerHeight - 2) el.style.display = "none";
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `${p.key}-${lang}.png`) });
      if (process.env.CZ_FULL) await page.screenshot({ path: join(OUT, `${p.key}-${lang}-full.png`), fullPage: true });
      console.log("ok", p.key, lang, page.url());
      await ctx.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
