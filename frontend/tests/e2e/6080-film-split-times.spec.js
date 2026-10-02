import { test, expect } from "./e2e-base.js";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { installNetworkMocks, login, stabilizePage, json, raceResultsRoute, TEST_TEAM, evidenceShotPath } from "./fixtures.js";
import { SPLIT_TIMELINE, SPLIT_RIDERS, OWN_TEAM_ID } from "./6080-split-stage.fixture.js";

// #6080: mellemtider + "hvor tabte dine ryttere tid" i løbsfilmen og på etape-
// fanen. Fixturen er en ægte v4-etape (anonymiseret), så gabene her er de
// samme som etaperesultatets egne tider (fx feltet +1:35 i mål).

const RACE = {
  id: "race-6080",
  name: "Split E2E Tour",
  race_type: "stage_race",
  race_class: "TourFrance",
  stages: 1,
  stages_completed: 1,
  edition_year: 2026,
  status: "completed",
  season: { id: "season-6080", number: 1 },
  pool_race: null,
};

const teamOf = (r) => (r.teamId === OWN_TEAM_ID ? { id: TEST_TEAM.id, name: "Hold A" } : { id: "team-b", name: "Hold B" });

const RESULTS = SPLIT_RIDERS.map((r) => {
  const team = teamOf(r);
  const rider = { id: r.id, firstname: r.firstname, lastname: r.lastname, nationality_code: r.nationality_code, team };
  return {
    id: `res-${r.id}`, stage_number: 1, result_type: "stage", rank: r.rank,
    rider_id: r.id, rider_name: `${r.firstname} ${r.lastname}`, team_id: team.id, team_name: team.name,
    finish_time: r.finishTime, points_earned: 0, prize_money: 0, rider, in_breakaway: false, breakaway_caught: false,
  };
}).sort((a, b) => a.rank - b.rank);

async function mockRace(page, { timeline = SPLIT_TIMELINE, overrides = [], teamOrders = [] } = {}) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? RACE : [RACE]);
  });
  await page.route("**/rest/v1/race_results**", raceResultsRoute(RESULTS));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, []));
  await page.route("**/rest/v1/race_stage_passages**", (route) => json(route, []));
  await page.route("**/api/races/*/timeline**", (route) => json(route, timeline));
  await page.route("**/api/races/*/stage-roles**", (route) => json(route, {
    enabled: true, intention_enabled: true, valid_efforts: ["grupetto", "save", "normal", "protect", "all_out"],
    stages_completed: 1, stage_count: 1, riders: [], overrides,
  }));
  await page.route("**/api/races/*/team-orders**", (route) => json(route, {
    stages: [], stage_count: 1, stages_completed: 1, race_completed: true, riders: [], default_order: null, orders: teamOrders,
  }));
  await login(page);
}

test("stage tab shows split times at each climb and where own riders lost time", async ({ page }) => {
  // v4-etape: holdets ordre (team-orders) vinder over en stage-roles-override.
  await mockRace(page, {
    overrides: [{ stage_number: 1, rider_id: "r141", race_role: "helper", effort: "normal" }],
    teamOrders: [{ stage_number: 1, riders: [{ rider_id: "r141", effort: "save" }] }],
  });
  await page.goto("/races/race-6080?stage=1");

  const section = page.getByTestId("stage-split-times");
  await expect(section).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mellemtider" })).toBeVisible();

  // Mål-stigningen: feltet +1:35 og Johan Aas alene +2:32, præcis som resultatlisten.
  await expect(section.getByText("Mont Portet (kat. 2)", { exact: false })).toBeVisible();
  await expect(section.getByText("+1:35").first()).toBeVisible();
  await expect(section.getByText("+2:32").first()).toBeVisible();

  // Holdets egne ryttere: hvor og hvorfor, kun ud fra motorens data.
  await expect(section.getByText(/mistede kontakten til feltet på Mont Saint-Roch\./)).toBeVisible();
  await expect(section.getByText("Johan Aas mistede kontakten til feltet på Mont Portet.")).toBeVisible();
  await expect(section.getByText("Tempoet på stigningen var for højt for ham. Din ordre: Kør roligt.")).toBeVisible();
});

test("race film shows split times only up to the scrubber", async ({ page }) => {
  await mockRace(page);
  await page.goto("/races/race-6080?stage=1");
  await page.getByRole("button", { name: "Se løbsfilmen" }).click();
  const dialog = page.getByRole("dialog");
  const scrubber = dialog.getByRole("slider", { name: "Scrub gennem etapen" });
  const splits = dialog.getByTestId("stage-split-times");

  await scrubber.fill("80");
  await expect(splits.getByText("Mont Saint-Roch (kat. 3)", { exact: false })).toBeVisible();
  await expect(splits.getByText("Col de la Colombière", { exact: false })).toHaveCount(0);

  await scrubber.fill("165");
  await expect(splits.getByText("Mont Portet (kat. 2)", { exact: false })).toBeVisible();
  await expect(splits.getByText("Johan Aas mistede kontakten til feltet på Mont Portet.")).toBeVisible();
});

