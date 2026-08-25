// Forum-synlighed (#3199, variant B) — screenshots til PR-review: dashboard-
// kortet ("From the forum") + den nye nav-rækkefølge (Forum lige efter Inbox).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Samme mønster som forum.shots.mjs (#3199): rigtig e2e-netværks-
// mock (installNetworkMocks — Playwright page.route, ikke VITE_PREVIEW_MOCK),
// så scriptet kører mod en almindelig `npm run dev`-server.
//
//   node tests/e2e/shot-forum-highlights.mjs [baseURL] [outDir]

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

const BASE = process.argv[2] || "http://localhost:5210";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../..", "pr-screens/forum-synlighed"));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

// 1) Desktop: dashboard med "From the forum"-kortet.
{
  const context = await browser.newContext({
    baseURL: BASE, viewport: { width: 1440, height: 1500 }, deviceScaleFactor: 2, locale: "en-GB",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await stabilizeEnglish(page);
  await loginEnglish(page);
  await page.goto("/dashboard");
  await page.locator('[data-testid="forum-highlights-card"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, "dashboard-forum-card-desktop.png"), fullPage: false });
  await page.locator('[data-testid="forum-highlights-card"]').screenshot({ path: resolve(OUT, "forum-card-closeup-desktop.png") });

  // Nav-rækkefølge: Forum lige efter Inbox i Klubhus-gruppen.
  await page.locator("nav").first().screenshot({ path: resolve(OUT, "nav-order-desktop.png") });
  await context.close();
}

// 2) Mobil: dashboard med kortet.
{
  const context = await browser.newContext({
    baseURL: BASE, viewport: { width: 393, height: 1700 }, deviceScaleFactor: 2, locale: "en-GB",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await stabilizeEnglish(page);
  await loginEnglish(page);
  await page.goto("/dashboard");
  await page.locator('[data-testid="forum-highlights-card"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, "dashboard-forum-card-mobile.png"), fullPage: false });
  await context.close();
}

// 3) Tom-tilstand: forum-listen tømmes for pinned+items via en override AF
// installNetworkMocks's egen /api/forum/posts-route (Playwright: senest
// registrerede route for samme mønster vinder), samme "override-oven-på"-
// mønster som installBoardStatusMock i fixtures.js.
{
  const context = await browser.newContext({
    baseURL: BASE, viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, locale: "en-GB",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await page.route("**/api/forum/posts**", route => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,OPTIONS" } });
    }
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ pinned: [], items: [], next_cursor: null, limit: 2 }),
    });
  });
  await stabilizeEnglish(page);
  await loginEnglish(page);
  await page.goto("/dashboard");
  await page.getByText("Nothing new since your last visit.").waitFor({ timeout: 20000 });
  await page.waitForTimeout(300);
  await page.locator('[data-testid="forum-highlights-card"]').screenshot({ path: resolve(OUT, "forum-card-empty-desktop.png") });
  await context.close();
}

await browser.close();
console.log(`Screenshots -> ${OUT}`);
