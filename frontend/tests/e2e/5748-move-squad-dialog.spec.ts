import type { Page, Route } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, RIDERS, TEST_TEAM, json, corsHeaders } from "./fixtures.js";
import { wantsObject } from "../../src/preview/mockHandlers.js";

// #5748 (ejer-go A 25/9) — "Move squad": ÉN flyt-dialog for alle trupper.
//
// Dialogen skal ALTID vise alle tre trupper (senior, U23, junior) med pladser,
// markere den nuværende trup, gøre en trup rytteren er for gammel til grå MED
// grunden, og sende det VALGTE mål til POST /api/riders/:id/squad. Før låste
// knappen målet på forhånd ("Flyt til junior" for en 17-årig senior), og U23
// kunne aldrig vælges, selvom opad altid er tilladt (YOUTH_RULES §2).
//
// Specs kører på DA-locale (stabilizePage sætter cz_lang=da). Sæson 1 = 2026,
// så fødselsåret afgør sæsonalderen direkte (2009 -> 17, 2007 -> 19, 2010 -> 16).

const OWN_RIDER = RIDERS.find((r: { id: string }) => r.id === "rider-1");

function riderWith(overrides: Record<string, unknown>) {
  return { ...OWN_RIDER, ...overrides };
}

async function mockOwnRider(page: Page, rider: Record<string, unknown>) {
  await page.route("**/rest/v1/riders**", (route: Route) => {
    const request = route.request();
    if (request.method() !== "GET") return json(route, {});
    const url = request.url();
    const accept = request.headers().accept || "";
    const asSingle = (rows: unknown[]) => (wantsObject(accept) ? (rows[0] || {}) : rows);
    if (url.includes("pending_team_id=eq.")) return json(route, asSingle([]));
    const pool = RIDERS.map((r: { id: string }) => (r.id === rider.id ? rider : r));
    const idEq = url.match(/[?&]id=eq\.([^&]+)/);
    if (idEq) {
      const id = decodeURIComponent(idEq[1]);
      return json(route, asSingle(pool.filter((r: { id: string }) => r.id === id)));
    }
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) {
      return json(route, asSingle(pool.filter((r: { team_id?: string }) => r.team_id === TEST_TEAM.id)));
    }
    return json(route, asSingle(pool));
  });
}

async function mockQuote(page: Page) {
  await page.route("**/api/riders/*/academy-demote-quote**", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    const squad = new URL(request.url()).searchParams.get("squad") || "junior";
    return json(route, {
      currentSalary: 17000, newSalary: 17000, keepsContract: true, racesCleared: 1, racesOngoing: 0,
      targetSquad: squad, squadUsed: 1, squadMax: squad === "u23" ? 12 : 10,
    });
  });
}

async function captureMove(page: Page) {
  const bodies: unknown[] = [];
  await page.route("**/api/riders/*/squad", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    const body = request.postDataJSON() as { squad?: string };
    bodies.push(body);
    return json(route, { riderId: OWN_RIDER.id, action: "demoted", from: "senior", to: body?.squad });
  });
  return bodies;
}

async function openDialog(page: Page) {
  await page.goto(`/riders/${OWN_RIDER.id}`);
  const trigger = page.getByTestId("move-squad-button");
  await expect(trigger).toBeVisible({ timeout: 20000 });
  await expect(trigger).toHaveText("Flyt trup");
  await trigger.click();
  const dialog = page.getByTestId("move-squad-dialog");
  await expect(dialog).toBeVisible();
  // Pladserne er hentet, når rækkerne ikke længere viser "...".
  await expect(dialog.getByTestId("move-squad-row-u23")).not.toContainText("...");
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await mockQuote(page);
  await stabilizePage(page);
});

test("17-årig senior: tre rækker, junior forvalgt, U23 kan vælges og sendes til routen (#5748)", async ({ page }) => {
  await mockOwnRider(page, riderWith({ birthdate: "2009-04-12", squad: "senior", is_academy: false }));
  const moves = await captureMove(page);
  await login(page);
  const dialog = await openDialog(page);

  await expect(dialog.getByTestId("move-squad-row-senior")).toHaveAttribute("data-state", "current");
  await expect(dialog.getByTestId("move-squad-row-u23")).toHaveAttribute("data-state", "open");
  await expect(dialog.getByTestId("move-squad-row-junior")).toHaveAttribute("data-state", "open");
  await expect(dialog.getByRole("radio")).toHaveCount(3);
  await expect(dialog.getByRole("radio", { checked: true })).toHaveValue("junior");

  await dialog.getByRole("radio").nth(1).check();
  const confirm = dialog.getByTestId("move-squad-confirm");
  await expect(confirm).toHaveText("Flyt til U23");
  await confirm.click();

  await expect.poll(() => moves.length).toBe(1);
  expect(moves[0]).toEqual({ squad: "u23" });
  await expect(page.getByText("Rytter flyttet til dit U23-hold.")).toBeVisible();
});

test("19-årig senior: junior står grå med grunden, U23 er forvalgt (#5748)", async ({ page }) => {
  await mockOwnRider(page, riderWith({ birthdate: "2007-04-12", squad: "senior", is_academy: false }));
  await login(page);
  const dialog = await openDialog(page);

  const junior = dialog.getByTestId("move-squad-row-junior");
  await expect(junior).toHaveAttribute("data-state", "tooOld");
  await expect(junior).toContainText("For gammel til junior (maks 18)");
  await expect(junior.getByRole("radio")).toBeDisabled();
  await expect(dialog.getByRole("radio", { checked: true })).toHaveValue("u23");
});

test("juniorrytter: samme dialog, U23 forvalgt og senior kan vælges (#5748)", async ({ page }) => {
  await mockOwnRider(page, riderWith({ birthdate: "2010-04-12", squad: "junior", is_academy: true }));
  await login(page);
  const dialog = await openDialog(page);

  await expect(dialog.getByTestId("move-squad-row-junior")).toHaveAttribute("data-state", "current");
  await expect(dialog.getByTestId("move-squad-row-senior")).toHaveAttribute("data-state", "open");
  await expect(dialog.getByRole("radio", { checked: true })).toHaveValue("u23");
  await expect(dialog.getByText("Kun truppen skifter. Løn og kontrakt forbliver præcis som nu.")).toBeVisible();
});
