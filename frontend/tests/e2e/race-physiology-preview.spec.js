import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json } from "./fixtures.js";

// Race Engine (#676) — renderer-regression for evner + power-profil på rytter-profilen
// (/riders/:id). #1529: de udledte CZ-evner er den PRIMÆRE stat-visning (var PCM-stats),
// og power-profilen er en ren sektion uden "beta"-mærke. #2000-redesignet flyttede
// profilen til faner: evnerne bor nu på Overblik (default), og fysiologien/effektprofilen
// bor på Fysiologi-fanen. Mocker fundamentet for rider-1 og verificerer evne-label på
// Overblik + watt-profil/FTP på Fysiologi + at beta er væk.

const PHYS = {
  rider_id: "rider-1",
  ftp_wkg: 5.42, ftp_watts: 379, vo2max_power_wkg: 6.10, zone2_power_wkg: 3.80,
  pmax_watts: 1180, power_5s_wkg: 18.50, power_15s_wkg: 13.20, power_1m_wkg: 9.40, power_5m_wkg: 6.20,
  high_intensity_energy_kj: 22.5, time_to_exhaustion_ftp_min: 52,
  fatigue_resistance: 0.720, recovery_rate: 0.680,
  height_cm: 178, weight_kg: 70, source: "seeded_from_legacy", version: 1,
};
const ABIL = {
  rider_id: "rider-1", formula_version: 1,
  climbing: 78, time_trial: 66, flat: 64, tempo: 60, sprint: 81, acceleration: 84,
  punch: 72, endurance: 70, recovery: 67, durability: 69, descending: 62,
  cobblestone: 58, positioning: 73, aggression: 55, tactics: 71,
};

function objectRoute(data) {
  return (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? data : [data]);
  };
}

test("rider profile shows race-engine physiology + abilities preview", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  // Fundament-tabellerne (registreres efter installNetworkMocks → tager præcedens).
  await page.route("**/rest/v1/rider_physiology_profiles**", objectRoute(PHYS));
  await page.route("**/rest/v1/rider_derived_abilities**", objectRoute(ABIL));

  await login(page);
  await page.goto("/riders/rider-1");

  // Overblik-fanen er default (#2000). #1529: de udledte evner er den PRIMÆRE visning
  // i evne-kolonnerne — climbing-evne-labellen bevises her.
  await expect(page.getByText("Klatring")).toBeVisible(); // climbing-evne-label (DA), primær visning

  // Effektprofilen bor nu på Fysiologi-fanen (#2000). Skift dertil og bevis
  // watt-profil-sektionen (de-beta'et) + FTP W/kg. FTP W/kg formateres med 1 decimal
  // i redesignet (fmtWkg → toFixed(1)), så 5.42 renders som "5.4".
  await page.getByRole("tab", { name: "Fysiologi" }).click();
  await expect(page.getByText("Watt-profil")).toBeVisible(); // power-profil-sektion (de-beta'et)
  await expect(page.getByText(/5\.4 W\/kg/)).toBeVisible();   // FTP W/kg (headline-sub)

  // "beta"-mærket + "Udledte evner"-underoverskrift er fjernet (#1529) — også efter
  // #2000-redesignet, hvor den gamle "Cycling Zones"-panel-copy udgik helt.
  await expect(page.getByText("Beta", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Udledte evner")).toHaveCount(0);

  await page.getByText("Watt-profil").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "C:/Users/Nicolai/AppData/Local/Temp/race-preview.png", fullPage: true });
});
