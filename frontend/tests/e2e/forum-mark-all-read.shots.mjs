// #3451 — screenshots af "Mark all as read"-knappen på forum-oversigten
// (PR-review). Ad-hoc capture-script (samme mønster som forum.shots.mjs,
// ikke en del af CI-suiten — testMatch fanger kun *.spec.js).
//
//   node tests/e2e/forum-mark-all-read.shots.mjs [baseURL] [outDir]

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
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../..", "pr-screens/3451"));

// Ejer-krav: desktop 1280px + Android-bredde 412px.
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "android-412", width: 412, height: 915 },
];

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

  // Forum-listen: mock-seedet har to ulæste tråde (forum-post-2, forum-post-4),
  // så "Mark all as read" er synlig ved siden af det gold "New post".
  await page.goto("/forum");
  await page.getByRole("button", { name: /^Mark all as read$/ }).waitFor();
  await page.screenshot({ path: resolve(OUT, `forum-mark-all-read-before-${vp.name}.png`), fullPage: false });

  // Klik — knappen forsvinder, gul prik-tilstand ryddet (samme skærmbillede
  // dokumenterer at ingen tråde længere viser ulæst-prikken).
  await page.getByRole("button", { name: /^Mark all as read$/ }).click();
  await page.getByRole("button", { name: /^Mark all as read$/ }).waitFor({ state: "detached" });
  await page.screenshot({ path: resolve(OUT, `forum-mark-all-read-after-${vp.name}.png`), fullPage: false });

  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
