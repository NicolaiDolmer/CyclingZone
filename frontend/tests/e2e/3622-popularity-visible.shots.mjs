// #3622 — screenshots af popularitet på markedet + rytterprofilen.
//
// Issuet: popularitet var kun synlig i bestyrelsen (star-score-blandingen).
// Dette script viser den nye Popularitet-kolonne i rytterdatabasen (marked)
// og den nye Popularitet-hero-stat på rytterprofilen, desktop + mobil.
// Seed-dataen (src/preview/seedData.js) har ingen popularity-felter endnu,
// så en LOKAL route-override (registreret EFTER installNetworkMocks — senest
// registrerede route vinder) beriger riders-svaret med en deterministisk
// popularity pr. rytter-id, uden at røre den delte seed-fil.
//
//   node tests/e2e/3622-popularity-visible.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const { parseTable, restRows, restObject, wantsObject } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/mockHandlers.js")).href
);

const BASE = process.argv[2] || "http://localhost:5173";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

const myRider = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];

// Deterministisk 0-100-værdi pr. rytter-id (samme klasse hash som backend
// bruger til seeded støj andre steder) — kun til screenshot-demonstration.
function popularityFor(id) {
  let hash = 0;
  const str = String(id);
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return hash % 101;
}
// Myrider (egen trup-topscorer): fastholdt højt så profil-screenshottet viser
// et tydeligt tal over bestyrelsens 75-tærskel (selve issuets eksempel).
const FORCED = { [myRider.id]: 82 };

function withPopularity(data) {
  if (Array.isArray(data)) {
    return data.map((r) => (r && r.id != null ? { ...r, popularity: FORCED[r.id] ?? popularityFor(r.id) } : r));
  }
  if (data && data.id != null) {
    return { ...data, popularity: FORCED[data.id] ?? popularityFor(data.id) };
  }
  return data;
}

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
  // #3622: berig riders-svaret med popularity — registreret EFTER
  // installNetworkMocks, så denne route vinder for riders-tabellen.
  await page.route("**/rest/v1/riders?**", (route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.fallback();
    const table = parseTable(request.url());
    const accept = request.headers().accept || "";
    const data = wantsObject(accept) ? restObject(table, request.url()) : restRows(table, request.url());
    return json(route, withPopularity(data));
  });
  await stabilizeEnglish(page);
  await login(page);

  await page.goto("/riders");
  await page.getByRole("table").waitFor({ timeout: 20000 });
  // Tabellen er T2 wide-data (overflow-x-auto) — Popularitet-kolonnen sidder
  // efter Løn, uden for viewport'ets startvisning. Scroll headeren i sigte
  // før screenshot, så kolonnen faktisk ses (ikke kun tilstede i DOM'en).
  // Scroll den vandret-scrollende tabel-wrapper (T2 DataTable, .overflow-x-auto)
  // helt til højre, så Popularitet-kolonnen (efter Løn) faktisk er i billedet.
  await page.evaluate(() => {
    const scroller = document.querySelector(".overflow-x-auto");
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(OUT, `3622-market-popularity-${label}.png`), fullPage: true });

  await page.goto(`/riders/${myRider.id}`);
  await page.getByText(/popularity/i).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(OUT, `3622-profile-popularity-${label}.png`), fullPage: true });

  await context.close();
  await browser.close();
}

mkdirSync(OUT, { recursive: true });
await shootViewport(1280, "desktop");
await shootViewport(390, "mobile");
console.log(`Screenshots → ${OUT}`);
