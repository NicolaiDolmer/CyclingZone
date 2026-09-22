// #5435 (D-049, model A) — rating = "bedste rolle nu" + badge "Natural role",
// bag app_config-kontakten rider_best_role_display.
//
// Kontakten kommer fra GET /api/display-flags. Playwright-mocken svarer OFF
// (mockHandlers.js), så alle eksisterende specs og snapshots viser dagens
// visning; her tændes den med localStorage cz_mock_best_role = "1".
//
// Testen beviser tre ting:
//   1. OFF er uændret: rating = egen rolle, kolonnen hedder "Type".
//   2. ON: rating = max over de otte roller + rollenavnet ved tallet, typen
//      hedder "Natural role", og "Best role now" kan filtreres.
//   3. ON på rytterprofilen: "Best role now" i heroen, "Natural"-etiket i
//      badget og intet loft-tal (ejer 21/9).
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders, collectBrowserErrors, evidenceShotPath } from "./fixtures.js";
import { ratingForRole } from "../../src/lib/generated/displayRecipes.js";
import { riderBestRole } from "../../src/lib/riderRating.js";

const CONSOLE_NOISE = [/WebSocket connection to .*supabase\.co.*failed/i, /ERR_NAME_NOT_RESOLVED/i];

// Anlæg sprinter, men bjerg-evnerne er højest NU: det er præcis den rytter
// model A handler om — badget siger "Sprinter", ratingen siger "Climber".
function riderRow(id, lastname, abilities) {
  const best = riderBestRole(abilities);
  return {
    id, firstname: "Test", lastname, nationality_code: "dk", birthdate: "1998-01-01",
    team_id: null, team: null, is_retired: false, is_u25: false, owner_is_ai: false,
    base_value: 500000, market_value: 500000, salary: 40000, contract_length: 2,
    contract_end_season: 3, popularity: 50, prize_earnings_bonus: 0,
    primary_type: "sprinter", secondary_type: "rouleur",
    // Cachen (#5487) — bruges af server-filteret på bedste rolle.
    best_role: best.role, best_role_rating: best.rating,
    rider_derived_abilities: abilities,
  };
}

function flat(level) {
  return {
    sprint: level, acceleration: level, positioning: level, flat: level, durability: level,
    climbing: level, time_trial: level, tempo: level, endurance: level, recovery: level,
    descending: level, cobblestone: level, aggression: level, tactics: level, punch: level,
  };
}

const CLIMBER_NOW = { ...flat(30), climbing: 72, recovery: 64, endurance: 62 };
const SPRINTER_NOW = { ...flat(25), sprint: 70, acceleration: 66, positioning: 60, flat: 55 };

const RIDERS = [
  riderRow("best-climb", "Climbnow", CLIMBER_NOW),
  riderRow("best-sprint", "Sprintnow", SPRINTER_NOW),
];

async function mockRiders(page) {
  await page.route("**/rest/v1/riders*", route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    const search = decodeURIComponent(new URL(request.url()).search);
    let rows = RIDERS;
    const idIn = search.match(/[?&]id=in\.\(([^)]*)\)/);
    if (idIn) {
      const ids = new Set(idIn[1].split(",").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean));
      rows = rows.filter(r => ids.has(r.id));
    }
    const bestRole = search.match(/[?&]best_role=eq\.([a-z]+)/);
    if (bestRole) rows = rows.filter(r => r.best_role === bestRole[1]);
    return json(route, rows);
  });
}

async function setup(page, { on }) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem("cz_mock_best_role", value);
      window.localStorage.setItem("cz_lang", "en");
    } catch { /* ignore */ }
  }, on ? "1" : "0");
}

