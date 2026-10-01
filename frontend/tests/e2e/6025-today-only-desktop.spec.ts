// #6025 / #5630 — Today handler kun om i dag (ejer-valg A 1/10).
//
// Guarden holder paa det rettelsen LOVER, bag beta (training_program_cells):
//   1) Desktop 1440: Today-tabellen har ingen saesonkolonne, og traethed viser
//      "nu / i aften" fra SAMME prognose som telefonens raekke (#6021) og
//      Program -> Plan (#5933): tallet og baandet kommer fra serveren.
//   2) Fanen Development har et trup-overblik "This season" oeverst med samme
//      tal og samme kvittering som foer.
//   3) Telefonens gamle D-047-gren (uden mobil-tabellen) har ingen
//      "This season"-kolonne laengere.
//   4) Uden beta er Today og Development praecis som foer.
//
// Testene saetter selv viewport, saa alle tre Playwright-projekter koerer de
// samme assertions. Foer/efter-billederne til PR'en tages i 1440 og 390.
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, RIDERS, evidenceShotPath } from "./fixtures.js";

const base = RIDERS.find((r: { id: string }) => r.id === "rider-1");
if (!base) throw new Error("fixtures.js: rider-1 mangler i RIDERS");
const FIRST = ["Mathias", "Tom", "Luca", "Rafael", "Viktor", "Antoine"];
const LAST = ["Sørensen", "Van Aerde", "Colombo", "Duran", "Lindqvist", "Fabre"];
const SQUAD = FIRST.map((firstname, i) => ({
  ...base,
  id: `rider-6025-${i}`,
  firstname,
  lastname: LAST[i],
  team_id: TEST_TEAM.id,
  is_academy: false,
}));
const BANDS = ["ok", "warn", "risk", "ok", "warn", "ok"] as const;

