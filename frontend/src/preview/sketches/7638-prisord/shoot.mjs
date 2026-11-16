// Tager billederne til #7638: hver variant som helsides billede ved 1440 og 390, med bogstav, navn og
// én sætning brændt ind øverst (siden tegner selv captionen). Starter sin egen vite-dev-server i
// forgrunden, bruger maskinens Edge og lukker begge igen, så intet bliver kørende. Kør fra frontend/:
//   node src/preview/sketches/7638-prisord/shoot.mjs [a b c]
import { createServer } from "vite";
import { chromium } from "playwright";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, "../../../..");
const repo = path.resolve(frontend, "..");
const out = path.join(repo, "pr-screens/7638-prisord");
mkdirSync(out, { recursive: true });

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ["a", "b", "c"];
const names = { a: "a-ordet-i-knappen", b: "b-ord-og-trappe", c: "c-ordet-i-forklaringen" };

// Kun de plugins skitsen behøver (React + Tailwind); appens HTML-plugins forventer appens index.html.
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
const base = server.resolvedUrls.local[0].replace(/\/$/, "") + "/src/preview/sketches/7638-prisord";
const browser = await chromium.launch({ channel: process.env.SHOOT_CHANNEL || "msedge" });

try {
  for (const [w, vw, vh, scale] of [["d", 1440, 900, 1], ["m", 390, 844, 2]]) {
    for (const scheme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: scale, colorScheme: scheme });
      const page = await ctx.newPage();
      for (const id of ids) {
        await page.goto(`${base}/index.html?id=${id}&w=${w}${scheme === "dark" ? "&theme=dark" : ""}`, { waitUntil: "networkidle" });
        await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(150);
        const file = path.join(out, `${names[id]}-${w === "d" ? "1440" : "390"}${scheme === "dark" ? "-moerk" : ""}.png`);
        // Mørk tages kun ved 1440 for den anbefalede variant; resten lys.
        if (scheme === "dark" && !(id === "a" && w === "d")) continue;
        await page.screenshot({ path: file, fullPage: true });
        console.log("ok", path.relative(repo, file));
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
