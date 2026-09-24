// #5631: U23 team- og Junior team-siderne på niveau med My Team.
//
// Testen beviser:
//   1. Squad-fanen har My Teams kolonne-tilstande (Overblik / Evner).
//   2. Stats-fanen findes og viser truppens ryttere (My Teams TeamStatsTab).
//   3. Standings-fanen viser holdets egen ungdomsgruppe med "dig"-rækken, og
//      er en tom tilstand uden tabel før det første ungdomsløb.
//   4. Youth races viser én gruppe ad gangen; gruppe- og trupvælgeren virker.
//   5. My Teams filter er Senior / U23 / Junior med kontakten tændt, og Stats-
//      fanen deler valget.
//
// Stillingen kommer fra den delte mock (SEED_YOUTH_STANDINGS via
// mockHandlers.js). Kontakten tændes med egne routes, som youth-squad-pages.spec.ts.
import type { Page, Route } from "@playwright/test";
import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks, login, stabilizePage, json, corsHeaders, evidenceShotPath, RIDERS, TEST_TEAM,
} from "./fixtures.js";
import { wantsObject } from "../../src/preview/mockHandlers.js";
import { PREVIEW_YOUTH_RIDERS, previewYouthSquadsPayload, previewYouthRiderRows } from "../../src/preview/youthSquadsMock.ts";

const U23 = PREVIEW_YOUTH_RIDERS.filter((r) => r.squad === "u23");
const JUNIORS = PREVIEW_YOUTH_RIDERS.filter((r) => r.squad === "junior");

function preflight(route: Route): boolean {
  const request = route.request();
  if (request.method() !== "OPTIONS") return false;
  void route.fulfill({ status: 204, headers: corsHeaders(request) });
  return true;
}

async function setup(page: Page) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/display-flags", (route) => {
    if (preflight(route)) return;
    return json(route, { rider_best_role_display: false, youth_squad_pages: true });
  });
  await page.route("**/api/youth-squads", (route) => {
    if (preflight(route)) return;
    return json(route, previewYouthSquadsPayload());
  });
  await page.route("**/rest/v1/riders*", (route) => {
    if (preflight(route)) return;
    const rows = previewYouthRiderRows(route.request().url());
    return rows ? json(route, rows) : route.fallback();
  });
}

async function shots(page: Page, name: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: evidenceShotPath(`pr-screens/5631-${name}-desktop-1440.png`), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: evidenceShotPath(`pr-screens/5631-${name}-mobile-390.png`), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
}

