// #6523 — Today-fanen: saet dagen for flere ryttere paa een gang, bag flaget
// training_bulk_day (serveren leverer `bulkDay` som en bar boolean).
//
// Guarden holder paa det rettelsen LOVER:
//   1) Flag ON: linjen "Set today's day for ..." er ALTID synlig. Intet markeret
//      = "All N riders"; markering = "N selected". Apply bruger samme bulk-sti
//      (POST /api/training/bulk) med de rigtige ryttere.
//   2) Flag ON + Group by type: "Set for group" paa hver gruppe-overskrift.
//   3) Flag ON: Today-overskriften har en kort forklaring; kolonnen BLIVER.
//   4) Flag OFF: ingen linje, ingen gruppe-knap, ingen forklaring (gammel visning).
// Testene saetter selv viewport, saa alle tre Playwright-projekter koerer dem.
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, RIDERS, evidenceShotPath } from "./fixtures.js";

const base = RIDERS.find((r: { id: string }) => r.id === "rider-1");
if (!base) throw new Error("fixtures.js: rider-1 mangler i RIDERS");
const FIRST = ["Mathias", "Tom", "Luca", "Rafael", "Viktor", "Antoine"];
const LAST = ["Sørensen", "Van Aerde", "Colombo", "Duran", "Lindqvist", "Fabre"];
const TYPES = ["sprinter", "sprinter", "climber", "climber", "climber", "sprinter"];
const SQUAD = FIRST.map((firstname, i) => ({
  ...base,
  id: `rider-6523-${i}`,
  firstname,
  lastname: LAST[i],
  primary_type: TYPES[i],
  team_id: TEST_TEAM.id,
  is_academy: false,
}));

