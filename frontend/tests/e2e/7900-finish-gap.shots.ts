// #7900: foer/efter-billede til PR-review (ad-hoc capture-script, ikke en del af
// CI-suiten; testMatch fanger kun *.spec.*). Samme moenster som 7701-abandon-reason.shots.ts.
//
//   node tests/e2e/7900-finish-gap.shots.ts shoot <baseURL> <outDir> <before|after>
//   node tests/e2e/7900-finish-gap.shots.ts compose <outDir>
//
// Rettelsen ligger i serverens historie, saa "before" og "after" tages mod samme
// frontend: "before" uden resultatets huller (motorens maalbillede), "after" med.
// Etapen er formet efter en rigtig etape: finalen deler feltet, og motoren melder
// intet hul for hovedfeltet ved maalet. Alle navne er fiktive.

import { chromium } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIVAL_TEAM } = await import(pathToFileURL(resolve(__dirname, "fixtures.js")).href);
const { buildRaceStory, storyInputsFromResults } = await import(pathToFileURL(resolve(__dirname, "../../../backend/lib/raceStory.js")).href);

const [mode, ...rest] = process.argv.slice(2);

const RACE = {
  id: "race-e2e-7900", name: "Tour of the Hills", race_type: "stage_race", race_class: "GiroVuelta",
  stages: 2, stages_completed: 2, edition_year: 2026, status: "completed",
  season: { id: "season-e2e", number: 1 }, pool_race: null,
};
const OTHER = { id: "team-other", name: "Valley Cycling" };
type Team = { id: string; name: string };
type Rider = { id: string; firstname: string; lastname: string; nationality_code: string; team: Team };
const mine: Team = { id: TEST_TEAM.id, name: TEST_TEAM.name };
const rival: Team = { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name };
const R = (id: string, firstname: string, lastname: string, team: Team): Rider => ({ id, firstname, lastname, nationality_code: "dk", team });
const RIDERS = [
  R("r-1", "Pablo", "Serrat", rival),
  R("r-2", "Theo", "Marchand", OTHER),
  R("r-3", "Luca", "Benedetti", rival),
  R("r-4", "Jonas", "Kildahl", mine),
  R("r-5", "Mads", "Ravn", mine),
  R("r-6", "Pieter", "Vos", OTHER),
  R("r-7", "Erik", "Lund", OTHER),
  R("r-8", "Oskar", "Holm", rival),
];
const GAPS = ["+0:00", "+0:00", "+0:14", "+0:16", "+0:16", "+0:16", "+0:16", "+2:24"];
const row = (id: string, stage: number, type: string, rank: number, r: Rider, finish_time: string) => ({
  id, stage_number: stage, result_type: type, rank, rider_id: r.id, rider_name: `${r.firstname} ${r.lastname}`,
  team_id: r.team.id, team_name: r.team.name, finish_time, points_earned: 0, prize_money: 0,
  in_breakaway: false, breakaway_caught: false, rider: r,
});
const RESULTS = [
  ...RIDERS.map((r, i) => row(`s1-${i}`, 1, "stage", i + 1, r, GAPS[0])),
  ...RIDERS.map((r, i) => row(`s2-${i}`, 2, "stage", i + 1, r, GAPS[i])),
  ...RIDERS.map((r, i) => row(`g2-${i}`, 2, "gc", i + 1, r, GAPS[i])),
];
const PROFILES = [
  { stage_number: 1, profile_type: "hilly", finale_type: "reduced_sprint" },
  { stage_number: 2, profile_type: "hilly", finale_type: "reduced_sprint" },
];
const ev = (km: number, type: string, params: Record<string, unknown> = {}) => ({ km, type, params });
const EVENTS = [
  ev(0, "stage_start", { exact_km: 0, exact_time: 0, distance_km: 100, field_count: 8, profile_type: "hilly" }),
  ev(60, "gap_update", { group_id: "gruppetto-1", gap_seconds: 30, exact_km: 60, exact_time: 5230 }),
  ev(95, "finale_attack", { group_id: "finale-winner-0", source_group_id: "peloton-0", rider_ids: ["r-1", "r-2"], exact_km: 100, exact_time: 8200 }),
  ev(95, "finale_attack", { group_id: "finale-tier-1", source_group_id: "peloton-0", rider_ids: ["r-3"], exact_km: 100, exact_time: 8214 }),
  ev(100, "gap_update", { group_id: "finale-tier-1", gap_seconds: 13.6, exact_km: 100, exact_time: 8213.6 }),
  ev(100, "finish", { win_type: "small_group", exact_km: 100, exact_time: 8200, top: [{ rider_id: "r-1", rank: 1, gap: 0 }, { rider_id: "r-2", rank: 2, gap: 0 }] }),
];
const stageRows = RESULTS.filter((r) => r.stage_number === 2 && r.result_type === "stage");
const storyFor = (label: string) => buildRaceStory({
  events: EVENTS, timelineVersion: 2,
  ...storyInputsFromResults(label === "before" ? stageRows.map(({ finish_time: _gap, ...r }) => r) : stageRows, 2),
});

