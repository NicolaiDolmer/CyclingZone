// #4582 — PR-screenshots for demote-dialogen. Ad-hoc capture-script (ikke en del
// af CI-suiten; testMatch fanger kun *.spec.js). Regressions-daekningen ligger i
// 4582-demote-keeps-contract.spec.js — dette script findes kun for at vise
// ejeren fladen foer merge.
//
// Tre billeder, fordi teksten er BETINGET og et enkelt billede ikke kan vise det:
//   1) desktop, rytter MED kontrakt   -> "Wage (unchanged)" + kontrakt-noten
//   2) mobil,   rytter MED kontrakt   -> samme, paa 390px
//   3) desktop, rytter UDEN kontrakt  -> "Youth salary" + den gamle note
//
//   node tests/e2e/4582-demote-keeps-contract.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json, corsHeaders } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const { wantsObject } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/mockHandlers.js")).href
);

const BASE = process.argv[2] || "http://localhost:4173";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

// Samme fixtur som specen: rider-1 med et yngre foedselsaar, saa demote-knappens
// alders-gate (isU23) slipper hende igennem.
const OWN_RIDER = RIDERS.find((r) => r.id === "rider-1");
const U23_RIDER = { ...OWN_RIDER, birthdate: "2006-04-12" };

const KEEPS_CONTRACT_QUOTE = {
  currentSalary: 17000, newSalary: 17000, keepsContract: true, racesCleared: 0, racesOngoing: 0,
};
const FRESH_SALARY_QUOTE = {
  currentSalary: null, newSalary: 4200, keepsContract: false, racesCleared: 0, racesOngoing: 0,
};

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

async function mockU23OwnRider(page) {
  await page.route("**/rest/v1/riders**", (route) => {
    const request = route.request();
    if (request.method() !== "GET") return json(route, {});
    const url = request.url();
    const accept = request.headers().accept || "";
    const asSingle = (rows) => (wantsObject(accept) ? (rows[0] || {}) : rows);
    if (url.includes("pending_team_id=eq.")) return json(route, asSingle([]));
    const pool = RIDERS.map((r) => (r.id === U23_RIDER.id ? U23_RIDER : r));
    const idEq = url.match(/[?&]id=eq\.([^&]+)/);
    if (idEq) {
      const id = decodeURIComponent(idEq[1]);
      const match = pool.find((r) => r.id === id);
      return json(route, asSingle(match ? [match] : []));
    }
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) {
      return json(route, asSingle(pool.filter((r) => r.team_id === TEST_TEAM.id)));
    }
    return json(route, asSingle(pool));
  });
}

async function mockDemoteQuote(page, quote) {
  await page.route("**/api/riders/*/academy-demote-quote**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, quote);
  });
}

async function shoot({ browser, width, height, quote, file }) {
  const context = await browser.newContext({
    baseURL: BASE, viewport: { width, height }, deviceScaleFactor: 2, locale: "en-US",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await mockU23OwnRider(page);
  await mockDemoteQuote(page, quote);
  await stabilizeEnglish(page);
  await login(page);
  await page.goto(`/riders/${U23_RIDER.id}`);
  const demoteBtn = page.getByRole("button", { name: /Move to U23/i }).first();
  await demoteBtn.waitFor({ timeout: 20000 });
  await demoteBtn.click();
  await page.getByRole("dialog").waitFor();
  // Vent til quoten er landet (knappen er laast mens newSalary er null).
  await page.getByText(quote.keepsContract ? /17[.,]000/ : /4[.,]200/).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, file), fullPage: false });
  await context.close();
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

await shoot({ browser, width: 1440, height: 900, quote: KEEPS_CONTRACT_QUOTE, file: "4582-demote-keeps-contract-desktop.png" });
await shoot({ browser, width: 390, height: 844, quote: KEEPS_CONTRACT_QUOTE, file: "4582-demote-keeps-contract-mobile.png" });
await shoot({ browser, width: 1440, height: 900, quote: FRESH_SALARY_QUOTE, file: "4582-demote-fresh-salary-desktop.png" });

await browser.close();
console.log(`Screenshots → ${OUT}`);