function trainingMe(bulkDay: boolean) {
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
    bulkDay,
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

type BulkBody = { riderIds: string[]; dayType: string; session: string | null };

async function openTraining(page: Page, { bulkDay, width = 1440, height = 900 }: { bulkDay: boolean; width?: number; height?: number }) {
  const bulkPosts: BulkBody[] = [];
  const me = trainingMe(bulkDay);
  await page.setViewportSize({ width, height });
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/rest/v1/riders**", (route: Route) => (preflight(route) ? undefined : json(route, SQUAD)));
  await page.route("**/rest/v1/training_day_runs**", (route: Route) => (preflight(route) ? undefined : json(route, [])));
  await page.route("**/api/training/me**", (route: Route) => (preflight(route) ? undefined : json(route, me)));
  await page.route("**/api/training/programs/forecast**", (route: Route) =>
    preflight(route) ? undefined : json(route, { available: false }));
  await page.route("**/api/training/programs", (route: Route) =>
    preflight(route) ? undefined : json(route, { enabled: false, cellsEnabled: false, seeds: {}, catalog: [], assigned: {} }));
  await page.route("**/api/training/bulk", (route: Route) => {
    if (preflight(route)) return;
    const body = route.request().postDataJSON() as BulkBody;
    bulkPosts.push(body);
    const plans = { ...me.plans } as Record<string, unknown>;
    for (const id of body.riderIds) plans[id] = { focus: body.session ?? "rest", intensity: "easy" };
    return json(route, { applied: body.riderIds.length, plans, slots: me.slots, skipped: {} });
  });
  await login(page);
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  await page.goto("/training");
  await page.getByTestId("training-overview").waitFor();
  return bulkPosts;
}

const todayRows = (page: Page) => page.getByTestId("training-today-row");

test("flag ON: linjen er altid synlig, 'All N riders' som standard, og Apply rammer alle", async ({ page }) => {
  const posts = await openTraining(page, { bulkDay: true });
  await expect(todayRows(page)).toHaveCount(SQUAD.length);
  const bar = page.getByTestId("training-bulk-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("Set today's day for");
  await expect(page.getByTestId("training-bulk-scope")).toHaveText(`All ${SQUAD.length} riders`);
  await page.screenshot({ path: evidenceShotPath("pr-screens/6523/after-1440-on.png") });

  // Uden et valg: en venlig besked, intet POST.
  await page.getByTestId("training-bulk-apply").click();
  await expect(bar.getByRole("status")).toContainText("Pick a focus");
  expect(posts).toHaveLength(0);

  await bar.getByRole("combobox").selectOption("rest");
  await page.getByTestId("training-bulk-apply").click();
  await expect(bar.getByRole("status")).toContainText(String(SQUAD.length));
  expect(posts).toHaveLength(1);
  expect(posts[0].dayType).toBe("rest");
  expect([...posts[0].riderIds].sort()).toEqual(SQUAD.map((r) => r.id).sort());
});

test("flag ON: markering skifter scope til 'N selected' og Apply rammer kun dem", async ({ page }) => {
  const posts = await openTraining(page, { bulkDay: true });
  const bar = page.getByTestId("training-bulk-bar");
  await todayRows(page).nth(0).getByRole("checkbox").check();
  await todayRows(page).nth(2).getByRole("checkbox").check();
  await expect(page.getByTestId("training-bulk-scope")).toHaveText("2 selected");
  await expect(bar.getByRole("button", { name: "Clear" })).toBeVisible();

  await bar.getByRole("combobox").selectOption("rest");
  await page.getByTestId("training-bulk-apply").click();
  await expect.poll(() => posts.length).toBe(1);
  expect([...posts[0].riderIds].sort()).toEqual([SQUAD[0].id, SQUAD[2].id].sort());
});

test("flag ON: Group by type giver 'Set for group', og Today-overskriften har en forklaring", async ({ page }) => {
  const posts = await openTraining(page, { bulkDay: true });
  const head = page.getByTestId("training-race-day-head").first();
  await expect(head).toBeVisible();
  await expect(head).toHaveText("Today");
  await expect(head).toHaveAttribute("title", /race days/);

  await page.getByLabel("Group by type").check();
  const buttons = page.getByTestId("training-set-for-group");
  await expect(buttons).toHaveCount(2);

  await page.getByTestId("training-bulk-bar").getByRole("combobox").selectOption("rest");
  await buttons.first().click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].dayType).toBe("rest");
  // Gruppen er en af de to typer, aldrig hele truppen.
  expect(posts[0].riderIds.length).toBe(3);
  await page.screenshot({ path: evidenceShotPath("pr-screens/6523/after-1440-group.png") });
});

test("flag OFF: den gamle visning, ingen linje, ingen gruppe-knap, ingen forklaring", async ({ page }) => {
  await openTraining(page, { bulkDay: false });
  await expect(todayRows(page)).toHaveCount(SQUAD.length);
  await page.screenshot({ path: evidenceShotPath("pr-screens/6523/before-1440-off.png") });
  await expect(page.getByTestId("training-bulk-bar")).toHaveCount(0);
  await expect(page.getByTestId("training-race-day-head")).toHaveCount(0);
  await page.getByLabel("Group by type").check();
  await expect(page.getByTestId("training-set-for-group")).toHaveCount(0);
  // Today-kolonnen findes stadig.
  await expect(page.getByRole("columnheader", { name: "Today", exact: true })).toBeVisible();
  // Uden flag staar den gamle markerings-linje: intet markeret = ingen vaelger.
  await expect(page.getByRole("combobox", { name: "Set day" })).toHaveCount(0);
  await todayRows(page).nth(0).getByRole("checkbox").check();
  await expect(page.getByRole("combobox", { name: "Set day" })).toBeVisible();
});

test("mobil 390 med flag ON: telefonen er uroert (linjen er kun paa desktop-fanen)", async ({ page }) => {
  await openTraining(page, { bulkDay: true, width: 390, height: 844 });
  await expect(page.getByTestId("training-bulk-bar")).toHaveCount(0);
  await expect(page.getByTestId("training-set-for-group")).toHaveCount(0);
  await page.screenshot({ path: evidenceShotPath("pr-screens/6523/after-390-on.png") });
});
