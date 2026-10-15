// #6570 spor 2 · skærmbilleder af løbshistorien mod en RIGTIG prod-etape.
//
//   node pr-screens/6570-story/render.mjs <datadir>
//
// <datadir> indeholder prod-events.json (etapens race_stage_timelines.events,
// hentet read-only) og prod-results.json (etapens resultat: [rank, rider_id,
// fornavn, efternavn, nation, hold-alias, hul]). Data committes IKKE; holdene er
// aliaser, og "dit hold" er e2e-fixturens hold. Historien bygges af kontraktens
// egen buildRaceStory, præcis som serveren gør det for ?story=1.
//
// Starter vite (dev) på en fast port, tager billederne og stopper vite igen.
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const frontend = resolve(root, "frontend");
const dataDir = process.argv[2];
if (!dataDir) throw new Error("brug: node pr-screens/6570-story/render.mjs <datadir>");
const PORT = 5197;
const BASE = `http://127.0.0.1:${PORT}`;

const { chromium } = await import(pathToFileURL(resolve(frontend, "node_modules/@playwright/test/index.mjs")).href);
const { installNetworkMocks, stabilizePage, login, json, TEST_TEAM } = await import(pathToFileURL(resolve(frontend, "tests/e2e/fixtures.js")).href);
const { buildRaceStory } = await import(pathToFileURL(resolve(root, "backend/lib/raceStory.js")).href);

const RACE_ID = "d49d48cf-637b-439c-b0ab-d496f0205e98";
const STAGE = 3;
const events = JSON.parse(readFileSync(resolve(dataDir, "prod-events.json"), "utf8"));
const raw = JSON.parse(readFileSync(resolve(dataDir, "prod-results.json"), "utf8"));
const MY_ALIAS = 12;
const teamId = (alias) => (alias === MY_ALIAS ? TEST_TEAM.id : `team-${alias}`);
const results = raw.map(([rank, id, fn, ln, nat, alias, gap]) => ({
  id: `res-${id}`, race_id: RACE_ID, stage_number: STAGE, result_type: "stage", rank,
  rider_id: id, rider_name: `${fn} ${ln}`, team_id: teamId(alias), team_name: alias === MY_ALIAS ? TEST_TEAM.name : `Team ${alias}`,
  finish_time: gap, points_earned: 0, prize_money: 0,
  rider: { id, firstname: fn, lastname: ln, nationality_code: nat.toLowerCase(), team: { id: teamId(alias), name: alias === MY_ALIAS ? TEST_TEAM.name : `Team ${alias}` } },
}));
const story = buildRaceStory({
  events, timelineVersion: 2,
  results: results.map((r) => ({ rider_id: r.rider_id, rank: r.rank })),
  startlist: results.map((r) => r.rider_id),
});
const mine = results.filter((r) => r.team_id === TEST_TEAM.id).map((r) => ({ rider_id: r.rider_id, name: r.rider_name, race_role: "helper", stage_fit: null }));

const RACE = {
  id: RACE_ID, name: "Tour des Rives et Cols Vaudois", race_type: "stage_race", race_class: "Class1",
  stages: 4, stages_completed: 3, status: "scheduled", edition_year: 2026, season: { id: "season-6570", number: 5 }, pool_race: null,
};
const PROFILE3 = {
  race_id: RACE_ID, stage_number: 3, profile_type: "mountain", finale_type: "breakaway", distance_km: 160, elevation_gain_m: 2916,
  climbs: [
    { name: "Col de Portet", category: "3", crest_km: 62, length_km: 4.3, avg_gradient: 5.3, summit_finish: false },
    { name: "Côte de Aubisque", category: "2", crest_km: 84, length_km: 7.7, avg_gradient: 6.5, summit_finish: false },
    { name: "Côte de la Colombière", category: "2", crest_km: 106, length_km: 7.9, avg_gradient: 6.1, summit_finish: false },
    { name: "Col de Granier", category: "1", crest_km: 148, length_km: 9.7, avg_gradient: 8.3, summit_finish: false },
  ],
  sprints: [{ km: 86, kind: "intermediate", name: "Intermediate Sprint" }, { km: 160, kind: "finish", name: "Finish" }],
  sectors: [], demand_vector: { punch: 0.04, tempo: 0.12, tactics: 0.02, climbing: 0.5, recovery: 0.06, endurance: 0.14, randomness: 0.1, positioning: 0.02 },
  elevation_profile: null,
};
const PROFILES = [1, 2, 4].map((n) => ({ race_id: RACE_ID, stage_number: n, profile_type: "hilly", finale_type: null, distance_km: 150, elevation_gain_m: 1500, climbs: [], sprints: [], sectors: [] })).concat([PROFILE3]);

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(BASE); if (r.ok) return; } catch { /* starter endnu */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("vite startede ikke");
}

