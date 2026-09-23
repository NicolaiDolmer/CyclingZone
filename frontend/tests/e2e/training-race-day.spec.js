import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, evidenceShotPath,
} from "./fixtures.js";

// #3459 V3 - løbsdags-badge på trænings-siden (ejer-godkendt mockup 7/8, bag
// race_day_development_enabled efter #4277/#4375). Flaget er OFF i prod for S3,
// så racingToday-feltet
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
  // #3643: denne spec maaler DESKTOP-rosterets indhold. Telefonen har siden
  // 18/9 sin egen visning (tabel med dagens loebsdage, mockup 2), og den er
  // daekket af 3643-training-mobile.spec.js. Viewporten saettes derfor
  // eksplicit, saa alle tre projekter bliver ved med at koere DENNE flade i
  // deres egen motor i stedet for at teste en flade der ikke findes laengere.
  await page.setViewportSize({ width: 1280, height: 900 });
  await installNetworkMocks(page);
});

// #5485 (A1): dagens celle viser dagtypen. En rytter der kører løb i dag står
// som "Løb" med løbets navn i tooltip'et, og overblikket tæller ham under
// "Kører løb i dag". Planen er urørt: dagsvælgeren er stadig aktiv og står
// på rytterens dag — løbet dæmper ikke og låser ikke planen.
const rowFor = (page) => page.getByTestId("training-today-row").filter({ hasText: "Ada Pedersen" });
// Dagens celle er den eneste celle i rækken der bærer et title-tooltip.
const dayCellFor = (page) => rowFor(page).locator("td span[title]");

test("#3459 racingToday sat: Løb i dagens celle, tooltip nævner løbet, planen er urørt", async ({ page }, testInfo) => {
  await mockTrainingMe(page, { racingToday: { "rider-1": { race: "Trofeo Ligure" } } });
  await login(page);
  await page.goto("/training");

  const row = rowFor(page);
  const raceCell = dayCellFor(page);
  await expect(raceCell).toHaveText("Løb");
  await expect(raceCell).toHaveAttribute("title", /Trofeo Ligure/);

  // Overblikket tæller rytteren under "Kører løb i dag" med løbets navn.
  const racing = page.getByTestId("training-overview").getByRole("button", { name: /Kører løb i dag/ });
  await expect(racing).toContainText("1");
  await expect(racing).toContainText("Trofeo Ligure");

  // Planen er urørt og kan stadig skiftes: rytterens dag er `endurance`.
  const daySelect = row.getByRole("combobox", { name: /Ada Pedersen/ });
  await expect(daySelect).toHaveValue("endurance");
  await expect(daySelect).toBeEnabled();

  // Ægte Playwright-screenshot til PR-body (#3459 — flag off i prod pt., derfor
  // mocket tilstand). Kun ét skud pr. viewport-klasse.
  const isMobile = testInfo.project.name.startsWith("mobile");
  await row.screenshot({ path: evidenceShotPath(`pr-screens/3459-race-day-training-${isMobile ? "mobile" : "desktop"}.png`) });
});

test("#3459 racingToday fraværende (samme kontrakt som flag off): ingen Løb, dagens session i cellen", async ({ page }) => {
  await mockTrainingMe(page); // ingen racingToday-nøgle overhovedet
  await login(page);
  await page.goto("/training");

  const row = rowFor(page);
  await expect(dayCellFor(page)).toHaveText("Lang");
  await expect(dayCellFor(page)).toHaveAttribute("title", "Lang tur");
  await expect(row.getByText("Løb", { exact: true })).toHaveCount(0);

  const daySelect = row.getByRole("combobox", { name: /Ada Pedersen/ });
  await expect(daySelect).toHaveValue("endurance");
  await expect(daySelect).toBeEnabled();
});
