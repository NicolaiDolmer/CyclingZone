// #1140 Pakke A: "Your first race"-kortet oeverst paa dashboardet for et nyt hold,
// bag flaget first_race_card (ejer-go 12/10, mockup before-after-1140.png).
//
// Netvaerket er mocket (som resten af e2e-suiten), saa serverens afgoerelse
// (flag, beta/preview, resultat-gate) staar i en route-mock; selve gaten er
// unit-testet i backend/lib/firstRaceCardFlag.test.js. Det der bevises HER er
// det kortet LOVER paa skaermen:
//   1) Flag slukket: dashboardet er uaendret ("Pick your race squad" med guld,
//      intet nyt kort).
//   2) Flag taendt: kortet staar oeverst med loebsnavn, starttid i spillerens
//      tidszone, tre linjer og den ENE guld-knap; "Pick your race squad" er
//      skjult; "Next move" er uroert; "Get started" staar nedenunder, nedtonet.
//   3) ?preview=first-race sendes videre til serveren, og kun et svar med
//      visible:true giver et kort.
//   4) Saertilfaelde: loeb allerede startet (ingen guld-knap), saesonpause
//      (ingen guld-knap), assistent-/mail-saetninger udelades naar de ikke er
//      sande, og dansk.
//
// Testene saetter selv viewport, saa alle tre Playwright-projekter koerer de
// samme assertions.
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import {
  installNetworkMocks,
  stabilizePage,
  login,
  json,
  corsHeaders,
  evidenceShotPath,
  waitForStableSnapshotTarget,
} from "./fixtures.js";

type CardPayload = {
  visible: boolean;
  preview?: boolean;
  assistant_picks?: boolean;
  mail?: boolean;
  next_season_start?: string | null;
};

const CARD_ON: CardPayload = { visible: true, preview: false, assistant_picks: true, mail: true, next_season_start: null };
const CARD_OFF: CardPayload = { visible: false, preview: false };

const HOUR = 3600 * 1000;

const RACE = {
  id: "race-1140-next",
  name: "Tour de Preview",
  race_type: "stage_race",
  race_class: "Class1",
  stages: 4,
  status: "scheduled",
  stages_completed: 0,
  season_id: "season-e2e",
  pool_race: { date_text: "5/7" },
};
const RACE_STARTED = { ...RACE, stages_completed: 1 };

const SIZES = [
  { label: "desktop 1440 x 900", slug: "1440", width: 1440, height: 900 },
  { label: "mobil 390 x 844", slug: "390", width: 390, height: 844 },
];

const GOLD = /\bbg-cz-accent\b/;

async function mockCard(page: Page, payload: CardPayload | ((url: URL) => CardPayload)) {
  await page.route("**/api/me/first-race-card**", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    const body = typeof payload === "function" ? payload(new URL(request.url())) : payload;
    return json(route, body);
  });
}

// Et nyt hold har intet finaliseret resultat: samme kilde som MyLatestResultCard (race: null).
async function mockNoResult(page: Page) {
  await page.route("**/api/dashboard/my-latest-result**", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, { race: null });
  });
}

// ...og er midt i onboarding (1 af 4 trin), som i mockuppen: "Get started" er synligt.
async function mockOnboardingOpen(page: Page) {
  await page.route("**/api/me/onboarding-progress", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, {
      completed_count: 1,
      total_count: 4,
      dismissed: false,
      established: false,
      steps: [
        { key: "first_bid_placed", done: true },
        { key: "first_training_run", done: false },
        { key: "first_squad_selected", done: false },
        { key: "board_plan_set", done: false },
      ],
    });
  });
}

async function mockRaces(page: Page, rows: unknown[]) {
  await page.route("**/rest/v1/races?**", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    return json(route, rows);
  });
}

async function mockSchedule(page: Page, rows: { race_id: string; stage_number: number; scheduled_at: string }[]) {
  await page.route("**/rest/v1/race_stage_schedule**", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    return json(route, rows);
  });
}

async function mockEntries(page: Page, raceIds: string[]) {
  await page.route("**/rest/v1/race_entries**", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    return json(route, raceIds.map((race_id) => ({ race_id })));
  });
}

