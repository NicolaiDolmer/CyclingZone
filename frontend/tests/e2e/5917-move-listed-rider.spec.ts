// #5917 (ejer 4/10): en rytter på transferlisten skal kunne flyttes mellem
// senior, U23 og junior uden at miste pladsen på listen, og U23-/juniorryttere
// skal kunne sættes til salg fra trupsiden.
//
// Testen beviser frontend-delen (backend-reglen er bevist mod en ægte Postgres i
// backend/lib/testdb/squadCapsRpc.integration.test.js):
//   1. Rytterprofilen: en listet rytter kan åbne Move squad, flytte, og
//      listingen står stadig på profilen bagefter.
//   2. My Team: samme flytning fra rækkehandlingens Flyt trup-fane; listed-
//      badgen står stadig på rækken bagefter.
//   3. U23 team: en listet rytter har listed-badgen og "Ret salg"; en ulistet
//      har "Sælg", og knappen åbner profilens salgsformular (?sell=1).
//
// Specs kører på DA-locale (stabilizePage sætter cz_lang=da). Sæson 1 = 2026.
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import {
  installNetworkMocks, login, stabilizePage, json, corsHeaders, evidenceShotPath,
  revealMobileTableColumn, MOBILE_COLUMN_ACTION, RIDERS, TEST_TEAM,
} from "./fixtures.js";
import { wantsObject } from "../../src/preview/mockHandlers.js";
import { PREVIEW_YOUTH_RIDERS, previewYouthSquadsPayload, previewYouthRiderRows } from "../../src/preview/youthSquadsMock.ts";

type RiderRow = Record<string, unknown> & { id: string; team_id?: string; firstname?: string; lastname?: string };

const OWN_RIDER: RiderRow = (() => {
  const found = RIDERS.find((r: { id: string }) => r.id === "rider-1");
  if (!found) throw new Error("fixtures.RIDERS mangler rider-1");
  return { ...found, birthdate: "2009-04-12", squad: "senior", is_academy: false };
})();
const LISTED_YOUTH = PREVIEW_YOUTH_RIDERS[0]; // youth-u23-1
const UNLISTED_YOUTH = PREVIEW_YOUTH_RIDERS[1]; // youth-u23-2
const ASKING_PRICE = 250000;

function preflight(route: Route): boolean {
  const request = route.request();
  if (request.method() !== "OPTIONS") return false;
  void route.fulfill({ status: 204, headers: corsHeaders(request) });
  return true;
}

/** Én aktiv listing pr. rytter-id, både som REST-række og som GET /api/transfers-kort. */
async function mockListings(page: Page, riderIds: string[]) {
  await page.route("**/rest/v1/transfer_listings*", (route) => {
    if (preflight(route)) return;
    return json(route, riderIds.map((id, i) => ({ id: `listing-${i}`, rider_id: id, asking_price: ASKING_PRICE, status: "open" })));
  });
  await page.route("**/api/transfers", (route) => {
    if (preflight(route)) return;
    if (route.request().method() !== "GET") return route.fallback();
    return json(route, riderIds.map((id, i) => ({ id: `listing-${i}`, rider: { id }, asking_price: ASKING_PRICE, status: "open" })));
  });
}

async function mockRiders(page: Page) {
  const youthById = new Map(PREVIEW_YOUTH_RIDERS.map((r) => [r.id, r]));
  await page.route("**/rest/v1/riders**", (route: Route) => {
    if (preflight(route)) return;
    const request = route.request();
    if (request.method() !== "GET") return json(route, {});
    const url = request.url();
    const asSingle = (rows: unknown[]) => (wantsObject(request.headers().accept || "") ? (rows[0] || {}) : rows);
    const youthRows = previewYouthRiderRows(url);
    if (youthRows) return json(route, youthRows);
    if (url.includes("pending_team_id=eq.")) return json(route, asSingle([]));
    const pool: RiderRow[] = RIDERS.map((r: RiderRow) => (r.id === OWN_RIDER.id ? OWN_RIDER : r));
    const idEq = url.match(/[?&]id=eq\.([^&]+)/);
    if (idEq) {
      const id = decodeURIComponent(idEq[1]);
      const youth = youthById.get(id);
      return json(route, asSingle(youth ? [youth] : pool.filter((r) => r.id === id)));
    }
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) {
      return json(route, asSingle(pool.filter((r) => r.team_id === TEST_TEAM.id)));
    }
    return json(route, asSingle(pool));
  });
}

