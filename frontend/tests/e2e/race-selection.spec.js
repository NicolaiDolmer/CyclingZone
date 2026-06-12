// #1307: holdudtagelses-flow — vælg 6, sæt kaptajn, gem.
//
// Testen mocker:
//   - Supabase REST-laget (races + race_results) så RaceDetailPage loader et
//     "scheduled" løb og renderer RaceSelectionPanel.
//   - GET /api/races/:id/selection så panelet henter rytterliste + størrelsesgrænser.
//   - PUT /api/races/:id/selection — fanger request-body og asserterer 6 rider_ids
//     + captain_id.
//
// Mønster følger race-detail.spec.js: stabilizePage → installNetworkMocks →
// spec-specifikke overrides (LIFO, senest registrerede matcher først) → login → goto.
import { test, expect } from "@playwright/test";
import {
  installNetworkMocks,
  login,
  stabilizePage,
  json,
  corsHeaders,
} from "./fixtures.js";

const RACE_ID = "00000000-0000-4000-8000-000000001307";

const SCHEDULED_RACE = {
  id: RACE_ID,
  name: "E2E Classic",
  race_type: "single",
  race_class: "ProSeries",
  stages: 1,
  edition_year: 2026,
  status: "scheduled",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
};

// 9 ryttere — rider-8 (index 8) er skadet.
const SELECTION_RIDERS = Array.from({ length: 9 }, (_, i) => ({
  id: `sel-r${i}`,
  name: `Rider ${i}`,
  suitability: 70 - i,
  form: 55,
  fatigue: 10,
  injured: i === 8,
}));

test("manager kan udtage hold og gemme", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  // Override races-tabellen så RaceDetailPage finder SCHEDULED_RACE.
  // Følger race-detail.spec.js: registreres efter installNetworkMocks → vinder (LIFO).
  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes(
      "vnd.pgrst.object"
    );
    return json(route, wantsObject ? SCHEDULED_RACE : [SCHEDULED_RACE]);
  });

  // race_results er tom — det er et scheduleret løb, ingen resultater endnu.
  await page.route("**/rest/v1/race_results**", (route) =>
    json(route, [])
  );

  // Stash PUT-body så vi kan assertere payload efter klikket.
  let capturedBody = null;

  // Override GET + PUT på selection-endpointet.
  // Registreres EFTER installNetworkMocks → matcher FØR fixtures' generiske **/api/** handler.
  await page.route(`**/api/races/${RACE_ID}/selection`, async (route) => {
    const request = route.request();

    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }

    if (request.method() === "PUT") {
      try {
        capturedBody = JSON.parse(request.postData() || "{}");
      } catch {
        capturedBody = {};
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders(request),
        body: JSON.stringify({ ok: true }),
      });
    }

    // GET
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify({
        enabled: true,
        race: SCHEDULED_RACE,
        size: { min: 6, max: 8 },
        selection: null,
        riders: SELECTION_RIDERS,
        availableCount: 8,
      }),
    });
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  // Panelet loader og er synligt.
  const panel = page.getByTestId("race-selection-panel");
  await expect(panel).toBeVisible();

  // Skadet rytter (index 8) skal være disabled fra starten.
  await expect(panel.getByRole("checkbox").nth(8)).toBeDisabled();

  // Vælg 6 ryttere (index 0-5).
  for (let i = 0; i < 6; i++) {
    await panel.getByRole("checkbox").nth(i).check();
  }

  // Tæller viser "6/8 udtaget" (DA-locale — stabilizePage sætter cz_lang=da).
  await expect(panel.getByText(/6\/8/)).toBeVisible();

  // Sæt kaptajn — første combobox er kaptajn-select, vælg index 1 (første rytteroption).
  await panel.getByRole("combobox").first().selectOption({ index: 1 });

  // Gem-knappen skal nu være aktiveret (6 ryttere ≥ min=6 + kaptajn sat).
  // Tekst er "Gem udtagelse" i DA-locale.
  const saveBtn = panel.getByRole("button", { name: /gem udtagelse/i });
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();

  // Succesbesked vises: "Udtagelsen er gemt." i DA-locale.
  await expect(panel.getByText(/udtagelsen er gemt/i)).toBeVisible();

  // Assertér PUT-body: 6 rider_ids + captain_id sat.
  expect(capturedBody).not.toBeNull();
  expect(Array.isArray(capturedBody.rider_ids)).toBe(true);
  expect(capturedBody.rider_ids).toHaveLength(6);
  expect(capturedBody.captain_id).not.toBeNull();
  expect(capturedBody.captain_id).not.toBe("");
  // Captain skal være én af de valgte ryttere.
  expect(capturedBody.rider_ids).toContain(capturedBody.captain_id);
});
