// #4618 (slice 0 af epic #2492) — PR-screenshots af Akademi-sidens nye
// "Youth squads"-kort (Junior team + U23 team, Coming soon-pille, roadmap-link).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en kørende dev/preview-server med e2e-netværksmocks
// (samme mønster som 3550-academy-intake-pull.shots.mjs).
//
//   node tests/e2e/4618-youth-squads-coming-soon.shots.mjs [baseURL] [outDir]

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

async function login(page) {
  await page.goto("/login");
  await page.getByPlaceholder(/email/i).waitFor();
  await page.getByPlaceholder(/email/i).fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard$/);
}

const BASE = process.argv[2] || "http://127.0.0.1:4542";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../docs/audits/screenshots/4618"));

const VARIANTS = [
  { name: "desktop-light", width: 1280, height: 1400, theme: "light" },
  { name: "desktop-dark", width: 1280, height: 1400, theme: "dark" },
  { name: "mobile-light", width: 375, height: 1400, theme: "light" },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const variant of VARIANTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: variant.width, height: variant.height },
    deviceScaleFactor: 2,
    locale: "en-US",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await stabilizeEnglish(page);
  if (variant.theme === "dark") {
    await page.addInitScript(() => {
      window.localStorage.setItem("cz-theme", "dark");
    });
  }
  await login(page);
  await page.goto("/academy");
  const heading = page.getByText(/Youth squads/i).first();
  await heading.waitFor();
  await page.getByText(/Coming soon/i).first().waitFor();
  await heading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(OUT, `4618-${variant.name}.png`), fullPage: false });
  await context.close();
}

await browser.close();
console.log(`Screenshots -> ${OUT}`);
