// #3721 — "før"-screenshots af dubletten på rytterprofilen.
//
// Issuet påstår at evnelisten står to steder: Overblik-fanen (15 evner, værdi +
// fremdriftsbar mod næste +1) og Træning-fanen (samme 15 evner + sæsonens point
// + fremdrift + "færdig"). Dette script fanger begge faner på samme rytter, så
// påstanden kan efterprøves med øjnene i stedet for i koden.
//
//   node tests/e2e/3721-rider-profile-duplicate.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json, corsHeaders } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://localhost:5173";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

const rider = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];

const TRAINING_ME = {
  enabled: true,
  betaTester: true,
  teamId: TEST_TEAM.id,
  slots: { total: null, used: 1, remaining: null },
  focuses: ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"],
  intensities: ["easy", "normal", "hard", "rest"],
  plans: { [rider.id]: { focus: "sprint", intensity: "normal" } },
  condition: { [rider.id]: { form: 71, fatigue: 34, injured_until: null, risk: 0 } },
  progress: {
    [rider.id]: {
      climbing: 0.12, punch: 0.55, tempo: 0.81, sprint: 0.44, acceleration: 0.9,
      endurance: 0.66, flat: 0.3, recovery: 0.2, durability: 0.5,
      descending: 0.1, positioning: 0.44, cobblestone: 0.05,
      tactics: 0.44, aggression: 0.6, teamwork: 0.35,
    },
  },
  capped: { [rider.id]: ["climbing"] },
  trainability: { [rider.id]: { sprint: "strength", endurance: "limited", technique: "blocked" } },
  smartDefaultFocus: {},
  weekPlan: null,
  riderWeekPlans: {},
  racingToday: {},
  todayRun: null,
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

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  locale: "en-US",
});
const page = await context.newPage();
await installNetworkMocks(page);
await page.route("**/api/training/me**", (route) => {
  const request = route.request();
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
  return json(route, TRAINING_ME);
});
await stabilizeEnglish(page);
await login(page);

for (const tab of ["overview", "training"]) {
  await page.goto(`/riders/${rider.id}?tab=${tab}`);
  await page.getByRole("tab", { name: /overview/i }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(OUT, `3721-before-profile-${tab}.png`), fullPage: true });
}

await context.close();
await browser.close();
console.log(`Screenshots → ${OUT}`);
