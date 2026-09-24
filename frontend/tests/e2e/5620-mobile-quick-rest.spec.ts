// #5620 / #5485-kommentar 24/9 — hurtig hvile på telefonen.
//
// Spillerfund (@smukkethomsen, Discord 24/9): "der er ikke en hurtig måde at
// hvile, man skal simpelthen åbne alle ryttere og skifte deres træning [...] på
// web version kan man hænge ryttere af og vælge hvile, det ville være perfekt
// hvis man kunne det på mobil også".
//
// Guarden holder på det rettelsen LOVER:
//   1) Mobil 390: "Select riders" (i assistent-rækken, så tabellen ikke rykker
//      ned) slår markering til; et tryk på en række
//      markerer rytteren (og folder IKKE kortet ud); "Set to rest" sender ÉT
//      mængde-kald (POST /api/training/bulk, dayType "rest") for netop de
//      valgte, og tabellen viser hvile bagefter.
//   2) "Done" slår markeringen fra igen uden at gemme noget.
//   3) Desktop 1440: telefonens værktøjslinje findes ikke; desktoppens egen
//      afkrydsning er uændret.
//
// Testene sætter selv viewport, så alle tre Playwright-projekter kører de samme
// assertions.
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, RIDERS, evidenceShotPath } from "./fixtures.js";

const base = RIDERS.find((r: { id: string }) => r.id === "rider-1");
if (!base) throw new Error("fixtures.js: rider-1 mangler i RIDERS");
const FIRST = ["Mathias", "Tom", "Luca", "Rafael", "Viktor", "Antoine", "Jonas", "Emil"];
const LAST = ["Sørensen", "Van Aerde", "Colombo", "Duran", "Lindqvist", "Fabre", "Halvorsen", "Bakker"];
const SQUAD = FIRST.map((firstname, i) => ({
  ...base,
  id: `rider-5620-${i}`,
  firstname,
  lastname: LAST[i],
  team_id: TEST_TEAM.id,
  is_academy: false,
}));

function trainingMe() {
  const plans: Record<string, { focus: string; intensity: string }> = {};
  const condition: Record<string, { form: number; fatigue: number; injured_until: null; risk: number }> = {};
  for (const [i, rider] of SQUAD.entries()) {
    plans[rider.id] = { focus: "tempo", intensity: "normal" };
    // Tre trætte ryttere: dem spilleren vil hvile.
    condition[rider.id] = { form: 60, fatigue: i < 3 ? 78 : 20, injured_until: null, risk: 0 };
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
    racingToday: {},
    todayRun: null,
  };
}

async function mockTraining(page: Page) {
  const me = trainingMe();
  const bulkCalls: Array<{ riderIds: string[]; dayType: string; session: string | null }> = [];
  await page.route("**/rest/v1/riders**", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, SQUAD);
  });
  await page.route("**/api/training/me**", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, me);
  });
  await page.route("**/api/training/bulk", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    const body = JSON.parse(request.postData() || "{}");
    bulkCalls.push(body);
    for (const id of body.riderIds) me.plans[id] = { focus: "tempo", intensity: "rest" };
    return json(route, { applied: body.riderIds.length, plans: { ...me.plans } });
  });
  return bulkCalls;
}

async function openTraining(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await stabilizePage(page);
  await installNetworkMocks(page);
  const bulkCalls = await mockTraining(page);
  await login(page);
  // Copy'en er EN-first; sproget flyttes efter login (samme greb som 5485-specen).
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  await page.goto("/training");
  await page.getByTestId("training-overview").waitFor();
  return bulkCalls;
}

const roster = (page: Page) => page.getByTestId("training-mobile-roster");
const bulkBar = (page: Page) => page.getByTestId("training-mobile-bulk-bar");
const selectRiders = (page: Page) => page.getByTestId("training-mobile-select-riders");
const rowButton = (page: Page, i: number) => roster(page).locator("tbody tr td:first-child button").nth(i);

test("mobil 390 × 844: vælg tre ryttere og sæt dem til hvile med ét tryk", async ({ page }) => {
  const bulkCalls = await openTraining(page, 390, 844);
  await expect(roster(page)).toBeVisible();
  await expect(roster(page).getByTestId("training-mobile-pick-box")).toHaveCount(0);

  await selectRiders(page).click();
  await expect(roster(page).getByTestId("training-mobile-pick-box")).toHaveCount(SQUAD.length);

  for (const i of [0, 1, 2]) await rowButton(page, i).click();
  for (const i of [0, 1, 2]) await expect(rowButton(page, i)).toHaveAttribute("aria-pressed", "true");
  await expect(rowButton(page, 3)).toHaveAttribute("aria-pressed", "false");
  // Et tryk markerer; det folder ikke rytterens kort ud.
  await expect(page.getByTestId("training-mobile-rider-detail")).toHaveCount(0);
  await expect(bulkBar(page)).toContainText("3 selected");
  await page.screenshot({ path: evidenceShotPath("pr-screens/5620-quick-rest-390-selected.png") });

  await bulkBar(page).getByRole("button", { name: "Set to rest" }).click();
  await expect.poll(() => bulkCalls.length).toBe(1);
  expect(bulkCalls[0].dayType).toBe("rest");
  expect(bulkCalls[0].session).toBeNull();
  expect([...bulkCalls[0].riderIds].sort()).toEqual(["rider-5620-0", "rider-5620-1", "rider-5620-2"]);

  // Markeringen slutter, og beskeden står i linjen.
  await expect(selectRiders(page)).toBeVisible();
  await expect(roster(page).getByTestId("training-mobile-pick-box")).toHaveCount(0);
  await expect(bulkBar(page).getByRole("status")).toBeVisible();
  await page.screenshot({ path: evidenceShotPath("pr-screens/5620-quick-rest-390-done.png") });
});

test("mobil 390 × 844: Done slår markeringen fra uden at gemme", async ({ page }) => {
  const bulkCalls = await openTraining(page, 390, 844);
  await selectRiders(page).click();
  await rowButton(page, 4).click();
  await bulkBar(page).getByRole("button", { name: "Done" }).click();
  await expect(roster(page).getByTestId("training-mobile-pick-box")).toHaveCount(0);
  expect(bulkCalls).toHaveLength(0);
  // Uden markering folder et tryk kortet ud som før.
  await rowButton(page, 4).click();
  await expect(page.getByTestId("training-mobile-rider-detail")).toHaveCount(1);
});

test("desktop 1440 × 900: telefonens værktøjslinje findes ikke", async ({ page }) => {
  await openTraining(page, 1440, 900);
  await expect(page.getByTestId("training-today-table")).toBeVisible();
  await expect(bulkBar(page)).toHaveCount(0);
  await expect(selectRiders(page)).toHaveCount(0);
  await page.screenshot({ path: evidenceShotPath("pr-screens/5620-quick-rest-1440.png") });
});
