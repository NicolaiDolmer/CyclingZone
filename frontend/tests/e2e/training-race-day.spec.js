import { test, expect } from "@playwright/test";
import {
  installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM,
} from "./fixtures.js";

// #3459 V3 — løbsdags-badge på trænings-siden (ejer-godkendt mockup 7/8, bag
// race_day_engine_enabled). Flag er OFF i prod (flip 23/8) — racingToday-feltet
// mockes direkte her (samme teknik som training-report.spec.js) fordi
// /api/training/me kun leverer feltet når flaget er on server-side; testen
// verificerer derfor den fulde UI-kontrakt uden at afhænge af live flag-state.
//
// TEST_TEAM's roster har kun ÉN egen rytter i seedData (rider-1, Ada Pedersen;
// rider-2 tilhører RIVAL_TEAM) — kontrasten "badge vs. ingen badge" testes derfor
// SAMME rytter i to scenarier: racingToday sat (racer i dag) vs. feltet fraværende
// (samme kontrakt som "flag off" — backend udelader feltet helt, se
// apiTrainingMeRaceDay.routes.test.js), ikke to forskellige ryttere.

const BASE_TRAINING_ME = {
  enabled: true,
  betaTester: true,
  teamId: TEST_TEAM.id,
  slots: { total: null, used: 1, remaining: null },
  focuses: ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"],
  intensities: ["easy", "normal", "hard", "rest"],
  plans: { "rider-1": { focus: "endurance", intensity: "hard" } },
  condition: { "rider-1": { form: 68, fatigue: 35, injured_until: null, risk: 0.02 } },
  progress: { "rider-1": { endurance: 0.4 } },
  todayRun: null,
  weekPlan: null,
  riderWeekPlans: {},
};

async function mockTrainingMe(page, overrides = {}) {
  await page.route("**/api/training/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, { ...BASE_TRAINING_ME, ...overrides });
  });
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
});

test("#3459 racingToday sat: badge + dæmpede men AKTIVE intensitets-knapper, tooltip nævner løbet", async ({ page }, testInfo) => {
  await mockTrainingMe(page, { racingToday: { "rider-1": { race: "Trofeo Ligure" } } });
  await login(page);
  await page.goto("/training");

  const row = page.locator("tbody tr", { hasText: "Ada Pedersen" }).first();

  // Badge (DA-locale via stabilizePage) ERSTATTER den normale rytme-linje.
  const badgeLine = row.getByText("Løbsdag");
  await expect(badgeLine).toBeVisible();
  await expect(badgeLine).toHaveAttribute("title", /Trofeo Ligure/);
  await expect(row.getByText(/^I dag:/)).toHaveCount(0);

  // Planen er urørt: intensitets-knapperne er stadig synlige og AKTIVE (ikke
  // disabled) — racedagen dæmper visuelt (opacity), den låser ikke.
  const intensityGroup = row.locator('[role="group"]');
  await expect(intensityGroup).toHaveClass(/opacity-\[0\.55\]/);
  const hardBtn = row.getByRole("button", { name: "Hård" });
  await expect(hardBtn).toBeVisible();
  await expect(hardBtn).toBeEnabled();
  await expect(hardBtn).toHaveAttribute("aria-pressed", "true");

  // Ægte Playwright-screenshot til PR-body (#3459 — flag off i prod pt., derfor
  // mocket tilstand). Kun ét skud pr. viewport-klasse, taget fra de faktiske
  // playwright-projekter (desktop-chromium / mobile-*), ikke en hardcodet path.
  // MobileQuickNav (fixed bottom-tab-bar, kun md:hidden) overlapper reelt denne
  // korte sides nederste ~56px uanset scroll-position (den er position:fixed på
  // selve viewporten, ikke chrome om indholdet) — skjules rent kosmetisk for
  // screenshot'et alene, så badge-linjen ikke ligger fysisk under nav-baren.
  await page.addStyleTag({ content: "nav.fixed.bottom-0 { display: none !important; }" });
  const isMobile = testInfo.project.name.startsWith("mobile");
  const screenshotPath = `../pr-screens/3459-race-day-training-${isMobile ? "mobile" : "desktop"}.png`;
  if (isMobile) {
    // #3194 T2 mobil-kontrakten: Intensitet-kolonnen scroller VANDRET under den
    // fastgjorte (sticky) navnekolonne (~194px, opak baggrund) — et skud af hele
    // rækken (som på desktop) ville enten vise den opake sticky-kolonne oven på
    // badge't, eller (locator.screenshot() på hele <tr>, bredere end scroll-
    // vinduet) hvid tomrum for alt uden for det aktuelt scrollede udsnit. Cellen
    // scrolles derfor en anelse forbi sticky-grænsen (kalibreret margin) og
    // skærmbilledet klippes til netop den celle.
    const intensityCell = badgeLine.locator("xpath=ancestor::td[1]");
    await badgeLine.scrollIntoViewIfNeeded();
    await intensityCell.evaluate((el) => {
      const scroller = el.closest(".overflow-x-auto");
      if (scroller) scroller.scrollLeft -= 95;
    });
    const cellBox = await intensityCell.boundingBox();
    const viewportSize = page.viewportSize();
    const clip = {
      x: Math.max(0, cellBox.x),
      y: Math.max(0, cellBox.y),
      width: Math.min(cellBox.width, viewportSize.width - Math.max(0, cellBox.x)),
      height: Math.min(cellBox.height, viewportSize.height - Math.max(0, cellBox.y)),
    };
    await page.screenshot({ path: screenshotPath, clip });
  } else {
    // Desktop viser alle kolonner uden vandret scroll — hele rækken (rytternavn
    // + fokus + intensitet + badge) i ét skud giver mere kontekst end en ren
    // celle-crop, og der er ingen sticky-occlusion at tage højde for.
    await row.screenshot({ path: screenshotPath });
  }
});

test("#3459 racingToday fraværende (samme kontrakt som flag off): ingen badge, normal knapvisning uændret", async ({ page }) => {
  await mockTrainingMe(page); // ingen racingToday-nøgle overhovedet
  await login(page);
  await page.goto("/training");

  const row = page.locator("tbody tr", { hasText: "Ada Pedersen" }).first();

  await expect(row.getByText("Løbsdag")).toHaveCount(0);

  const intensityGroup = row.locator('[role="group"]');
  await expect(intensityGroup).not.toHaveClass(/opacity-\[0\.55\]/);
  const hardBtn = row.getByRole("button", { name: "Hård" });
  await expect(hardBtn).toBeVisible();
  await expect(hardBtn).toBeEnabled();
});
