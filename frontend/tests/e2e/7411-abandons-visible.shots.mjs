// #7411 — foer/efter-billede til PR-review (ad-hoc capture-script, ikke en del af
// CI-suiten; testMatch fanger kun *.spec.*). Samme moenster som
// 6970-paused-race-banner.shots.mjs.
//
//   node tests/e2e/7411-abandons-visible.shots.mjs shoot <baseURL> <outDir> <before|after>
//   node tests/e2e/7411-abandons-visible.shots.mjs compose <outDir>
//
// "before" tages mod et build af main, "after" mod et build af branchen, begge
// med SAMME mockede etape: fem udgaaede paa etape 2 (tre udkoerte hjaelpere, en
// uden for tidsgraensen, et styrt), heraf én fra dit eget hold. Alle navne er
// fiktive.

import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIVAL_TEAM } = await import(pathToFileURL(resolve(__dirname, "fixtures.js")).href);

const [mode, ...rest] = process.argv.slice(2);

const RACE = {
  id: "race-e2e-7411", name: "Tour of the Hills", race_type: "stage_race", race_class: "GiroVuelta",
  stages: 2, stages_completed: 2, edition_year: 2026, status: "completed",
  season: { id: "season-e2e", number: 1 }, pool_race: null,
};
const OTHER = { id: "team-other", name: "Valley Cycling" };
const teamOf = { mine: { id: TEST_TEAM.id, name: TEST_TEAM.name }, rival: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name }, other: OTHER };
const R = (id, firstname, lastname, team) => ({ id, firstname, lastname, nationality_code: "dk", team: teamOf[team] });
const RIDERS = [
  R("r-1", "Pablo", "Serrat", "rival"),
  R("r-2", "Jonas", "Kildahl", "mine"),
  R("r-3", "Theo", "Marchand", "other"),
  R("r-4", "Luca", "Benedetti", "rival"),
  R("r-5", "Mads", "Ravn", "mine"),
  R("r-6", "Pieter", "Vos", "other"),
  R("r-7", "Erik", "Lund", "other"),
  // udgaaede paa etape 2
  R("r-8", "Oskar", "Holm", "mine"),
  R("r-9", "Andrea", "Ricci", "rival"),
  R("r-10", "Jules", "Petit", "other"),
  R("r-11", "Bram", "de Wit", "other"),
  R("r-12", "Simon", "Berg", "rival"),
];
const gap = (i) => (i === 0 ? "+0:00" : `+${Math.floor((i * 47) / 60)}:${String((i * 47) % 60).padStart(2, "0")}`);
const row = (id, stage, type, rank, r, finish_time) => ({
  id, stage_number: stage, result_type: type, rank, rider_id: r.id, rider_name: `${r.firstname} ${r.lastname}`,
  team_id: r.team.id, team_name: r.team.name, finish_time, points_earned: 0, prize_money: 0,
  in_breakaway: false, breakaway_caught: false, rider: r,
});
const RESULTS = [
  ...RIDERS.map((r, i) => row(`s1-${i}`, 1, "stage", i + 1, r, gap(i))),
  ...RIDERS.slice(0, 7).map((r, i) => row(`s2-${i}`, 2, "stage", i + 1, r, gap(i * 3))),
  ...RIDERS.slice(0, 7).map((r, i) => row(`g2-${i}`, 2, "gc", i + 1, r, gap(i * 3))),
];
const inc = (id, r, kind) => ({ id, stage_number: 2, rider_id: r.id, kind, outcome: "abandon", time_loss_seconds: null, rider: r });
const INCIDENTS = [
  inc("i-1", RIDERS[7], "withdrawal"),
  inc("i-2", RIDERS[8], "withdrawal"),
  inc("i-3", RIDERS[9], "withdrawal"),
  inc("i-4", RIDERS[10], "time_limit"),
  inc("i-5", RIDERS[11], "crash"),
];
const PROFILES = [
  { stage_number: 1, profile_type: "hilly", finale_type: "reduced_sprint" },
  { stage_number: 2, profile_type: "mountain", finale_type: "summit_finish" },
];

const json = (route, body) => route.fulfill({
  status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body),
});

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

async function shoot(base, out, label) {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  for (const vp of [{ name: "1280", width: 1280, height: 1000 }, { name: "390", width: 390, height: 900 }]) {
    const context = await browser.newContext({ baseURL: base, viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, locale: "en-GB" });
    const page = await context.newPage();
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
    await page.route("**/rest/v1/race_incidents**", (route) => json(route, INCIDENTS));
    await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, PROFILES));
    await page.route("**/rest/v1/race_stage_passages**", (route) => json(route, []));
    await page.route("**/rest/v1/race_stage_moments**", (route) => json(route, []));

    await page.goto("/login");
    await page.getByPlaceholder("you@email.com").fill(TEST_USER.email);
    await page.getByPlaceholder("••••••••").fill("playwright-password");
    await page.getByRole("button", { name: /^Log in$/ }).click();
    await page.waitForURL(/\/dashboard$/);

    await page.goto(`/races/${RACE.id}?tab=results&stage=2`);
    await page.getByText("Stage 2 · finish order").first().waitFor({ timeout: 30000 });
    const showAll = page.getByRole("button", { name: /^Show all/ });
    if (await showAll.count()) await showAll.first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(out, `${label}-${vp.name}.png`), fullPage: true });
    await context.close();
    console.log(`[7411] ${label} ${vp.name} ok`);
  }
  await browser.close();
}

async function compose(out) {
  const b64 = (name) => readFileSync(resolve(out, name)).toString("base64");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 2640, height: 800 }, deviceScaleFactor: 1 });
  const sheet = await ctx.newPage();
  const cols = [
    ["before", "#ff8a80", "BEFORE: 5 riders are gone from the stage result. The list at the bottom says only 'Abandoned', a time cut reads 'Crash'."],
    ["after", "#e8c04a", "AFTER: they stand at the bottom as DNF with the reason. The recap gets one line + 'See the list'. Your team: who climbed off and how many are left."],
  ];
  await sheet.setContent(`<!doctype html><html><body style="margin:0;background:#111;font-family:system-ui,sans-serif;color:#fff">
<div style="display:flex;gap:24px;padding:24px;align-items:flex-start">
  ${cols.map(([k, color, label]) => `
  <div style="flex:1">
    <div style="font-size:24px;font-weight:700;padding:0 0 12px;color:${color};min-height:64px">${label}</div>
    <div style="display:flex;gap:16px;align-items:flex-start">
      <img src="data:image/png;base64,${b64(`${k}-1280.png`)}" style="width:76%;border:3px solid ${color}">
      <img src="data:image/png;base64,${b64(`${k}-390.png`)}" style="width:22%;border:3px solid ${color}">
    </div>
  </div>`).join("")}
</div></body></html>`);
  await sheet.screenshot({ path: resolve(out, "before-after-7411.png"), fullPage: true });
  await browser.close();
  console.log("OK", resolve(out, "before-after-7411.png"));
}

if (mode === "shoot") await shoot(rest[0], resolve(rest[1]), rest[2]);
else if (mode === "compose") await compose(resolve(rest[0]));
else {
  console.error("brug: shoot <baseURL> <outDir> <before|after> | compose <outDir>");
  process.exit(1);
}
