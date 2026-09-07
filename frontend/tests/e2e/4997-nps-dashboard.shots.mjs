// #4997 — screenshots af NPS-bundbaren på dashboardet (desktop + mobil, lukket
// og udfoldet). Ad-hoc capture-script (ikke en del af CI-suiten; testMatch
// fanger kun *.spec.js) — mønster: dashboard-today-stages.shots.mjs.
//
// Kører mod en dev-server startet med VITE_PREVIEW_MOCK=1, IKKE mod
// fixtures.js: baren er gated på "mindst 3 afsluttede løbsdage", og det delte
// seed giver testholdet 2 (se installPreviewMock.js' preview-override og
// mockHandlers' team_id-filter). Fixture-stien skal netop IKKE vise baren —
// ellers ville den flytte hvert eneste dashboard-snapshot.
//
//   npm run dev -- --port 5341   (med VITE_PREVIEW_MOCK=1)
//   node tests/e2e/4997-nps-dashboard.shots.mjs http://localhost:5341 ../pr-screens
//
// Sproget låses til EN (player-facing copy er EN-first).

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.argv[2] || "http://localhost:5341";
const OUT = resolve(process.argv[3] || "./pr-screens");
mkdirSync(OUT, { recursive: true });

const INIT = () => {
  window.localStorage.setItem("cz_lang", "en");
  // Analytics-consent er bevidst FALSE: efter #4997 skal baren vises alligevel
  // (svaret er spillerens frivillige input), mens player_events forbliver tavse.
  window.localStorage.setItem("cz_consent_v1", JSON.stringify({
    version: 1, necessary: true, analytics: false, marketing: false,
    email_marketing: false, updated_at: "2026-09-07T00:00:00.000Z",
  }));
  const css = "*,*::before,*::after{animation-duration:.001s!important;transition-duration:0s!important;caret-color:transparent!important}";
  const inject = () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject, { once: true });
  else inject();
};

async function shoot(browser, { name, width, height, pickScore }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("you@email.com").fill("preview@cyclingzone.local");
  await page.getByPlaceholder("••••••••").fill("preview-mock");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 20000 });
  const bar = page.getByRole("region", { name: "Feedback prompt" });
  await bar.waitFor({ state: "visible", timeout: 20000 });
  if (pickScore != null) {
    await bar.getByRole("radio", { name: String(pickScore), exact: true }).click();
    // Vent paa den UDFOLDEDE tilstand, ikke bare paa en timer: uden dette kunne
    // et *-expanded.png fange baren mens den stadig er sammenklappet.
    await bar.getByPlaceholder("Optional: the main reason, in a sentence or two").waitFor({ state: "visible", timeout: 10000 });
    await bar.getByRole("button", { name: "Send", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  console.log("wrote", name, `${width}x${height}`);
  await ctx.close();
}

const browser = await chromium.launch();
await shoot(browser, { name: "4997-nps-dashboard-desktop", width: 1280, height: 900 });
await shoot(browser, { name: "4997-nps-dashboard-desktop-expanded", width: 1280, height: 900, pickScore: 9 });
await shoot(browser, { name: "4997-nps-dashboard-mobile", width: 375, height: 812 });
await shoot(browser, { name: "4997-nps-dashboard-mobile-expanded", width: 375, height: 812, pickScore: 9 });
await browser.close();
