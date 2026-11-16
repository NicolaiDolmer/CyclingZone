// Tager valg-billederne til #7535: hver variant ved 1440 og 390 px i pr-screens/7535/valg/.
// Starter sin egen vite-dev-server i forgrunden, tager billederne og lukker den igen, så
// intet bliver kørende bagefter. Kør fra frontend/:
//   node src/preview/sketches/7535-valg/shoot.mjs [id ...]
import { createServer } from "vite";
import { chromium } from "playwright";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, "../../../..");
const out = path.resolve(frontend, "../pr-screens/7535/valg");
mkdirSync(out, { recursive: true });

const { VARIANTS } = await import("./variants.ts");
const only = process.argv.slice(2);
const list = only.length ? VARIANTS.filter((v) => only.includes(v.id)) : VARIANTS;

const server = await createServer({
  root: frontend,
  configFile: path.join(frontend, "vite.config.js"),
  server: { port: 5000 + Math.floor(Math.random() * 900), strictPort: false, open: false },
  logLevel: "error",
});
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch();
try {
  for (const [w, vw, vh, scale] of [["d", 1440, 1000, 1], ["m", 390, 900, 2]]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: scale, colorScheme: "light", isMobile: w === "m", hasTouch: w === "m" });
    const page = await ctx.newPage();
    for (const v of list) {
      await page.goto(`${base}/src/preview/sketches/7535-valg/index.html?id=${v.id}&w=${w}`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 15000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      const file = path.join(out, `${v.point}${v.letter.toLowerCase()}-${w === "d" ? "1440" : "390"}.png`);
      await page.screenshot({ path: file });
      console.log("ok", path.relative(frontend, file));
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
