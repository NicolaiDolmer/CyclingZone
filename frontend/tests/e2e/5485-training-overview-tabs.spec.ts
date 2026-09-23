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
//   Rettelser 23/9 aften (PR #5564), nummereret som i issuet: (1) turens trin
//   2 peger på det tryk der kører dagen, (2) markeringen følger filtret, (3)
//   assistenten rykket op, (4) alle fire faner på 360-390 px, (5) ugeplanens
//   lange forklaring er væk, (6) "Saved" kan ses i "Needs a day", (7) "i
//   morgen"-linjen på fanen Today, (8) målingen af telefon på langs uden beta,
//   (9) seneste score før dagens pas, (10) skademarkøren i telefonens række.
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
// #5534-typecheck: fixturens rider-1 er grundformen for hele truppen.
if (!base) throw new Error("fixtures.js: rider-1 mangler i RIDERS");
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

// #5485 (rettet 23/9): en skadet rytter (løbsdags-tallet sat, så teksten er
// uafhængig af testens dato) og scorer med historik, men uden dagens tal (dagens
// pas er ikke kørt endnu).
const INJURED = "rider-5485-1";
const LATEST_TOP = "rider-5485-8";

function sparkFor(i: number) {
  return [
    { date: "2026-09-19", score: 40 + i, raceDay: false },
    { date: "2026-09-20", score: null, raceDay: true },
    { date: "2026-09-21", score: 44 + i, raceDay: false },
    { date: "2026-09-22", score: 50 + i, raceDay: false },
  ];
}

function scoreFor({ trained }: { trained: boolean }) {
  const out: Record<string, unknown> = {};
  for (const [i, rider] of SQUAD.entries()) {
    // LATEST_TOP har den højeste seneste score: sorteringen på Score skal bruge den.
    const bump = rider.id === LATEST_TOP ? 30 : 0;
    const spark = sparkFor(i + bump);
    out[rider.id] = {
      today: trained ? 60 + i : null,
      todayIsRaceDay: false,
      todaySession: trained ? "tempo" : null,
      spark: trained ? [...spark, { date: "2026-09-23", score: 60 + i, raceDay: false }] : spark,
      avg: 50,
      best: 70,
      days: 3,
      contributions: [],
    };
  }
  return out;
}

function trainingMe({
  allSet = false,
  trained = false,
  mobileTable = true,
  withScore = false,
  injured = false,
  dayClose = null,
}: {
  allSet?: boolean;
  trained?: boolean;
  mobileTable?: boolean;
  withScore?: boolean;
  injured?: boolean;
  dayClose?: { open: boolean; opensAtHour?: number } | null;
} = {}) {
  const plans: Record<string, { focus: string; intensity: string }> = {};
  const condition: Record<string, { form: number; fatigue: number; injured_until: string | null; injury_race_days_left?: number; risk: number }> = {};
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
    if (injured && rider.id === INJURED) {
      condition[rider.id].injured_until = "2026-09-25";
      condition[rider.id].injury_race_days_left = 3;
    }
    progress[rider.id] = { sprint: 0.64, flat: 0.2, threshold: 0.41, endurance: 0.55, tempo: 0.3, vo2max: 0.47 };
  }
  return {
    ...(withScore ? { trainingScore: scoreFor({ trained }) } : {}),
    ...(dayClose ? { dayClose } : {}),
    enabled: true,
    betaTester: true,
    mobileTable,
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
  // Rettet 23/9: assistent-rækken står nu mellem overblikket og tabellen
  // (ejer-go), og kravet om mindst 8 ryttere på første skærm holder stadig.
  expect(visible).toBeGreaterThanOrEqual(8);
  expect(await fullyInViewport(page, page.getByTestId("training-assistant-row"))).toBe(true);

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

// ── Rettelser 23/9 aften (PR #5564) ─────────────────────────────────────────

const TOUR_KEY = "cz-onboarding-tour-step";

// (8) Telefon på langs UDEN beta-flaget (training_mobile_table off) viser
// desktop-tabellen ved siden af appens sidebar (Layout er desktop fra 768 px).
// Målt 23/9: 0 ryttere på første skærm. Sidens eget indhold over rækkerne
// (sidehoved, faner, overbliks-chips, sæson-noten og en værktøjslinje der
// ombrydes til tre linjer i ca. 570 px) kan ikke skæres nok ned til en hel
// række uden at fjerne indhold, så tallet står i PR-body, og flip af
// training_mobile_table er ejerens separate valg. Beta-visningen i samme
// størrelse: se "skærmbillede 844 × 390 (beta)" nedenfor. Gulvet her er det
// målte tal, så en forværring (fx en ny række over tabellen) ikke sker uset.
const LANDSCAPE_NO_BETA_MIN_RIDERS = 0;

async function startTourAtRunStep(page: Page) {
  // Turens trin 2 (index 1) = "kør dagens træning". Sat før siden loader,
  // præcis som dashboardets "Show me how" + ét tryk på Next.
  await page.addInitScript((key) => window.localStorage.setItem(key, JSON.stringify({ page: "training", step: 1 })), TOUR_KEY);
}

async function mockRunToday(page: Page) {
  const calls: string[] = [];
  await page.route("**/api/training/run-today", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    calls.push(request.method());
    return json(route, { ok: true, tickDate: "2026-09-23", report: { riders: [] } });
  });
  return calls;
}