async function mockMove(page: Page) {
  const bodies: unknown[] = [];
  await page.route("**/api/riders/*/academy-demote-quote**", (route: Route) => {
    if (preflight(route)) return;
    const squad = new URL(route.request().url()).searchParams.get("squad") || "junior";
    return json(route, {
      currentSalary: 17000, newSalary: 17000, keepsContract: true, racesCleared: 0, racesOngoing: 0,
      targetSquad: squad, squadUsed: 1, squadMax: squad === "u23" ? 12 : 10,
    });
  });
  await page.route("**/api/riders/*/squad", (route: Route) => {
    if (preflight(route)) return;
    const body = route.request().postDataJSON() as { squad?: string };
    bodies.push(body);
    return json(route, { riderId: OWN_RIDER.id, action: "demoted", from: "senior", to: body?.squad });
  });
  return bodies;
}

async function setup(page: Page, listedIds: string[]) {
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
  await mockRiders(page);
  await mockListings(page, listedIds);
  return mockMove(page);
}

async function moveToU23InDialog(page: Page) {
  const dialog = page.getByTestId("move-squad-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("move-squad-row-u23")).not.toContainText("...");
  await dialog.getByRole("radio").nth(1).check();
  const confirm = dialog.getByTestId("move-squad-confirm");
  await expect(confirm).toHaveText("Flyt til U23");
  await confirm.click();
}

test("#5917 rytterprofil: en listet rytter flyttes til U23, og listingen står stadig", async ({ page }) => {
  const moves = await setup(page, [OWN_RIDER.id]);
  await login(page);
  await page.goto(`/riders/${OWN_RIDER.id}`);
  await expect(page.getByText("På transferlisten for 250.000 CZ$")).toBeVisible({ timeout: 20000 });

  await page.getByTestId("move-squad-button").click();
  await moveToU23InDialog(page);

  await expect.poll(() => moves.length).toBe(1);
  expect(moves[0]).toEqual({ squad: "u23" });
  await expect(page.getByText("Rytter flyttet til dit U23-hold.")).toBeVisible();
  await expect(page.getByText("På transferlisten for 250.000 CZ$")).toBeVisible();
});

test("#5917 My Team: en listet rytter flyttes fra Flyt trup-fanen, og badgen står stadig", async ({ page }) => {
  const moves = await setup(page, [OWN_RIDER.id]);
  await login(page);
  await page.goto("/team");
  await revealMobileTableColumn(page, MOBILE_COLUMN_ACTION);
  const row = page.locator("main table").first().getByRole("row", { name: new RegExp(`${OWN_RIDER.firstname} ${OWN_RIDER.lastname}`) });
  await revealMobileTableColumn(page, /^Status$/);
  await expect(row.getByText("LISTE")).toBeVisible({ timeout: 20000 });

  await row.getByRole("button", { name: "Sælg / Auktion" }).click();
  await page.getByRole("button", { name: "Flyt trup" }).click();
  await page.getByTestId("team-move-squad-open").click();
  await moveToU23InDialog(page);

  await expect.poll(() => moves.length).toBe(1);
  expect(moves[0]).toEqual({ squad: "u23" });
  await expect(row.getByText("LISTE")).toBeVisible();
});

test("#5917 U23 team: listed-badge og Sælg / Ret salg åbner profilens salgsformular", async ({ page }, testInfo) => {
  await setup(page, [LISTED_YOUTH.id]);
  await login(page);
  await page.goto("/squads/u23");
  await expect(page.getByRole("heading", { name: "E2E Racing U23" })).toBeVisible();
  await revealMobileTableColumn(page, /^Status$/);
  await revealMobileTableColumn(page, MOBILE_COLUMN_ACTION);

  const table = page.locator("main table").first();
  const listedRow = table.getByRole("row", { name: new RegExp(`${LISTED_YOUTH.firstname} ${LISTED_YOUTH.lastname}`) });
  await expect(listedRow.getByText("LISTE")).toBeVisible();
  await expect(page.getByTestId(`youth-sell-${LISTED_YOUTH.id}`)).toHaveText("Ret salg");
  await expect(page.getByTestId(`youth-sell-${UNLISTED_YOUTH.id}`)).toHaveText("Sælg");
  const unlistedRow = table.getByRole("row", { name: new RegExp(`${UNLISTED_YOUTH.firstname} ${UNLISTED_YOUTH.lastname}`) });
  await expect(unlistedRow.getByText("LISTE")).toHaveCount(0);

  if (testInfo.project.name !== "mobile-webkit") {
    const tag = testInfo.project.name === "desktop-chromium" ? "desktop-1440" : "mobile-390";
    if (tag === "desktop-1440") await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: evidenceShotPath(`pr-screens/5917/after-u23-${tag}.png`), fullPage: true });
  }

  await page.getByTestId(`youth-sell-${UNLISTED_YOUTH.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/riders/${UNLISTED_YOUTH.id}\\?sell=1$`));
  await expect(page.getByTestId("transfer-list-price-input")).toBeVisible({ timeout: 20000 });
});
