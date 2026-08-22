// #3750/#4000 — admin-forhåndsvisningen af værdi-overgangen: (1) siden er
// admin-gated i UI'et (rolle-opslag), (2) værdi-fanen regner efter = dæmpet × c
// og c-presets ændrer tallene live, (3) løn-fanen viser forventet S3-løn,
// (4) sortérbar DataTable. Backend-gaten (requireAdmin) testes separat i
// backend/routes/valueTransitionAdminRoute.test.js.
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders, evidenceShotPath } from "./fixtures.js";

const PREVIEW_ROWS = [
  {
    riderId: "11111111-1111-4111-8111-111111111111",
    name: "Andrea Riva", teamName: "Aquila Racing", teamIsAi: false,
    valuationType: "puncheur", primaryType: "puncheur",
    valueNow: 23756219, valueDamped: 5129549,
    cpvNow: 1538503, cpvDamped: 332317,
    salaryNow: 538476, salaryExpected: 116311, salaryExpectedNoDamp: 538476,
  },
  {
    riderId: "22222222-2222-4222-8222-222222222222",
    name: "Berta Bakke", teamName: "Bjergholdet", teamIsAi: false,
    valuationType: "climber", primaryType: "rouleur",
    valueNow: 100000, valueDamped: 121900,
    cpvNow: 20000, cpvDamped: 24380,
    salaryNow: 7000, salaryExpected: 8533, salaryExpectedNoDamp: 7000,
  },
  {
    riderId: "33333333-3333-4333-8333-333333333333",
    name: "Carl Cpu", teamName: "Machina", teamIsAi: true,
    valuationType: "tt", primaryType: "tt",
    valueNow: 50000, valueDamped: 61850,
    cpvNow: 10000, cpvDamped: 12370,
    salaryNow: 3500, salaryExpected: 4330, salaryExpectedNoDamp: 3500,
  },
];

async function setup(page) {
  await stabilizePage(page);
  await installNetworkMocks(page);

  // Registreret EFTER installNetworkMocks → vinder routing. Admin-rollen er
  // hele adgangen til siden (samme mønster som language-resync-flicker.spec).
  await page.route("**/rest/v1/users**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method())) {
      return json(route, {});
    }
    return json(route, {
      id: "00000000-0000-4000-8000-000000000001",
      role: "admin",
      username: "Playwright Admin",
      language: "da",
    });
  });

  await page.route("**/api/admin/value-transition*", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    }
    return json(route, { computedAt: "2026-08-21T22:00:00Z", rows: PREVIEW_ROWS });
  });

  await login(page);
  await page.goto("/admin/value-transition");
  await expect(page.getByRole("heading", { name: "Værdi-overgangen — forhåndsvisning" })).toBeVisible();
}

test("værdi-fanen: efter = dæmpet × c, presets ændrer tallene, AI-hold er filtreret fra som default", async ({ page }) => {
  await setup(page);

  // Default c = 0,894: Riva 5.129.549 × 0,894 = 4.585.817.
  await expect(page.getByRole("cell", { name: "4.585.817" })).toBeVisible();
  // AI-rytteren er skjult af "Kun spillerhold"-defaulten.
  await expect(page.getByText("Carl Cpu")).toHaveCount(0);

  // Preset 0,666: Riva 5.129.549 × 0,666 = 3.416.280.
  await page.getByRole("button", { name: "0,666" }).click();
  await expect(page.getByRole("cell", { name: "3.416.280" })).toBeVisible();

  // Slå AI-filteret FRA (default er til) → Carl Cpu dukker op.
  await page.getByRole("checkbox", { name: "Kun spillerhold" }).uncheck();
  await expect(page.getByText("Carl Cpu")).toBeVisible();
});

test("løn-fanen: forventet S3-løn vises med ændring, og tabellen kan sorteres", async ({ page }) => {
  await setup(page);

  await page.getByRole("button", { name: "Løn", exact: true }).click();
  await expect(page.getByRole("cell", { name: "116.311" })).toBeVisible();

  // Sortér på "Forventet S3" stigende → mindste først (Berta 8.533 før Riva 116.311).
  const header = page.getByRole("columnheader", { name: /Forventet S3/ });
  await header.click(); // desc
  await header.click(); // asc
  const firstDataRow = page.locator("table tbody tr").first();
  await expect(firstDataRow).toContainText("Berta Bakke");
});

test("screenshots til ejer-review (desktop + mobil)", async ({ page }, testInfo) => {
  await setup(page);
  await page.screenshot({ path: evidenceShotPath(`pr-screens/3750-admin-vaerdi-fane-${testInfo.project.name}.png`), fullPage: true });
  await page.getByRole("button", { name: "Løn", exact: true }).click();
  await expect(page.getByRole("cell", { name: "116.311" })).toBeVisible();
  await page.screenshot({ path: evidenceShotPath(`pr-screens/3750-admin-loen-fane-${testInfo.project.name}.png`), fullPage: true });
});