test("older timeline without group gaps shows no split times", async ({ page }) => {
  const v3 = {
    ...SPLIT_TIMELINE,
    timeline_version: 1,
    events: SPLIT_TIMELINE.events.map((e) => (e.type === "gap_update" ? { ...e, params: { gap_seconds: e.params.gap_seconds } } : e)),
  };
  await mockRace(page, { timeline: v3 });
  await page.goto("/races/race-6080?stage=1");
  await expect(page.getByText("Etapens historie")).toBeVisible();
  await expect(page.getByTestId("stage-split-times")).toHaveCount(0);
});

// Før/efter-billedet til PR'en (ejer-krav). Kører kun med SHOTS_6080=1.
// "Før" = samme side med de nye sektioner fjernet (præcis main's markup).
test("before/after image", async ({ browser }, testInfo) => {
  test.skip(!process.env.SHOTS_6080 || testInfo.project.name !== "desktop-chromium", "kun ved billedgenerering");
  // Mellemtrin i test-results; det samlede billede via evidenceShotPath (#3554,
  // CZ_WRITE_COMMITTED_SHOTS=1 skriver til pr-screens/6080/).
  const shot = (n) => testInfo.outputPath(`${n}.png`);
  const finalPath = evidenceShotPath("pr-screens/6080/before-after.png");
  mkdirSync(dirname(finalPath), { recursive: true });

  const shoot = async (width, name) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await mockRace(p);
    await p.goto("/races/race-6080?stage=1");
    const section = p.getByTestId("stage-split-times");
    await expect(section).toBeVisible();

    // Bundnavigationen paa mobil er fixed og ville ligge hen over elementet.
    await p.addStyleTag({ content: "nav.fixed, .fixed.bottom-0 { display: none !important; }" });
    const column = await section.evaluateHandle((el) => el.parentElement);
    await column.screenshot({ path: shot(`${name}-after`) });
    await section.evaluate((el) => el.remove());
    await column.screenshot({ path: shot(`${name}-before`) });
    // Filmen (efter): scrub til mål.
    await p.getByRole("button", { name: "Se løbsfilmen" }).click();
    const dialog = p.getByRole("dialog");
    await dialog.getByRole("slider", { name: "Scrub gennem etapen" }).fill("165");
    await expect(dialog.getByTestId("stage-split-times")).toBeVisible();
    await dialog.getByTestId("stage-split-times").screenshot({ path: shot(`${name}-film`) });
    await ctx.close();
  };
  await shoot(1440, "desktop");
  await shoot(390, "mobile");

  const img = (n) => `data:image/png;base64,${readFileSync(shot(n)).toString("base64")}`;
  const p = await browser.newPage({ viewport: { width: 2000, height: 1000 } });
  await p.setContent(`<!doctype html><html><body style="margin:0;padding:24px;background:#f4f2ee;font:14px system-ui;color:#1c1b19">
    <h1 style="font-size:20px;margin:0 0 4px">#6080 Mellemtider og tidstab (ægte v4-etape, kuperet 165 km, anonymiseret)</h1>
    <p style="margin:0 0 16px;color:#5b5852">Etape-fanens højre kolonne og løbsfilmen. Holdet (Hold A) har 7 ryttere. Gabene stemmer med etaperesultatet (feltet +1:35, Johan Aas +2:32).</p>
    <div style="display:flex;gap:24px;align-items:flex-start">
      <figure style="margin:0"><figcaption><b>1440 FØR</b> (main)</figcaption><img src="${img("desktop-before")}" style="width:420px;border:1px solid #ccc"></figure>
      <figure style="margin:0"><figcaption><b>1440 EFTER</b> <span style="color:#a33">1</span> Mellemtider pr. stigning/mellemsprint <span style="color:#a33">2</span> Hvor dine ryttere tabte tid + grund</figcaption><img src="${img("desktop-after")}" style="width:420px;border:2px solid #a33"></figure>
      <figure style="margin:0"><figcaption><b>Løbsfilm EFTER</b> (scrubbet til mål)</figcaption><img src="${img("desktop-film")}" style="width:560px;border:2px solid #a33"></figure>
      <figure style="margin:0"><figcaption><b>390 FØR</b></figcaption><img src="${img("mobile-before")}" style="width:240px;border:1px solid #ccc"></figure>
      <figure style="margin:0"><figcaption><b>390 EFTER</b></figcaption><img src="${img("mobile-after")}" style="width:240px;border:2px solid #a33"></figure>
    </div></body></html>`);
  await p.waitForTimeout(200);
  await p.screenshot({ path: finalPath, fullPage: true });
  await p.close();
});
