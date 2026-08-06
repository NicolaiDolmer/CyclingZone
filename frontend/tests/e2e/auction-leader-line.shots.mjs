// #3099 — screenshots af "hvem fører?"-linjen på auktions-siden.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en kørende preview/dev-server med e2e-netværksmocks og
// serverer to auktioner, så begge tilstande er synlige i ét billede:
//
//   • "Leading: Northwind Cycling" — et andet hold fører.
//   • "No bids yet"                — ingen har budt; beløbet er startprisen.
//
//   node tests/e2e/auction-leader-line.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, AUCTIONS, RIDERS, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

// Egen stabilisering i stedet for fixtures.stabilizePage: den låser cz_lang til
// "da" på HVER navigation, og player-facing copy reviewes EN-first.
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
const OUT = resolve(process.argv[3] || resolve(__dirname, "../screenshots/3099-auction-leader-line"));

const base = AUCTIONS[0];
const led = {
  ...base,
  id: "auction-led",
  current_price: 1_240_000,
  current_bidder_id: "team-northwind",
  current_bidder: { id: "team-northwind", name: "Northwind Cycling" },
};
// Anden auktion uden bud: samme rytter-form, nyt id/navn så rækkerne kan skelnes.
const untouched = {
  ...base,
  id: "auction-untouched",
  rider: { ...RIDERS[1], id: "rider-shot", firstname: "Jonas", lastname: "Berg" },
};

const VIEWPORTS = [
  { name: "desktop", width: 1600, height: 900 },
  { name: "mobile-393", width: 393, height: 900 },
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
  await page.route("**/rest/v1/auctions**", (route) => (
    route.request().method() === "GET" ? json(route, [led, untouched]) : json(route, [])
  ));
  await stabilizeEnglish(page);
  await loginEnglish(page);
  await page.goto("/auctions");
  const leaderLine = page.getByText(/^Leading: Northwind Cycling$/).filter({ visible: true }).first();
  await leaderLine.waitFor();
  // Desktop: luk live-bud-panelet, ellers ligger bud-kolonnen uden for
  // tabellens synlige bredde og linjen ville kun kunne ses ved sidescroll.
  const feedToggle = page.getByRole("button", { name: /^Live bids$/ });
  if (vp.width >= 768 && await feedToggle.count()) await feedToggle.click();
  await leaderLine.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(OUT, `${vp.name}.png`), fullPage: false });
  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
