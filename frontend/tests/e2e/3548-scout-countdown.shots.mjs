// #3548 — capture-script til PR-screenshots af scout-nedtællingen.
//
// Ad-hoc (ikke en del af CI-suiten; testMatch fanger kun *.spec.js). Kører mod
// en kørende dev/preview-server med e2e-netværksmocks og overrider
// /api/scouting/me + /api/scouting/central med ÉN aktiv målrettet opgave hvis
// ready_at ligger et fast antal minutter ude i fremtiden, så nedtællingen har
// et forudsigeligt tal i billedet.
//
//   node tests/e2e/3548-scout-countdown.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5299";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

const TARGET_RIDER = RIDERS.find((r) => r.team_id !== TEST_TEAM.id) || RIDERS[0];
const MINUTES_LEFT = 18;

function scoutState() {
  const readyAt = new Date(Date.now() + MINUTES_LEFT * 60_000).toISOString();
  return {
    scout: { overall: 40, roleSkills: { evaluation: 40, reach: 40 }, isDefault: true },
    active: [{
      id: "shot-target-1",
      kind: "target",
      rider_id: TARGET_RIDER.id,
      target_level: 1,
      status: "active",
      ready_on: new Date().toISOString().slice(0, 10),
      ready_at: readyAt,
    }],
    completed: [],
    capacity: 1,
    jobConfig: { targetEtaMinutes: 30, targetCostPerLevel: 1000, missionDays: 2, missionCost: 6000 },
  };
}

async function stabilize(page, lang) {
  await page.addInitScript((language) => {
    window.localStorage.setItem("cz_lang", language);
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
  }, lang);
}

async function login(page, lang) {
  await page.goto("/login");
  const emailPlaceholder = lang === "da" ? "din@email.dk" : "you@email.com";
  const submitName = lang === "da" ? "Log ind" : "Log in";
  await page.getByPlaceholder(emailPlaceholder).waitFor();
  await page.getByPlaceholder(emailPlaceholder).fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: submitName, exact: true }).click();
  await page.waitForURL(/\/dashboard$/);
}

const SHOTS = [
  { lang: "en", vp: { name: "desktop", width: 1440, height: 900 } },
  { lang: "en", vp: { name: "mobile", width: 393, height: 852 } },
  { lang: "da", vp: { name: "desktop", width: 1440, height: 900 } },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const { lang, vp } of SHOTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    locale: lang === "da" ? "da-DK" : "en-GB",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);

  // Registreret EFTER installNetworkMocks, så disse matcher først.
  await page.route("**/api/scouting/central**", (route) => (
    route.request().method() === "GET"
      ? json(route, { teamId: TEST_TEAM.id, ...scoutState() })
      : route.fallback()
  ));
  await page.route("**/api/scouting/me**", (route) => (
    route.request().method() === "GET"
      ? json(route, {
          slots: { total: 3, used: 0, remaining: 3 },
          maxLevel: 3,
          levels: {},
          teamId: TEST_TEAM.id,
          scoutSystemEnabled: true,
          jobModel: scoutState(),
        })
      : route.fallback()
  ));
  await page.route("**/api/riders/names**", (route) => json(route, {
    riders: [{ id: TARGET_RIDER.id, name: `${TARGET_RIDER.firstname} ${TARGET_RIDER.lastname}` }],
  }));

  await stabilize(page, lang);
  await login(page, lang);

  await page.goto("/scouting");
  await page.getByText(new RegExp(`${MINUTES_LEFT} min`)).first().waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, `3548-scouting-central-${vp.name}-${lang}.png`), fullPage: false });

  // Samme nedtælling på rytterprofilens scouting-fane (RiderScoutingTab).
  await page.goto(`/riders/${TARGET_RIDER.id}?tab=scouting`);
  const pendingBadge = page.getByText(new RegExp(`${MINUTES_LEFT} min`)).first();
  await pendingBadge.waitFor();
  await pendingBadge.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, `3548-rider-scouting-tab-${vp.name}-${lang}.png`), fullPage: false });

  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
