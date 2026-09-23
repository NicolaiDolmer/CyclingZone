// #5519: U23 team- og Junior team-siderne bag kontakten youth_squad_pages.
//
// Kontakten kommer fra GET /api/display-flags. Den delte mock svarer OFF
// (mockHandlers.js), så alle eksisterende specs og snapshots viser dagens
// visning; her tændes den med en egen route. Truppens indhold kommer fra
// GET /api/youth-squads (id'er, server-grupperet) + rytter-opslaget med de id'er.
//
// Testen beviser:
//   1. OFF er uændret: ingen menupunkter, Academy har Coming soon-kortet, og en
//      direkte URL sender videre til My Team.
//   2. ON: U23 team + Junior team står lige efter My Team, Academy mister kortet.
//   3. Squad-fanen viser præcis truppen serveren gav, Development de samme ryttere.
//   4. Calendar/Results/Standings er tomme tilstande uden tal, med roadmap-knap.
import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks, login, stabilizePage, json, corsHeaders, collectBrowserErrors,
  waitForStableSnapshotTarget, TEXT_MASK_SELECTOR,
} from "./fixtures.js";
import { PREVIEW_YOUTH_RIDERS, previewYouthSquadsPayload, previewYouthRiderRows } from "../../src/preview/youthSquadsMock.ts";
import type { Page, Route } from "@playwright/test";

// Login-fixturen er DA-låst, så siderne står på dansk; begge sprog accepteres.
const U23_NAV = /^(U23 team|U23-hold)$/;
const JUNIOR_NAV = /^(Junior team|Juniorhold)$/;
const MY_TEAM_NAV = /^(My Team|Mit Hold)$/;
const COMING_SOON = /Coming soon|Kommer snart/;
const CONSOLE_NOISE = [/WebSocket connection to .*supabase\.co.*failed/i, /ERR_NAME_NOT_RESOLVED/i];

function preflight(route: Route): boolean {
  const request = route.request();
  if (request.method() !== "OPTIONS") return false;
  void route.fulfill({ status: 204, headers: corsHeaders(request) });
  return true;
}

// Senest registrerede route vinder over installNetworkMocks' generiske mocks.
async function setup(page: Page, { on }: { on: boolean }) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/display-flags", (route) => {
    if (preflight(route)) return;
    return json(route, { rider_best_role_display: false, youth_squad_pages: on });
  });
  await page.route("**/api/youth-squads", (route) => {
    if (preflight(route)) return;
    return on ? json(route, previewYouthSquadsPayload()) : json(route, { error: "youth_squad_pages_disabled" }, 409);
  });
  await page.route("**/rest/v1/riders*", (route) => {
    if (preflight(route)) return;
    const rows = previewYouthRiderRows(route.request().url());
    return rows ? json(route, rows) : route.fallback();
  });
}

const U23 = PREVIEW_YOUTH_RIDERS.filter((r) => r.squad === "u23");
const JUNIORS = PREVIEW_YOUTH_RIDERS.filter((r) => r.squad === "junior");