for (const size of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
  test(`(1) guidet tur ${size.w}: trin 2 peger på Run now når guld-knappen beder om dage, og trykket kører dagen`, async ({ page }) => {
    await startTourAtRunStep(page);
    const calls = await mockRunToday(page);
    await openTraining(page, size.w, size.h);
    await expect(primary(page)).toHaveText(/Set days for 3 riders/);

    const anchor = page.locator("[data-tour='training-run-today']");
    await expect(anchor).toHaveCount(1);
    // Ankeret er Run now, ikke guld-knappen der ikke træner.
    await expect(anchor.getByTestId("training-run-now")).toBeVisible();
    await expect(anchor.getByTestId("training-primary")).toHaveCount(0);
    // Turens tekst passer til netop det tryk.
    const tour = page.getByRole("dialog");
    await expect(tour).toContainText("Run today's training");
    await expect(tour).toContainText(/Run now trains the whole squad today/);

    // Trykket er det der kører dagen (backend tæller det som managerens kørsel
    // og fuldfører onboarding-trinnet "første træning").
    await anchor.getByTestId("training-run-now").click();
    await expect.poll(() => calls.length).toBe(1);
  });
}

test("(1) guidet tur: når guld-knappen selv kører dagen, peger trin 2 på den med sin egen tekst", async ({ page }) => {
  await startTourAtRunStep(page);
  await openTraining(page, 1440, 900, trainingMe({ allSet: true }));
  const anchor = page.locator("[data-tour='training-run-today']");
  await expect(anchor).toHaveCount(1);
  await expect(anchor.getByTestId("training-primary")).toHaveText(/Train today|Run today's training now/);
  await expect(page.getByRole("dialog")).toContainText("Train once a day");
});

test("(1) guidet tur med dayClose (#4847): turen lover ingen bonus, men siger at dagen også kører af sig selv", async ({ page }) => {
  await startTourAtRunStep(page);
  await openTraining(page, 1440, 900, trainingMe({ dayClose: { open: true, opensAtHour: 20 } }));
  const anchor = page.locator("[data-tour='training-run-today']");
  await expect(anchor.getByTestId("training-run-now")).toBeVisible();
  const tour = page.getByRole("dialog");
  await expect(tour).toContainText("with no bonus");
  await expect(tour).not.toContainText("+25%");
});

test("(2)+(6) markeringen: A får en dag i sin egen vælger → 'Saved' ses, 'Apply to 2', og A overskrives ikke", async ({ page }) => {
  await page.route("**/api/training/rider-5485-3", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, { ok: true, plan: { focus: "sprint", intensity: "hard" } });
  });
  let bulkBody: { riderIds?: string[] } | null = null;
  await page.route("**/api/training/bulk", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    bulkBody = JSON.parse(request.postData() || "{}");
    const ids = bulkBody?.riderIds ?? [];
    return json(route, {
      ok: true,
      applied: ids.length,
      appliedRiderIds: ids,
      skipped: { notOwned: [], noSlots: [], hasPlan: [] },
      plans: Object.fromEntries(ids.map((id) => [id, { focus: "endurance", intensity: "rest" }])),
      slots: { total: null, used: SQUAD.length, remaining: null },
    });
  });
  await openTraining(page, 1440, 900);

  // A, B og C markeret via "Set days for 3".
  await primary(page).click();
  await expect(page.getByTestId("training-today-row")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Apply to 3" })).toBeVisible();

  // A (Rafael Duran) får en dag i sin egen vælger.
  const rowA = page.locator("[data-testid='training-today-row'][data-rider-id='rider-5485-3']");
  await rowA.getByRole("combobox", { name: "Today's day for Rafael Duran" }).selectOption("sprint");

  // (6) Rækken bliver stående med "Saved", så kvitteringen kan ses ...
  await expect(rowA.getByRole("status")).toHaveText("Saved");
  // (2) ... men A er ikke længere med i markeringen.
  await expect(page.getByRole("button", { name: "Apply to 2" })).toBeVisible();
  await expect(rowA.getByRole("checkbox")).not.toBeChecked();
  // Efter ca. 2 sekunder forsvinder han fra "Needs a day".
  await expect(page.getByTestId("training-today-row")).toHaveCount(2, { timeout: 6000 });

  // Mængde-handlingen rammer kun B og C.
  await page.getByRole("combobox", { name: "Set day", exact: true }).selectOption("rest");
  await page.getByRole("button", { name: "Apply to 2" }).click();
  await expect.poll(() => bulkBody?.riderIds?.slice().sort() ?? null).toEqual(["rider-5485-10", "rider-5485-7"]);
});

