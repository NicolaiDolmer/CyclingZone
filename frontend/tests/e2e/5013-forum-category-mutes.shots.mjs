// #5013 — screenshots af abonnement pr. forum-kategori (PR-review).
// Ad-hoc capture-script (samme mønster som forum-mark-all-read.shots.mjs,
// ikke en del af CI-suiten — testMatch fanger kun *.spec.js).
//
//   node tests/e2e/5013-forum-category-mutes.shots.mjs [baseURL] [outDir]
//
// Fanger de tre flader ejeren skal kunne se:
//   a) kategori-hovedet i BEGGE tilstande (følger / slået fra)
//   b) den samlede liste i indstillingerne
//   c) nav-badget før og efter at den sidste ulæste kategori slås fra

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

async function stabilizeEnglish(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cz_lang", "en");
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false,
      email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
    const css = "*, *::before, *::after { animation-duration: 0.001s !important; animation-iteration-count: 1 !important; caret-color: transparent !important; transition-duration: 0s !important; }";
    const inject = () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject, { once: true });
    else inject();
  });
}

async function loginEnglish(page) {
  await page.goto("/login");
  await page.getByPlaceholder("you@email.com").waitFor();
  await page.getByPlaceholder("you@email.com").fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: /^Log in$/ }).click();
  await page.waitForURL(/\/dashboard$/);
}

const BASE = process.argv[2] || "http://127.0.0.1:5199";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../..", "pr-screens/5013"));

// Ejer-krav: desktop 1280px + mobil 390px.
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
];

const TOGGLE = "[data-testid=forum-category-subscription-toggle]";

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    locale: "en-GB",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await stabilizeEnglish(page);
  await loginEnglish(page);

  // (c, før) Dashboardet: nav-badget lyser, fordi to tråde i "General" er ulæste.
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: resolve(OUT, `nav-badge-before-${vp.name}.png`), fullPage: false });

  // (a, følger) Kategori-hovedet i "General" med ulæst-markeringer i listen.
  await page.goto("/forum?category=general");
  await page.locator(TOGGLE).waitFor();
  await page.screenshot({ path: resolve(OUT, `category-header-following-${vp.name}.png`), fullPage: false });

  // (a, slået fra) Samme flade efter ét klik: ulæst-markeringerne er væk,
  // trådene står der stadig.
  await page.locator(TOGGLE).click();
  await page.locator(`${TOGGLE}[aria-pressed=false]`).waitFor();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: resolve(OUT, `category-header-muted-${vp.name}.png`), fullPage: false });

  // (c, efter) Nav-badget er slukket — "General" var den eneste kilde til ulæst.
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: resolve(OUT, `nav-badge-after-${vp.name}.png`), fullPage: false });

  // (b) Indstillingerne: alle seks kategorier, "General" står som fravalgt.
  await page.goto("/profile");
  await page.locator("#forum-category-general").waitFor();
  await page.locator("#forum-category-general").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(OUT, `settings-list-${vp.name}.png`), fullPage: false });

  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