function trainingMe(mobileTable: boolean) {
  const plans: Record<string, { focus: string; intensity: string }> = {};
  const condition: Record<string, { form: number; fatigue: number; injured_until: null; risk: number }> = {};
  for (const [i, rider] of SQUAD.entries()) {
    plans[rider.id] = { focus: "tempo", intensity: "normal" };
    condition[rider.id] = { form: 60, fatigue: 20 + i * 10, injured_until: null, risk: 0 };
  }
  return {
    enabled: true,
    betaTester: true,
    mobileTable,
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

const RUNS = [
  {
    tick_date: "2026-05-04", executed_by: "manager", bonus_applied: true,
    report: { riders: SQUAD.slice(0, 3).map((r, i) => ({
      rider_id: r.id, name: `${r.firstname} ${r.lastname}`, focus: "tempo", intensity: "normal",
      gains: i === 0 ? { tempo: 3, endurance: 1 } : { tempo: 2 }, fatigue_delta: 3,
    })) },
  },
];

function preflight(route: Route) {
  const request = route.request();
  if (request.method() === "OPTIONS") {
    route.fulfill({ status: 204, headers: corsHeaders(request) });
    return true;
  }
  return false;
}

async function mockTraining(page: Page, { beta, mobileTable }: { beta: boolean; mobileTable: boolean }) {
  const me = trainingMe(mobileTable);
  await page.route("**/rest/v1/riders**", (route: Route) => (preflight(route) ? undefined : json(route, SQUAD)));
  await page.route("**/rest/v1/training_day_runs**", (route: Route) => (preflight(route) ? undefined : json(route, RUNS)));
  await page.route("**/api/training/me**", (route: Route) => (preflight(route) ? undefined : json(route, me)));
  await page.route("**/api/training/programs/forecast**", (route: Route) => {
    if (preflight(route)) return;
    if (!beta) return json(route, { available: false });
    const riders: Record<string, { fatigue: number; band: string; raceSlots: number[] }> = {};
    for (const [i, rider] of SQUAD.entries()) riders[rider.id] = { fatigue: 31 + i * 9.4, band: BANDS[i], raceSlots: [] };
    return json(route, { available: true, settled: false, tickDate: "2026-05-05", riders });
  });
  await page.route("**/api/training/programs", (route: Route) =>
    preflight(route) ? undefined : json(route, { enabled: false, cellsEnabled: beta, seeds: {}, catalog: [], assigned: {} }));
}

async function openTraining(page: Page, width: number, height: number, { beta = true, mobileTable = true } = {}) {
  await page.setViewportSize({ width, height });
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockTraining(page, { beta, mobileTable });
  await login(page);
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  await page.goto("/training");
  await page.getByTestId("training-overview").waitFor();
}

const todayRows = (page: Page) => page.getByTestId("training-today-row");

async function openDevelopment(page: Page) {
  await page.getByRole("tab", { name: "Development" }).click();
}

test("desktop 1440 (beta): Today uden saesonkolonne, traethed nu / i aften", async ({ page }) => {
  await openTraining(page, 1440, 900);
  const table = page.getByTestId("training-today-table");
  await expect(table).toBeVisible();
  await expect(todayRows(page)).toHaveCount(SQUAD.length);

  // (1) Saesonens point er vaek fra Today.
  await expect(table.getByRole("columnheader", { name: /Season pts/ })).toHaveCount(0);
  await expect(table.getByRole("columnheader", { name: /Fatigue now \/ tonight/ })).toBeVisible();
  // Form-kolonnen bliver.
  await expect(table.getByRole("columnheader", { name: /^Form/ })).toBeVisible();

  // Nu-tallet fra rytterens tilstand, i-aften-tallet og baandet fra serveren.
  const first = todayRows(page).filter({ hasText: "Mathias" }).getByTestId("fatigue-now-tonight");
  await expect(first).toHaveAttribute("data-band", "ok");
  await expect(first).toContainText("20");
  await expect(first).toContainText("~31");
  await expect(first).toHaveAttribute("aria-label", /Fatigue now 20, tonight approx\. 31\. Fresh/);
  const risk = todayRows(page).filter({ hasText: "Luca" }).getByTestId("fatigue-now-tonight");
  await expect(risk).toHaveAttribute("data-band", "risk");
  await expect(risk).toContainText("~50");

  await page.screenshot({ path: evidenceShotPath("pr-screens/6025/after-1440-today.png") });

  // (2) Development har trup-overblikket oeverst.
  await openDevelopment(page);
  const overview = page.getByTestId("training-season-overview");
  await expect(overview).toBeVisible();
  await expect(overview.getByRole("heading", { name: "This season" })).toBeVisible();
  await expect(overview.getByTestId("training-season-overview-row")).toHaveCount(SQUAD.length);
  await page.screenshot({ path: evidenceShotPath("pr-screens/6025/after-1440-development.png") });
});

test("desktop 1440 uden beta: Today og Development er uaendrede", async ({ page }) => {
  await openTraining(page, 1440, 900, { beta: false });
  const table = page.getByTestId("training-today-table");
  await expect(table.getByRole("columnheader", { name: /Season pts/ })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: /Fatigue now \/ tonight/ })).toHaveCount(0);
  await expect(page.getByTestId("fatigue-now-tonight")).toHaveCount(0);
  await page.screenshot({ path: evidenceShotPath("pr-screens/6025/before-1440-today.png") });

  await openDevelopment(page);
  await expect(page.getByTestId("training-season-overview")).toHaveCount(0);
});

test("mobil 390 (beta): telefonens raekke uroert, overblikket i Development", async ({ page }) => {
  await openTraining(page, 390, 844);
  // #6021's raekke er uroert: ingen saesonfremgang i den.
  await expect(page.getByTestId("training-onetap-row")).toHaveCount(SQUAD.length);
  await expect(page.getByTestId("training-onetap-season")).toHaveCount(0);

  await openDevelopment(page);
  await expect(page.getByTestId("training-season-overview")).toBeVisible();
  await expect(page.getByTestId("training-season-overview-row")).toHaveCount(SQUAD.length);
  const noPageScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await expect.poll(noPageScroll).toBe(true);
  await page.screenshot({ path: evidenceShotPath("pr-screens/6025/after-390-development.png") });
});

test("mobil 390 (beta, uden mobil-tabel): D-047-grenen har ingen This season-kolonne", async ({ page }) => {
  await openTraining(page, 390, 844, { mobileTable: false });
  await expect(page.getByRole("columnheader", { name: "Status" }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "This season" })).toHaveCount(0);
});

test("mobil 390 uden beta: Development uden overblik (foer-billede)", async ({ page }) => {
  await openTraining(page, 390, 844, { beta: false });
  await openDevelopment(page);
  await expect(page.getByTestId("training-season-overview")).toHaveCount(0);
  await page.screenshot({ path: evidenceShotPath("pr-screens/6025/before-390-development.png") });
});