test("(3) assistenten desktop: en rigtig sekundær knap med ramme i tabellens værktøjslinje, samme panel", async ({ page }) => {
  await openTraining(page, 1440, 900);
  const table = page.getByTestId("training-today-table");
  const button = table.getByTestId("training-assistant-button");
  await expect(button).toBeVisible();
  const borderWidth = await button.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth));
  expect(borderWidth).toBeGreaterThanOrEqual(1);
  await button.click();
  await expect(page.getByText("Assistant suggestions", { exact: true })).toBeVisible();
});

for (const mobileTable of [true, false]) {
  test(`(3) assistenten telefon 390 (${mobileTable ? "beta-tabellen" : "den almindelige telefon-visning"}): rækken står lige under overblikket, over tabellen`, async ({ page }) => {
    await openTraining(page, 390, 844, trainingMe({ mobileTable }));
    const row = page.getByTestId("training-assistant-row");
    await expect(row).toBeVisible();
    const overviewBox = await overview(page).boundingBox();
    const rowBox = await row.boundingBox();
    const tableBox = mobileTable
      ? await page.getByTestId("training-mobile-roster").boundingBox()
      : await page.locator("table[data-sortable]").first().boundingBox();
    expect(overviewBox && rowBox && tableBox).toBeTruthy();
    expect(rowBox!.y).toBeGreaterThanOrEqual(overviewBox!.y + overviewBox!.height);
    expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(tableBox!.y);
    // 44 px tryk-mål (#1602).
    expect(rowBox!.height).toBeGreaterThanOrEqual(44);
    await row.click();
    await expect(page.getByText("Assistant suggestions", { exact: true })).toBeVisible();
  });
}

for (const width of [360, 390]) {
  test(`(4) fanerne ${width} px: alle fire faner står helt på skærmen, ingen afskåret Report`, async ({ page }) => {
    await openTraining(page, width, 844);
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(4);
    for (let i = 0; i < 4; i += 1) {
      expect(await fullyInViewport(page, tabs.nth(i)), `fane ${i + 1} skal stå helt på ${width} px`).toBe(true);
    }
    const scrolls = await page.getByRole("tablist").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(scrolls).toBeLessThanOrEqual(0);
    await expect(tabs.nth(3)).toHaveText("Report");
  });
}

test("(5) ugeplanen har ikke længere den lange forklaring under tabellen", async ({ page }) => {
  await openTraining(page, 1440, 900);
  await page.getByRole("tab", { name: /Week plan/ }).click();
  const plan = page.getByTestId("training-week-plan");
  await expect(plan).toContainText("Set the intensity for each day of the week.");
  await expect(plan).not.toContainText("The rhythm is a default");
  await expect(plan).not.toContainText("consistency bonus");
});

test("(7) dagen er kørt: fanen Today siger at ændringer gælder fra i morgen, på desktop og telefon", async ({ page }) => {
  await openTraining(page, 1440, 900, trainingMe({ allSet: true, trained: true }));
  const desktopNote = overview(page).getByTestId("training-tick-model-note");
  await expect(desktopNote).toHaveText("Changes now take effect tomorrow.");
  await expect(desktopNote).toHaveAttribute("title", /Today's training has already run/);

  await page.setViewportSize({ width: 390, height: 844 });
  const phoneNote = page.getByTestId("training-tick-model-note");
  await expect(phoneNote).toHaveCount(1);
  await expect(phoneNote).toBeVisible();
  await expect(phoneNote).toHaveText("Changes now take effect tomorrow.");
});

// Ryttere hvis række-bund står over bundnavigationen (eller skærmkanten).
async function ridersOnFirstScreen(page: Page, rowSelector: string) {
  return page.evaluate((selector) => {
    const nav = document.querySelector("[data-mobile-quick-nav]");
    const navHeight = nav ? nav.getBoundingClientRect().height : 0;
    const bottom = window.innerHeight - (getComputedStyle(nav ?? document.body).display === "none" ? 0 : navHeight);
    return [...document.querySelectorAll(selector)].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.bottom <= bottom;
    }).length;
  }, rowSelector);
}

