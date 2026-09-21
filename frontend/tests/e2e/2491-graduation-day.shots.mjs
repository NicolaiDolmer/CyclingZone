// #2491 — PR-screenshots af Graduation Day-siden i begge tilstande fra den
// ejer-godkendte mockup: 3g (fyldt) og 3h (tom).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Koerer mod en koerende preview-server med e2e-netvaerksmocks og
// den SAMME fixture som 2491-graduation-day.spec.js, saa billedet ejeren
// godkender viser praecis den tilstand testen paastaar noget om.
//
//   node tests/e2e/2491-graduation-day.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, json, corsHeaders } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const { SEED_ACADEMY } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/seedData.js")).href
);
const { GRADUATES, ESTIMATES_PAYLOAD } = await import(
  pathToFileURL(resolve(__dirname, "2491-graduation-day.fixture.js")).href
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

async function login(page) {
  await page.goto("/login");
  await page.getByPlaceholder(/email/i).waitFor();
  await page.getByPlaceholder(/email/i).fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard$/);
}

const BASE = process.argv[2] || "http://127.0.0.1:4173";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

const STATES = [
  { name: "filled", graduations: GRADUATES, wait: /Aksel Berg/i },
  { name: "empty", graduations: [], wait: /No riders are graduating/i },
];

// Ejer-kravet: desktop 1440 og mobil 390.
const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 1000 },
  { name: "mobile-390", width: 390, height: 844 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  for (const state of STATES) {
    const context = await browser.newContext({
      baseURL: BASE,
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      locale: "en-US",
    });
    const page = await context.newPage();
    await installNetworkMocks(page);
    // Registreret EFTER installNetworkMocks, saa disse handlere vinder.
    await page.route("**/api/academy/me**", (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      return json(route, { ...SEED_ACADEMY, graduations: state.graduations });
    });
    await page.route("**/api/scouting/estimates", (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      if (request.method() !== "POST") return route.fallback();
      return json(route, ESTIMATES_PAYLOAD);
    });
    await stabilizeEnglish(page);
    await login(page);
    await page.goto("/academy/graduation");
    await page.getByText(state.wait).first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: resolve(OUT, `2491-${vp.name}-${state.name}.png`),
      fullPage: state.name === "filled",
    });
    await context.close();
  }
}

// Banneret paa Academy: den ene flade der er tilbage der.
for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    locale: "en-US",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await page.route("**/api/academy/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, { ...SEED_ACADEMY, graduations: GRADUATES });
  });
  await stabilizeEnglish(page);
  await login(page);
  await page.goto("/academy");
  await page.getByText(/Open Graduation Day/i).first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT, `2491-${vp.name}-academy-banner.png`), fullPage: false });
  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