const json = (route: Route, body: unknown) => route.fulfill({
  status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body),
});

async function stabilizeEnglish(page: Page) {
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

async function shoot(base: string, out: string, label: string) {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: base, viewport: { width: 390, height: 900 }, deviceScaleFactor: 1, locale: "en-GB" });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log(`[7900] pageerror: ${err.message}`));
  await installNetworkMocks(page);
  await stabilizeEnglish(page);
  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? RACE : [RACE]);
  });
  await page.route("**/rest/v1/race_results**", (route) => {
    const url = new URL(route.request().url());
    const m = url.search.match(/stage_number=eq\.([^&]+)/);
    const t = url.search.match(/result_type=eq\.([^&]+)/);
    let rows = RESULTS;
    if (m) rows = rows.filter((r) => String(r.stage_number) === decodeURIComponent(m[1]));
    if (t) rows = rows.filter((r) => r.result_type === decodeURIComponent(t[1]));
    return json(route, rows);
  });
  await page.route("**/rest/v1/race_incidents**", (route) => json(route, []));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, PROFILES));
  await page.route("**/rest/v1/race_stage_passages**", (route) => json(route, []));
  await page.route("**/rest/v1/race_stage_moments**", (route) => json(route, []));
  await page.route("**/api/races/*/timeline**", (route) => json(route, { timeline_version: 2, created_at: "2026-11-05T12:00:00.000Z", events: EVENTS, story: storyFor(label) }));

  await page.goto("/login");
  await page.getByPlaceholder("you@email.com").fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: /^Log in$/ }).click();
  await page.waitForURL(/\/dashboard$/);

  await page.goto(`/races/${RACE.id}?stage=2`);
  const section = page.locator('[data-race-section="race_story"]').first();
  await section.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  await section.screenshot({ path: resolve(out, `${label}-story.png`) });
  console.log(`[7900] ${label}: ${(await section.innerText()).replace(/\s+/g, " ").slice(0, 900)}`);
  await context.close();
  await browser.close();
}

async function compose(out: string) {
  const b64 = (name: string) => readFileSync(resolve(out, name)).toString("base64");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 880, height: 800 }, deviceScaleFactor: 1 });
  const sheet = await ctx.newPage();
  const cols = [
    ["before", "#ff8a80", "BEFORE: the bunch stands level with the winners. Result list: +0:16."],
    ["after", "#e8c04a", "AFTER: the film shows the result list's gap at the line."],
  ];
  await sheet.setContent(`<!doctype html><html><body style="margin:0;background:#111;font-family:system-ui,sans-serif;color:#fff">
<div style="display:flex;gap:24px;padding:24px;align-items:flex-start">
  ${cols.map(([k, color, label]) => `
  <div style="width:400px">
    <div style="font-size:20px;font-weight:700;padding:0 0 12px;color:${color};min-height:56px">${label}</div>
    <img src="data:image/png;base64,${b64(`${k}-story.png`)}" style="width:390px;border:3px solid ${color}">
  </div>`).join("")}
</div></body></html>`);
  await sheet.screenshot({ path: resolve(out, "before-after-7900.png"), fullPage: true });
  await browser.close();
  console.log("OK", resolve(out, "before-after-7900.png"));
}

if (mode === "shoot") await shoot(rest[0], resolve(rest[1]), rest[2]);
else if (mode === "compose") await compose(resolve(rest[0]));
else {
  console.error("brug: shoot <baseURL> <outDir> <before|after> | compose <outDir>");
  process.exit(1);
}
