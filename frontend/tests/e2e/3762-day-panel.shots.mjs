// #3762 — screenshots af dagstype-panelet: trin 1 (dagen) og trin 2 (sessionen),
// desktop + mobil, plus rosterets nye dags-kolonne.
//
//   node tests/e2e/3762-day-panel.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json, corsHeaders } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://localhost:5173";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

const FOCUSES = ["vo2max", "threshold", "sprint", "endurance", "technique", "aero", "tempo"];
const base = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];

// Tre ryttere: én med fokus, én uden (assistentens default synlig), én hvor ALT
// er `limited` — det er den rytter der viser at signal-kolonnen forsvinder helt
// i stedet for at stå tom med seks tomme celler.
const squad = [
  { ...base, id: "rider-3721-a", firstname: "Elias", lastname: "Andersen", team_id: TEST_TEAM.id, primary_type: "sprinter", secondary_type: "puncheur" },
  { ...base, id: "rider-3721-b", firstname: "Nuno", lastname: "Duran", team_id: TEST_TEAM.id, primary_type: "rouleur", secondary_type: "baroudeur" },
  { ...base, id: "rider-3721-c", firstname: "Bo", lastname: "Colombo", team_id: TEST_TEAM.id, primary_type: "climber", secondary_type: null },
  // #3762: en rytter der stadig staar paa en UMIGRERET plan (endurance + haard).
  // Rosteret skal vise ham som det han BLIVER (Traening · Lang tur), ikke som en
  // tilstand modellen ikke tilbyder.
  { ...base, id: "rider-3762-d", firstname: "Kasper", lastname: "Holm", team_id: TEST_TEAM.id, primary_type: "gc", secondary_type: "climber" },
];

const TRAINING_ME = {
  enabled: true,
  betaTester: true,
  teamId: TEST_TEAM.id,
  slots: { total: null, used: 1, remaining: null },
  focuses: FOCUSES,
  intensities: ["easy", "normal", "hard", "rest"],
  plans: {
    "rider-3721-a": { focus: "sprint", intensity: "hard" },
    // en hviledag der stadig baerer sit gamle fokus (623 saadan i prod)
    "rider-3721-b": { focus: "vo2max", intensity: "rest" },
    // umigreret: haard udholdenhed findes ikke i modellen
    "rider-3762-d": { focus: "endurance", intensity: "hard" },
  },
  condition: Object.fromEntries(squad.map((r, i) => [r.id, { form: 60 + i * 6, fatigue: 25 + i * 9, injured_until: null, risk: 0 }])),
  progress: Object.fromEntries(squad.map((r) => [r.id, { sprint: 0.44, acceleration: 0.9, endurance: 0.66, tempo: 0.81, climbing: 0.12 }])),
  capped: {},
  trainability: {
    // Ægte fordeling: de fleste fokus er `strength`, sprint er den hyppigste
    // `limited` (49 af 79 målte limited-celler).
    "rider-3721-a": { vo2max: "limited", threshold: "limited", sprint: "strength", endurance: "strength", technique: "strength", aero: "strength" },
    "rider-3721-b": { vo2max: "limited", threshold: "limited", sprint: "limited", endurance: "strength", technique: "strength", aero: "strength" },
    // Alt limited → signal-kolonnen skal forsvinde helt.
    "rider-3721-c": Object.fromEntries(FOCUSES.map((k) => [k, "limited"])),
    "rider-3762-d": { vo2max: "strength", threshold: "strength", sprint: "limited", endurance: "strength", technique: "limited", aero: "limited", tempo: "strength" },
  },
  smartDefaultFocus: { "rider-3721-c": "vo2max" },
  weekPlan: null,
  riderWeekPlans: {},
  racingToday: {},
  todayRun: null,
};

async function stabilizeEnglish(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cz_lang", "en");
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false,
      email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
    const css = "*, *::before, *::after { animation-duration: 0.001s !important; animation-iteration-count: 1 !important; caret-color: transparent !important; transition-duration: 0s !important; }";
    const inject = () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
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


// Paa mobil er navnekolonnen sticky og ligger OVEN PAA fokus-kolonnen indtil
// tabellen scrolles vandret. Det er T2's mobil-adfaerd (og praecis det #3721
// dokumenterer som problemet), ikke en fejl i panelet — saa scroll foerst.
async function openDayPanel(page, name) {
  await page.evaluate(() => {
    const table = document.querySelector("table[data-sortable]");
    const scroller = table?.closest(".overflow-x-auto");
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  });
  await page.waitForTimeout(120);
  await page.locator(`tr:has-text("${name}") button[aria-label*="${name}"]`).first().evaluate((el) => el.click());
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(300);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of [
  { name: "desktop", width: 1440, height: 950 },
  { name: "mobile", width: 393, height: 852 },
]) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, locale: "en-US" });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await page.route("**/rest/v1/riders**", (route) => {
    const url = route.request().url();
    if (route.request().method() !== "GET") return json(route, {});
    if (url.includes("pending_team_id=eq.")) return json(route, []);
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, squad);
    if (url.includes("rider-3721-")) return json(route, squad);
    return json(route, [...squad, ...RIDERS]);
  });
  await page.route("**/api/training/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, TRAINING_ME);
  });
  await stabilizeEnglish(page);
  await login(page);

  await page.goto("/training");
  await page.locator("table[data-sortable]").waitFor();
  await page.waitForTimeout(300);
  // Rosteret: dags-kolonnen + hurtig-skiftet. Kasper staar umigreret
  // (endurance + haard) og skal laese som "Traening · Lang tur".
  await page.screenshot({ path: resolve(OUT, `3762-roster-${vp.name}.png`), fullPage: true });

  // Panelet paa en traeningsdag: begge trin synlige, sessionerne grupperet
  // efter niveau.
  await openDayPanel(page, "Elias Andersen");
  await page.screenshot({ path: resolve(OUT, `3762-panel-training-${vp.name}.png`) });
  if (process.env.DEBUG_NAMES) {
    const names = await page.getByRole("radio").allTextContents();
    console.log("RADIO-NAVNE:", JSON.stringify(names, null, 1));
    console.log("DIALOG:", (await page.getByRole("dialog").innerText()).slice(0, 700));
  }

  // Skift til Hvile: trin 2 forsvinder og erstattes af hvad dagen goer.
  await page.getByRole("radio", { name: "Rest", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, `3762-panel-rest-${vp.name}.png`) });

  // Faerdighedsdag: kun de sessioner der findes paa den dag.
  await page.getByRole("radio", { name: "Skill day", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, `3762-panel-skill-${vp.name}.png`) });
  await page.keyboard.press("Escape");

  // Rytteren der stod paa hvile med et gammelt fokus i kolonnen.
  await openDayPanel(page, "Nuno Duran");
  await page.screenshot({ path: resolve(OUT, `3762-panel-legacy-rest-${vp.name}.png`) });
  await page.keyboard.press("Escape");

  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
