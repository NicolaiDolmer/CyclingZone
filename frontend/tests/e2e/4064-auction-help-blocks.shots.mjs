// #4064 — screenshots af de to auktions-hjælpetekster der aldrig blev vist.
//
// Issuet: help.json havde auctions.valuation og auctions.anonymityAndReveal
// fuldt oversat (en+da), men blocks-arrayet i HelpPage.jsx registrerede dem
// aldrig, så de renderede ikke. Scriptet viser auktions-sektionen på /help
// med begge blokke synlige, desktop + mobil.
//
//   node tests/e2e/4064-auction-help-blocks.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://localhost:5173";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

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

async function shootViewport(width, label) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width, height: width < 600 ? 844 : 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await stabilizeEnglish(page);
  await login(page);

  await page.goto("/help?section=auctions");
  // Begge nye blokke skal faktisk stå i sektionen — ikke kun være i help.json.
  const valuation = page.getByText("The valuation next to a bid", { exact: false }).first();
  await valuation.waitFor({ timeout: 20000 });
  await page.getByText("Anonymous bidding, then a full reveal", { exact: false }).first().waitFor({ timeout: 20000 });
  await valuation.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(OUT, `4064-auction-help-blocks-${label}.png`), fullPage: true });

  await context.close();
  await browser.close();
}

mkdirSync(OUT, { recursive: true });
await shootViewport(1280, "desktop");
await shootViewport(390, "mobile");
console.log(`Screenshots → ${OUT}`);
