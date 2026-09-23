// #5485 — træningssiden: overblik øverst, faner Today / Week plan /
// Development / Report, ingen scroll til dagens handling (ejer-go 23/9).
//
// Guarden holder på det designet LOVER, ikke på pixels:
//   1) Dagens vigtigste handling (guld-knappen + overblikket) står på første
//      skærm uden scroll på desktop 1440 × 900, mobil 390 × 844 og en telefon
//      på langs 844 × 390.
//   2) Mobil viser mindst 8 ryttere på første skærm (over bundnavigationen).
//   3) A2: guld-knappen skifter med situationen — "Set days for N riders" når
//      ryttere mangler en dag, ellers "Run today's training now"/"Train today",
//      og når dagen er kørt: ingen knap, kun statuslinjen.
//   4) A3: rytternavnet folder rytterens kort ud LIGE under rækken, også på
//      desktop, og profil-linket ligger inde i kortet.
//   5) Et tryk på en overbliks-celle filtrerer tabellen, og markeringen følger
//      det tabellen viser.
//   6) Week plan: "Plan for" vælger holdet eller én rytters egen plan.
//
// Testene sætter selv viewport, så alle tre Playwright-projekter kører de samme
// assertions.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, RIDERS, evidenceShotPath } from "./fixtures.js";
import type { Page } from "@playwright/test";

const TYPES = ["sprinter", "climber", "rouleur", "puncheur", "tt", "gc"];
const SESSIONS = ["sprint", "threshold", "endurance", "vo2max", "tempo", "technique"];
const FIRST = ["Mathias", "Tom", "Luca", "Rafael", "Viktor", "Antoine", "Søren", "Jonas", "Emil", "Nikolaj", "Oskar", "Pieter", "Anton"];
const LAST = ["Sørensen", "Van Aerde", "Colombo", "Duran", "Lindqvist", "Fabre", "Mikkelsen", "Halvorsen", "Bakker", "Riis", "Lindvik", "Draaijer", "Sørlie"];

const base = RIDERS.find((r: { id: string }) => r.id === "rider-1");
const SQUAD = [
  base,
  ...FIRST.map((firstname, i) => ({
    ...base,
    id: `rider-5485-${i}`,
    firstname,
    lastname: LAST[i],
    team_id: TEST_TEAM.id,
    primary_type: TYPES[i % TYPES.length],
    secondary_type: TYPES[(i + 2) % TYPES.length],
    is_academy: false,
  })),
];

// Tre ryttere uden en dag (overblikkets "Needs a day"), to trætte (fra
// skaderegelens grænse og op) og resten med en session.
const NO_DAY = new Set(["rider-5485-3", "rider-5485-7", "rider-5485-10"]);
const TIRED = new Set(["rider-5485-5", "rider-5485-11"]);

function trainingMe({ allSet = false, trained = false }: { allSet?: boolean; trained?: boolean } = {}) {
  const plans: Record<string, { focus: string; intensity: string }> = {};
  const condition: Record<string, { form: number; fatigue: number; injured_until: null; risk: number }> = {};
  const progress: Record<string, Record<string, number>> = {};
  for (const [i, rider] of SQUAD.entries()) {
    if (allSet || !NO_DAY.has(rider.id)) {
      plans[rider.id] = { focus: SESSIONS[i % SESSIONS.length], intensity: ["normal", "hard", "easy"][i % 3] };
    }
    condition[rider.id] = {
      form: 50 + ((i * 7) % 35),
      fatigue: TIRED.has(rider.id) ? 74 + i : 15 + ((i * 11) % 40),
      injured_until: null,
      risk: 0,
    };
    progress[rider.id] = { sprint: 0.64, flat: 0.2, threshold: 0.41, endurance: 0.55, tempo: 0.3, vo2max: 0.47 };
  }
  return {
    enabled: true,
    betaTester: true,
    mobileTable: true,
    teamId: TEST_TEAM.id,
    slots: { total: null, used: SQUAD.length, remaining: null },
    focuses: SESSIONS,
    intensities: ["easy", "normal", "hard", "rest"],
    plans,
    condition,
    progress,
    capped: {},
    trainability: {},
    smartDefaultFocus: { "rider-5485-3": "tempo" },
    weekPlan: null,
    riderWeekPlans: {},
    racingToday: {},
    todayRun: trained
      ? { tick_date: "2026-09-23", created_at: "2026-09-23T18:00:00Z", executed_by: "you", bonus_applied: false, report: { riders: [] } }
      : null,
  };
}

