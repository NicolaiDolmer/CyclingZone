import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, json, stabilizePage, corsHeaders, evidenceShotPath } from "./fixtures.js";

test("#5916: next season shows a provisional rate matching the current calendar", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const contract = { sponsor_name: "Fixture Sponsor", guaranteed_base: 772800, per_race_day_rate: 480,
    length_seasons: 1, start_season: 4, expires_after_season: 4, variant: "safe", bonus_clauses: [] };
  await page.route("**/api/sponsor/contract", route => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    return json(route, { contract, earnings: null, season: { number: 4, stagesTotal: 140, transactions: [] } });
  });
  await page.route("**/api/sponsor/offers", route => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    return json(route, { negotiable: true, upcomingSeasonNumber: 5, teamDivision: 1,
      stageCounts: { byTier: {}, fallbackDays: 60 }, offers: [{ variant: "safe", sponsorName: "Fixture Sponsor",
        guaranteedBase: 772800, guaranteedFraction: .92, raceDayShare: .08,
        perRaceDayRate: 1120, lengthSeasons: 1, clauses: [] }] });
  });
  await login(page);
  await page.goto("/sponsors?tab=next");
  await expect(page.getByText("480 CZ$", { exact: true })).toBeVisible();
  await expect(page.getByText(/Jeg bruger din nuværende kalender/)).toBeVisible();
  await expect(page.getByText("1 tilbud · division 1 · 140 etaper (estimat)", { exact: true })).toBeVisible();
  await expect(page.getByText("1.120 CZ$", { exact: true })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await page.getByRole("columnheader", {name:/Pr\. etape/}).scrollIntoViewIfNeeded();
  await page.screenshot({ path: evidenceShotPath("pr-screens/5916/after-" + testInfo.project.name + ".png"), fullPage: false });
});
