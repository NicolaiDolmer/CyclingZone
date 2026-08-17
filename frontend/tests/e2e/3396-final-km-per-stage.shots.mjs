// #3396 (bølge 2) — screenshots af "The Final Kilometre" per etape-fane
// (tidligere altid seneste kørte etape, uafhængig af fanen).
//
//   node tests/e2e/3396-final-km-per-stage.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, stabilizePage, login, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://localhost:5173";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

// Samme fixture-form som race-detail.spec.js: 2-etapers stage race, etape 1
// har begge ryttere sat som in_breakaway (holdt hjem → breakawaySurvived-beat),
// etape 2 har ingen breakaway-flag. Bruges her til at BEVISE at playbacken
// følger fanen, ikke altid den seneste kørte etape.
const RACE = {
  id: "race-3396-1",
  name: "3396 E2E Tour",
  race_type: "stage_race",
  race_class: "TourFrance",
  stages: 2,
  edition_year: 2026,
  status: "completed",
  season: { id: "season-3396", number: 1 },
  pool_race: null,
};

function rider(id, first, last) {
  return { id, firstname: first, lastname: last, nationality_code: "dk", team: { id: "team-x", name: "Team X" } };
}

function row(id, stage_number, result_type, rank, r, points = 0, finish_time = null, breakaway = {}) {
  return {
    id, stage_number, result_type, rank,
    rider_id: r.id, rider_name: `${r.firstname} ${r.lastname}`,
    team_id: r.team.id, team_name: r.team.name,
    finish_time, points_earned: points, prize_money: 0, rider: r,
    in_breakaway: breakaway.in_breakaway === true,
    breakaway_caught: breakaway.breakaway_caught === true,
  };
}

const ADA = rider("rider-1", "Ada", "Pedersen");
const MIK = rider("rider-2", "Mikkel", "Hansen");

const STAGE_PROFILES = [
  { stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint" },
  { stage_number: 2, profile_type: "mountain", finale_type: "long_climb" },
];

const RESULTS = [
  row("r1", 1, "stage", 1, ADA, 100, "+0:00", { in_breakaway: true, breakaway_caught: false }),
  row("r2", 1, "stage", 2, MIK, 80, "+0:23", { in_breakaway: true, breakaway_caught: true }),
  row("j1", 1, "leader", 1, ADA, 0),
  row("j2", 1, "points_day", 1, MIK, 0),
  row("j3", 1, "mountain_day", 1, ADA, 0),
  row("j4", 1, "young_day", 1, ADA, 0),
  row("r3", 2, "stage", 1, MIK, 100, "+0:00"),
  row("r4", 2, "stage", 2, ADA, 80, "+0:14"),
  row("g1", 2, "gc", 1, ADA, 0, "+0:00"),
  row("g2", 2, "gc", 2, MIK, 0, "+0:09"),
  row("p1", 2, "points", 1, MIK, 0),
  row("m1", 2, "mountain", 1, ADA, 0),
  row("y1", 2, "young", 1, ADA, 0),
  row("t1", 2, "team", 1, MIK, 0),
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of [
  { name: "desktop", width: 1440, height: 950 },
  { name: "mobile", width: 393, height: 852 },
]) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, locale: "da-DK" });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await page.route("**/rest/v1/races**", route => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? RACE : [RACE]);
  });
  await page.route("**/rest/v1/race_results**", route => json(route, RESULTS));
  await page.route("**/rest/v1/race_stage_profiles**", route => json(route, STAGE_PROFILES));
  await page.route("**/rest/v1/race_stage_passages**", route => json(route, []));

  await stabilizePage(page);
  await login(page);
  await page.goto("/races/race-3396-1");
  await page.getByRole("heading", { name: "3396 E2E Tour" }).waitFor();

  // FinalKilometrePlayback renderer i et Card (div.rounded-cz) — scope til DEN
  // for at undgå kollision med "breakawaySurvived"-teksten som ALSO optræder
  // i Løbsreferat-panelet (samme oversættelses-streng, forskellig komponent).
  const finalKm = page.locator('div.rounded-cz:has-text("Den sidste kilometer")');

  // (b) Samlet-fanen (default) — seneste kørte etape (etape 2), uændret adfærd.
  await finalKm.waitFor();
  await page.waitForTimeout(200);
  if (vp.name === "desktop") {
    await page.screenshot({ path: resolve(OUT, "3396-final-km-samlet-desktop.png"), fullPage: false });
  }

  // (a)/(c) En TIDLIGERE etapes fane (Etape 1) — playbacken skal nu følge
  // fanen (label "Etape 1" + breakaway-beat), ikke stadig vise etape 2.
  await page.getByRole("button", { name: "Etape 1" }).click();
  await finalKm.getByText("Et udbrud på 2 ryttere holdt hjem til mål.").waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, `3396-final-km-stage1-${vp.name}.png`), fullPage: false });

  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
