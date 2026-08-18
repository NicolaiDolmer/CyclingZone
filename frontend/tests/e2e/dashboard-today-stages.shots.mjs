// #3915 — screenshots af dashboardets nye "Today's stages"-stribe (dagens
// etaper/løb for holdet, allerøverst under page-header). Dækker BEGGE
// mockup-varianter i ét load: ét etapeløb (kommende, med samlet placering)
// og ét endagsløb (afsluttet, med vindernavn + antal tilmeldte).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js) — mønster: quality-auctions-contract.shots.mjs.
//
//   node tests/e2e/dashboard-today-stages.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, TEST_TEAM, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5199";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

// Klokken fastfryses (samme idiom som race-centre.spec.js) — hele stribens
// tilstand er en funktion af (nu − scheduled_at). 2026-08-17T14:30Z = 16:30
// København (CEST).
const FROZEN_NOW = new Date("2026-08-17T14:30:00Z");

const STAGE_RACE_ID = "race-today-stage";
const ONEDAY_RACE_ID = "race-today-oneday";

const SCHEDULE = [
  // Kommende: etape 3 kl. 19:00 København, senere i dag.
  { race_id: STAGE_RACE_ID, stage_number: 3, scheduled_at: "2026-08-17T17:00:00Z" },
  // Afsluttet: kørt kl. 12:00 København, langt uden for afspilningsvinduet.
  { race_id: ONEDAY_RACE_ID, stage_number: 1, scheduled_at: "2026-08-17T10:00:00Z" },
];

const RACES = [
  { id: STAGE_RACE_ID, name: "Vuelta de Zone", stages: 5, stages_completed: 2, status: "scheduled", race_type: "stage_race", league_division_id: TEST_TEAM.league_division_id },
  { id: ONEDAY_RACE_ID, name: "Classica Nordica", stages: 1, stages_completed: 1, status: "completed", race_type: "single", league_division_id: TEST_TEAM.league_division_id },
];

// Union-liste: bruges BÅDE til "hvilke løb er mine" (team_id+race_id-scoped
// forespørgsel) og "antal tilmeldte" (alle hold, race_id-scoped forespørgsel)
// — samme to forespørgsler som useTodayStages.js selv laver.
const ENTRIES = [
  { race_id: STAGE_RACE_ID },
  ...Array.from({ length: 8 }, (_, i) => ({ race_id: ONEDAY_RACE_ID, id: `entry-oneday-${i}` })),
];

const PROFILES = [
  { race_id: STAGE_RACE_ID, stage_number: 3, profile_type: "mountain" },
  { race_id: ONEDAY_RACE_ID, stage_number: 1, profile_type: "cobbles" },
];

const RESULTS = [
  // Etape 2's fulde dag-snapshot (leader-rækker, #2081) — tre hold á tre
  // ryttere, så deriveTeamStandings kan udlede en holdstilling. Rival-holdet
  // er hurtigst (rang 1), mit hold ligger midt i feltet (rang 2 af 3).
  { race_id: STAGE_RACE_ID, stage_number: 2, result_type: "leader", rank: 1, team_id: "team-rival", team_name: "Regression VC", finish_time: "+0:00" },
  { race_id: STAGE_RACE_ID, stage_number: 2, result_type: "leader", rank: 2, team_id: "team-rival", team_name: "Regression VC", finish_time: "+0:05" },
  { race_id: STAGE_RACE_ID, stage_number: 2, result_type: "leader", rank: 3, team_id: "team-rival", team_name: "Regression VC", finish_time: "+0:12" },
  { race_id: STAGE_RACE_ID, stage_number: 2, result_type: "leader", rank: 4, team_id: TEST_TEAM.id, team_name: TEST_TEAM.name, finish_time: "+0:20" },
  { race_id: STAGE_RACE_ID, stage_number: 2, result_type: "leader", rank: 5, team_id: TEST_TEAM.id, team_name: TEST_TEAM.name, finish_time: "+0:25" },
  { race_id: STAGE_RACE_ID, stage_number: 2, result_type: "leader", rank: 6, team_id: TEST_TEAM.id, team_name: TEST_TEAM.name, finish_time: "+0:31" },
  { race_id: STAGE_RACE_ID, stage_number: 2, result_type: "leader", rank: 7, team_id: "team-third", team_name: "Third VC", finish_time: "+0:40" },
  { race_id: STAGE_RACE_ID, stage_number: 2, result_type: "leader", rank: 8, team_id: "team-third", team_name: "Third VC", finish_time: "+0:44" },
  { race_id: STAGE_RACE_ID, stage_number: 2, result_type: "leader", rank: 9, team_id: "team-third", team_name: "Third VC", finish_time: "+0:50" },
  // Endagsløbets vinder (result_type='stage', rank 1) — "vindernavn når færdig".
  { race_id: ONEDAY_RACE_ID, stage_number: 1, result_type: "stage", rank: 1, rider_id: "r-win", rider_name: "Elena Bakker", team_id: "team-rival" },
];

// #3915 — supplerer (falder ALDRIG helt tilbage over) det eksisterende
// generiske "**/rest/v1/**"-mock fra installNetworkMocks: hver handler her
// tjekker om requesten bærer MINE distinkte race-id'er og kalder ellers
// route.fallback() videre til det generiske mock. Uden dette ville en
// blanket override af fx "races"/"race_entries" forurene de ANDRE tabeller
// og komponenter på dashboardet allerede forbruger (Kommende løb, Hero &
// Agony, m.fl.) med data de ikke selv har bedt om.
async function installTodayStagesMocks(page) {
  await page.route("**/rest/v1/race_stage_schedule**", (route) => {
    const url = route.request().url();
    if (!url.includes("scheduled_at=gte.")) return route.fallback();
    return json(route, SCHEDULE);
  });

  await page.route("**/rest/v1/races**", (route) => {
    const url = decodeURIComponent(route.request().url());
    if (!url.includes("id=in.") || !url.includes(STAGE_RACE_ID)) return route.fallback();
    return json(route, RACES);
  });

  await page.route("**/rest/v1/race_entries**", (route) => {
    const url = decodeURIComponent(route.request().url());
    if (!url.includes(STAGE_RACE_ID) && !url.includes(ONEDAY_RACE_ID)) return route.fallback();
    return json(route, ENTRIES);
  });

  await page.route("**/rest/v1/race_stage_profiles**", (route) => {
    const url = decodeURIComponent(route.request().url());
    if (!url.includes("race_id=in.") || !url.includes(STAGE_RACE_ID)) return route.fallback();
    return json(route, PROFILES);
  });

  await page.route("**/rest/v1/race_results**", (route) => {
    const url = decodeURIComponent(route.request().url());
    if (!url.includes("race_id=in.") || !url.includes(STAGE_RACE_ID)) return route.fallback();
    return json(route, RESULTS);
  });
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 393, height: 852 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    locale: "da-DK",
  });
  const page = await context.newPage();
  await stabilizePage(page);
  await page.clock.setFixedTime(FROZEN_NOW);
  await installNetworkMocks(page);
  await installTodayStagesMocks(page);
  await login(page);

  await page.goto("/dashboard");
  await page.getByText("Dagens etaper").waitFor();
  await page.getByText("Vuelta de Zone").waitFor();
  await page.getByText("Classica Nordica").waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, `3915-today-stages-${vp.name}.png`), fullPage: false });

  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
