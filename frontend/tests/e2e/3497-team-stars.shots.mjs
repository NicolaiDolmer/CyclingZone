// #3497 — recovery-agent FØR/EFTER-screenshots af holdsidens stjerne-farver.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en kørende dev/preview-server med e2e-netværksmocks.
// Overrider riders-mocken med to ryttere på TEST_TEAM (én ung, én "gammel" ≥30)
// så grå- vs. guld-stjerne-tonen (FØR) hhv. den ensartede tone (EFTER) er synlig
// i samme skærmbillede, uden at røre den committede seedData.js.
//
//   node tests/e2e/3497-team-stars.shots.mjs [baseURL] [outDir] [label]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

async function stabilizeDanish(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cz_lang", "da");
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
  await page.getByPlaceholder("din@email.dk").waitFor();
  await page.getByPlaceholder("din@email.dk").fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: "Log ind" }).click();
  await page.waitForURL(/\/dashboard$/);
}

const BASE = process.argv[2] || "http://127.0.0.1:5299";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../screenshots/3497-team-stars"));
const LABEL = process.argv[4] || "shot";

// Ung rytter (< 30 i sæson 1 / referenceår 2026) + "gammel" rytter (>= 30) —
// begge på TEST_TEAM, så roster-tabellen viser begge toner i ét screenshot.
const base = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];
const young = { ...base, id: "rider-shot-young", firstname: "Ung", lastname: "Rytter", birthdate: "2001-06-01", team_id: TEST_TEAM.id, team: { id: TEST_TEAM.id, name: TEST_TEAM.name } };
const old = { ...base, id: "rider-shot-old", firstname: "Gammel", lastname: "Rytter", birthdate: "1993-06-01", team_id: TEST_TEAM.id, team: { id: TEST_TEAM.id, name: TEST_TEAM.name } };

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 393, height: 852 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    locale: "da-DK",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await page.route("**/rest/v1/riders**", (route) => {
    const url = route.request().url();
    if (route.request().method() !== "GET") return json(route, {});
    if (url.includes("pending_team_id=eq.")) return json(route, []);
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, [young, old]);
    return json(route, [...RIDERS, young, old]);
  });
  // #1162: fixtures.js's /api/scouting/estimates-mock kender kun de RIDERS der
  // eksporteres fra seedData.js — vores to override-ryttere (young/old) findes
  // ikke der, og estimatet ville komme tilbage tomt (POTENTIALE-kolonnen "—").
  // Registreret EFTER installNetworkMocks, så den kører først (Playwright:
  // senest-tilføjede route matcher først).
  await page.route("**/api/scouting/estimates**", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    let ids = [];
    try { ids = JSON.parse(route.request().postData() || "{}").riderIds || []; } catch { /* tom body */ }
    const shotIds = new Set([young.id, old.id]);
    if (!ids.some((id) => shotIds.has(id))) return route.fallback();
    const estimates = {};
    for (const id of ids) {
      if (id === young.id || id === old.id) estimates[id] = { lo: 4.5, hi: 4.5, exact: true, level: 3 };
    }
    return json(route, { teamId: TEST_TEAM.id, maxLevel: 3, estimates });
  });
  await stabilizeDanish(page);
  await login(page);
  await page.goto("/team");
  await page.getByRole("heading", { name: TEST_TEAM.name }).waitFor();
  await page.getByText(/Gammel Rytter/).first().waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, `3497-${LABEL}-${vp.name}.png`), fullPage: false });
  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
