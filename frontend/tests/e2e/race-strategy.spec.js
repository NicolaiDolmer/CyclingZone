// Race Hub S3 — Holdstrategi-fladen på /races/strategy.
//
// Mocker GET /api/races/strategy (aggregat-endpointet) så fladen renderer A-kæde,
// faste roller, kaptajn 1/2/3-board (med bucket-suitability) og mål-løb. Mønster
// følger race-distribution.spec.js: stabilizePage → installNetworkMocks → mock → login → goto.
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, corsHeaders } from "./fixtures.js";

const ROSTER = Array.from({ length: 8 }, (_, i) => ({
  id: `r${i}`,
  name: `Rider ${i}`,
  primaryType: null,
  secondaryType: null,
  overall: 70 - i * 2,
  suitabilities: { flat: 80 - i * 3, hilly: 60 - i * 2, mountain: 40 + i * 4, cobbles: 50, itt: 55 },
}));

const STRATEGY = {
  enabled: true,
  roster: ROSTER,
  a_chain: ["r0", "r1"],
  captain_priorities: { mountain: ["r2"] },
  role_rules: { r3: "always_captain" },
  target_race_ids: ["race-a"],
  upcoming: [
    { id: "race-a", name: "Hamburger Klassiker", race_class: "ProSeries", status: "scheduled", stages: 1, stages_completed: 0, bucket: "flat", is_target: true },
    { id: "race-b", name: "La Corsa dei Due Mari", race_class: "OtherWorldTourA", status: "scheduled", stages: 7, stages_completed: 0, bucket: "mountain", is_target: false },
  ],
};

async function mockStrategy(page, payload = STRATEGY) {
  await page.route("**/api/races/strategy", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return route.fulfill({
      status: 200, contentType: "application/json", headers: corsHeaders(request),
      body: JSON.stringify(payload),
    });
  });
}

test("Holdstrategi-fladen renderer A-kæde, kaptajn-board og mål-løb", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockStrategy(page);

  await login(page);
  await page.goto("/races/strategy");

  const root = page.getByTestId("strategy-page");
  await expect(root).toBeVisible();

  // De fire sektioner (cz_lang=da).
  await expect(root.getByText("A-kæde", { exact: true })).toBeVisible();
  await expect(root.getByText("Faste roller", { exact: true })).toBeVisible();
  await expect(root.getByText("Kaptajner pr. terræn", { exact: true })).toBeVisible();
  await expect(root.getByText("Mål-løb", { exact: true })).toBeVisible();

  // A-kæden viser de to rangordnede ryttere.
  await expect(root.getByText("Rider 0").first()).toBeVisible();

  // Terræn-buckets på kaptajn-boardet (label optræder også i mål-løb-listen → .first()).
  await expect(root.getByText("Bjerg", { exact: true }).first()).toBeVisible();

  // Mål-løb-listen viser de kommende løb.
  await expect(root.getByText("Hamburger Klassiker")).toBeVisible();
});

test("Holdstrategi: auto-foreslå udfylder en terræn-bucket", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockStrategy(page, { ...STRATEGY, captain_priorities: {} }); // tom → auto-foreslå fylder

  await login(page);
  await page.goto("/races/strategy");
  const root = page.getByTestId("strategy-page");
  await expect(root).toBeVisible();

  // Klik første "Auto-foreslå" (Flad-bucket) → kandidater dukker op.
  await root.getByRole("button", { name: "Auto-foreslå" }).first().click();
  // Rider 0 har højest flad-suitability (80) → øverste kandidat.
  await expect(root.getByText("Rider 0").first()).toBeVisible();
});
