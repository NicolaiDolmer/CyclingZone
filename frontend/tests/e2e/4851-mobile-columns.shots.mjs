// #4851 — kolonnebredderne i mobil-traeningstabellen, foer/efter.
//
// Ad-hoc capture-script (ikke i CI-suiten; testMatch fanger kun *.spec.js).
// Soestermodul til 4851-training-score.shots.mjs, men beskaaret til EEN ting:
// selve trup-tabellen, saa de to billeder kan laegges ved siden af hinanden
// uden at hele siden stoejer med.
//
//   node tests/e2e/4851-mobile-columns.shots.mjs <outDir>
//
// Matricen er den ejer-review'et 20/9 bad om: 360 og 390 px, EN og DA (de
// danske typenavne er laengere), lyst og moerkt. Mock-data bruger de LAENGSTE
// rigtige typenavne fra locales/*/riderTypes.json — ikke opdigtede strenge:
//
//   tt + brostensrytter   "Time-trialist/Cobbles specialist"  laengst paa EN
//   gc + brostensrytter   "Etapeløbsrytter/Brostensrytter"    laengst paa DA
//   puncheur + baroudeur  "Puncheur/Baroudeur"                ingen bindestreg
//                         og intet mellemrum at bryde paa — det var netop det
//                         ord der loeb ud over kolonnestregen
//
// Scriptet starter SELV den statiske server paa worktreets egen port og lukker
// den igen — ingen efterladt proces.

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

// Laengste sessioner i begge sprog, plus een rytter HELT uden plan
// ("Ikke valgt" / "Not set" — den laengste celle-etikette der findes) og een
// paa en loebsdag.
const ROSTER = [
  { first: "Mathias", last: "Sørensen", primary: "tt", secondary: "brostensrytter", focus: "loebslaere", intensity: "easy" },
  { first: "Kristoffer", last: "Ødegaard", primary: "gc", secondary: "brostensrytter", focus: "echelon_drills", intensity: "hard" },
  { first: "Sebastian", last: "Mikkelsen", primary: "puncheur", secondary: "baroudeur", focus: "threshold", intensity: "hard" },
  { first: "Aleksander", last: "Kristiansen", primary: "brostensrytter", secondary: "gc", focus: "cobbled_sectors", intensity: "hard" },
  { first: "Frederik", last: "Vestergaard", primary: "baroudeur", secondary: "puncheur", focus: null, intensity: null },
  { first: "Emil", last: "Thorbjørnsen", primary: "rouleur", secondary: "tt", focus: "vo2max_climb", intensity: "hard" },
  { first: "Nikolaj", last: "Brandstrup", primary: "climber", secondary: "gc", focus: "restitution", intensity: "recovery" },
  { first: "Oliver", last: "Damsgaard", primary: "sprinter", secondary: "brostensrytter", focus: "endurance", intensity: "rest" },
];

const base = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];
const squad = ROSTER.map((r, i) => ({
  ...base,
  id: `rider-4851-col-${i}`,
  firstname: r.first,
  lastname: r.last,
  team_id: TEST_TEAM.id,
  team: { id: TEST_TEAM.id, name: TEST_TEAM.name },
  primary_type: r.primary,
  secondary_type: r.secondary,
  is_academy: false,
}));

const plans = {};
const condition = {};
const trainingScore = {};
for (const [i, rider] of squad.entries()) {
  if (ROSTER[i].focus) plans[rider.id] = { focus: ROSTER[i].focus, intensity: ROSTER[i].intensity };
  // To cifre i baade form og traethed: "· F78 · T59" er den laengste hale
  // meta-linjen kan faa, og den er det der presser typenavnene.
  condition[rider.id] = { form: 78 - i, fatigue: 59 + i, injured_until: null, risk: 0 };
  const week = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    date: `2026-09-${String(8 + d).padStart(2, "0")}`,
    score: (i + d) % 9 === 0 ? null : 28 + ((i * 13 + d * 7) % 52),
    raceDay: (i + d) % 9 === 0,
  }));
  trainingScore[rider.id] = {
    today: i === 1 ? null : week[week.length - 1].score,
    todayIsRaceDay: i === 1,
    todaySession: ROSTER[i].focus,
    spark: week,
    avg: 57,
    best: 81,
    days: 23,
    contributions: [],
  };
}

const TRAINING_ME = {
  enabled: true,
  betaTester: true,
  teamId: TEST_TEAM.id,
  slots: { total: null, used: squad.length, remaining: null },
  focuses: ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"],
  intensities: ["easy", "normal", "hard", "rest"],
  plans,
  condition,
  progress: {},
  capped: {},
  trainability: {},
  smartDefaultFocus: {},
  weekPlan: null,
  riderWeekPlans: {},
  todayRun: null,
  mobileTable: true,
  trainingScore,
};

async function stabilize(page, { lang, theme }) {
  await page.addInitScript(({ language, mode }) => {
    window.localStorage.setItem("cz_lang", language);
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
  }, { language: lang, mode: theme });
}

async function login(page, lang) {
  await page.goto("/login");
  const email = page.getByPlaceholder(/e-?mail/i);
  await email.waitFor();
  await email.fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: lang === "da" ? /log ind/i : /log in/i }).click();
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

// `browser` staar UDEN for try'et med vilje (CodeRabbit 20/9): fejler en
// capture undervejs, springer vi til finally, og en Chromium der aldrig blev
// lukket holder kommandoen i live. Hard rule #4920 er netop "ingen efterladte
// processer".
let browser;

try {
  await waitForServer(`${BASE}/app.html`);
  browser = await chromium.launch();

  for (const width of [360, 390]) {
    for (const lang of ["en", "da"]) {
      for (const theme of ["light", "dark"]) {
        const context = await browser.newContext({
          baseURL: BASE,
          // Bredden er det maalte; HOEJDEN er kunstigt stor med vilje. Den
          // klaebende bundnavigation ligger i bunden af viewporten og ville
          // ellers male hen over de nederste raekker i et element-screenshot.
          // Layoutet afhaenger kun af bredden, saa billedet viser praecis det
          // en telefon paa 360/390 px ser — bare uden bjaelken foran.
          viewport: { width, height: 1800 },
          deviceScaleFactor: 2,
          locale: lang === "da" ? "da-DK" : "en-US",
          colorScheme: theme,
        });
        const page = await context.newPage();
        await installNetworkMocks(page);
        await page.route("**/rest/v1/riders**", (route) => {
          const request = route.request();
          if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
          const url = request.url();
          if (request.method() === "GET" && !/[?&]id=eq\./.test(url)) return json(route, squad);
          return route.fallback();
        });
        await page.route("**/api/training/me**", (route) => {
          const request = route.request();
          if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
          return json(route, TRAINING_ME);
        });
        await stabilize(page, { lang, theme });
        await login(page, lang);

        await page.goto("/training");
        const roster = page.locator('[data-testid="training-mobile-roster"]');
        await roster.waitFor();
        await page.evaluate(async () => {
          if (document.fonts?.ready) await document.fonts.ready;
        });
        await page.waitForTimeout(500);

        // Kortet OM tabellen, ikke hele siden: rammen er selve kolonnestregen
        // man skal kunne se at teksten ikke krydser.
        const card = roster.locator("xpath=..");
        await card.screenshot({ path: resolve(OUT, `4851-mobil-trup-${width}-${lang}-${theme}.png`) });

        await context.close();
      }
    }
  }

  console.log(`Screenshots → ${OUT}`);
} finally {
  try {
    await browser?.close();
  } finally {
    server.kill();
  }
}
