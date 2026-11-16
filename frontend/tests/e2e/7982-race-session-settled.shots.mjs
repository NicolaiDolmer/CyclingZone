// #7982 skaermdelen: PR-billeder af traeningsgitteret, naar loebets session er afregnet efter etapen.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun *.spec.*). Samme moenster
// som 4847-training-day-close.shots.mjs: scriptet starter og draeber sin EGEN statiske server, saa
// intet overlever kommandoen. Opdigtede navne og tal (fixtures + "Ada Pedersen"); intet prod-kald.
//
// HVORFOR ET EGET SCRIPT. Kontakten training_settle_race_session er slukket i prod, og felterne
// (`raceSessionSettle`, `ranSlots`) sendes kun med kontakten on. Prognosen mockes derfor i to
// tilstande, saa ejeren ser praecis hvad han taender:
//   foer  - kontakten slukket (svaret uden de nye felter): etapens felt staar "Stage" som i dag
//   efter - kontakten on, etapen er afgjort: feltet staar "Run", de andre felter er aabne,
//           og en linje siger, at loebets session er afregnet
//
// Byg frontend foerst (ellers serveres en gammel dist):
//   npm --prefix frontend run build
//   node frontend/tests/e2e/7982-race-session-settled.shots.mjs [outDir] [port]
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(__dirname, "../..");
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json, corsHeaders } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const HOST = "127.0.0.1";
const PORT = Number(process.argv[3] || 4798);
const BASE = `http://${HOST}:${PORT}`;
const OUT = resolve(process.argv[2] || resolve(__dirname, "../../../pr-screens/7982-skaerm"));

const server = spawn(
  process.execPath,
  [resolve(frontendRoot, "scripts/e2e-static-server.mjs"), "--host", HOST, "--port", String(PORT)],
  { cwd: frontendRoot, stdio: ["ignore", "pipe", "pipe"] },
);
server.stderr.on("data", (b) => process.stderr.write(`[static] ${b}`));

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/app.html`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`statisk server kom aldrig op paa ${BASE}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function stabilize(page, theme) {
  await page.addInitScript((mode) => {
    window.localStorage.setItem("cz_lang", "da");
    window.localStorage.setItem("cz_theme", mode);
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
  await page.getByPlaceholder("din@email.dk").waitFor();
  await page.getByPlaceholder("din@email.dk").fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: "Log ind" }).click();
  await page.waitForURL(/\/dashboard$/);
}

const base = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];
const rider = {
  ...base, id: "rider-shot-7982", firstname: "Ada", lastname: "Pedersen", primary_type: "climber",
  team_id: TEST_TEAM.id, team: { id: TEST_TEAM.id, name: TEST_TEAM.name }, is_academy: false,
};
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SESSION = { mon: "vo2max", tue: "endurance", wed: "recovery", thu: "threshold", fri: "vo2max", sat: "endurance", sun: "rest" };
const INTENSITY = { vo2max: "hard", endurance: "normal", recovery: "easy", threshold: "hard", rest: "rest" };
const weekDays = Object.fromEntries(WEEKDAYS.map((w) => [w, { session: SESSION[w], intensity: INTENSITY[SESSION[w]] }]));

function trainingMe() {
  return {
    enabled: true, betaTester: true, mobileTable: true, teamId: TEST_TEAM.id,
    slots: { total: null, used: 1, remaining: null },
    focuses: ["vo2max", "threshold", "endurance"], intensities: ["easy", "normal", "hard", "rest"],
    plans: { [rider.id]: { focus: "vo2max", intensity: "normal" } },
    condition: { [rider.id]: { form: 61, fatigue: 58, injured_until: null, risk: 0 } },
    progress: {}, capped: {}, trainability: {}, smartDefaultFocus: {},
    weekPlan: null, riderWeekPlans: { [rider.id]: weekDays }, todayRun: null,
    dayClose: { open: false, reason: "awaiting_finalization", gameDays: [41, 42, 43, 44, 45], opensAtHour: 20 },
  };
}

// Etapen ligger i felt 3 (slot 2). Foer: kontakten slukket. Efter: etapen er afgjort og afregnet.
const FORECAST = {
  before: { available: true, settled: false, riders: { [rider.id]: { fatigue: 66, band: "warn", raceSlots: [2] } } },
  after: {
    available: true, settled: false, raceSessionSettle: { fatigueNow: true },
    riders: { [rider.id]: { fatigue: 66, band: "warn", raceSlots: [2], ranSlots: [2] } },
  },
};

const SHOTS = [
  { state: "before", name: "foer-1440", width: 1440, height: 900, theme: "light" },
  { state: "after", name: "efter-1440", width: 1440, height: 900, theme: "light" },
  { state: "before", name: "foer-390", width: 390, height: 844, theme: "light" },
  { state: "after", name: "efter-390", width: 390, height: 844, theme: "light" },
  { state: "before", name: "foer-1440-moerk", width: 1440, height: 900, theme: "dark" },
  { state: "after", name: "efter-1440-moerk", width: 1440, height: 900, theme: "dark" },
];

const preflight = (route) => {
  const request = route.request();
  if (request.method() !== "OPTIONS") return false;
  route.fulfill({ status: 204, headers: corsHeaders(request) });
  return true;
};

mkdirSync(OUT, { recursive: true });
let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      baseURL: BASE, viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 1, locale: "en-US",
      colorScheme: shot.theme,
    });
    const page = await context.newPage();
    await installNetworkMocks(page);
    await page.route("**/rest/v1/riders**", (route) => {
      if (preflight(route)) return undefined;
      const url = route.request().url();
      if (route.request().method() !== "GET") return json(route, {});
      if (url.includes("pending_team_id=eq.")) return json(route, []);
      if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, [rider]);
      return json(route, RIDERS);
    });
    await page.route("**/rest/v1/training_day_runs**", (route) => (preflight(route) ? undefined : json(route, [])));
    await page.route("**/api/training/me**", (route) => (preflight(route) ? undefined : json(route, trainingMe())));
    await page.route("**/api/training/train-now**", (route) => (preflight(route) ? undefined : json(route, { enabled: false })));
    await page.route("**/api/training/programs/forecast**", (route) => (preflight(route) ? undefined : json(route, FORECAST[shot.state])));
    await page.route("**/api/training/programs", (route) => (preflight(route) ? undefined : json(route, {
      enabled: false, cellsEnabled: true, seeds: {}, catalog: [], assigned: {},
    })));
    await stabilize(page, shot.theme);
    await login(page);
    await page.goto("/training?tab=weekplan");
    await page.evaluate(() => window.__i18n?.changeLanguage("en"));
    await page.getByTestId("training-plan-for").waitFor();
    await page.getByTestId("training-plan-for").selectOption(rider.id);
    await page.getByTestId("training-program-grid").waitFor();
    const locked = page.getByTestId("training-program-cell-locked").first();
    await locked.waitFor();
    if (shot.state === "after") await page.getByTestId("training-race-session-note").waitFor();
    await locked.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(OUT, `${shot.name}.png`), fullPage: false });
    await context.close();
  }
  console.log(`Billeder -> ${OUT}`);
} finally {
  await browser?.close();
  server.kill();
}