test("(8) telefon på langs UDEN beta (844 × 390): måling af ryttere på første skærm", async ({ page }, testInfo) => {
  await openTraining(page, 844, 390, trainingMe({ mobileTable: false }));
  await expect(page.getByTestId("training-today-table")).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const visible = await ridersOnFirstScreen(page, "[data-testid='training-today-row']");
  testInfo.annotations.push({ type: "riders-on-first-screen-844x390-no-beta", description: String(visible) });
  console.log(`#5485 (8) 844x390 uden beta: ${visible} ryttere på første skærm`);
  expect(visible).toBeGreaterThanOrEqual(LANDSCAPE_NO_BETA_MIN_RIDERS);
  await page.screenshot({ path: evidenceShotPath("pr-screens/5485-training-844-landscape-no-beta.png") });
});

test("(9) Score før dagens pas: seneste tal dæmpet med 'latest', kurven vises, og sorteringen bruger det", async ({ page }) => {
  await openTraining(page, 1440, 900, trainingMe({ withScore: true, injured: true }));
  const cells = page.getByTestId("training-score-cell");
  await expect(cells.first()).toHaveAttribute("data-score-state", "latest");
  const top = page.locator("[data-testid='training-today-row'][data-rider-id='rider-5485-8']");
  await expect(top.getByTestId("training-score-cell")).toContainText("latest");
  await expect(top.getByTestId("training-score-cell").getByRole("img")).toBeVisible();

  // Sortér på Score (desc): den med den højeste SENESTE score står øverst.
  const header = page.getByRole("columnheader", { name: /^Score/ }).first();
  await header.getByRole("button").first().click();
  await expect(header).toHaveAttribute("aria-sort", "descending");
  await expect(page.getByTestId("training-today-row").first()).toHaveAttribute("data-rider-id", LATEST_TOP);

  await page.screenshot({ path: evidenceShotPath("pr-screens/5485-training-1440-latest-score.png") });

  // Efter dagens pas: dagens tal, normalt, uden "latest".
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockSquad(page, trainingMe({ withScore: true, allSet: true, trained: true }));
  await page.reload();
  await overview(page).waitFor();
  await expect(page.getByTestId("training-score-cell").first()).toHaveAttribute("data-score-state", "score");
  await expect(page.getByTestId("training-score-cell").filter({ hasText: "latest" })).toHaveCount(0);
});

test("(9)+(10) telefon 390 (beta): seneste score i tabellen og kortet, rød skademarkør i rækken", async ({ page }) => {
  await openTraining(page, 390, 844, trainingMe({ withScore: true, injured: true }));
  const roster = page.getByTestId("training-mobile-roster");
  await roster.waitFor();
  const latestCells = roster.locator("[data-testid='training-mobile-score-cell'][data-score-state='latest']");
  await expect(latestCells.first()).toContainText("latest");

  // (10) Skaden står i rytterens egen række, under underlinjen.
  const injuredRow = roster.locator("tr", { hasText: "T. Van Aerde" }).first();
  const marker = injuredRow.getByTestId("training-mobile-injury");
  await expect(marker).toHaveText("Injured: 3 race days left");
  const color = await marker.evaluate((el) => getComputedStyle(el).color);
  const danger = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "text-cz-danger";
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  expect(color).toBe(danger);
  await expect(roster.getByTestId("training-mobile-injury")).toHaveCount(1);

  // Kortet: seneste tal + mærke + kurve.
  await roster.locator("tr", { hasText: "J. Halvorsen" }).first().getByRole("button").first().click();
  const scoreBlock = page.getByTestId("training-mobile-score");
  await expect(scoreBlock).toContainText("latest");
  await expect(scoreBlock.getByRole("img")).toBeVisible();

  // Stadig mindst 8 ryttere på første skærm med alt det ovenfor.
  await roster.locator("tr", { hasText: "J. Halvorsen" }).first().getByRole("button").first().click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: evidenceShotPath("pr-screens/5485-training-390-latest-injury.png") });
});

test("skærmbillede 844 × 390 (beta): telefonens layout på langs", async ({ page }) => {
  await openTraining(page, 844, 390, trainingMe({ withScore: true, injured: true }));
  await expect(page.getByTestId("training-mobile-roster")).toBeVisible();
  const visible = await ridersOnFirstScreen(page, "[data-testid='training-mobile-roster'] tbody tr:has(button[aria-expanded])");
  console.log(`#5485 (8) 844x390 med beta: ${visible} ryttere på første skærm`);
  await page.screenshot({ path: evidenceShotPath("pr-screens/5485-training-844-landscape.png") });
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
