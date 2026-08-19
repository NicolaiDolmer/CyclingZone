// #3550 — ungdomspakken (løn-design-session 19/8). PR-screenshots af akademisidens
// pull-baserede intake-sektion i begge ejer-godkendte tilstande.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en kørende dev/preview-server med e2e-netværksmocks —
// overrider /api/academy/me med intakePull.enabled=true (flaget er seedet OFF i
// den rigtige app indtil cutover 23/8, så mocken er den eneste måde at se den nye
// UI før flippet).
//
//   node tests/e2e/3550-academy-intake-pull.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, json, corsHeaders } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const { SEED_ACADEMY } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/seedData.js")).href
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

// #3550 punkt 2: en pull-hentet kandidat får market_value trukket uniformt
// 1.000-5.000 (IKKE de gamle 150k-200k SEED_ACADEMY-værdier) — screenshottet skal
// vise den symbolske størrelsesorden ejeren rent faktisk vil se. signingFee =
// round(value × 0.25) (uændret formel). wagePreview er computeFrozenSalary af en
// repræsentativ current_production_value — #3550 punkt 4-fundet (se PR-body):
// lønnen er IKKE afledt af den symbolske market_value, så tallet her er bevidst
// IKKE "symbolsk lavt" — det viser den faktiske, upåvirkede appadfærd.
const PULLED_INTAKE = [
  {
    intakeId: "intake-pull-1",
    riderId: "prospect-pull-1",
    is_serious: true,
    status: "offered",
    created_at: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    signingFee: 800,
    wagePreview: 6800,
    rider: {
      id: "prospect-pull-1",
      firstname: "Emil",
      lastname: "Kristiansen",
      birthdate: "2009-06-05",
      nationality_code: "dk",
      base_value: 3200,
      market_value: 3200,
      prize_earnings_bonus: 0,
      team_id: null,
      primary_type: "puncheur",
      secondary_type: "climber",
    },
    potentialEstimate: { lo: 3.5, hi: 5.0, exact: false, scoutLevel: 1 },
  },
  {
    intakeId: "intake-pull-2",
    riderId: "prospect-pull-2",
    is_serious: false,
    status: "offered",
    created_at: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    signingFee: 600,
    wagePreview: 5200,
    rider: {
      id: "prospect-pull-2",
      firstname: "Axel",
      lastname: "Bergström",
      birthdate: "2010-02-18",
      nationality_code: "se",
      base_value: 2400,
      market_value: 2400,
      prize_earnings_bonus: 0,
      team_id: null,
      primary_type: "tt",
      secondary_type: "rouleur",
    },
    potentialEstimate: { lo: 2.0, hi: 4.0, exact: false, scoutLevel: 0 },
  },
];

const STATES = [
  {
    name: "not-pulled",
    payload: { ...SEED_ACADEMY, intake: [], intakePull: { enabled: true, pulledThisWeek: false } },
  },
  {
    name: "pulled",
    payload: { ...SEED_ACADEMY, intake: PULLED_INTAKE, intakePull: { enabled: true, pulledThisWeek: true } },
  },
];

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  for (const state of STATES) {
    const context = await browser.newContext({
      baseURL: BASE,
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      locale: "en-US",
    });
    const page = await context.newPage();
    await installNetworkMocks(page);
    // Registreret EFTER installNetworkMocks, så denne handler vinder (Playwright:
    // senest-tilføjede route matcher først).
    await page.route("**/api/academy/me**", (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      return json(route, state.payload);
    });
    await stabilizeEnglish(page);
    await login(page);
    await page.goto("/academy");
    if (state.name === "not-pulled") {
      await page.getByText(/Scout this week's intake/i).first().waitFor();
    } else {
      await page.getByText(/Emil Kristiansen/i).first().waitFor();
    }
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(OUT, `3550-${vp.name}-${state.name}.png`), fullPage: false });
    await context.close();
  }
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
