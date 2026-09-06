import { chromium } from "file:///C:/Dev/CyclingZone/frontend/node_modules/playwright/index.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const pages = ["crashes-AB", "time-limit-AB", "route-gaps"];

const browser = await chromium.launch();
for (const name of pages) {
  for (const [suffix, width] of [["", 1200], ["-mobile", 390]]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(path.join(dir, `${name}.html`)).href, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(dir, `${name}${suffix}.png`);
    await page.screenshot({ path: out, fullPage: true });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log(`${name}${suffix}.png  ${width}x${h}`);
    await ctx.close();
  }
}
await browser.close();