async function mockSquad(page: Page, me: ReturnType<typeof trainingMe>) {
  await page.route("**/rest/v1/riders**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, SQUAD);
  });
  await page.route("**/api/training/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, me);
  });
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
});

const primary = (page: Page) => page.getByTestId("training-primary");
const overview = (page: Page) => page.getByTestId("training-overview");

// Er elementet helt inde i det synlige vindue — uden at siden er rullet?
async function fullyInViewport(page: Page, locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  const size = page.viewportSize();
  if (!box || !size) return false;
  return box.y >= 0 && box.x >= 0 && box.y + box.height <= size.height && box.x + box.width <= size.width;
}

async function openTraining(page: Page, width: number, height: number, me = trainingMe()) {
  await mockSquad(page, me);
  await login(page);
  // Copy'en er EN-first, så beviset tages på engelsk (samme greb som #3709's
  // EN-bevis): login-helperen kræver de danske placeholders, og stabilizePage
  // sætter cz_lang=da ved hver navigation, så sproget flyttes EFTER login.
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  await page.setViewportSize({ width, height });
  await page.goto("/training");
  await overview(page).or(page.getByRole("group", { name: /Today at a glance|Dagen på et blik/ })).first().waitFor();
}

test("desktop 1440 × 900: guld-knap og overblik på første skærm, faner, kort under rækken", async ({ page }) => {
  await openTraining(page, 1440, 900);
  await expect(page.getByTestId("training-today-table")).toBeVisible();

  await expect(primary(page)).toHaveText(/Set days for 3 riders|Sæt dag for 3 ryttere/);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await fullyInViewport(page, primary(page))).toBe(true);
  expect(await fullyInViewport(page, overview(page))).toBe(true);

  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveText([/^(Today|I dag)/, /Week plan|Ugeplan/, /Development|Udvikling/, /Report|Rapport/]);

  // Markeringskolonnen hedder Select (aendring 5).
  await expect(page.getByRole("columnheader").first()).toContainText(/Select|Vælg/);

  // A3: navnet folder kortet ud lige under rækken; profil-linket er inde i kortet.
  const firstRow = page.getByTestId("training-today-row").first();
  await firstRow.getByRole("button", { expanded: false }).click();
  const detail = page.getByTestId("training-rider-detail");
  await expect(detail).toBeVisible();
  const nextIsDetail = await firstRow.evaluate((row) => row.nextElementSibling?.getAttribute("data-testid"));
  expect(nextIsDetail).toBe("training-rider-detail");
  await expect(detail.getByRole("link", { name: /Rider profile|Rytterprofil/ })).toBeVisible();

  await page.screenshot({ path: evidenceShotPath("pr-screens/5485-training-1440-today.png") });
});

test("guld-knappen 'Set days' filtrerer til rytterne uden dag og markerer dem", async ({ page }) => {
  await openTraining(page, 1440, 900);
  await primary(page).click();
  await expect(page.getByTestId("training-today-row")).toHaveCount(NO_DAY.size);
  await expect(page.getByText(new RegExp(`^${NO_DAY.size} (selected|valgt)$`))).toBeVisible();

  // Et tryk på "Tired" filtrerer til de trætte (skaderegelens grænse, #5418).
  await overview(page).getByRole("button", { name: /Tired|Trætte/ }).click();
  await expect(page.getByTestId("training-today-row")).toHaveCount(TIRED.size);
  // Ingen af de trætte mangler en dag, så markeringen er tom nu: en rytter der
  // forsvinder fra tabellen, må ikke blive stående som valgt til mængde-
  // handlingen i værktøjslinjen.
  await expect(page.getByText(/^\d+ (selected|valgt)$/)).toHaveCount(0);
});

test("Select all gælder kun de ryttere tabellen viser, ikke dem filtret skjuler", async ({ page }) => {
  await openTraining(page, 1440, 900);
  await overview(page).getByRole("button", { name: /Tired|Trætte/ }).click();
  await expect(page.getByTestId("training-today-row")).toHaveCount(TIRED.size);

  await page.getByRole("checkbox", { name: /^(Select all|Vælg alle)$/ }).check();
  await expect(page.getByText(new RegExp(`^${TIRED.size} (selected|valgt)$`))).toBeVisible();

  // Tilbage til alle: markeringen er stadig kun de to trætte.
  await overview(page).getByRole("button", { name: /Tired|Trætte/ }).click();
  await expect(page.getByTestId("training-today-row")).toHaveCount(SQUAD.length);
  await expect(page.getByText(new RegExp(`^${TIRED.size} (selected|valgt)$`))).toBeVisible();
});

