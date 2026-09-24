// #5462 — PR-screenshots af skade-visningen i BEGGE flag-tilstande.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun *.spec.js).
// Moenster + egen server/eget drab kopieret fra 4847-training-day-close.shots.mjs,
// saa intet overlever kommandoen (boelge-regel: ingen dev-server/watcher der lever
// videre).
//
// HVORFOR MOCKET. `injury_race_days_left` skrives kun naar
// `training_tick_per_race_day` er on, og flaget er off i prod. Feltet mockes derfor
// her i de to tilstande ejeren skal kunne se side om side:
//   1. race-days — flaget on: "Injured: 15 race days left (approx. <dato>)"
//   2. calendar  — flaget off: PRAECIS dagens tekst, "Injured: 4 days left"
//
// Bygger du ikke frontend foerst, serverer serveren en gammel dist. Koer:
//   npm --prefix frontend run build
//   node frontend/tests/e2e/5462-injury-race-days.shots.mjs [outDir]

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
const PORT = Number(process.argv[3] || 5462);
const BASE = `http://${HOST}:${PORT}`;
const OUT = resolve(process.argv[2] || resolve(__dirname, "../../../pr-screens"));

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

const base = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];
const rider = {
  ...base, id: "rider-shot-5462", firstname: "Ada", lastname: "Pedersen",
  team_id: TEST_TEAM.id, team: { id: TEST_TEAM.id, name: TEST_TEAM.name }, is_academy: false,
};

// Kalender-grenen regner LIVE mod dagens dato, saa tallet i "calendar"-shottet
// afhaenger af hvornaar scriptet koeres. Datoen saettes derfor relativt: fire dage
// frem. Loebsdags-grenen er upaavirket — den laeser tallet fra serveren.
const INJURED_UNTIL = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);

function trainingMe(condition) {
  return {
    enabled: true,
    betaTester: true,
    teamId: TEST_TEAM.id,
    slots: { total: null, used: 1, remaining: null },
    focuses: ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"],
    intensities: ["easy", "normal", "hard", "rest"],
    plans: { [rider.id]: { focus: "sprint", intensity: "normal" } },
    condition: { [rider.id]: condition },
    progress: { [rider.id]: { sprint: 0.82, acceleration: 0.41 } },
    capped: {}, trainability: {}, smartDefaultFocus: {},
    weekPlan: null, riderWeekPlans: {}, racingToday: {},
    // #3643: telefonen tegner den nye loebsdags-tabel (kortet med skade-linjen)
    // naar serveren siger til. Uden den viser mobil-shottet den GAMLE visning.
    mobileTable: true,
    todayRun: null,
  };
}

const STATES = [
  {
    name: "race-days",
    condition: { form: 62, fatigue: 74, injured_until: INJURED_UNTIL, injury_race_days_left: 15, risk: 0 },
  },
  {
    name: "calendar",
    condition: { form: 62, fatigue: 74, injured_until: INJURED_UNTIL, injury_race_days_left: null, risk: 0 },
  },
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

mkdirSync(OUT, { recursive: true });

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();

  for (const state of STATES) {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        baseURL: BASE,
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
        locale: "en-US",
      });
      const page = await context.newPage();
      await installNetworkMocks(page);
      await page.route("**/rest/v1/riders**", (route) => {
        const url = route.request().url();
        if (route.request().method() !== "GET") return json(route, {});
        if (url.includes("pending_team_id=eq.")) return json(route, []);
        if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, [rider]);
        return json(route, RIDERS);
      });
      await page.route("**/api/training/me**", (route) => {
        const request = route.request();
        if (request.method() === "OPTIONS") {
          return route.fulfill({ status: 204, headers: corsHeaders(request) });
        }
        return json(route, trainingMe(state.condition));
      });
      await stabilizeEnglish(page);
      await login(page);
      await page.goto("/training");
      await page.getByText(/Ada Pedersen|A\. Pedersen/).first().waitFor();
      if (vp.name === "mobile") {
        // Rytter-kortet er foldet sammen; raekkens EGEN knap folder det ud
        // (navnet er ikke et link her, men en aria-expanded-knap).
        await page.locator('[data-testid="training-mobile-roster"] button[aria-expanded]').first().click();
        await page.waitForTimeout(400);
      } else {
        // Skade-badget bor i Status-kolonnen, som ligger til hoejre for den
        // synlige bredde — scroll tabellen derhen foer billedet tages.
        await page.getByText(/(race )?days? left/i).first().scrollIntoViewIfNeeded();
      }
      await page.waitForTimeout(400);
      await page.screenshot({
        path: resolve(OUT, `5462-injury-${state.name}-${vp.name}.png`),
        fullPage: false,
      });
      await context.close();
    }
  }
  console.log(`Screenshots → ${OUT}`);
} finally {
  await browser?.close();
  server.kill();
}