test.describe("Rytterdatabase: rating = bedste rolle nu bag kontakten (#5435)", () => {
  test("kontakt OFF: dagens visning — egen rolle, kolonnen hedder Type", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Tabel-kolonnerne er kun egne kolonner på desktop.");
    await setup(page, { on: false });
    await mockRiders(page);
    await login(page);
    await page.goto("/riders");
    await expect(page.getByRole("heading", { name: /Rider Database|Rytterdatabase/ })).toBeVisible();

    const row = page.locator("table tbody tr", { hasText: "Climbnow" });
    await expect(row).toBeVisible();
    await expect(row.locator("td:nth-child(5)")).toHaveText(String(ratingForRole(CLIMBER_NOW, "sprinter")));
    await expect(page.locator("[data-best-role]")).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Natural role" })).toHaveCount(0);
  });

  test("kontakt ON: bedste rolle nu + rollenavn, Natural role-kolonne og filter", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Tabel-kolonnerne er kun egne kolonner på desktop.");
    const { pageErrors, consoleErrors } = collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });
    await setup(page, { on: true });
    await mockRiders(page);
    await login(page);
    await page.goto("/riders");
    await expect(page.getByRole("heading", { name: /Rider Database|Rytterdatabase/ })).toBeVisible();

    const best = riderBestRole(CLIMBER_NOW);
    expect(best.role).toBe("climber");
    expect(best.rating).toBeGreaterThan(ratingForRole(CLIMBER_NOW, "sprinter"));

    const row = page.locator("table tbody tr", { hasText: "Climbnow" });
    const ratingCell = row.locator("td:nth-child(5)");
    await expect(ratingCell).toContainText(String(best.rating));
    await expect(ratingCell.locator("[data-best-role='climber']")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Natural role" })).toBeVisible();

    await page.screenshot({ path: evidenceShotPath("pr-screens/5435-riders-best-role-on-desktop.png"), fullPage: true });

    // Filter på bedste rolle nu: kun klatreren er tilbage.
    const filter = page.getByLabel("Best role now").first();
    await filter.selectOption("climber");
    await expect(page.locator("table tbody tr", { hasText: "Climbnow" })).toBeVisible();
    await expect(page.locator("table tbody tr", { hasText: "Sprintnow" })).toHaveCount(0);

    expect(pageErrors, `pageerror(s): ${pageErrors.join(" | ")}`).toEqual([]);
    expect(consoleErrors, `console.error(s): ${consoleErrors.join(" | ")}`).toEqual([]);
  });
});

test.describe("Rytterprofil + Mit hold bag kontakten (#5435)", () => {
  test("kontakt ON: hero viser Best role now + rolle, badget er Natural, intet loft-tal", async ({ page }, testInfo) => {
    await setup(page, { on: true });
    await login(page);
    await page.goto("/riders/rider-1");
    await expect(page.getByText("Best role now").first()).toBeVisible();
    await expect(page.getByTestId("rider-hero-best-role")).toBeVisible();
    await expect(page.getByTestId("rider-type-natural-label").first()).toHaveText(/Natural/i);
    await expect(page.getByTestId("rider-hero-loft")).toHaveCount(0);
    await page.screenshot({ path: evidenceShotPath(`pr-screens/5435-profile-best-role-on-${testInfo.project.name}.png`), fullPage: true });
  });

  test("kontakt OFF: hero hedder Rating, ingen Natural-etiket", async ({ page }) => {
    await setup(page, { on: false });
    await login(page);
    await page.goto("/riders/rider-1");
    await expect(page.getByText("Rating", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("rider-hero-best-role")).toHaveCount(0);
    await expect(page.getByTestId("rider-type-natural-label")).toHaveCount(0);
  });

  test("kontakt ON: Mit hold har Natural role-kolonne og rollen ved ratingen", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Trup-tabellens kolonner er kun egne kolonner på desktop.");
    await setup(page, { on: true });
    await login(page);
    await page.goto("/team");
    await expect(page.getByRole("columnheader", { name: "Natural role" }).first()).toBeVisible();
    await expect(page.locator("table tbody [data-best-role]").first()).toBeVisible();
    await page.screenshot({ path: evidenceShotPath("pr-screens/5435-team-best-role-on-desktop.png"), fullPage: true });
  });
});
