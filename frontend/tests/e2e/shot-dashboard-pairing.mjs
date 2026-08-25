// Dashboard-omlægningen (#4249) — screenshot der faktisk VISER to-kolonne-
// parringen.
//
// Hvorfor et script mere: `shot-forum-highlights.mjs` rammer en mock-tilstand
// hvor `isFirstRaceMoment()` er sand. Første-løbs-øjeblikket ejer toppen ALENE
// (#3310), så parrene kollapser korrekt til fuld bredde — og screenshottet ser
// derfor ud, som om omlægningen ikke virker. Ejeren bad 25/8 specifikt om at
// se, at moduler IKKE går kant til kant; det kræver en tilstand hvor begge
// halvdele har data.
//
// Kneb: override `/api/dashboard/my-latest-result` så `history` ikke er tom.
// `isFirstRaceMoment` (frontend/src/lib/firstRaceMoment.js) returnerer false
// når historyCount > 0 → `myLatestResultPaired` bliver sand → kortet parres
// med "Næste træk" i stedet for at stå alene.
//
//   node tests/e2e/shot-dashboard-pairing.mjs [baseURL] [outDir]

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

// Et resultat MED historik → ikke første-løbs-øjeblik → kortet parres.
const PAIRED_RESULT = {
  race: {
    id: "shot-race-1",
    name: "Giro di Preview",
    seen: true,
    finished_at: "2026-08-20T14:00:00.000Z",
    best_position: 2,
    best_rider_name: "Ada Pedersen",
    points: 80,
    prize_money: 194000,
  },
  history: [
    { id: "shot-race-0", name: "Omloop Preview", position: 1, points: 45, prize_money: 140000 },
    { id: "shot-race-h2", name: "Grand Prix Preview", position: 7, points: 12, prize_money: 40000 },
  ],
  season_totals: { races: 3, points: 137, prize_money: 374000 },
};

const BASE = process.argv[2] || "http://localhost:5210";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../..", "pr-screens/forum-synlighed"));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

for (const [label, width, height] of [["desktop", 1440, 1600], ["mobile", 390, 1400]]) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width, height },
    deviceScaleFactor: 2,
    locale: "en-GB",
    isMobile: width < 768,
    hasTouch: width < 768,
  });
  const page = await context.newPage();
  await installNetworkMocks(page);

  // Override oven på installNetworkMocks — senest registrerede route vinder.
  await page.route("**/api/dashboard/my-latest-result**", route => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "GET,OPTIONS",
        },
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PAIRED_RESULT),
    });
  });

  await stabilizeEnglish(page);
  await loginEnglish(page);
  await page.goto("/dashboard");
  await page.locator('[data-testid="forum-highlights-card"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT, `dashboard-pairing-${label}.png`), fullPage: false });
  await context.close();
}

await browser.close();
console.log(`Screenshots -> ${OUT}`);
