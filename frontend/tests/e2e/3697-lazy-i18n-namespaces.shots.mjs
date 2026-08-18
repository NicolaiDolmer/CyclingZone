// #3697 — screenshots af de flader hvis i18n-namespace nu lazy-loades via
// HttpBackend i stedet for at ligge inline i language-chunken.
//
// Formålet er visuel evidens for at ready-gaten virker: ingen rå nøgler
// ("board:dna.title", "notifications:tabs.mine") nogen steder på de gatede
// flader, hverken på desktop eller mobil.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js) — samme mønster som 3811-patchnotes-unread-dot.shots.mjs.
//
//   npm run build
//   npm run preview -- --host 127.0.0.1 --port 4636 --strictPort &
//   node tests/e2e/3697-lazy-i18n-namespaces.shots.mjs http://127.0.0.1:4636

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:4636";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

// Fladerne hvis namespace er flyttet ud af index-chunken (ét pr. gate-type:
// route-gate, fane-gate, kort-gate).
const ROUTES = [
  { slug: "dashboard", path: "/dashboard" }, // board: kort-niveau gate
  { slug: "board", path: "/board" }, // board: route-gate
  { slug: "notifications", path: "/notifications" }, // notifications: route-gate
  { slug: "standings", path: "/standings" }, // standings: route-gate
  { slug: "profile", path: "/profile" }, // profile: route-gate
  { slug: "watchlist", path: "/watchlist" }, // watchlist: route-gate
  { slug: "resultater", path: "/resultater" }, // results: route-gate
];

// Rå i18n-nøgler ser ud som "namespace:some.key". Fanger regressionen direkte
// i stedet for at bede en læser om at stirre på billedet.
const RAW_KEY_RE =
  /\b(board|notifications|standings|profile|watchlist|results|achievements|activity|planner|calendar|forum|founder|pro|roadmap|scouting|seasonEnd|staffOverview|admin):[a-zA-Z0-9_.]+/;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let rawKeyHits = 0;

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await stabilizePage(page);
  await login(page);

  for (const route of ROUTES) {
    await page.goto(route.path);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    const body = await page.locator("body").innerText();
    const hit = body.match(RAW_KEY_RE);
    if (hit) {
      rawKeyHits += 1;
      console.error(`[3697] RÅ NØGLE på ${vp.name}${route.path}: ${hit[0]}`);
    }

    await page.screenshot({
      path: resolve(OUT, `3697-${route.slug}-${vp.name}.png`),
      fullPage: false,
    });
  }

  await context.close();
}

await browser.close();

if (rawKeyHits > 0) {
  console.error(`[3697] ${rawKeyHits} flade(r) viste rå i18n-nøgler — ready-gaten holder ikke.`);
  process.exit(1);
}
console.log(`[3697] Screenshots skrevet til ${OUT} — 0 rå i18n-nøgler på ${ROUTES.length} flader × ${VIEWPORTS.length} viewports.`);
