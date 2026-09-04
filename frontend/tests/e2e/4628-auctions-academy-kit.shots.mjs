// #4628 / #4262 — screenshots af Auktioner + Akademi paa kittets standard.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Koerer mod en koerende dev-/preview-server med e2e-netvaerksmocks.
// Lys tilstand, EN-locale, desktop 1280 + mobil 375.
//
//   node tests/e2e/4628-auctions-academy-kit.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5302";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];

// Samme stabilisering som fixtures.stabilizePage, men laast til EN-locale og
// lys tilstand (screenshot-kontrakten i briefen).
async function stabilizeEn(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cz_lang", "en");
    window.localStorage.setItem("cz_theme", "light");
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1,
      necessary: true,
      analytics: false,
      marketing: false,
      email_marketing: false,
      updated_at: "2026-05-13T00:00:00.000Z",
    }));
  });
}

async function loginEn(page) {
  await page.goto("/login");
  await page.getByPlaceholder("you@email.com").waitFor();
  await page.getByPlaceholder("you@email.com").fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: /^Log in$/ }).click();
  await page.waitForURL(/\/dashboard$/);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    locale: "en-US",
    colorScheme: "light",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await stabilizeEn(page);
  await loginEn(page);

  await page.goto("/auctions?tab=all");
  await page.getByTestId("auctions-ticker").waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT, `4628-auctions-${vp.name}.png`), fullPage: false });

  await page.goto("/academy");
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(OUT, `4628-academy-${vp.name}.png`), fullPage: false });

  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