test("A2: alle har en dag → knappen kører dagen; dagen kørt → ingen knap, kun status", async ({ page }) => {
  await openTraining(page, 1440, 900, trainingMe({ allSet: true }));
  await expect(primary(page)).toHaveText(/Train today|Run today's training now|Træn i dag|Kør dagens træning nu/);
  await expect(primary(page)).toBeEnabled();

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockSquad(page, trainingMe({ allSet: true, trained: true }));
  await page.reload();
  await overview(page).waitFor();
  await expect(primary(page)).toHaveCount(0);
  await expect(overview(page)).toContainText(/Trained today|Trænet i dag/);
});

test("mobil 390 × 844: guld-knap + overblik uden scroll og mindst 8 ryttere på første skærm", async ({ page }) => {
  await openTraining(page, 390, 844);
  const roster = page.getByTestId("training-mobile-roster");
  await roster.waitFor();

  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await fullyInViewport(page, primary(page))).toBe(true);
  expect(await fullyInViewport(page, overview(page))).toBe(true);

  const bottom = await page.evaluate(() => {
    const nav = document.querySelector("[data-mobile-quick-nav]");
    return window.innerHeight - (nav ? nav.getBoundingClientRect().height : 0);
  });
  const rows = roster.locator("tbody tr").filter({ has: page.locator("button[aria-expanded]") });
  const bottoms = await rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().bottom));
  const visible = bottoms.filter((b) => b <= bottom).length;
  expect(visible).toBeGreaterThanOrEqual(8);

  // Mens guld-knappen beder om dage, kan dagen stadig køres fra telefonen:
  // "Run now" står i samme række som guld-knappen (telefonens overblik har
  // ingen statuscelle), og den kalder den samme kørsel.
  const runNow = page.getByRole("button", { name: /^(Run now|Kør nu)$/ });
  await expect(runNow).toBeEnabled();
  expect(await fullyInViewport(page, runNow)).toBe(true);

  await page.screenshot({ path: evidenceShotPath("pr-screens/5485-training-390-today.png") });

  let ran = false;
  await page.route("**/api/training/run-today", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    ran = true;
    return json(route, { ok: true, tickDate: "2026-09-23", report: { riders: [] } });
  });
  await runNow.click();
  await expect.poll(() => ran).toBe(true);
});

test("landscape 844 × 390: telefonens layout, guld-knap og overblik uden scroll", async ({ page }) => {
  await openTraining(page, 844, 390);
  await expect(page.getByTestId("training-mobile-roster")).toBeVisible();
  await expect(page.getByTestId("training-today-table")).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await fullyInViewport(page, primary(page))).toBe(true);
  const chips = page.getByRole("group", { name: /Today at a glance|Dagen på et blik/ });
  expect(await fullyInViewport(page, chips)).toBe(true);
  // Chips-overblikket har heller ingen statuscelle: "Run now" står ved guld-knappen.
  const runNow = page.getByRole("button", { name: /^(Run now|Kør nu)$/ });
  await expect(runNow).toBeEnabled();
  expect(await fullyInViewport(page, runNow)).toBe(true);
});

test("Week plan: Plan for vælger holdet eller én rytters egen plan", async ({ page }) => {
  await openTraining(page, 1440, 900);
  await page.getByRole("tab", { name: /Week plan|Ugeplan/ }).click();
  const plan = page.getByTestId("training-week-plan");
  await expect(plan).toBeVisible();
  await expect(plan.getByTestId("training-week-plan-row")).toHaveCount(7);
  const planFor = plan.getByRole("combobox", { name: /Plan for/ });
  await expect(planFor).toHaveValue("team");
  await planFor.selectOption("rider-5485-2");
  await expect(plan).toContainText("Luca Colombo");

  // Et gammelt ?tab=history-link lander på Report.
  await page.goto("/training?tab=history");
  await expect(page.getByRole("tab", { name: /Report|Rapport/ })).toHaveAttribute("aria-selected", "true");
});