const vite = spawn(process.execPath, [resolve(frontend, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  cwd: frontend,
  env: {
    ...process.env,
    VITE_E2E: "1",
    VITE_API_URL: BASE,
    VITE_SUPABASE_URL: "https://cycling-zone-e2e.supabase.co",
    VITE_SUPABASE_ANON_KEY: "e2e-anon-key",
    VITE_PUBLIC_APP_URL: BASE,
  },
  stdio: "ignore",
});

const OUT = here;
mkdirSync(OUT, { recursive: true });
try {
  await waitForServer();
  const browser = await chromium.launch();
  for (const vp of [{ name: "desktop-1440", width: 1440, height: 1000 }, { name: "mobile-390", width: 390, height: 844 }]) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({ baseURL: BASE, viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, colorScheme: theme });
      const page = await context.newPage();
      if (process.env.SHOTS_DEBUG) {
        page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 400)); });
        page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 400)));
        page.on("response", (r) => { if (r.status() >= 400 || /timeline|stage_profiles|stage-roles/.test(r.url())) console.log("http", r.status(), r.url().slice(0, 200)); });
      }
      await installNetworkMocks(page);
      await page.route("**/rest/v1/races**", (route) => {
        const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
        return json(route, wantsObject ? RACE : [RACE]);
      });
      await page.route("**/rest/v1/race_results**", (route) => {
        const url = new URL(route.request().url());
        const m = url.search.match(/stage_number=eq\.([^&]+)/);
        return json(route, m && Number(decodeURIComponent(m[1])) !== STAGE ? [] : results);
      });
      await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, PROFILES));
      await page.route("**/rest/v1/race_stage_schedule**", (route) => json(route, []));
      await page.route("**/rest/v1/race_stage_passages**", (route) => json(route, []));
      await page.route("**/api/races/stage-page-v2**", (route) => json(route, { enabled: true }));
      await page.route("**/api/races/*/stage-roles**", (route) => json(route, { riders: mine, overrides: [] }));
      await page.route("**/api/races/*/timeline**", (route) => json(route, { timeline_version: 2, stage_number: STAGE, events, story }));

      await stabilizePage(page);
      await login(page);
      await page.evaluate((t) => { localStorage.setItem("cz_lang", "en"); localStorage.setItem("cz-theme", t); }, theme);
      await page.addInitScript((t) => { localStorage.setItem("cz_lang", "en"); localStorage.setItem("cz-theme", t); }, theme);
      await page.goto(`/races/${RACE_ID}?stage=${STAGE}`);
      const card = page.locator('[aria-label="How stage 3 was raced"]').first();
      try {
        await card.waitFor({ timeout: 30000 });
      } catch (err) {
        if (process.env.SHOTS_DEBUG) {
          await page.screenshot({ path: resolve(process.env.SHOTS_DEBUG, "debug.png"), fullPage: true });
          console.log((await page.innerText("body")).slice(0, 3000));
        }
        throw err;
      }
      await page.waitForTimeout(600);
      for (const [view, label] of [["stage", "Whole stage"], ["route", "The route"], ["final", "Final 5 km"]]) {
        await card.getByRole("button", { name: label, exact: true }).click();
        await page.waitForTimeout(500);
        await card.screenshot({ path: resolve(OUT, `${vp.name}-${theme}-${view}.png`) });
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(`${vp.name} ${theme}: horisontal overflow ${overflow}px`);
      await context.close();
    }
  }
  await browser.close();
} finally {
  vite.kill();
}
console.log(`Billeder -> ${OUT}`);