async function openDashboard(
  page: Page,
  { width, height, lang = "en", path = "/dashboard" }: { width: number; height: number; lang?: "en" | "da"; path?: string },
) {
  await login(page);
  // login-helperen kraever danske placeholders, og stabilizePage saetter
  // cz_lang=da ved hver navigation, saa sproget flyttes EFTER login (samme greb som #5485).
  await page.addInitScript((value) => window.localStorage.setItem("cz_lang", value), lang);
  await page.setViewportSize({ width, height });
  const answered = page.waitForResponse((res) => res.url().includes("/api/me/first-race-card"));
  await page.goto(path);
  await answered;
  await expect(page.getByRole("heading", { name: "E2E Racing" })).toBeVisible();
  await waitForStableSnapshotTarget(page);
}

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
  await mockNoResult(page);
  await mockOnboardingOpen(page);
});

for (const size of SIZES) {
  test(`${size.label}: flag slukket, dashboardet er uaendret`, async ({ page }) => {
    await mockCard(page, CARD_OFF);
    await mockRaces(page, [RACE]);
    await mockSchedule(page, [{ race_id: RACE.id, stage_number: 1, scheduled_at: new Date(Date.now() + 17 * HOUR).toISOString() }]);
    await openDashboard(page, size);

    await expect(page.getByTestId("first-race-card")).toHaveCount(0);
    const squad = page.getByTestId("team-selection-cta");
    await expect(squad).toBeVisible();
    await expect(squad.getByRole("link")).toHaveClass(GOLD);

    await page.screenshot({ path: evidenceShotPath(`pr-screens/1140/before-${size.slug}.png`) });
  });

  test(`${size.label}: flag taendt, kortet staar oeverst med den ene guld-knap`, async ({ page }) => {
    await mockCard(page, CARD_ON);
    await mockRaces(page, [RACE]);
    await mockSchedule(page, [{ race_id: RACE.id, stage_number: 1, scheduled_at: new Date(Date.now() + 17 * HOUR).toISOString() }]);
    await openDashboard(page, size);

    const card = page.getByTestId("first-race-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Your first race");
    await expect(card).toContainText("Tour de Preview starts");
    await expect(page.getByTestId("first-race-meta")).toContainText(/in \d+ hours?/i);
    await expect(page.getByTestId("first-race-meta")).toContainText("4 stages");
    await expect(page.getByTestId("first-race-meta")).toContainText("Division 2");

    // Tre linjer: Now (med assistent), etape 1, resultat (med mail).
    const timeline = page.getByTestId("first-race-timeline");
    await expect(timeline.getByRole("listitem")).toHaveCount(3);
    await expect(timeline).toContainText("If you skip it, your assistant picks for you.");
    await expect(timeline).toContainText("Stage 1 is raced.");
    await expect(timeline).toContainText("Your result is here, and it is emailed to you.");

    // Eneste guld-knap + "Pick your race squad" skjult + "Next move" uroert.
    const cta = page.getByTestId("first-race-cta");
    await expect(cta).toHaveClass(GOLD);
    await expect(cta).toHaveAttribute("href", /\/races\/race-1140-next#selection$/);
    await expect(page.getByTestId("team-selection-cta")).toHaveCount(0);
    await expect(page.getByText("Pick your race squad")).toHaveCount(0);
    await expect(page.getByText("Next move")).toBeVisible();

    // Kortet staar over "Get started", som er nedtonet.
    const started = page.getByText(/Get started/).first();
    await expect(started).toBeVisible();
    const cardBox = await card.boundingBox();
    const startedBox = await started.boundingBox();
    expect(cardBox && startedBox).toBeTruthy();
    expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(startedBox!.y);
    const dimmed = await started.evaluate((el) => {
      for (let node: HTMLElement | null = el as HTMLElement; node; node = node.parentElement) {
        if (getComputedStyle(node).opacity !== "1") return true;
      }
      return false;
    });
    expect(dimmed).toBe(true);

    await page.screenshot({ path: evidenceShotPath(`pr-screens/1140/after-${size.slug}.png`) });
  });
}

test("assistent- og mail-saetningerne udelades naar de ikke er sande", async ({ page }) => {
  await mockCard(page, { ...CARD_ON, assistant_picks: false, mail: false });
  await mockRaces(page, [RACE]);
  await mockSchedule(page, [{ race_id: RACE.id, stage_number: 1, scheduled_at: new Date(Date.now() + 5 * HOUR).toISOString() }]);
  await openDashboard(page, { width: 1440, height: 900 });

  const timeline = page.getByTestId("first-race-timeline");
  await expect(timeline).toContainText("Pick your riders and captain.");
  await expect(timeline).not.toContainText("assistant");
  await expect(timeline).toContainText("Your result is here.");
  await expect(timeline).not.toContainText("emailed");
});

const PREVIEW_SERVER = (url: URL): CardPayload =>
  (url.searchParams.get("preview") === "first-race" ? { ...CARD_ON, preview: true } : CARD_OFF);

async function seedUpcomingRace(page: Page) {
  await mockRaces(page, [RACE]);
  await mockSchedule(page, [{ race_id: RACE.id, stage_number: 1, scheduled_at: new Date(Date.now() + 17 * HOUR).toISOString() }]);
}

// Serveren giver KUN et kort naar preview er bedt om (som for en beta-tester med flag off).
test("?preview=first-race sendes til serveren og giver kortet", async ({ page }) => {
  await mockCard(page, PREVIEW_SERVER);
  await seedUpcomingRace(page);
  await openDashboard(page, { width: 1440, height: 900, path: "/dashboard?preview=first-race" });
  await expect(page.getByTestId("first-race-card")).toBeVisible();
  await expect(page.getByTestId("team-selection-cta")).toHaveCount(0);
});

test("uden ?preview=first-race giver samme server intet kort", async ({ page }) => {
  await mockCard(page, PREVIEW_SERVER);
  await seedUpcomingRace(page);
  await openDashboard(page, { width: 1440, height: 900, path: "/dashboard" });
  await expect(page.getByTestId("first-race-card")).toHaveCount(0);
  await expect(page.getByTestId("team-selection-cta")).toBeVisible();
});

test("en ukendt preview-vaerdi sendes slet ikke videre til serveren", async ({ page }) => {
  const seen: string[] = [];
  await page.route("**/api/me/first-race-card**", (route: Route) => {
    seen.push(route.request().url());
    return json(route, CARD_OFF);
  });
  await seedUpcomingRace(page);
  await openDashboard(page, { width: 1440, height: 900, path: "/dashboard?preview=other" });
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((u) => !u.includes("preview="))).toBe(true);
});