test.describe("U23 team og Junior team på niveau med My Team (#5631)", () => {
  test("U23 team: Evner, Stats og Standings med egen gruppe", async ({ page }, testInfo) => {
    const takeShots = testInfo.project.name === "desktop-chromium";
    await setup(page);
    await login(page);
    await page.goto("/squads/u23");
    await expect(page.getByRole("heading", { name: "E2E Racing U23" })).toBeVisible();

    const tabs = page.getByRole("tablist");
    await expect(tabs.getByRole("tab")).toHaveCount(6);
    if (takeShots) await shots(page, "u23-overview");

    // 1. Kolonne-tilstanden Evner (samme Segmented som My Team).
    await page.getByRole("button", { name: /^(Abilities|Evner)$/ }).click();
    await expect(page.locator("main table").first().getByRole("columnheader").nth(3)).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Abilities|Evner)$/ })).toHaveAttribute("aria-pressed", "true");
    for (const rider of U23) {
      await expect(page.getByRole("link", { name: `${rider.firstname} ${rider.lastname}` }).first()).toBeVisible();
    }

    // 2. Stats-fanen: truppens ryttere, ingen Seniors/Academy-filter.
    await tabs.getByRole("tab", { name: /^(Stats|Statistik)$/ }).click();
    for (const rider of U23) {
      await expect(page.getByRole("link", { name: `${rider.firstname} ${rider.lastname}` }).first()).toBeVisible();
    }
    await expect(page.getByTestId("squad-group-filter")).toHaveCount(0);
    if (takeShots) await shots(page, "u23-stats");

    // 3. Standings: egen gruppe (A) med "dig"-rækken.
    await tabs.getByRole("tab", { name: /^(Standings|Stilling)$/ }).click();
    const me = page.getByTestId("youth-standings-me").first();
    await expect(me).toBeVisible();
    await expect(me).toContainText("E2E Racing U23");
    await expect(page.locator("main")).toContainText(/Group A|Gruppe A/);
    await expect(page.locator("main")).not.toContainText("Regression VC U23"); // gruppe B står på Youth races
    await expect(page.locator("main").getByRole("link", { name: /^(All groups|Alle grupper)$/ })).toHaveAttribute("href", "/youth-races?squad=u23");
    if (takeShots) await shots(page, "u23-standings");
  });

  test("Standings er en tom tilstand uden tabel før det første ungdomsløb", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Tom-tilstanden er ens på alle projekter.");
    await setup(page);
    await page.route("**/api/rankings/youth/standings*", (route) => {
      if (preflight(route)) return;
      return json(route, { data: [{ team_id: TEST_TEAM.id, team_name: TEST_TEAM.name, league_division_id: 911, pool_index: 0, rank_in_pool: 1, total_points: 0, races: 0 }] });
    });
    await login(page);
    await page.goto("/squads/junior");
    await page.getByRole("tablist").getByRole("tab", { name: /^(Standings|Stilling)$/ }).click();
    await expect(page.getByText(/See when youth races start|Se hvornår ungdomsløbene starter/)).toBeVisible();
    await expect(page.locator("main table")).toHaveCount(0);
  });

  test("Youth races: én gruppe ad gangen, gruppe- og trupvælger", async ({ page }, testInfo) => {
    const takeShots = testInfo.project.name === "desktop-chromium";
    await setup(page);
    await login(page);
    await page.goto("/youth-races?squad=u23");
    await expect(page.getByRole("heading", { name: /^(Youth races|Ungdomsløb)$/ })).toBeVisible();
    // Standard = holdets egen gruppe (A).
    await expect(page.getByTestId("youth-standings-me").first()).toContainText("E2E Racing U23");
    if (takeShots) await shots(page, "youth-races");

    // Værdien er gruppens league_division_id (SEED_YOUTH_STANDINGS: gruppe B = 902).
    await page.locator("#youth-group").selectOption("902");
    await expect(page.locator("main")).toContainText("Regression VC U23");
    await expect(page.getByTestId("youth-standings-me")).toHaveCount(0);
    await expect(page).toHaveURL(/pool=902/);

    await page.getByRole("combobox", { name: /^(Squad|Trup)$/ }).selectOption("junior");
    await expect(page).toHaveURL(/squad=junior/);
    await expect(page.getByTestId("youth-standings-me").first()).toContainText(/E2E Racing Juniors?/);
  });

  test("My Team: filteret er Senior / U23 / Junior, og Stats-fanen deler valget", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Filter-logikken er projekt-uafhængig; desktop dækker den.");
    await setup(page);
    const senior = RIDERS.find((r) => r.id === "rider-1");
    const roster = [senior, ...PREVIEW_YOUTH_RIDERS.map((r) => ({ ...r, pending_team_id: null }))];
    await page.route("**/rest/v1/riders**", (route) => {
      if (preflight(route)) return;
      const request = route.request();
      const url = request.url();
      const asSingle = (rows: unknown[]) => (wantsObject(request.headers().accept || "") ? (rows[0] || {}) : rows);
      if (url.includes("pending_team_id=eq.")) return json(route, asSingle([]));
      if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, asSingle(roster));
      return route.fallback();
    });
    await login(page);
    await page.goto("/team");

    const filter = page.getByTestId("squad-group-filter");
    await expect(filter.getByRole("button", { name: `Seniorer (1)` })).toBeVisible();
    await expect(filter.getByRole("button", { name: `U23 (${U23.length})` })).toBeVisible();
    const juniorToggle = filter.getByRole("button", { name: `Juniorer (${JUNIORS.length})` });
    await expect(juniorToggle).toHaveAttribute("aria-pressed", "true");
    await expect(filter.getByRole("button", { name: /^Akademi/ })).toHaveCount(0);

    await juniorToggle.click();
    await expect(juniorToggle).toHaveAttribute("aria-pressed", "false");
    for (const rider of JUNIORS) {
      await expect(page.getByRole("link", { name: `${rider.firstname} ${rider.lastname}`, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("link", { name: `${U23[0].firstname} ${U23[0].lastname}`, exact: true })).toBeVisible();

    // Delt state: Stats-fanen har samme fravalg.
    await page.getByRole("tab", { name: "Statistik" }).click();
    await expect(page.getByTestId("squad-group-filter").getByRole("button", { name: `Juniorer (${JUNIORS.length})` })).toHaveAttribute("aria-pressed", "false");
    for (const rider of JUNIORS) {
      await expect(page.getByRole("link", { name: `${rider.firstname} ${rider.lastname}`, exact: true })).toHaveCount(0);
    }
    await page.getByRole("tab", { name: /^Trup/ }).click();
    await shots(page, "my-team-filter");
  });
});
