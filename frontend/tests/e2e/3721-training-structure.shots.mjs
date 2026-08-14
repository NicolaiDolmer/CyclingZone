// #3721 — måling + "før"-screenshots af /training med en REALISTISK trup.
//
// Issuet målte på ét skærmbillede med ÉN rytter. En rigtig trup har 12-30.
// Dette script bygger 14 ryttere på TEST_TEAM, kører /training og rapporterer
// den lodrette position (px fra sidens top) af hvert blok på siden, plus sidens
// samlede højde. Det er tallet designbeslutningen skal hvile på.
//
//   node tests/e2e/3721-training-structure.shots.mjs [baseURL] [outDir]
//
// Ad-hoc capture-script (ikke i CI-suiten; testMatch fanger kun *.spec.js).

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json, corsHeaders } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5173";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

const TYPES = ["sprinter", "climber", "rouleur", "puncheur", "timetrialist", "allrounder", "baroudeur"];
const FOCUSES = ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"];
const base = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];

const squad = Array.from({ length: 14 }, (_, i) => ({
  ...base,
  id: `rider-3721-${i}`,
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
for (const [i, r] of squad.entries()) {
  plans[r.id] = { focus: FOCUSES[i % FOCUSES.length], intensity: ["normal", "hard", "easy"][i % 3] };
  condition[r.id] = { form: 50 + ((i * 7) % 40), fatigue: 15 + ((i * 11) % 60), injured_until: null, risk: i % 6 === 0 ? 0.07 : 0 };
  progress[r.id] = { climbing: 0.2, punch: 0.55, tempo: 0.81, sprint: 0.4, endurance: 0.66, flat: 0.12 };
  trainability[r.id] = Object.fromEntries(FOCUSES.map((f, j) => [f, ["strength", "limited", "blocked"][(i + j) % 3]]));
}

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
  capped: Object.fromEntries(squad.map((r, i) => [r.id, i % 4 === 0 ? ["climbing"] : []])),
  trainability,
  smartDefaultFocus: {},
  weekPlan: null,
  riderWeekPlans: {},
  racingToday: {},
  todayRun: null,
};

// Den tilstand spilleren FAKTISK ser de fleste dage: assistenten/cron har kørt
// dagens træning. Den tænder tre blokke mere (dagens moment, tick-noten og hele
// rapport-tabellen) som "ikke trænet endnu"-tilstanden skjuler.
const TODAY_RUN = {
  tick_date: "2026-08-16",
  created_at: "2026-08-16T04:12:00.000Z",
  executed_by: "assistant",
  bonus_applied: true,
  report: {
    riders: squad.map((r, i) => ({
      rider_id: r.id,
      name: `${r.firstname} ${r.lastname}`,
      focus: plans[r.id].focus,
      intensity: plans[r.id].intensity,
      form: condition[r.id].form,
      fatigue_delta: (i % 5) - 2,
      status: i % 4 === 0 ? "over" : i % 7 === 0 ? "under" : "normal",
      injured: false,
      gains: i % 3 === 0 ? { tempo: 1 } : {},
      gains_detail: i % 3 === 0 ? { tempo: { from: 41, to: 42 } } : {},
    })),
  },
};
const TRAINING_ME_TRAINED = { ...TRAINING_ME, todayRun: TODAY_RUN };

// Blokkene på /training, i DOM-rækkefølge. Vælgerne er bevidst tekst-/struktur-
// baserede (ingen test-id'er tilføjet til produktionskoden for et måle-script).
const BLOCK_PROBES = [
  ["Sidehoved", "h1"],
  ["Recovery-FAQ", "section:has-text('energy'), div:has-text('Do riders get energy')"],
  ["Fokus-guide (accordion)", "details:has(summary:has-text('focus'))"],
  ["Ugerytme (accordion)", "details:has(summary:has-text('rhythm'))"],
  ["Group-by-type checkbox", "input[type=checkbox]:below(:text('rhythm'))"],
  ["Roster-tabel", "table[data-sortable]"],
];

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

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, trained: false },
  { name: "mobile", width: 393, height: 852, trained: false },
  { name: "desktop-trained", width: 1440, height: 900, trained: true },
  { name: "mobile-trained", width: 393, height: 852, trained: true },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const report = {};

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    locale: "en-US",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await page.route("**/rest/v1/riders**", (route) => {
    const url = route.request().url();
    if (route.request().method() !== "GET") return json(route, {});
    if (url.includes("pending_team_id=eq.")) return json(route, []);
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, squad);
    return json(route, RIDERS);
  });
  await page.route("**/api/training/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, vp.trained ? TRAINING_ME_TRAINED : TRAINING_ME);
  });
  await stabilizeEnglish(page);
  await login(page);
  await page.goto("/training");
  await page.locator("table[data-sortable]").waitFor();
  await page.waitForTimeout(400);

  // Mål DOM-rækkefølgen direkte i stedet for at gætte vælgere: sidehovedet +
  // hvert direkte barn af indholds-stakken, med top-offset, højde og en tekst-
  // stump så blokken kan genkendes i rapporten.
  const measurements = await page.evaluate(() => {
    const header = document.querySelector("h1");
    const stack = header?.closest("div")?.parentElement?.querySelector(".space-y-6")
      || document.querySelector(".space-y-6");
    const rows = [];
    const push = (label, el) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.height === 0) return;
      rows.push({
        label,
        top: Math.round(r.top + window.scrollY),
        height: Math.round(r.height),
        text: (el.innerText || "").replace(/\s+/g, " ").slice(0, 60),
      });
    };
    push("PageHeader", header?.closest("div")?.parentElement?.firstElementChild ?? header);
    for (const child of stack ? [...stack.children] : []) push("blok", child);
    return rows;
  });
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const screens = pageHeight / vp.height;
  report[vp.name] = { viewport: vp, pageHeight, screens: Number(screens.toFixed(2)), measurements };

  await page.screenshot({ path: resolve(OUT, `3721-before-training-${vp.name}.png`), fullPage: true });
  await context.close();
}

await browser.close();
writeFileSync(resolve(OUT, "3721-before-measurements.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`Screenshots + measurements → ${OUT}`);
