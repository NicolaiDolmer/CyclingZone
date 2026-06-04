import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json } from "./fixtures.js";

// Race Engine V1 (#676) — renderer-regression for physiology/abilities-preview på
// rytter-profilen (/riders/:id, fanen "Evner"). Mocker fundamentet for rider-1 (Ada,
// fra fixturen) og verificerer beta-badge, effektprofil-tal og udledte evner.

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
  climbing: 78, time_trial: 66, sprint: 81, punch: 72, endurance: 70,
  cobble_classics: 58, acceleration: 84, recovery: 67, tactics: 71, positioning: 73,
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

  // Stats-fanen er default → preview-sektionen vises direkte.
  await expect(page.getByRole("heading", { name: "Cycling Zones" })).toBeVisible();
  await expect(page.getByText("Beta", { exact: true })).toBeVisible();
  await expect(page.getByText("Effektprofil")).toBeVisible();
  await expect(page.getByText("Udledte evner")).toBeVisible();

  // Physiology-tal + en udledt evne renderer.
  await expect(page.getByText("5.42")).toBeVisible();   // FTP W/kg
  await expect(page.getByText("Klatring")).toBeVisible(); // climbing-label (DA)

  await page.getByRole("heading", { name: "Cycling Zones" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "C:/Users/Nicolai/AppData/Local/Temp/race-preview.png", fullPage: true });
});
