// #3956 — screenshots af popularitet på holdoversigten + auktionssiden.
//
// Issuet: popularitet (shippet på markedet + rytterprofilen via #3622) kunne
// hverken findes på holdoversigten eller auktionssiden, og slet ikke på
// mobil de to steder. Dette script viser den nye Popularitet-kolonne/-badge
// på /team (desktop-tabel + mobil-foldet subline) og /auctions (desktop-
// tabel + mobil-kort), samme "berig riders-svaret via en lokal route-
// override"-mønster som 3622-popularity-visible.shots.mjs (seed-dataen har
// ingen popularity-felter endnu, og dette script rører den bevidst ikke).
//
//   node tests/e2e/3956-popularity-visible.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const { parseTable, restRows, restObject, wantsObject } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/mockHandlers.js")).href
);

const BASE = process.argv[2] || "http://localhost:5173";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

// Samme deterministiske hash som 3622's script — kun til screenshot-demonstration.
function popularityFor(id) {
  let hash = 0;
  const str = String(id);
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return hash % 101;
}

function withPopularity(data) {
  if (Array.isArray(data)) {
    return data.map((r) => (r && r.id != null ? { ...r, popularity: popularityFor(r.id) } : r));
  }
  if (data && data.id != null) {
    return { ...data, popularity: popularityFor(data.id) };
  }
  return data;
}

// Auktionens rytter er embeddet direkte (rider: RIDERS[1] i seedData.js), så
// riders-route-overriden alene ikke rammer den — auctions-svaret skal
// beriges separat, samme hash på det nestede rider-objekt.
function withAuctionPopularity(data) {
  if (Array.isArray(data)) {
    return data.map((a) => (a && a.rider ? { ...a, rider: withPopularity(a.rider) } : a));
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
  // Registreret EFTER installNetworkMocks, så disse routes vinder.
  await page.route("**/rest/v1/riders?**", (route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.fallback();
    const table = parseTable(request.url());
    const accept = request.headers().accept || "";
    const data = wantsObject(accept) ? restObject(table, request.url()) : restRows(table, request.url());
    return json(route, withPopularity(data));
  });
  await page.route("**/rest/v1/auctions?**", (route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.fallback();
    const table = parseTable(request.url());
    const data = restRows(table, request.url());
    return json(route, withAuctionPopularity(data));
  });
  await stabilizeEnglish(page);
  await login(page);

  await page.goto("/team");
  await page.getByRole("table").waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(OUT, `3956-team-popularity-${label}.png`), fullPage: true });

  await page.goto("/auctions");
  await page.getByRole("heading", { name: "Auctions", exact: true }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  // Auktions-TABELLEN (desktop, ≥768px) er bredere end viewportet. Under md
  // er tabellen `hidden md:block` (AuctionCard viser popularitet inline i
  // stedet), så headeren findes ikke der. scrollIntoViewIfNeeded scrollede
  // Popularity-headeren IND BAG den sticky højre Bid-kolonne (sticky-cellens
  // visuelle position tælles ikke med i dens synlighedstjek) — sæt scrollLeft
  // manuelt i stedet, med margen til begge sticky-kolonner.
  if (width >= 768) {
    await page.evaluate(() => {
      const table = document.querySelector("table[data-sortable]");
      const scroller = table?.closest(".overflow-auto");
      const th = table && [...table.querySelectorAll("th")].find((el) => /popularity/i.test(el.textContent || ""));
      if (scroller && th) scroller.scrollLeft = Math.max(0, th.offsetLeft - 200);
    });
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: resolve(OUT, `3956-auctions-popularity-${label}.png`), fullPage: true });

  await context.close();
  await browser.close();
}

mkdirSync(OUT, { recursive: true });
await shootViewport(1280, "desktop");
await shootViewport(375, "mobile");
console.log(`Screenshots → ${OUT}`);
