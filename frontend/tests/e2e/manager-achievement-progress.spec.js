import { test, expect } from "./e2e-base.js";
import { stabilizePage, installNetworkMocks, login, json, corsHeaders, TEST_USER, TEST_TEAM } from "./fixtures.js";

// #1008: progress mod næste mål på låste, tæller-baserede achievements (fx "40/50").
// Funktionel guard (ingen pixel-snapshot): bekræfter at backend-leveret progress-felt
// rendres via ProgressMeter + "current/target"-tal på Managerprofilens achievements-tab.

const MANAGER_PROFILE = {
  team: { id: TEST_TEAM.id, name: TEST_TEAM.name, division: TEST_TEAM.division },
  user: { id: TEST_USER.id, username: "Playwright Manager", is_online: false, last_seen: null },
  riders: [],
  season_history: [],
  achievements: [
    {
      id: "auction_first_win", title: "First win", description: "Win your first auction.",
      category: "auction", is_secret: false, unlocked: true,
      unlocked_at: "2026-06-01T00:00:00.000Z", progress: null,
    },
    {
      id: "auction_50_wins", title: "Auction veteran", description: "Win 50 auctions in total.",
      category: "auction", is_secret: false, unlocked: false,
      unlocked_at: null, progress: { current: 40, target: 50 },
    },
  ],
  transfer_activity: [],
};

test("locked achievement shows progress toward its next goal", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  // Override efter installNetworkMocks — senest registrerede route vinder i Playwright.
  await page.route(`**/api/managers/${TEST_TEAM.id}`, route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, MANAGER_PROFILE);
  });

  await login(page);
  // Lad login's dashboard-redirect settle helt før vi navigerer videre — ellers kan
  // webkit afbryde goto'en med den efterfølgende /dashboard-navigation.
  await page.waitForLoadState("networkidle");
  await page.goto(`/managers/${TEST_TEAM.id}`);
  await expect(page).toHaveURL(new RegExp(`/managers/${TEST_TEAM.id}$`));

  // Åbn achievements-tabben (DA-locale: "Achievements 1/2").
  //
  // #3200-afløseren 8/9: samme rettelse som i manager-profile.spec.js. Her stod
  // `scrollIntoViewIfNeeded()` + `click({ force: true })`, og den kombination
  // parkerer fanen i viewportens nederste kant — under den faste bundnavigation
  // på mobile-webkits lavere viewport — mens `force` springer netop
  // obstruktions-tjekket over. I søstermodulet endte klikket i bundbjælken og
  // navigerede væk fra siden. Denne test var ikke rød endnu, men den står på
  // samme fane på samme side og er samme fejlklasse.
  const achievementsTab = page.getByRole("tab", { name: /Achievements 1\/2/ });
  await achievementsTab.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await achievementsTab.click();

  // Progress-tal + progressbar på den låste achievement.
  await expect(page.getByText("40/50")).toBeVisible();
  const meter = page.getByRole("progressbar").first();
  await expect(meter).toBeVisible();
  await expect(meter).toHaveAttribute("aria-valuenow", "40");
  await expect(meter).toHaveAttribute("aria-valuemax", "50");
});
