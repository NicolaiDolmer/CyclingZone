// #4265 — PR-screenshots af Sponsors-siden (alle fire faner + mobil).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en kørende preview-server med e2e-netværksmocks, samme
// mønster som 4618-youth-squads-coming-soon.shots.mjs. EN-locale, fordi
// player-facing copy er EN-first.
//
// Tallene er den ejer-godkendte mockups egne og hænger sammen:
// 214.200 + 30.000 garanteret, 33 etaper á 345 CZ$, 22.491 i bonusser = 278.076.
//
//   node tests/e2e/4265-sponsors-page.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const CONTRACT = {
  sponsor_name: "Corvus Aviation",
  guaranteed_base: 214200,
  per_race_day_rate: 345,
  length_seasons: 2,
  start_season: 2,
  expires_after_season: 3,
  status: "active",
  variant: "results",
  guaranteed_fraction: 0.55,
  race_day_share: 0.1,
  signed_division: 3,
  results_bonus_paid: 22491,
  bonus_clauses: [
    { type: "stage_win", amount: 12495 },
    { type: "podium", amount: 4998 },
    { type: "results_cap", amount: 189210 },
  ],
  created_at: "2026-05-08T00:00:00Z",
};

const stage = (id, amount, raceId, raceName, at) => ({
  id, type: "sponsor_race_day", amount, raceId, raceName, createdAt: at,
});
const bonus = (id, amount, raceId, raceName, at, params) => ({
  id, type: "sponsor_result_bonus", amount, raceId, raceName, createdAt: at, metadata: { params },
});

const SEASON = {
  number: 3,
  stagesTotal: 124,
  transactions: [
    { id: "b1", type: "sponsor", amount: 214200, createdAt: "2026-08-28T00:00:00Z" },
    { id: "b2", type: "division_adjustment", amount: 30000, createdAt: "2026-08-28T00:01:00Z" },
    stage("s1", 6210, "r1", "Giro della Penisola", "2026-08-30T00:00:00Z"),
    stage("s2", 2070, "r2", "Vuelta a los Pirineos", "2026-08-31T00:00:00Z"),
    stage("s3", 2070, "r3", "Tour of South Australia", "2026-09-01T00:00:00Z"),
    stage("s4", 345, "r4", "Klassieker van Kuurne", "2026-09-02T00:00:00Z"),
    stage("s5", 345, "r5", "Rund um Koeln Neu", "2026-09-02T01:00:00Z"),
    stage("s6", 345, "r6", "Ronde van Drenthe Nieuw", "2026-09-02T02:00:00Z"),
    bonus("x1", 12495, "r1", "Giro della Penisola", "2026-08-30T01:00:00Z", { wins: 1, podiums: 0 }),
    bonus("x2", 4998, "r2", "Vuelta a los Pirineos", "2026-08-31T01:00:00Z", { wins: 0, podiums: 1 }),
    bonus("x3", 4998, "r4", "Klassieker van Kuurne", "2026-09-02T03:00:00Z", { wins: 0, podiums: 1 }),
  ],
};

const OFFERS = {
  negotiable: true,
  upcomingSeasonNumber: 4,
  pendingVariant: null,
  teamDivision: 2,
  stageCounts: { byTier: { 1: 140, 2: 124, 3: 84 }, fallbackDays: 31 },
  offers: [
    { variant: "safe", sponsorName: "Meridian Bank", guaranteedBase: 412160, guaranteedFraction: 0.92, raceDayShare: 0.08, perRaceDayRate: 289, lengthSeasons: 1, clauses: [] },
    { variant: "loyal", sponsorName: "Falcon Logistics", guaranteedBase: 349440, guaranteedFraction: 0.78, raceDayShare: 0.18, perRaceDayRate: 650, lengthSeasons: 3, clauses: [{ type: "signing", amount: 35840 }] },
    { variant: "racing", sponsorName: "Alta Cycles", guaranteedBase: 224000, guaranteedFraction: 0.5, raceDayShare: 0.58, perRaceDayRate: 2095, lengthSeasons: 1, clauses: [] },
    { variant: "results", sponsorName: "Vesna Robotics", guaranteedBase: 268800, guaranteedFraction: 0.6, raceDayShare: 0.12, perRaceDayRate: 434, lengthSeasons: 2, clauses: [{ type: "stage_win", amount: 15680 }, { type: "podium", amount: 6272 }, { type: "results_cap", amount: 237440 }] },
    { variant: "ambition", sponsorName: "Larkin Brewing", guaranteedBase: 313600, guaranteedFraction: 0.7, raceDayShare: 0.2, perRaceDayRate: 723, lengthSeasons: 2, clauses: [{ type: "season_objective", objective: "top_40pct", amount: 170240 }] },
  ],
};

function jsonRoute(payload) {
  return (route) => {
    const request = route.request();
    const headers = {
      "content-type": "application/json",
      "access-control-allow-origin": request.headers().origin || "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    return route.fulfill({ status: 200, headers, body: JSON.stringify(payload) });
  };
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

const BASE = process.argv[2] || "http://127.0.0.1:4542";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

// Overblikket måles på 1280x900 — ejer-reglen "ét skærmbillede uden scroll".
const VARIANTS = [
  { name: "overview", width: 1280, height: 900, path: "/sponsors" },
  { name: "deal", width: 1280, height: 900, path: "/sponsors?tab=deal" },
  { name: "payments", width: 1280, height: 1100, path: "/sponsors?tab=payments" },
  { name: "next-season", width: 1280, height: 900, path: "/sponsors?tab=next" },
  { name: "overview-mobile", width: 390, height: 844, path: "/sponsors" },
  { name: "next-season-mobile", width: 390, height: 844, path: "/sponsors?tab=next" },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const variant of VARIANTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: variant.width, height: variant.height },
    deviceScaleFactor: 2,
    locale: "en-US",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await page.route("**/api/sponsor/contract", jsonRoute({ contract: CONTRACT, earnings: null, season: SEASON }));
  await page.route("**/api/sponsor/offers", jsonRoute(OFFERS));
  await stabilizeEnglish(page);
  await login(page);
  await page.goto(variant.path);
  await page.getByRole("heading", { name: "Sponsors", level: 1 }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT, `4265-sponsors-${variant.name}.png`), fullPage: false });
  await context.close();
}

await browser.close();
console.log(`Screenshots -> ${OUT}`);
