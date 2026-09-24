// #4851 — screenshots af traeningsscoren (kolonne + profilkort), desktop + mobil.
//
// Ad-hoc capture-script (ikke i CI-suiten; testMatch fanger kun *.spec.js).
// Moenstret er kopieret fra 3721-training-structure.shots.mjs: samme mocks,
// samme login, samme sprog-/animations-stabilisering.
//
// Flaget `training_score_visible` er off i prod. Preview tvinger det ON ved at
// levere `trainingScore`-feltet i /api/training/me-mocken — praecis den kontrakt
// backend bruger (feltet UDELADES naar flaget er off), saa billedet viser det
// spilleren faar den dag ejeren flipper flaget.
//
//   node tests/e2e/4851-training-score.shots.mjs [outDir]
//
// Scriptet starter SELV den statiske server paa worktreets egen port og lukker
// den igen — ingen efterladt proces.
//
// FOER/EFTER (20/9): scriptet koeres TO gange mod TO builds af `frontend/dist`
// — een fra basis-committen og een fra arbejdskopien. Mocks, login og data er
// identiske i begge koersler, saa hver forskel paa billederne ER aendringen.
// Mobilfladen er den NYE loebsdags-tabel (`mobileTable: true`, flaget
// `training_mobile_table`), fordi det er dér scoren manglede helt.

import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(__dirname, "../..");
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json, corsHeaders } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const { resolveRuntimePort } = await import(pathToFileURL(resolve(FRONTEND, "playwright.ports.js")).href);

const OUT = resolve(process.argv[2] || resolve(__dirname, "../../../pr-screens"));
const PORT = resolveRuntimePort(FRONTEND);
const HOST = "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;

// Kun de 8 typer der findes i locales/*/riderTypes.json. "timetrialist" og
// "allrounder" stod her foer og fandtes ikke: i18n faldt tilbage til den raa
// noegle, saa billedet viste "types.allrounder" i stedet for en ryttertype.
const TYPES = ["sprinter", "climber", "rouleur", "puncheur", "tt", "gc", "baroudeur", "brostensrytter"];
const FOCUSES = ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"];
const base = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];

const squad = Array.from({ length: 12 }, (_, i) => ({
  ...base,
  id: `rider-4851-${i}`,
  firstname: `Rytter${i + 1}`,
  lastname: ["Andersen", "Bak", "Colombo", "Duran", "Eriksen", "Fabre", "Gomez"][i % 7],
  team_id: TEST_TEAM.id,
  team: { id: TEST_TEAM.id, name: TEST_TEAM.name },
  primary_type: TYPES[i % TYPES.length],
  secondary_type: TYPES[(i + 3) % TYPES.length],
  is_academy: i % 5 === 0,
}));

const plans = {};
const condition = {};
const progress = {};
const trainability = {};
const trainingScore = {};
for (const [i, r] of squad.entries()) {
  plans[r.id] = { focus: FOCUSES[i % FOCUSES.length], intensity: ["normal", "hard", "easy"][i % 3] };
  condition[r.id] = { form: 50 + ((i * 7) % 40), fatigue: 15 + ((i * 11) % 60), injured_until: null, risk: 0 };
  progress[r.id] = { climbing: 0.2, punch: 0.55, tempo: 0.81, sprint: 0.4, endurance: 0.66, flat: 0.12 };
  trainability[r.id] = Object.fromEntries(FOCUSES.map((f, j) => [f, ["strength", "limited", "blocked"][(i + j) % 3]]));

  // Realistisk spraed (harnessen maalte 9-87, median 56) plus loebsdags-huller,
  // saa baade tallet, kurven og "loeb"-tilstanden staar paa billedet.
  const week = [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const raceDay = (i + d) % 9 === 0;
    return {
      date: `2026-09-${String(8 + d).padStart(2, "0")}`,
      score: raceDay ? null : 28 + ((i * 13 + d * 7) % 52),
      raceDay,
    };
  });
  const numbers = week.filter((p) => p.score != null).map((p) => p.score);
  trainingScore[r.id] = {
    today: week[week.length - 1].score,
    todayIsRaceDay: week[week.length - 1].raceDay,
    todaySession: plans[r.id].focus,
    spark: week,
    avg: Math.round(numbers.reduce((s, n) => s + n, 0) / numbers.length),
    best: Math.max(...numbers),
    days: numbers.length + 14,
    contributions: [
      { key: "focusMatch", points: 8 + (i % 4), direction: "up" },
      { key: "condition", points: -(3 + (i % 5)), direction: "down" },
      { key: "potential", points: 5, direction: "up" },
    ],
  };
}

