// #3300 (rework) — PR-screenshots efter ejer-afvist v1-layout (badge inline i
// navne-cellen, ugeplan-knap samme sted). Nyt layout: BÅDE akademi-badgen OG
// ugeplan-knappen har hver sin egen kolonne (Status- hhv. Ugeplan-kolonnen),
// samme mønster som TeamPages badges-kolonne.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en kørende dev/preview-server med e2e-netværksmocks.
// Overrider riders-mocken med to ryttere på TEST_TEAM (én akademi, én senior)
// + /api/training/me med planer for begge og en individuel ugeplan-override
// for akademi-rytteren, så både Status-kolonnens "AKAD"-badge og Ugeplan-
// kolonnens "Egen plan"-pill er synlige i samme screenshot.
//
//   node tests/e2e/3300-training-academy-status.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json, corsHeaders } = await import(
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

async function login(page) {
  await page.goto("/login");
  await page.getByPlaceholder(/email/i).waitFor();
  await page.getByPlaceholder(/email/i).fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard$/);
}

const BASE = process.argv[2] || "http://127.0.0.1:4173";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

// Standard-fixturen har kun ÉN rytter på TEST_TEAM (rider-1, Ada Pedersen) —
// samme mønster som 3497-team-stars.shots.mjs: spred den som base og lav to
// synteriske ryttere (akademi + senior), begge fuldt udfyldte felter, så
// rosteret viser badge-kontrasten i ét screenshot uden at røre committede
// seedData.js.
const base = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];
const academyRider = {
  ...base, id: "rider-shot-academy", firstname: "Anna", lastname: "Akademi",
  team_id: TEST_TEAM.id, team: { id: TEST_TEAM.id, name: TEST_TEAM.name }, is_academy: true,
};
const seniorRider = {
  ...base, id: "rider-shot-senior", firstname: "Sofus", lastname: "Senior",
  team_id: TEST_TEAM.id, team: { id: TEST_TEAM.id, name: TEST_TEAM.name }, is_academy: false,
};

const TRAINING_ME = {
  enabled: true,
  betaTester: true,
  teamId: TEST_TEAM.id,
  slots: { total: null, used: 2, remaining: null },
  focuses: ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"],
  intensities: ["easy", "normal", "hard", "rest"],
  plans: {
    [academyRider.id]: { focus: "vo2max", intensity: "hard" },
    [seniorRider.id]: { focus: "endurance", intensity: "normal" },
  },
  condition: {
    [academyRider.id]: { form: 68, fatigue: 32, injured_until: null, risk: 0 },
    [seniorRider.id]: { form: 75, fatigue: 20, injured_until: null, risk: 0 },
  },
  progress: {
    [academyRider.id]: { climbing: 0.62, punch: 0.3, tempo: 0.5 },
    [seniorRider.id]: { endurance: 0.44, punch: 0.2, tempo: 0.3 },
  },
  capped: {},
  trainability: {},
  smartDefaultFocus: {},
  weekPlan: null,
  // Akademi-rytteren har sin egen individuelle ugeplan-override, så Ugeplan-
  // kolonnens "Egen plan"-pill er synlig i screenshottet ved siden af knappen.
  riderWeekPlans: {
    [academyRider.id]: {
      mon: { intensity: "hard" }, tue: { intensity: "normal" }, wed: { intensity: "easy" },
      thu: { intensity: "hard" }, fri: { intensity: "normal" }, sat: { intensity: "rest" }, sun: { intensity: "rest" },
    },
  },
  racingToday: {},
  todayRun: null,
};

// Bredere end den normale desktop-viewport (1440), fordi rosteret nu har 10
// kolonner (Status + Ugeplan i egen kolonne) — vi vil vise BEGGE nye kolonner
// uden vandret scroll i selve screenshottet, jf. opgavens krav om at både
// badge- og ugeplan-knap-kolonnen skal være synlige.
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, scrollTableRight: true },
  { name: "mobile", width: 393, height: 852, scrollTableRight: true },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    locale: "en-US",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  // Registreret EFTER installNetworkMocks, så disse handlers vinder (Playwright:
  // senest-tilføjede route matcher først).
  await page.route("**/rest/v1/riders**", (route) => {
    const url = route.request().url();
    if (route.request().method() !== "GET") return json(route, {});
    if (url.includes("pending_team_id=eq.")) return json(route, []);
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, [academyRider, seniorRider]);
    return json(route, RIDERS);
  });
  await page.route("**/api/training/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, TRAINING_ME);
  });
  await stabilizeEnglish(page);
  await login(page);
  await page.goto("/training");
  await page.getByText(/Anna Akademi/).first().waitFor();
  await page.waitForTimeout(300);
  if (vp.scrollTableRight) {
    // Scroll rosterets horisontale scroller helt til højre, så Status- og
    // Ugeplan-kolonnerne (yderst til højre) er synlige i screenshottet.
    await page.evaluate(() => {
      const table = document.querySelector("table[data-sortable]");
      const scroller = table?.closest(".overflow-x-auto");
      if (scroller) scroller.scrollLeft = scroller.scrollWidth;
    });
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: resolve(OUT, `3300-training-academy-status-${vp.name}.png`), fullPage: false });
  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