test("saertilfaelde: loebet er allerede startet viser naeste etape og tidspunkt, uden guld-knap", async ({ page }) => {
  await mockCard(page, CARD_ON);
  await mockRaces(page, [RACE_STARTED]);
  await mockEntries(page, [RACE_STARTED.id]);
  await mockSchedule(page, [{ race_id: RACE_STARTED.id, stage_number: 2, scheduled_at: new Date(Date.now() + 3 * HOUR).toISOString() }]);
  await openDashboard(page, { width: 1440, height: 900 });

  const card = page.getByTestId("first-race-card");
  await expect(card).toContainText("Tour de Preview is under way");
  await expect(page.getByTestId("first-race-timeline")).toContainText("Stage 2 is raced.");
  await expect(page.getByTestId("first-race-cta")).toHaveCount(0);
  await expect(card.getByRole("link", { name: "View the race" })).not.toHaveClass(GOLD);

  await page.screenshot({ path: evidenceShotPath("pr-screens/1140/after-1440-started.png") });
});

test("saertilfaelde: saesonpause siger hvornaar naeste saeson starter, uden guld-knap", async ({ page }) => {
  await mockCard(page, { ...CARD_ON, next_season_start: "2026-11-02" });
  await mockRaces(page, []);
  await mockSchedule(page, []);
  await openDashboard(page, { width: 1440, height: 900 });

  const card = page.getByTestId("first-race-card");
  await expect(card).toContainText("No race to pick right now");
  await expect(card).toContainText(/next season starts on/i);
  await expect(page.getByTestId("first-race-cta")).toHaveCount(0);
  await expect(card.getByRole("link", { name: "Open the race calendar" })).not.toHaveClass(GOLD);
  await expect(page.getByTestId("team-selection-cta")).toHaveCount(0);

  await page.screenshot({ path: evidenceShotPath("pr-screens/1140/after-1440-pause.png") });
});

test("dansk: kortet staar paa dansk med danske tider", async ({ page }) => {
  await mockCard(page, CARD_ON);
  await mockRaces(page, [RACE]);
  await mockSchedule(page, [{ race_id: RACE.id, stage_number: 1, scheduled_at: new Date(Date.now() + 17 * HOUR).toISOString() }]);
  await openDashboard(page, { width: 1440, height: 900, lang: "da" });

  const card = page.getByTestId("first-race-card");
  await expect(card).toContainText("Dit første løb");
  await expect(card).toContainText("Tour de Preview starter");
  await expect(page.getByTestId("first-race-meta")).toContainText(/om \d+ timer?/i);
  await expect(page.getByTestId("first-race-timeline")).toContainText("Springer du over, vælger din assistent for dig.");
  await expect(page.getByTestId("first-race-timeline")).toContainText("Dit resultat står her og sendes også på mail.");
});
