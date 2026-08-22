// #3750/#4000 — EJERENS forhåndsvisning af værdi-overgangen: (1) siden er
// ejer-gated (backend 403 ⇒ redirect, menupunkt skjult for andre admins),
// (2) værdi-fanen regner efter = dæmpet × c med presets fra den OFFICIELLE
// gate-måling, (3) løn-fanen viser forventet S3-løn, (4) sortérbar DataTable.
// Backend-gaten (requireOwner) testes separat i
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

// Den officielle måling 22/8 (RØD, ustabil kanal) — presets kommer herfra.
const GATE = {
  measured_date: "2026-08-22",
  gate_status: "red",
  gate_reason: "unstable_channel",
  gate_reason_text: "De seneste 3 rullende 30-dages-medianer spænder 0.225 (1.000 → 0.811 → 0.775), over stabilitetsbåndet ±0.15.",
  n_qualified_90d: 80,
  median_price_over_anchor_90d: 0.655,
  rolling_medians: [
    { window_end: "2026-08-08", n: 21, median: 1.0 },
    { window_end: "2026-08-15", n: 31, median: 0.811 },
    { window_end: "2026-08-22", n: 54, median: 0.775 },
  ],
  c_candidate: null,
};

async function setup(page, { isOwner = true } = {}) {
  await stabilizePage(page);
  await installNetworkMocks(page);

  // Registreret EFTER installNetworkMocks → vinder routing. Admin-rollen er
  // første led i adgangen (samme mønster som language-resync-flicker.spec).
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

  await page.route("**/api/admin/owner-check*", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    }
    return json(route, { isOwner });
  });

  await page.route("**/api/admin/market-value-level-correction/gate*", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    }
    return json(route, { gate: GATE });
  });

  await page.route("**/api/admin/value-transition*", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    }
    if (!isOwner) return json(route, { error: "Owner only" }, 403);
    return json(route, { computedAt: "2026-08-22T14:00:00Z", rows: PREVIEW_ROWS });
  });

  await login(page);
  await page.goto("/admin/value-transition");
}

test("ejer-gate: ikke-ejer-admin sendes til dashboardet og ser intet menupunkt", async ({ page }) => {
  await setup(page, { isOwner: false });
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Værdi-overgangen — forhåndsvisning" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Værdi-overgang" })).toHaveCount(0);
});

test("værdi-fanen: presets fra den officielle gate-måling; efter = dæmpet × c; AI-hold filtreret fra", async ({ page }) => {
  await setup(page);
  await expect(page.getByRole("heading", { name: "Værdi-overgangen — forhåndsvisning" })).toBeVisible();

  // Gate-status vises med den officielle måling.
  await expect(page.getByTestId("gate-status")).toContainText("Gate RØD");
  await expect(page.getByTestId("gate-status")).toContainText("0.775");

  // Default c = nyeste vindue (0,775): Riva 5.129.549 × 0,775 = 3.975.400.
  await expect(page.getByRole("cell", { name: "3.975.400" })).toBeVisible();
  await expect(page.getByText("Carl Cpu")).toHaveCount(0);

  // Preset median90 (0,655): 5.129.549 × 0,655 = 3.359.855.
  await page.getByRole("button", { name: /median90/ }).click();
  await expect(page.getByRole("cell", { name: "3.359.855" })).toBeVisible();

  // Slå AI-filteret FRA (default er til) → Carl Cpu dukker op.
  await page.getByRole("checkbox", { name: "Kun spillerhold" }).uncheck();
  await expect(page.getByText("Carl Cpu")).toBeVisible();
});

test("løn-fanen: forventet S3-løn vises med ændring, og tabellen kan sorteres", async ({ page }, testInfo) => {
  await setup(page);
  await expect(page.getByRole("heading", { name: "Værdi-overgangen — forhåndsvisning" })).toBeVisible();

  await page.getByRole("button", { name: "Løn", exact: true }).click();
  await expect(page.getByRole("cell", { name: "116.311" })).toBeVisible();

  // Sortér på "Forventet S3" stigende → mindste først (Berta 8.533 før Riva 116.311).
  // På mobil dækker den sticky "Rytter"-kolonne headeren efter vandret
  // scroll (pointer-interception på webkit) — der affyres klikket direkte på
  // elementet; desktop bruger et ægte klik.
  const header = page.getByRole("columnheader", { name: /Forventet S3/ });
  const clickHeader = async () => (testInfo.project.name.startsWith("mobile") ? header.dispatchEvent("click") : header.click());
  await clickHeader(); // desc
  await clickHeader(); // asc
  const firstDataRow = page.locator("table tbody tr").first();
  await expect(firstDataRow).toContainText("Berta Bakke");
});

test("screenshots til ejer-review (desktop + mobil)", async ({ page }, testInfo) => {
  await setup(page);
  await expect(page.getByRole("heading", { name: "Værdi-overgangen — forhåndsvisning" })).toBeVisible();
  await page.screenshot({ path: evidenceShotPath(`pr-screens/3750-admin-vaerdi-fane-${testInfo.project.name}.png`), fullPage: true });
  await page.getByRole("button", { name: "Løn", exact: true }).click();
  await expect(page.getByRole("cell", { name: "116.311" })).toBeVisible();
  await page.screenshot({ path: evidenceShotPath(`pr-screens/3750-admin-loen-fane-${testInfo.project.name}.png`), fullPage: true });
});
