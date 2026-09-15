// #5236/#5237 — screenshots af sessions-vælgeren (trin 2, niveau hård) med de
// tre nye sessioner: Cobbled Sectors / Brostenssektorer, Echelon Drills /
// Vifteøvelser, Attack Repeats / Angrebsintervaller.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js), modelleret 1:1 efter 3762-day-panel.shots.mjs. Kører mod en
// kørende dev-server med e2e-netværksmocks — ingen ægte backend/DB.
//
//   node tests/e2e/5236-hard-sessions.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json, corsHeaders } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://localhost:5173";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens/5236"));

// #5236/#5237: de tre nye sessioner ind i mock-fokuslisten, så den flade
// "focuses"-listen fra /api/training/me matcher den nye virkelighed.
const FOCUSES = [
  "vo2max", "threshold", "sprint", "cobbled_sectors", "echelon_drills", "attack_repeats",
  "endurance", "technique", "aero", "tempo",
];
const base = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];

const squad = [
  { ...base, id: "rider-5236-a", firstname: "Elias", lastname: "Andersen", team_id: TEST_TEAM.id, primary_type: "sprinter", secondary_type: "puncheur" },
];

const TRAINING_ME = {
  enabled: true,
  betaTester: true,
  teamId: TEST_TEAM.id,
  slots: { total: null, used: 0, remaining: null },
  focuses: FOCUSES,
  intensities: ["easy", "normal", "hard", "rest"],
  plans: {},
  condition: Object.fromEntries(squad.map((r, i) => [r.id, { form: 60 + i * 6, fatigue: 25 + i * 9, injured_until: null, risk: 0 }])),
  progress: Object.fromEntries(squad.map((r) => [r.id, { sprint: 0.44, acceleration: 0.9, endurance: 0.66, tempo: 0.81, climbing: 0.12 }])),
  capped: {},
  trainability: {
    "rider-5236-a": { vo2max: "limited", threshold: "limited", sprint: "strength", endurance: "strength", technique: "strength", aero: "strength" },
  },
  smartDefaultFocus: { "rider-5236-a": "vo2max" },
  weekPlan: null,
  riderWeekPlans: {},
  racingToday: {},
  todayRun: null,
};

async function stabilizeLocale(page, lang) {
  await page.addInitScript((lng) => {
    window.localStorage.setItem("cz_lang", lng);
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false,
      email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
    const css = "*, *::before, *::after { animation-duration: 0.001s !important; animation-iteration-count: 1 !important; caret-color: transparent !important; transition-duration: 0s !important; }";
    const inject = () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject, { once: true });
    else inject();
  }, lang);
}

async function login(page) {
  await page.goto("/login");
  await page.getByPlaceholder(/email/i).waitFor();
  await page.getByPlaceholder(/email/i).fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: /log in|log ind/i }).click();
  await page.waitForURL(/\/dashboard$/);
}

async function openDayPanel(page, name) {
  await page.evaluate(() => {
    const table = document.querySelector("table[data-sortable]");
    const scroller = table?.closest(".overflow-x-auto");
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  });
  await page.waitForTimeout(120);
  await page.locator(`tr:has-text("${name}") button[aria-label*="${name}"]`).first().evaluate((el) => el.click());
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(300);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const locale of [
  { code: "en", lang: "en", name: "Elias Andersen" },
  { code: "da", lang: "da", name: "Elias Andersen" },
]) {
  for (const vp of [
    { name: "desktop", width: 1440, height: 950 },
    { name: "mobile", width: 393, height: 852 },
  ]) {
    const context = await browser.newContext({
      baseURL: BASE,
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      locale: locale.code === "da" ? "da-DK" : "en-US",
    });
    const page = await context.newPage();
    await installNetworkMocks(page);
    await page.route("**/rest/v1/riders**", (route) => {
      const url = route.request().url();
      if (route.request().method() !== "GET") return json(route, {});
      if (url.includes("pending_team_id=eq.")) return json(route, []);
      if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, squad);
      return json(route, [...squad, ...RIDERS]);
    });
    await page.route("**/api/training/me**", (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      return json(route, TRAINING_ME);
    });
    await stabilizeLocale(page, locale.lang);
    await login(page);

    await page.goto("/training");
    await page.locator("table[data-sortable]").waitFor();
    await page.waitForTimeout(300);

    // Panelet står som default på en Træningsdag (endurance/easy), trin 2
    // grupperet efter niveau — de tre nye sessioner ligger i "hård"-gruppen.
    await openDayPanel(page, locale.name);
    const dialog = page.getByRole("dialog");
    await dialog.locator("text=/hard|hård/i").first().scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: resolve(OUT, `5236-session-selector-${locale.code}-${vp.name}.png`) });

    await context.close();
  }
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
