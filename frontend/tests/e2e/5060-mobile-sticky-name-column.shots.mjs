// #5060 — foer/efter-screenshots af den pinnede navnekolonne paa mobil (375x812).
// Ad-hoc capture-script (ikke i CI-suiten; testMatch fanger kun *.spec.js).
// Koerer mod en koerende dev-/preview-server med e2e-netvaerksmocks.
//
//   node tests/e2e/5060-mobile-sticky-name-column.shots.mjs <baseURL> <outDir> <before|after> [chromium|webkit]
//
// DET HER SCRIPT ASSERTERER INTET. Det producerer billeder til PR-kroppen, og
// et billede er ikke en guard. Selve kontrakten — navnecellen og dens overskrift
// staar stille, intet maler oven paa dem, hairline foelger cellen — maales i
// `5060-mobile-sticky-name-column.spec.js`, som CI koerer paa BEGGE mobil-motorer
// (mobile-chromium = Pixel 5/Android-UA, mobile-webkit = iPhone 13). Den 4.
// parameter findes fordi `chromium` alene med `isMobile: true` stadig er en
// desktop-Chromium: skal billederne vise en anden motor, saa vaelg webkit.
//
// Hver rute scrolles vandret helt ud i tabellens egen scroller; screenshottet er
// viewportet (ikke fullPage), fordi det er praecis den tilstand spilleren
// beskriver: navnekolonnen skal stadig staa der naar tallene er scrollet forbi.

import { chromium, webkit } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = await import(pathToFileURL(resolve(__dirname, "fixtures.js")).href);
const { installNetworkMocks, login } = fixtures;

const BASE = process.argv[2] || "http://127.0.0.1:5311";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));
const PHASE = process.argv[4] || "after";
const ENGINE = process.argv[5] === "webkit" ? webkit : chromium;
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  { slug: "mit-hold", path: "/team" },
  // Evne-matricen paa Mit hold: 15 tal-kolonner er den bredeste tabel i appen,
  // og #4982's padding-fund sidder her — tages med saa fixet kan ses paa den
  // vaerste case og saa #4982 ikke forvaerres ubemaerket.
  {
    slug: "mit-hold-evner",
    path: "/team",
    prepare: async (page) => {
      const tab = page.getByRole("button", { name: /abilities|evner/i }).first();
      if (await tab.count()) await tab.click();
      await page.waitForTimeout(600);
    },
  },
  { slug: "traening", path: "/training" },
  { slug: "rangliste-ryttere", path: "/standings?tab=riders" },
];

const browser = await ENGINE.launch();
const context = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});

await context.addInitScript(() => {
  try {
    window.localStorage.setItem("cz_lang", "da");
    window.localStorage.setItem("cz-theme", "light");
    window.localStorage.setItem(
      "cz_consent_v1",
      JSON.stringify({
        version: 1, necessary: true, analytics: false, marketing: false,
        email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
      })
    );
  } catch { /* ignore */ }
  const css = `*, *::before, *::after { animation-duration: .001s !important; animation-iteration-count: 1 !important; caret-color: transparent !important; transition-duration: 0s !important; }`;
  const inject = () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject, { once: true });
  else inject();
});

const loginPage = await context.newPage();
await installNetworkMocks(loginPage);
await login(loginPage);
await loginPage.close();

const report = [];

for (const spec of ROUTES) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    try { window.localStorage.setItem("cz_lang", "en"); } catch { /* ignore */ }
  });
  await installNetworkMocks(page);
  await page.goto(spec.path, { waitUntil: "domcontentloaded" });
  await page.locator("main").first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  await page.locator("table").first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; }).catch(() => {});
  await page.waitForTimeout(1500);
  if (spec.prepare) await spec.prepare(page);

  // Scroll tabellens egen scroller helt ud til hoejre + bring tabellen i view.
  const geom = await page.evaluate(() => {
    const table = document.querySelector("main table");
    if (!table) return { found: false };
    const scroller = table.closest("div[class*='overflow']");
    if (scroller) {
      scroller.scrollLeft = scroller.scrollWidth;
      scroller.scrollIntoView({ block: "start" });
    }
    const firstBodyCell = table.querySelector("tbody tr td");
    const firstHeadCell = table.querySelector("thead tr th");
    const read = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        position: cs.position,
        left: cs.left,
        zIndex: cs.zIndex,
        backgroundColor: cs.backgroundColor,
        rectLeft: Math.round(r.left),
        rectWidth: Math.round(r.width),
        text: el.textContent.trim().slice(0, 30),
      };
    };
    return {
      found: true,
      scrollLeft: scroller ? Math.round(scroller.scrollLeft) : null,
      scrollWidth: scroller ? Math.round(scroller.scrollWidth) : null,
      clientWidth: scroller ? Math.round(scroller.clientWidth) : null,
      bodyCell: read(firstBodyCell),
      headCell: read(firstHeadCell),
    };
  });
  await page.waitForTimeout(400);

  const file = resolve(OUT, `${spec.slug}-375x812-${PHASE}.png`);
  await page.screenshot({ path: file });
  report.push({ route: spec.path, file, ...geom });
  console.log(`saved ${file}`);
  console.log(JSON.stringify(geom, null, 2));
  await page.close();
}

writeFileSync(resolve(OUT, `geom-${PHASE}.json`), JSON.stringify(report, null, 2));
await context.close();
await browser.close();
