// #5435 — foer/efter-screenshots (kontakt off/on) af de tre flader: rytterprofil,
// Mit hold og rytterdatabasen. Ad-hoc capture-script (ikke i CI-suiten;
// testMatch fanger kun *.spec.*), samme moenster som 4628-team-pages.shots.mjs.
// Koerer mod en koerende e2e-build (VITE_E2E=1) med e2e-netvaerksmocks, dvs.
// preview-seed-data (seedData.js). Kontakten styres af svaret paa
// GET /api/display-flags, praecis som i prod.
//
//   node tests/e2e/5435-best-role.shots.mjs <baseURL> <off|on>

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = await import(pathToFileURL(resolve(__dirname, "fixtures.js")).href);
const { installNetworkMocks, login, json, corsHeaders } = fixtures;

const BASE = process.argv[2] || "http://127.0.0.1:4399";
const PHASE = process.argv[3] === "on" ? "on" : "off";
const OUT = resolve(__dirname, "../../../docs/screenshots/feat-5435-best-role-kit");
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  { slug: "profile", path: "/riders/rider-1" },
  { slug: "profile-scouting", path: "/riders/rider-1?tab=scouting" },
  { slug: "team", path: "/team" },
  { slug: "riders", path: "/riders" },
];

const VARIANTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

async function mockFlag(page) {
  await page.route("**/api/display-flags", route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, { rider_best_role_display: PHASE === "on" });
  });
}

const browser = await chromium.launch();

for (const variant of VARIANTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: variant.width, height: variant.height },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    try {
      // Login-fixturen er DA-laast; hver side skifter selv til EN nedenfor.
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
  await mockFlag(loginPage);
  await login(loginPage);
  await loginPage.close();

  for (const spec of ROUTES) {
    const page = await context.newPage();
    await page.addInitScript(() => {
      try { window.localStorage.setItem("cz_lang", "en"); } catch { /* ignore */ }
    });
    await installNetworkMocks(page);
    await mockFlag(page);
    await page.goto(spec.path, { waitUntil: "domcontentloaded" });
    await page.locator("main").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; }).catch(() => {});
    await page.waitForTimeout(1500);
    const file = resolve(OUT, `${spec.slug}-${variant.name}-${PHASE}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`saved ${file}`);
    await page.close();
  }
  await context.close();
}

await browser.close();
