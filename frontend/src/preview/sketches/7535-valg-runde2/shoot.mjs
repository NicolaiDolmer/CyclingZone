// Tager billederne til #8254: hver variant for punkt 4-8 som helsides billede ved 1440 og 390,
// lagt side om side med wireframen fra 2/11, med caption øverst og nummererede afvigelser.
// Punkt 4 tages i begge tilstande (profil vist og skjult). Starter sin egen vite-dev-server i
// forgrunden, bruger maskinens Edge og lukker begge igen, så intet bliver kørende. Kør fra frontend/:
//   node src/preview/sketches/7535-valg-runde2/shoot.mjs [id ...]
import { createServer } from "vite";
import { chromium } from "playwright";
import path from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, "../../../..");
const repo = path.resolve(frontend, "..");
const out = path.join(repo, "pr-screens/7535/valg-runde2");
mkdirSync(out, { recursive: true });

const { VARIANTS, POINTS, statesFor, shotName } = await import("./variants.ts");
const only = process.argv.slice(2);
const list = only.length ? VARIANTS.filter((v) => only.includes(v.id)) : VARIANTS;

const dataUrl = (buf) => `data:image/png;base64,${buf.toString("base64")}`;
const WF = {
  d: { src: dataUrl(readFileSync(path.join(repo, "pr-screens/7535/prototype-desktop-1440.png"))), w: 1440, h: 1000 },
  m: { src: dataUrl(readFileSync(path.join(repo, "pr-screens/7535/prototype-mobile-375.png"))), w: 375, h: 812 },
};

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
const base = server.resolvedUrls.local[0].replace(/\/$/, "") + "/src/preview/sketches/7535-valg-runde2";
const browser = await chromium.launch({ channel: process.env.SHOOT_CHANNEL || "msedge" });

async function ready(page) {
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(120);
}

try {
  for (const [w, vw, vh, scale] of [["d", 1440, 900, 1], ["m", 390, 844, 2]]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: scale, colorScheme: "light" });
    const page = await ctx.newPage();
    for (const v of list) {
      for (const state of statesFor(v)) {
        // 1) Varianten som helside. Vinduet gøres lige så højt som siden, så klæbende elementer står
        //    hvor de hører til, og afvigelsernes placering måles i samme koordinater som billedet.
        await page.setViewportSize({ width: vw, height: vh });
        await page.goto(`${base}/index.html?id=${v.id}${state ? `&state=${state}` : ""}&w=${w}`, { waitUntil: "networkidle" });
        await ready(page);
        const fullH = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
        // Flyder siden ud over bredden, tages billedet bredere; numrene placeres så efter den faktiske bredde.
        const fullW = await page.evaluate(() => Math.ceil(document.documentElement.scrollWidth));
        if (fullW > vw) console.warn("bredere end vinduet:", v.id, state, fullW);
        await page.setViewportSize({ width: vw, height: fullH });
        await page.waitForTimeout(150);
        const raw = await page.evaluate(() =>
          [...document.querySelectorAll("[data-dev],[data-note]")]
            .map((el) => {
              const r = el.getBoundingClientRect();
              const dev = el.getAttribute("data-dev");
              return { kind: dev ? "dev" : "note", text: dev ?? el.getAttribute("data-note"), x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
            })
            .filter((m) => m.w > 0 && m.h > 0),
        );
        const shot = await page.screenshot({ fullPage: true });
        // Samme tekst = samme nummer; afvigelser først, så noter.
        const order = [...raw.filter((m) => m.kind === "dev"), ...raw.filter((m) => m.kind === "note")];
        const numbers = new Map();
        const marks = order.map((m) => {
          if (!numbers.has(m.text)) numbers.set(m.text, numbers.size + 1);
          return { ...m, n: numbers.get(m.text) };
        });

        // 2) Arket: caption + wireframen + varianten med numre.
        const data = {
          mobile: w === "m", point: v.point, pointName: POINTS[v.point], letter: v.letter, name: v.name, line: v.line,
          recommended: v.recommended, wireframe: v.wireframe, wfNote: v.wfNote, state,
          wfSrc: WF[w].src, wfW: WF[w].w, wfH: WF[w].h,
          shotSrc: dataUrl(shot), shotW: Math.max(vw, fullW), shotH: fullH, marks,
        };
        const sheet = await ctx.newPage();
        await sheet.addInitScript((d) => { window.__COMPOSE = d; }, data);
        await sheet.setViewportSize({ width: 800, height: 600 });
        await sheet.goto(`${base}/compose.html`, { waitUntil: "networkidle" });
        await ready(sheet);
        const size = await sheet.evaluate(() => {
          const el = document.getElementById("root").firstElementChild;
          return { w: Math.ceil(el.scrollWidth), h: Math.ceil(el.scrollHeight) };
        });
        await sheet.setViewportSize({ width: size.w, height: size.h });
        await sheet.waitForTimeout(150);
        const file = path.join(out, `${shotName(v, state)}-${w === "d" ? "1440" : "390"}.png`);
        await sheet.screenshot({ path: file, fullPage: true });
        await sheet.close();
        console.log("ok", path.relative(repo, file), `${marks.filter((m) => m.kind === "dev").length} afvigelser`);
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
