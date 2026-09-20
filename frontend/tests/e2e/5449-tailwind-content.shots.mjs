// #5449 — foer/efter-billeder af de flader hvor Tailwind-globben manglede
// `.ts`/`.tsx`.
//
// Ad-hoc capture-script (ikke i CI-suiten; testMatch fanger kun *.spec.js).
// Moenstret er kopieret fra 4851-training-score.shots.mjs: samme fixtures,
// samme login, samme sprog-/animations-stabilisering, og scriptet starter SELV
// den statiske server paa worktreets egen port og lukker den igen.
//
//   node tests/e2e/5449-tailwind-content.shots.mjs <outDir>
//
// Scriptet skal koeres TO gange mod TO builds af `frontend/dist`:
//   1) med den gamle glob (`./src/**/*.{js,jsx}`)        → <outDir>/before
//   2) med den rettede glob (`./src/**/*.{js,jsx,ts,tsx}`) → <outDir>/after
// Kun CSS'en er forskellig; markup og data er identisk, saa hver forskel paa
// billederne ER den manglende klasse.
//
// Fladerne er valgt efter en MAALT liste: de 10 klasser der kommer til i den
// byggede CSS bor i fem `.tsx`-filer (TrainingScoreSparkline, TrainingProgramGrid,
// TrainingMobileRoster, TrainingMobileRiderCard, TrainingRaceDayStrip og
// SelectionDeadlineReminder). "Alle handler"-fanen (TradeListPage.tsx) er med
// som KONTROL: den er ogsaa .tsx, men alle dens klasser fandtes i forvejen fra
// en .jsx-fil, saa dens to billeder skal vaere byte-identiske foer/efter.

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

const OUT = resolve(process.argv[2] || resolve(__dirname, "screenshots-5449"));
const PORT = resolveRuntimePort(FRONTEND);
const HOST = "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;

const TYPES = ["sprinter", "climber", "rouleur", "puncheur", "timetrialist", "allrounder", "baroudeur"];
const FOCUSES = ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"];
const base = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];

const squad = Array.from({ length: 8 }, (_, i) => ({
  ...base,
  id: `rider-5449-${i}`,
  firstname: `Rytter${i + 1}`,
  lastname: ["Andersen", "Bak", "Colombo", "Duran", "Eriksen", "Fabre", "Gomez"][i % 7],
  team_id: TEST_TEAM.id,
  team: { id: TEST_TEAM.id, name: TEST_TEAM.name },
  primary_type: TYPES[i % TYPES.length],
  secondary_type: TYPES[(i + 3) % TYPES.length],
  is_academy: false,
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

  // Fast, deterministisk kurve med ét loebsdags-hul, saa baade fyldet, stregen,
  // slutpunktet og hullet staar paa billedet.
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
      { key: "focusMatch", points: 8, direction: "up" },
      { key: "condition", points: -4, direction: "down" },
      { key: "potential", points: 5, direction: "up" },
    ],
  };
}

// Rytterprofilen slaar rytteren op paa id og viser kun traeningsfanen for egne
// ryttere, saa profil-billedet bruger fixturens EGEN rytter.
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

function trainingMe({ mobileTable }) {
  return {
    enabled: true,
    betaTester: true,
    // Den nye mobil-visning ligger bag `training_mobile_table` (stadie beta);
    // serveren sender resultatet som en bar boolean. Kun mobil-gennemloebet
    // taender den, saa desktop-billederne viser den uaendrede gamle tabel.
    ...(mobileTable ? { mobileTable: true } : {}),
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
    racingToday: {},
    todayRun: null,
    // Flaget `training_score_visible` tvinges ON i preview ved at LEVERE feltet
    // — praecis den kontrakt backend bruger (feltet udelades naar flaget er off).
    trainingScore,
  };
}

// Samme shape som backend/lib/selectionDeadlineReminder.js returnerer. Den
// delte mock svarer bevidst "tone: none", saa boksen skal overstyres her.
const REMINDER = {
  enabled: true,
  tone: "warning",
  count: 2,
  races: [
    {
      id: "wp-2", name: "Giro di Preview", race_class: "GiroVuelta",
      deadline_at: "2026-09-11T15:00:00.000Z", hours_until: 6,
      entry_count: 6, target_size: 8, min_size: 6, will_not_start: false, tone: "warning",
    },
    {
      id: "wp-1", name: "Tour de Preview", race_class: "TourFrance",
      deadline_at: "2026-09-12T09:00:00.000Z", hours_until: 30,
      entry_count: 1, target_size: 8, min_size: 6, will_not_start: true, tone: "warning",
    },
  ],
  window_hours: 36,
  urgent_hours: 24,
};

const teamRef = (id, name, division) => ({ id, name, is_ai: false, division });
const riderRef = (id, firstname, lastname) => ({ id, firstname, lastname });