// Profil-billedet bruger fixturens EGEN rytter (base), fordi RiderStatsPage
// slaar rytteren op paa id og kun viser traeningsfanen for egne ryttere.
plans[base.id] = { focus: "vo2max", intensity: "hard" };
condition[base.id] = { form: 74, fatigue: 32, injured_until: null, risk: 0 };
progress[base.id] = { climbing: 0.44, punch: 0.62, tempo: 0.18 };
trainability[base.id] = Object.fromEntries(FOCUSES.map((f) => [f, "strength"]));
trainingScore[base.id] = {
  today: 68,
  todayIsRaceDay: false,
  todaySession: "vo2max",
  spark: [
    { date: "2026-09-08", score: 54, raceDay: false },
    { date: "2026-09-09", score: 61, raceDay: false },
    { date: "2026-09-10", score: null, raceDay: true },
    { date: "2026-09-11", score: 47, raceDay: false },
    { date: "2026-09-12", score: 59, raceDay: false },
    { date: "2026-09-13", score: 63, raceDay: false },
    { date: "2026-09-14", score: 68, raceDay: false },
  ],
  avg: 57,
  best: 81,
  days: 23,
  contributions: [
    { key: "focusMatch", points: 11, direction: "up" },
    { key: "condition", points: -4, direction: "down" },
    { key: "potential", points: 6, direction: "up" },
  ],
};

const TRAINING_ME = {
  enabled: true,
  betaTester: true,
  teamId: TEST_TEAM.id,
  slots: { total: null, used: squad.length, remaining: null },
  focuses: FOCUSES,
  intensities: ["easy", "normal", "hard", "rest"],
  plans,
  condition,
  progress,
  capped: {},
  trainability,
  smartDefaultFocus: {},
  weekPlan: null,
  riderWeekPlans: {},
  todayRun: null,
  // #3643: telefonens NYE loebsdags-tabel. Det er den flade fundet 20/9 handler
  // om — scoren stod slet ikke paa den.
  mobileTable: true,
  // Flaget tvunget ON i preview: feltet er til stede.
  trainingScore,
};

async function stabilizeEnglish(page, theme) {
  await page.addInitScript((mode) => {
    window.localStorage.setItem("cz_lang", "en");
    window.localStorage.setItem("cz-theme", mode);
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
  }, theme);
}

async function login(page) {
  await page.goto("/login");
  await page.getByPlaceholder(/email/i).waitFor();
  await page.getByPlaceholder(/email/i).fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard$/);
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`static server kom aldrig op paa ${url}`);
}

mkdirSync(OUT, { recursive: true });

const server = spawn(
  process.execPath,
  [resolve(FRONTEND, "scripts/e2e-static-server.mjs"), "--host", HOST, "--port", String(PORT)],
  { cwd: FRONTEND, stdio: "inherit" },
);

// Samme grund som i 4851-mobile-columns.shots.mjs (CodeRabbit 20/9): fejler en
// capture, springer vi til finally, og en Chromium der aldrig blev lukket
// holder kommandoen i live. Hard rule #4920: ingen efterladte processer.
let browser;

try {
  await waitForServer(`${BASE}/app.html`);

  browser = await chromium.launch();
  const VIEWPORTS = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ];
  const THEMES = ["light", "dark"];

  for (const vp of VIEWPORTS) for (const theme of THEMES) {
    const context = await browser.newContext({
      baseURL: BASE,
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      locale: "en-US",
      colorScheme: theme,
    });
    const page = await context.newPage();
    await installNetworkMocks(page);
    // KUN holdets roster-query overtages — alt andet (enkelt-rytter-opslaget
    // rytterprofilen laver, og dens objekt-form) falder tilbage til
    // installNetworkMocks, som allerede kender kontrakten.
    await page.route("**/rest/v1/riders**", (route) => {
      const url = route.request().url();
      if (route.request().method() === "GET"
        && url.includes(`team_id=eq.${TEST_TEAM.id}`)
        && !url.includes("pending_team_id=eq.")
        && !/[?&]id=eq\./.test(url)) {
        return json(route, squad);
      }
      return route.fallback();
    });
    await page.route("**/api/training/me**", (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      return json(route, TRAINING_ME);
    });
    await stabilizeEnglish(page, theme);
    await login(page);
    const tag = `${vp.name}-${theme}`;

    // (a) Traeningssiden. Paa desktop er det rytterlisten med Score-kolonnen;
    //     paa 390 px er det den NYE loebsdags-tabel (mockup 2), hvor scoren
    //     manglede helt indtil nu.
    await page.goto("/training");
    await page.locator('table[data-sortable], [data-testid="training-mobile-roster"]').first().waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(OUT, `4851-training-score-list-${tag}.png`), fullPage: true });

    // (a2) Kun paa telefonen: det udfoldede rytterkort, hvor tallet og kurven
    //      staar. Den oeverste rytter er valgt fra start (mockup 2).
    if (vp.name === "mobile") {
      const roster = page.locator('[data-testid="training-mobile-roster"]');
      if (await roster.count()) {
        await roster.locator("tbody tr").first().locator("button").first().click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: resolve(OUT, `4851-training-score-mobile-card-${tag}.png`), fullPage: true });
      }
    }

    // (b) Profilkortet paa rytterens traeningsfane.
    await page.goto(`/riders/${base.id}?tab=training`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: resolve(OUT, `4851-training-score-card-${tag}.png`), fullPage: true });

    await context.close();
  }

  console.log(`Screenshots → ${OUT}`);
} finally {
  try {
    await browser?.close();
  } finally {
    server.kill();
  }
}
