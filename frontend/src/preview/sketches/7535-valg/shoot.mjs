// Tager valg-billederne til #7535: hver variant ved 1440 og 390 px i pr-screens/7535/valg/.
// Starter sin egen vite-dev-server i forgrunden, tager billederne og lukker den igen, så
// intet bliver kørende bagefter. Kør fra frontend/:
//   node src/preview/sketches/7535-valg/shoot.mjs [id ...]
import { createServer } from "vite";
import { chromium } from "playwright";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, "../../../..");
const out = path.resolve(frontend, "../pr-screens/7535/valg");
mkdirSync(out, { recursive: true });

const { VARIANTS } = await import("./variants.ts");
const only = process.argv.slice(2);
const list = only.length ? VARIANTS.filter((v) => only.includes(v.id)) : VARIANTS;

// Kun de plugins skitsen behøver (React + Tailwind). Appens HTML-plugins (boot-assets m.fl.)
// forventer appens egen index.html og fejler på en skitseside.
const { default: react } = await import("@vitejs/plugin-react");
const { default: tailwindcss } = await import("@tailwindcss/vite");
const { tailwindV3CompatPlugin } = await import(pathToFileURL(path.join(frontend, "vite-plugins/tailwind-v3-compat.ts")).href);
const server = await createServer({
  root: frontend,
  configFile: false,
  plugins: [react(), tailwindcss({ optimize: false }), tailwindV3CompatPlugin()],
  server: { port: 5000 + Math.floor(Math.random() * 900), strictPort: false, open: false, fs: { strict: false } },
  logLevel: "error",
});
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
// Maskinens egen Edge (eller SHOOT_CHANNEL=chrome), så skitsen aldrig kræver en browser-download.
const browser = await chromium.launch({ channel: process.env.SHOOT_CHANNEL || "msedge" });
try {
  // Skærmen under captionen: 1440×900 og 390×844 (telefon). Vinduet gøres caption-højden
  // højere, så captionen aldrig spiser af det man skal vurdere.
  for (const [w, vw, vh, scale] of [["d", 1440, 900, 1], ["m", 390, 844, 2]]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: scale, colorScheme: "light", isMobile: w === "m", hasTouch: w === "m" });
    const page = await ctx.newPage();
    for (const v of list) {
      await page.setViewportSize({ width: vw, height: vh });
      await page.goto(`${base}/src/preview/sketches/7535-valg/index.html?id=${v.id}&w=${w}`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 15000 });
      await page.evaluate(() => document.fonts.ready);
      const cap = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cap")) || 0);
      await page.setViewportSize({ width: vw, height: Math.round(vh + cap) });
      await page.waitForTimeout(100);
      await page.evaluate(() => window.__scrollToAnchor?.());
      await page.waitForTimeout(150);
      const file = path.join(out, `${v.point}${v.letter.toLowerCase()}-${w === "d" ? "1440" : "390"}.png`);
      const full = w === "d" ? v.fullD : v.fullM;
      await page.screenshot({ path: file, fullPage: Boolean(full) });
      console.log("ok", path.relative(frontend, file));
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
