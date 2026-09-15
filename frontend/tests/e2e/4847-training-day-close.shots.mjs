// #4847 — PR-screenshots af den frivillige knap "Run today's training now".
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun *.spec.js).
// Moenster fra 3300-training-academy-status.shots.mjs, med EEN forskel: dette script
// starter og draeber sin EGEN statiske server, saa koerslen er selvindeholdt og
// intet overlever kommandoen (baelge-regel: ingen dev-server/watcher der overlever).
//
// HVORFOR ET EGET SCRIPT. Knappens nye tilstande haenger paa `dayClose` fra
// /api/training/me, som backenden KUN leverer naar `training_tick_per_race_day` er
// on — og flaget er off i prod. Feltet mockes derfor her i tre tilstande, saa ejeren
// kan se praecis hvad han flipper til:
//   1. waiting  — dagens sidste loeb koerer stadig: knap DEAKTIVERET, kort linje
//                 "Today's training runs on its own once the last race is done…"
//   2. ready    — dagen er lukket: knap AKTIV, "Today's training is ready…"
//   3. legacy   — flaget off (feltet mangler): PRAECIS dagens knap, "Train today"
//
// Bygger du ikke frontend foerst, serverer serveren en gammel dist. Koer:
//   npm --prefix frontend run build
//   node frontend/tests/e2e/4847-training-day-close.shots.mjs [outDir]

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
const PORT = Number(process.argv[3] || 4847);
const BASE = `http://${HOST}:${PORT}`;
const OUT = resolve(process.argv[2] || resolve(__dirname, "../../../pr-screens"));

// ── Egen server, eget drab ───────────────────────────────────────────────────
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
  ...base, id: "rider-shot-4847", firstname: "Ada", lastname: "Pedersen",
  team_id: TEST_TEAM.id, team: { id: TEST_TEAM.id, name: TEST_TEAM.name }, is_academy: false,
};

function trainingMe(dayClose) {
  return {
    enabled: true,
    betaTester: true,
    teamId: TEST_TEAM.id,
    slots: { total: null, used: 1, remaining: null },
    focuses: ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"],
    intensities: ["easy", "normal", "hard", "rest"],
    plans: { [rider.id]: { focus: "sprint", intensity: "normal" } },
    condition: { [rider.id]: { form: 72, fatigue: 38, injured_until: null, risk: 0 } },
    progress: { [rider.id]: { sprint: 0.82, acceleration: 0.41 } },
    capped: {}, trainability: {}, smartDefaultFocus: {},
    weekPlan: null, riderWeekPlans: {}, racingToday: {},
    // Ingen koersel i dag — ellers er knappen deaktiveret af den gamle grund og
    // screenshottet viser ingenting om #4847.
    todayRun: null,
    ...(dayClose ? { dayClose } : {}),
  };
}

const STATES = [
  { name: "waiting", dayClose: { open: false, reason: "awaiting_finalization", gameDays: [40, 41, 42], opensAtHour: 20 } },
  { name: "ready", dayClose: { open: true, reason: "closed", gameDays: [40, 41, 42], opensAtHour: 20 } },
  { name: "legacy", dayClose: null },
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
        return json(route, trainingMe(state.dayClose));
      });
      await stabilizeEnglish(page);
      await login(page);
      await page.goto("/training");
      await page.getByText(/Ada Pedersen/).first().waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({
        path: resolve(OUT, `4847-training-day-close-${state.name}-${vp.name}.png`),
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