// Kontrol-fladen. Tallene er fiktive preview-tal, ikke maalte balance-vaerdier.
const TRADE_FEED = {
  events: [
    {
      id: "ev-1", type: "auction", date: "2026-09-18T10:00:00.000Z", season_number: 3,
      rider: riderRef("r-1", "Rytter1", "Andersen"),
      rider_swapped: null,
      from_team: null, to_team: teamRef("t-a", "Hold A", 1),
      amount: 1200000, is_guaranteed_sale: false, reportable: false,
    },
    {
      id: "ev-2", type: "transfer", date: "2026-09-17T12:30:00.000Z", season_number: 3,
      rider: riderRef("r-2", "Rytter2", "Bak"),
      rider_swapped: null,
      from_team: teamRef("t-b", "Hold B", 2), to_team: teamRef("t-a", "Hold A", 1),
      amount: 640000, is_guaranteed_sale: true, reportable: true,
    },
    {
      id: "ev-3", type: "swap", date: "2026-09-16T08:15:00.000Z", season_number: 3,
      rider: riderRef("r-3", "Rytter3", "Colombo"),
      rider_swapped: riderRef("r-4", "Rytter4", "Duran"),
      from_team: teamRef("t-c", "Hold C", 2), to_team: teamRef("t-b", "Hold B", 2),
      amount: null, is_guaranteed_sale: false, reportable: true,
    },
  ],
  limit: 50,
  offset: 0,
  has_more: false,
};

function stabilize(page, theme) {
  return page.addInitScript(({ theme }) => {
    window.localStorage.setItem("cz_lang", "en");
    // lib/theme.jsx: STORAGE_KEY = "cz-theme". "system" ville laese
    // prefers-color-scheme og goere billedet afhaengigt af maskinen.
    window.localStorage.setItem("cz-theme", theme);
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
  }, { theme });
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

async function shoot(page, name, locator) {
  const target = locator ? page.locator(locator).first() : page;
  await target.screenshot({ path: resolve(OUT, `${name}.png`) });
}

mkdirSync(OUT, { recursive: true });

const server = spawn(
  process.execPath,
  [resolve(FRONTEND, "scripts/e2e-static-server.mjs"), "--host", HOST, "--port", String(PORT)],
  { cwd: FRONTEND, stdio: "inherit" },
);

try {
  await waitForServer(`${BASE}/app.html`);

  const browser = await chromium.launch();
  const VIEWPORTS = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ];
  const THEMES = ["light", "dark"];

  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      const tag = `${vp.name}-${theme}`;
      const context = await browser.newContext({
        baseURL: BASE,
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        locale: "en-US",
        colorScheme: theme,
      });
      const page = await context.newPage();
      await installNetworkMocks(page);

      // KUN holdets roster-query overtages — enkelt-rytter-opslaget
      // rytterprofilen laver falder tilbage til installNetworkMocks.
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
        return json(route, trainingMe({ mobileTable: vp.name === "mobile" }));
      });
      await page.route("**/api/me/selection-reminder**", (route) => {
        const request = route.request();
        if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
        return json(route, REMINDER);
      });
      await page.route("**/api/transfers/feed**", (route) => {
        const request = route.request();
        if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
        return json(route, TRADE_FEED);
      });

      await stabilize(page, theme);
      await login(page);

      // (1) Daglig traening. Desktop: den gamle tabel med Score-kolonnen
      //     (sparkline pr. rytter). Mobil: den nye tabel bag
      //     `training_mobile_table`.
      await page.goto("/training");
      if (vp.name === "mobile") {
        await page.locator('[data-testid="training-mobile-roster"]').waitFor();
      } else {
        await page.locator("table[data-sortable]").first().waitFor();
      }
      await page.waitForTimeout(700);
      await shoot(page, `5449-training-${tag}`);

      // (2) Rytterprofilens Traening-fane — RiderTrainingScoreCard med samme
      //     sparkline i stort format.
      await page.goto(`/riders/${base.id}?tab=training`);
      await page.waitForTimeout(1100);
      await shoot(page, `5449-rider-training-${tag}`);

      // (3) Planlaegning — SelectionDeadlineReminder-boksen.
      await page.goto("/planning");
      await page.getByRole("status").first().waitFor();
      await page.waitForTimeout(400);
      await shoot(page, `5449-planning-reminder-${tag}`);

      // (4) KONTROL: "Alle handler"-fanen. Ogsaa .tsx, men uden nye klasser —
      //     billedet skal vaere identisk foer/efter.
      await page.goto("/transfers?tab=trades");
      await page.waitForTimeout(900);
      await shoot(page, `5449-trades-${tag}`);

      await context.close();
    }
  }

  await browser.close();
  console.log(`[5449] Screenshots → ${OUT}`);
} finally {
  server.kill();
}