test.describe("U23 team- og Junior team-siderne (#5519)", () => {
  test("kontakt OFF: ingen menupunkter, Coming soon-kortet står, direkte URL sender til My Team", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Menu- og kort-tjekket er projekt-uafhængigt; desktop dækker det.");
    await setup(page, { on: false });
    await login(page);

    const nav = page.locator("nav").filter({ has: page.getByRole("link", { name: MY_TEAM_NAV }) }).first();
    await expect(nav.getByRole("link", { name: MY_TEAM_NAV })).toBeVisible();
    await expect(page.getByRole("link", { name: U23_NAV })).toHaveCount(0);
    await expect(page.getByRole("link", { name: JUNIOR_NAV })).toHaveCount(0);

    await page.goto("/academy");
    await expect(page.locator("main")).toContainText(COMING_SOON);

    await page.goto("/squads/u23");
    await expect(page).toHaveURL(/\/team$/);
  });

  test("kontakt ON: U23 team og Junior team står lige efter My Team, Academy mister kortet", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Menu-rækkefølgen er den samme i skuffen på mobil.");
    await setup(page, { on: true });
    await login(page);

    await expect(page.getByRole("link", { name: U23_NAV })).toBeVisible();
    await expect(page.getByRole("link", { name: JUNIOR_NAV })).toBeVisible();
    const hrefs = await page.locator("aside nav a").evaluateAll(
      (links) => links.map((a) => a.getAttribute("href")),
    );
    const teamIdx = hrefs.indexOf("/team");
    expect(teamIdx).toBeGreaterThanOrEqual(0);
    expect(hrefs.slice(teamIdx, teamIdx + 3)).toEqual(["/team", "/squads/u23", "/squads/junior"]);

    await page.goto("/academy");
    await expect(page.getByRole("heading", { name: /Academy|Akademi/i }).first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText(COMING_SOON);
  });

  test("U23 team: Squad-fanen viser truppen fra serveren, Development de samme ryttere", async ({ page }, testInfo) => {
    const { pageErrors, consoleErrors } = collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });
    await setup(page, { on: true });
    await login(page);

    // Menu-vejen dækkes af "kontakt ON"-testen; her gælder det selve siden.
    await page.goto("/squads/u23");
    await expect(page.getByRole("heading", { name: "E2E Racing U23" })).toBeVisible();

    const tabs = page.getByRole("tablist");
    await expect(tabs.getByRole("tab")).toHaveCount(5);
    await expect(tabs.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");

    const table = page.locator("table").first();
    for (const rider of U23) {
      await expect(table.getByRole("link", { name: `${rider.firstname} ${rider.lastname}` })).toBeVisible();
    }
    for (const rider of JUNIORS) {
      await expect(page.getByText(`${rider.firstname} ${rider.lastname}`)).toHaveCount(0);
    }

    await waitForStableSnapshotTarget(page);
    await expect(page).toHaveScreenshot("youth-squad-u23.png", {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      mask: [page.locator(TEXT_MASK_SELECTOR)],
      maxDiffPixelRatio: 0.05,
    });

    await tabs.getByRole("tab", { name: /Development|Udvikling/ }).click();
    for (const rider of U23) {
      await expect(page.getByRole("link", { name: `${rider.firstname} ${rider.lastname}` }).first()).toBeVisible();
    }

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("Junior team: Calendar, Results og Standings er tomme tilstande uden tal", async ({ page }) => {
    await setup(page, { on: true });
    await login(page);
    await page.goto("/squads/junior");
    await expect(page.getByRole("heading", { name: "E2E Racing Juniors" })).toBeVisible();

    const tabs = page.getByRole("tablist");
    for (const name of [/Calendar|Kalender/, /Results|Resultater/, /Standings|Stilling/]) {
      await tabs.getByRole("tab", { name }).click();
      const main = page.locator("main");
      await expect(main.getByText(/See when youth races start|Se hvornår ungdomsløbene starter/)).toBeVisible();
      await expect(main.getByRole("link", { name: "Roadmap" })).toHaveAttribute("href", "/roadmap");
      await expect(main.locator("table")).toHaveCount(0);
    }

    await waitForStableSnapshotTarget(page);
    await expect(page).toHaveScreenshot("youth-squad-junior-standings.png", {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      mask: [page.locator(TEXT_MASK_SELECTOR)],
      maxDiffPixelRatio: 0.05,
    });
  });

  test("tom trup: Squad-fanen peger på akademiet i stedet for en tom tabel", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Tom-tilstanden er ens på alle projekter.");
    await setup(page, { on: true });
    await page.route("**/api/youth-squads", (route) => {
      if (preflight(route)) return;
      return json(route, { seasonNumber: 1, squads: { u23: { riderIds: [] }, junior: { riderIds: [] } } });
    });
    await login(page);
    await page.goto("/squads/u23");
    await expect(page.getByText(/Sign a talent in your academy|Signér et talent i dit akademi/)).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: /Go to academy|Gå til akademiet/ })).toHaveAttribute("href", "/academy");
    await expect(page.locator("main table")).toHaveCount(0);
  });
});
