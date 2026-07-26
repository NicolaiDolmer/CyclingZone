// #3018 — før/efter-screenshots af sæsonplanlæggeren for en KOMMENDE sæson.
//
// Ad-hoc capture-script (ikke en del af CI-suiten): kører mod dev-serveren med
// e2e-netværksmocks og serverer to varianter af GET /api/peak-plans/board:
//
//   before/ — den gamle adfærd: holdets NUVÆRENDE division (D3) markeres isMine
//             i sæson 2, så "Mine løb" viser D3's kalender til et hold der
//             rykker op i D2. Det er præcis det thelamba rapporterede 26/7.
//   after/  — den nye adfærd: divisionPending, intet er isMine, hele kalenderen
//             på tværs af divisioner + en ærlig forklaring.
//
//   node tests/e2e/planner-division-pending.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

// Egen stabilisering i stedet for fixtures.stabilizePage: den låser cz_lang til
// "da" på HVER navigation (addInitScript), og player-facing copy skal reviewes
// EN-first. Samme consent + animations-frys, bare med engelsk locale.
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

async function loginEnglish(page) {
  await page.goto("/login");
  await page.getByPlaceholder("you@email.com").waitFor();
  await page.getByPlaceholder("you@email.com").fill(TEST_USER.email);
  await page.getByPlaceholder("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022").fill("playwright-password");
  await page.getByRole("button", { name: /^Log in$/ }).click();
  await page.waitForURL(/\/dashboard$/);
}

const BASE = process.argv[2] || "http://localhost:5199";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../screenshots/3018-planner-division"));

const TODAY = "2026-06-01";
const DAY = 86_400_000;
const ord = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY;

const DEMANDS = {
  sprint: { sprint: 0.61, acceleration: 0.15, flat: 0.06, positioning: 0.08, endurance: 0.02, randomness: 0.08 },
  hilly: { punch: 0.35, climbing: 0.2, tempo: 0.15, endurance: 0.1, positioning: 0.08, randomness: 0.12 },
  mountain: { climbing: 0.5, tempo: 0.12, endurance: 0.14, recovery: 0.06, punch: 0.04, tactics: 0.02, positioning: 0.02, randomness: 0.1 },
  itt: { time_trial: 0.58, positioning: 0.24, flat: 0.06, randomness: 0.12 },
};

function race(id, name, terrain, date, isMine, stages, division) {
  const profiles = Array.from({ length: stages }, (_, i) => ({ stage: i + 1, terrain, summit: terrain === "mountain" && i % 2 === 0 }));
  return {
    id, name, raceClass: stages > 1 ? "WorldTour" : "ProSeries", division, isMine,
    date, gameDayStart: ord(date), gameDayEnd: ord(date) + (stages - 1), stages, terrain,
    stageProfiles: profiles,
    profileSummary: { stages, summitFinishes: profiles.filter((p) => p.summit).length },
    demandVector: DEMANDS[terrain], rivalPeakCount: 0,
  };
}

const ability = (over = {}) => ({
  climbing: 38, time_trial: 38, sprint: 38, punch: 40, endurance: 46, cobblestone: 36,
  acceleration: 40, recovery: 44, tactics: 42, positioning: 46, flat: 40, tempo: 42,
  durability: 44, aggression: 38, descending: 42, ...over,
});

const RIDERS = [
  { id: "rd-verm", firstname: "Lars", lastname: "Vermeulen", nationality: "be", primaryType: "climber", secondaryType: "puncheur", isAcademy: true, form: 54, fatigue: 22, injuredUntil: null, abilities: ability({ climbing: 74, tempo: 62, endurance: 60 }), peaks: [] },
  { id: "rd-krist", firstname: "Henrik", lastname: "Kristiansen", nationality: "no", primaryType: "sprinter", secondaryType: null, isAcademy: false, form: 60, fatigue: 30, injuredUntil: null, abilities: ability({ sprint: 76, acceleration: 70, flat: 58 }), peaks: [] },
  { id: "rd-soren", firstname: "Mikkel", lastname: "Sørensen", nationality: "dk", primaryType: "puncheur", secondaryType: "climber", isAcademy: false, form: 50, fatigue: 26, injuredUntil: null, abilities: ability({ punch: 66, tempo: 60 }), peaks: [] },
  { id: "rd-novak", firstname: "Tomaz", lastname: "Novak", nationality: "si", primaryType: "gc", secondaryType: "tt", isAcademy: true, form: 57, fatigue: 24, injuredUntil: null, abilities: ability({ climbing: 72, time_trial: 66 }), peaks: [] },
];

const SEASONS = [
  { id: "s1", number: 1, status: "active" },
  { id: "s2", number: 2, status: "upcoming" },
];

// Sæson 2's kalender på tværs af pyramiden. I "before" er D3-løbene markeret
// isMine (holdets gamle division); i "after" er intet isMine.
const S2 = (mineDivision) => [
  race("r2-a", "Season Openers", "sprint", "2026-08-02", mineDivision === 2, 1, 2),
  race("r2-b", "Ardennes Week", "hilly", "2026-08-16", mineDivision === 2, 4, 2),
  race("r2-c", "High Alps Tour", "mountain", "2026-09-06", mineDivision === 3, 7, 3),
  race("r2-d", "Chrono Championship", "itt", "2026-09-20", mineDivision === 3, 1, 3),
  race("r2-e", "Autumn Closer", "hilly", "2026-10-04", mineDivision === 4, 1, 4),
];

const BOARDS = {
  // Gammel adfærd: holdets nuværende division (3) vinder, divisionPending findes ikke.
  before: {
    enabled: true, season: SEASONS[1], availableSeasons: SEASONS,
    maxPerRider: 2, today: TODAY, leadupDays: 14,
    riders: RIDERS, races: S2(3),
  },
  // Ny adfærd: divisionen er ikke afgjort → intet isMine + eksplicit flag.
  after: {
    enabled: true, season: SEASONS[1], availableSeasons: SEASONS, divisionPending: true,
    maxPerRider: 2, today: TODAY, leadupDays: 14,
    riders: RIDERS, races: S2(null),
  },
};

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 1400 },
  { name: "mobile-360", width: 360, height: 1400 },
];

const browser = await chromium.launch();

for (const [variant, board] of Object.entries(BOARDS)) {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      baseURL: BASE, // fixtures.login() navigerer relativt til /login
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      locale: "en-GB",
    });
    const page = await context.newPage();
    await installNetworkMocks(page);
    await page.route("**/api/peak-plans/board**", (route) => json(route, board));
    await stabilizeEnglish(page);
    await loginEnglish(page);
    await page.goto(`${BASE}/planner`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Season planner/i }).first().waitFor();
    await page.waitForTimeout(600);

    const dir = resolve(OUT, variant);
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `planner-s2-${vp.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log("wrote", file);

    await context.close();
  }
}

await browser.close();
