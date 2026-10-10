// #6035 — Program-fanen vendt (ejer-loefte til beta 1/10): FOERST rytter eller
// gruppe, DEREFTER programmet.
//
// Guarden holder paa det rettelsen LOVER, bag training_programs (beta):
//   1) Ved indlaesning er intet valgt, og "Put on" er slaaet fra, saa hele
//      truppen aldrig faar et program ved et uheld.
//   2) Vaelges en rytter, staar programmerne der passer til hans type oeverst i
//      egen sektion, og hans nuvaerende program er markeret.
//   3) "Put on" sender SAMME kald som foer (programKey + target) og viser
//      kvitteringen.
//   4) Telefonen (390): ingen vandret side-scroll, knappen er et 44 px-maal.
//
// CZ_6035_SHOT=before tager kun foer-billederne (koeres mod main's komponent).
import type { Page, Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, RIDERS, evidenceShotPath } from "./fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const CATALOG = JSON.parse(readFileSync(join(here, "6035-program-catalog.json"), "utf8"));
const BEFORE = process.env.CZ_6035_SHOT === "before";

const base = RIDERS.find((r: { id: string }) => r.id === "rider-1");
if (!base) throw new Error("fixtures.js: rider-1 mangler i RIDERS");
const FIRST = ["Mathias", "Tom", "Luca", "Rafael", "Viktor", "Antoine"];
const LAST = ["Sørensen", "Van Aerde", "Colombo", "Duran", "Lindqvist", "Fabre"];
const TYPES = ["climber", "sprinter", "puncheur", "gc", "rouleur", "brostensrytter"];
const SQUAD = FIRST.map((firstname, i) => ({
  ...base,
  id: `rider-6035-${i}`,
  firstname,
  lastname: LAST[i],
  primary_type: TYPES[i],
  team_id: TEST_TEAM.id,
  is_academy: false,
}));
const CLIMBER = SQUAD[0];

function trainingMe() {
  const plans: Record<string, { focus: string; intensity: string }> = {};
  const condition: Record<string, { form: number; fatigue: number; injured_until: null; risk: number }> = {};
  for (const [i, rider] of SQUAD.entries()) {
    plans[rider.id] = { focus: "tempo", intensity: "normal" };
    condition[rider.id] = { form: 60, fatigue: 20 + i * 10, injured_until: null, risk: 0 };
  }
  return {
    enabled: true,
    betaTester: true,
    mobileTable: true,
    teamId: TEST_TEAM.id,
    slots: { total: null, used: SQUAD.length, remaining: null },
    focuses: ["tempo", "endurance"],
    intensities: ["easy", "normal", "hard", "rest"],
    plans,
    condition,
    progress: {},
    capped: {},
    trainability: {},
    smartDefaultFocus: {},
    weekPlan: null,
    riderWeekPlans: {},
    todayRun: null,
  };
}

function preflight(route: Route) {
  const request = route.request();
  if (request.method() === "OPTIONS") {
    route.fulfill({ status: 204, headers: corsHeaders(request) });
    return true;
  }
  return false;
}

async function openPrograms(page: Page, width: number, height: number) {
  const applied: Array<{ programKey: string; target: string }> = [];
  await page.setViewportSize({ width, height });
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/rest/v1/riders**", (route: Route) => (preflight(route) ? undefined : json(route, SQUAD)));
  await page.route("**/rest/v1/training_day_runs**", (route: Route) => (preflight(route) ? undefined : json(route, [])));
  await page.route("**/api/training/me**", (route: Route) => (preflight(route) ? undefined : json(route, trainingMe())));
  await page.route("**/api/training/programs/forecast**", (route: Route) => (preflight(route) ? undefined : json(route, { available: false })));
  await page.route("**/api/training/programs/apply", (route: Route) => {
    if (preflight(route)) return;
    applied.push(route.request().postDataJSON());
    return json(route, { ok: true });
  });
  await page.route("**/api/training/programs", (route: Route) => (preflight(route) ? undefined : json(route, {
    enabled: true, cellsEnabled: true, seeds: {}, catalog: CATALOG, assigned: { [CLIMBER.id]: "hill_climber" },
  })));
  await login(page);
  // Ét sprog-initialisator: stabilizePage laaser DA (login kraever det). Vi skifter
  // til EN i appen EFTER navigationen i stedet for et andet cz_lang-init-script,
  // hvis raekkefoelge Playwright ikke garanterer.
  await page.goto("/training?tab=weekplan&sub=programs");
  await page.getByTestId("training-programs").waitFor();
  await page.evaluate(() => (window as unknown as { __i18n: { changeLanguage: (l: string) => Promise<unknown> } }).__i18n.changeLanguage("en"));
  await expect(page.getByTestId("training-program-target").locator("option").first()).toHaveText("Pick a rider or group first");
  return applied;
}

