// #4628 — foer/efter-screenshots af de tre hold-/manager-sider (slice 3 af
// #4622). Ad-hoc capture-script (ikke i CI-suiten; testMatch fanger kun
// *.spec.js), samme moenster som 4624-quality-audit.shots.mjs. Koerer mod en
// koerende dev-/preview-server med e2e-netvaerksmocks.
//
//   node tests/e2e/4628-team-pages.shots.mjs <baseURL> <before|after>

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = await import(pathToFileURL(resolve(__dirname, "fixtures.js")).href);
const { installNetworkMocks, login } = fixtures;

const BASE = process.argv[2] || "http://127.0.0.1:5303";
const PHASE = process.argv[3] || "after";
const OUT = resolve(__dirname, "../../../docs/screenshots/feat-4628-team-pages-kit");
mkdirSync(OUT, { recursive: true });

const TEAM_ID = "team-e2e";
const RIVAL_TEAM_ID = "team-rival";

const ROUTES = [
  { slug: "team", path: "/team" },
  { slug: "teams-id", path: `/teams/${RIVAL_TEAM_ID}` },
  { slug: "managers-teamid", path: `/managers/${TEAM_ID}` },
];

const VARIANTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];

const browser = await chromium.launch();

for (const variant of VARIANTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: variant.width, height: variant.height },
    deviceScaleFactor: 1,
  });
  // EN + lys + samtykke sat, animationer slaaet fra — samme init-payload som
  // #4624's audit-script, blot med engelsk sprog (PR-kravet: lys, EN).
  await context.addInitScript(() => {
    try {
      // Login-fixturen er DA-laast (hardcodede danske placeholders), saa
      // konteksten starter paa dansk; hver screenshot-side skifter selv til EN
      // via sin egen addInitScript (page-init koerer EFTER context-init).
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

  for (const spec of ROUTES) {
    const page = await context.newPage();
    await page.addInitScript(() => {
      try { window.localStorage.setItem("cz_lang", "en"); } catch { /* ignore */ }
    });
    await installNetworkMocks(page);
    await page.goto(spec.path, { waitUntil: "domcontentloaded" });
    await page.locator("main").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; }).catch(() => {});
    await page.waitForTimeout(1200);
    const file = resolve(OUT, `${spec.slug}-${variant.name}-${PHASE}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`saved ${file}`);
    await page.close();
  }
  await context.close();
}

await browser.close();
