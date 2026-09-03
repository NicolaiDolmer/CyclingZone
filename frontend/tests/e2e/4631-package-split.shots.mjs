// #4631 — screenshots af pakkevalget efter splittet af punch og climbing.
// Trin 2 paa en traeningsdag skal vise tre intervaldage: hybriden plus de to
// specialiserede, hver med sin ene linje forklaring.
//
// Koeres mod preview-mock-serveren (VITE_PREVIEW_MOCK=1), som leverer sin egen
// trup — derfor ingen netvaerks-mocks her; fladen faar sine data i appen.
//
//   node tests/e2e/4631-package-split.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.argv[2] || "http://localhost:5305";
const OUT = resolve(process.argv[3] || "pr-screens");

async function stabilizeEnglish(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cz_lang", "en");
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false,
      email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
    const css = "*, *::before, *::after { animation-duration: 0.001s !important; animation-iteration-count: 1 !important; caret-color: transparent !important; transition-duration: 0s !important; }";
    const inject = () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject, { once: true });
    else inject();
  });
}

async function login(page) {
  await page.goto("/login");
  await page.getByPlaceholder(/email/i).waitFor();
  await page.getByPlaceholder(/email/i).fill("preview@cyclingzone.local");
  await page.getByPlaceholder("••••••••").fill("preview-password");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard$/);
}

// Paa mobil ligger navnekolonnen sticky oven paa dags-kolonnen indtil tabellen
// scrolles vandret (T2's mobil-adfaerd, ikke en panel-fejl).
async function openDayPanel(page) {
  await page.evaluate(() => {
    const table = document.querySelector("table[data-sortable]");
    const scroller = table?.closest(".overflow-x-auto");
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  });
  await page.waitForTimeout(120);
  await page.locator('button[aria-label^="Day —"]').first().evaluate((el) => el.click());
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(300);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of [
  { name: "desktop", width: 1280, height: 1000 },
  { name: "mobile", width: 375, height: 900 },
]) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, locale: "en-US" });
  const page = await context.newPage();
  await stabilizeEnglish(page);
  await login(page);

  await page.goto("/training");
  await page.locator("table[data-sortable]").waitFor();
  await page.waitForTimeout(400);

  // Pakkevalget: trin 2 med de tre intervaldage.
  await openDayPanel(page);
  await page.getByRole("radio", { name: "Training", exact: true }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(OUT, `4631-package-picker-${vp.name}.png`), fullPage: true });

  // Den specialiserede pakke valgt: klatreintervaller.
  await page.getByRole("radio", { name: /Climbing intervals/ }).first().click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(OUT, `4631-climbing-selected-${vp.name}.png`), fullPage: true });
  await page.keyboard.press("Escape");

  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