test("desktop 1440: rytter foerst, saa programmet", async ({ page }) => {
  const applied = await openPrograms(page, 1440, 900);
  if (BEFORE) {
    await page.screenshot({ path: evidenceShotPath("pr-screens/6035/before-1440.png") });
    return;
  }
  const target = page.getByTestId("training-program-target");
  const putOn = page.getByTestId("training-program-put-on");
  // (1) Intet valgt: alle "Put on" er slaaet fra.
  await expect(target).toHaveValue("");
  await expect(putOn.first()).toBeDisabled();
  await page.screenshot({ path: evidenceShotPath("pr-screens/6035/after-1440-start.png") });

  // (2) Klatreren: hans programmer oeverst, nuvaerende markeret.
  await target.selectOption(CLIMBER.id);
  const options = page.getByTestId("training-program-option");
  await expect(options.first()).toContainText("Hill climber");
  await expect(page.getByText("Fits Climber")).toBeVisible();
  await expect(page.getByTestId("training-program-current")).toHaveCount(1);
  // Det nuvaerende program kan laegges paa igen (nulstiller rettede felter).
  await expect(options.first().getByTestId("training-program-put-on")).toBeEnabled();

  // (3) Samme kald som foer.
  // Foerste program under "Other programs" (raekke 2; klatreren har eet passende).
  await options.nth(1).getByTestId("training-program-put-on").click();
  await expect.poll(() => applied.length).toBe(1);
  expect(applied[0].target).toBe(CLIMBER.id);
  await expect(page.getByRole("status")).toContainText(`${CLIMBER.firstname} ${CLIMBER.lastname}`);
  await page.screenshot({ path: evidenceShotPath("pr-screens/6035/after-1440.png") });
});

test("mobil 390: vaelgeren foerst, ingen vandret scroll", async ({ page }) => {
  await openPrograms(page, 390, 844);
  if (BEFORE) {
    await page.screenshot({ path: evidenceShotPath("pr-screens/6035/before-390.png") });
    return;
  }
  await page.getByTestId("training-program-target").selectOption(CLIMBER.id);
  // #5825: telefonens katalog er foldet sammen til en linje; fold det ud.
  await page.getByTestId("training-program-browse").click();
  await expect(page.getByText("Fits Climber")).toBeVisible();
  const box = await page.getByTestId("training-program-put-on").first().boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  const noPageScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await expect.poll(noPageScroll).toBe(true);
  await page.screenshot({ path: evidenceShotPath("pr-screens/6035/after-390.png") });
});

// #5825 - telefonens katalog foldes sammen til EN linje med "Browse programs".
test("mobil 390: nuvaerende program som een linje, katalog foldes ud, valg og Close lukker", async ({ page }) => {
  const applied = await openPrograms(page, 390, 844);
  if (BEFORE) {
    await page.getByTestId("training-program-target").selectOption(CLIMBER.id);
    await page.screenshot({ path: evidenceShotPath("pr-screens/5825/before-390.png"), fullPage: true });
    return;
  }
  const noPageScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const browse = page.getByTestId("training-program-browse");
  const options = page.getByTestId("training-program-option");

  // Foldet: kataloget er skjult, knappen siger Browse programs.
  await expect(browse).toHaveText("Browse programs");
  await expect(browse).toHaveAttribute("aria-expanded", "false");
  await expect(options.first()).toBeHidden();

  // Valgt rytter: hans nuvaerende program staar paa linjen.
  await page.getByTestId("training-program-target").selectOption(CLIMBER.id);
  await expect(page.getByTestId("training-program-summary")).toContainText("Hill climber");
  await expect(options.first()).toBeHidden();
  await page.screenshot({ path: evidenceShotPath("pr-screens/5825/after-390-closed.png") });

  // Fold ud, ingen vandret scroll, Close catalog lukker uden aendring.
  await browse.click();
  await expect(browse).toHaveAttribute("aria-expanded", "true");
  await expect(options.first()).toBeVisible();
  await expect.poll(noPageScroll).toBe(true);
  await page.getByTestId("training-program-close").click();
  await expect(options.first()).toBeHidden();
  expect(applied).toHaveLength(0);

  // Et valg lukker kataloget og bruger samme onApply-flow.
  await browse.click();
  await options.nth(1).getByTestId("training-program-put-on").click();
  await expect.poll(() => applied.length).toBe(1);
  expect(applied[0].target).toBe(CLIMBER.id);
  await expect(options.first()).toBeHidden();
  await expect(page.getByRole("status")).toContainText(`${CLIMBER.firstname} ${CLIMBER.lastname}`);
});

test("desktop 1440: kataloget er altid fremme og uden foldeknap", async ({ page }) => {
  await openPrograms(page, 1440, 900);
  if (BEFORE) return;
  await expect(page.getByTestId("training-program-summary")).toBeHidden();
  await expect(page.getByTestId("training-program-option").first()).toBeVisible();
});
