// Race Hub Fase 1 — trup-fordeling-board'et på /races.
//
// Mocker GET /api/races/distribution (aggregat-endpointet) så board'et renderer to
// overlappende løb som kolonner + en 12-trup-pulje hvor en udtaget rytter er låst.
// Mønster følger race-selection.spec.js: stabilizePage (sætter cz_lang=da) →
// installNetworkMocks → spec-override (LIFO) → login → goto.
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, corsHeaders } from "./fixtures.js";

const ROSTER = Array.from({ length: 12 }, (_, i) => ({
  id: `r${i}`,
  name: `Rider ${i}`,
  primaryType: null,
  secondaryType: null,
  form: 50 + i,
  fatigue: 10,
  injured: false,
}));

const DISTRIBUTION = {
  enabled: true,
  season: { id: "s1", number: 1 },
  currentDay: 24,
  focusDay: 24,
  timeline: {
    totalDays: 60,
    currentDay: 24,
    days: Array.from({ length: 60 }, (_, i) => ({ day: i + 1, dateText: null, terrain: "flat", hasMyRace: i === 23 })),
  },
  columns: [
    {
      id: "race-a", name: "Hamburger Klassiker", race_class: "ProSeries", race_type: "single",
      // bindingWindow = in-game-dag-span (samme shape som API'en); race-a og race-b deler
      // game-dag 1 → de binder → r0 (i race-a) er låst fra race-b i puljen.
      stages: 1, status: "scheduled", window: { start: 1, end: 1 }, bindingWindow: { start: 1, end: 1 },
      size: { min: 6, max: 6 }, withdrawn: false, counts: { selected: 1, target: 6 },
      riders: ROSTER, selection: { rider_ids: ["r0"], captain_id: "r0", sprint_captain_id: null, hunter_id: null, is_auto_filled: true },
    },
    {
      id: "race-b", name: "La Corsa dei Due Mari", race_class: "OtherWorldTourA", race_type: "stage_race",
      stages: 7, status: "scheduled", window: { start: 1, end: 1 }, bindingWindow: { start: 1, end: 1 },
      size: { min: 8, max: 8 }, withdrawn: false, counts: { selected: 0, target: 8 },
      riders: ROSTER, selection: null,
    },
  ],
  bindingMap: { r0: ["race-a"] },
};

async function mockDistribution(page, dist = DISTRIBUTION) {
  await page.route("**/api/races/distribution**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify(dist),
    });
  });
}

test("trup-fordeling-board viser overlappende løb + låst rytter i puljen", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockDistribution(page);

  await login(page);
  await page.goto("/races");

  const board = page.getByTestId("race-hub-board");
  await expect(board).toBeVisible();

  // Begge overlappende løb vises som kolonner. (#1984: race-navnet optræder nu også i
  // pulje-chip'ens inline lås-grund, så vi peger entydigt på kolonne-headeren = link.)
  await expect(board.getByRole("link", { name: "Hamburger Klassiker" })).toBeVisible();
  await expect(board.getByRole("link", { name: "La Corsa dei Due Mari" })).toBeVisible();

  // Underbemandet-status på race-b (0/8).
  await expect(board.getByText(/0 \/ 8/)).toBeVisible();

  // r0 er udtaget til race-a → låst i puljen. Pulje-chip'en bærer bound-title;
  // kolonne-knappen for samme rytter gør ikke (entydig selector).
  // #1984: chip'en er nu KLIKBAR (popoveren forklarer hvorfor) men markeret som låst
  // via bound-title + en inline lås-grund ("kører <løb>").
  const lockedChip = board.locator("button[title]").filter({ hasText: "Rider 0" });
  await expect(lockedChip).toBeEnabled();
  await expect(lockedChip).toHaveAttribute("title", /Hamburger Klassiker/);

  // #1984/C: klik den låste chip → popoveren viser HVORFOR (optaget i overlappende løb)
  // + navngiver det konkrete blokerende løb (verificerer blockedReason-interpolationen).
  await lockedChip.click();
  await expect(board.getByText("Optaget i overlappende løb")).toBeVisible();
  await expect(board.getByText("Overlapper Hamburger Klassiker")).toBeVisible();

  // En ledig rytter (ikke udtaget nogen steder) er klikbar i puljen.
  await expect(board.getByRole("button", { name: /Rider 5/ })).toBeEnabled();
});

// Fuld 6/6-race-a (alle 6 pladser) — så en GYLDIG ændring (rolle-skift) faktisk PUT'er.
const FULL_RACE_A = {
  ...DISTRIBUTION,
  columns: [
    {
      ...DISTRIBUTION.columns[0],
      counts: { selected: 6, target: 6 },
      selection: { rider_ids: ["r0", "r1", "r2", "r3", "r4", "r5"], captain_id: "r0", sprint_captain_id: null, hunter_id: null, is_auto_filled: false },
    },
    DISTRIBUTION.columns[1],
  ],
  bindingMap: { r0: ["race-a"], r1: ["race-a"], r2: ["race-a"], r3: ["race-a"], r4: ["race-a"], r5: ["race-a"] },
};

// Gem-fejl må IKKE være tavse — når serveren afviser et Gem, viser board'et en mappet
// fejlbesked. (Ejer 28/6: eksplicit Gem-knap PUT'er; her mocker vi et 409 og forventer alert'en.)
test("board surfacer fejlbesked når et gem afvises (#1823)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockDistribution(page, FULL_RACE_A);
  await page.route("**/api/races/race-a/selection", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return route.fulfill({
      status: 409, contentType: "application/json", headers: corsHeaders(request),
      body: JSON.stringify({ error: "selection_wrong_size" }),
    });
  });

  await login(page);
  await page.goto("/races");
  const board = page.getByTestId("race-hub-board");
  await expect(board).toBeVisible();

  // Klik en udtagen rytter → rolle-menu → sæt en rolle (kladde-ændring, intet PUT endnu).
  await board.getByRole("button", { name: /Rider 1/ }).first().click();
  await board.getByRole("button", { name: /Sprint-kaptajn/ }).click();
  // Ejer 28/6: ingen auto-gem — den eksplicitte "Gem ændringer"-knap udløser PUT (→ mocket 409 → alert).
  await board.getByRole("button", { name: /Gem ændringer/ }).click();
  const alert = board.getByRole("alert");
  await expect(alert).toBeVisible();
  // Specifik mapping (ikke bare "indeholder 6"): den mappede selection_wrong_size-streng.
  await expect(alert).toContainText(/højst udtage/);
});

// Ejer 28/6: redigering PUT'er ALDRIG af sig selv (ingen auto-gem). At fjerne en rytter
// viser blot underbemandet (5/6) lokalt — intet PUT, ingen fejl-alert — indtil man trykker Gem.
test("board: redigering gemmer ikke før Gem (underbemandet vises lokalt)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockDistribution(page, FULL_RACE_A);
  let putCalled = false;
  await page.route("**/api/races/race-a/selection", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    putCalled = true; // bør ALDRIG ske for en ugyldig (under-min) kladde
    return route.fulfill({ status: 200, contentType: "application/json", headers: corsHeaders(request), body: JSON.stringify({ ok: true }) });
  });

  await login(page);
  await page.goto("/races");
  const board = page.getByTestId("race-hub-board");
  await expect(board).toBeVisible();
  await expect(board.getByText(/6 \/ 6/).first()).toBeVisible();

  // Fjern én rytter fra den fulde 6/6-trup → 5/6.
  const removeBtn = board.getByRole("button", { name: /Fjern rytter/ }).first();
  await removeBtn.scrollIntoViewIfNeeded();
  await removeBtn.click({ force: true });

  // Underbemandet vises; INGEN fejl-alert; INGEN PUT (ugyldig kladde gemmes ikke).
  await expect(board.getByText(/5 \/ 6/).first()).toBeVisible();
  await expect(board.getByRole("alert")).toHaveCount(0);
  expect(putCalled).toBe(false);
});

// #1823: klik en udtagen rytter → rolle-menu (kaptajn/sprint/jæger/kun rytter).
test("board: klik udtagen rytter åbner rolle-vælger (#1823)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockDistribution(page);
  await login(page);
  await page.goto("/races");
  const board = page.getByTestId("race-hub-board");
  await expect(board).toBeVisible();

  // Kolonne-rytteren (r0) ligger før pulje-chip'en i DOM → .first() = kolonne-knappen.
  await board.getByRole("button", { name: /Rider 0/ }).first().click();
  // Rolle-menuens valg vises (rene menu-labels, ikke andre steder på board'et).
  await expect(board.getByRole("button", { name: /Kun rytter/ })).toBeVisible();
  await expect(board.getByRole("button", { name: /Sprint-kaptajn/ })).toBeVisible();
});

// S6 (#1835): read-only "andre divisioner" — pulje-vælger + PCS-style bruttotrupper.
// Browse-endpointet er mere specifikt end /distribution → registreres SIDST (Playwright
// LIFO: sidst-registrerede route tjekkes først) så det vinder for /distribution/browse,
// mens /distribution stadig falder til mine-board-mocken.
const BROWSE = {
  enabled: true,
  season: { id: "s1", number: 1 },
  pools: [
    { id: 1, tier: 1, pool_index: 0, label: "Pool A" },
    { id: 2, tier: 2, pool_index: 0, label: "Pool A" },
    { id: 3, tier: 2, pool_index: 1, label: "Pool B" },
  ],
  pool: { id: 2, tier: 2, pool_index: 0, label: "Pool A" },
  ownPoolId: 2,
  currentDay: 24, focusDay: 24, horizonDays: 7,
  timeline: { totalDays: 60, currentDay: 24, days: Array.from({ length: 60 }, (_, i) => ({ day: i + 1, dateText: null, terrain: "flat", hasMyRace: i === 23 })) },
  columns: [
    {
      id: "race-x", name: "Tour de Browse", race_class: "ProSeries", race_type: "single",
      stages: 1, stages_completed: 0, status: "scheduled", window: { start: 1, end: 1 },
      primaryProfileType: "flat", visible: true, daysUntilStart: 2, opensInDays: 0, teamCount: 1,
      teams: [{ team: { id: "t-rival", name: "Regression VC" }, riders: [
        { id: "rb1", firstname: "Lars", lastname: "Aerts", nationality_code: "be" },
        { id: "rb2", firstname: "Tom", lastname: "Garnier", nationality_code: "fr" },
      ] }],
    },
    {
      id: "race-locked", name: "GP des Préviews", race_class: "Class1", race_type: "single",
      stages: 1, stages_completed: 0, status: "scheduled", window: { start: 30, end: 30 },
      primaryProfileType: "hilly", visible: false, daysUntilStart: 11, opensInDays: 4, teamCount: 0, teams: [],
    },
  ],
};

async function mockBrowse(page, payload = BROWSE) {
  await page.route("**/api/races/distribution/browse**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return route.fulfill({ status: 200, contentType: "application/json", headers: corsHeaders(request), body: JSON.stringify(payload) });
  });
}

test("browse: 'Andre divisioner' viser read-only startlister (bruttotrupper) + låst løb (#1835)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockDistribution(page); // mine-board initial-load (/distribution)
  await mockBrowse(page);       // /distribution/browse — registreret sidst → vinder (LIFO)

  await login(page);
  await page.goto("/races");
  await expect(page.getByTestId("race-hub-board")).toBeVisible();

  // Skift til "Andre divisioner" → read-only browse-flade. Scope-pillerne er
  // ARIA-faner (role="tab", #1924), ikke generiske knapper.
  await page.getByRole("tab", { name: "Andre divisioner" }).click();
  const browse = page.getByTestId("race-hub-browse");
  await expect(browse).toBeVisible();

  // Read-only-mærkat + en startliste (bruttotrup) med hold + rytter (PCS-style "L. Aerts").
  await expect(browse.getByText("Skrivebeskyttet")).toBeVisible();
  await expect(browse.getByText("Regression VC")).toBeVisible();
  await expect(browse.getByText("L. Aerts")).toBeVisible();
  await expect(browse.getByText("Tour de Browse")).toBeVisible();

  // Det fjerne løb er låst (uden for 7-dages-vinduet) → "Åbner om 4 dage", ingen trup.
  await expect(browse.getByText(/Åbner om 4 dage/)).toBeVisible();

  await browse.screenshot({ path: "test-results/race-hub-browse-s6.png" });
});

// #1825: frosset løb (lineup_locked) vises som "Trup låst" og redigering er væk.
test("board: igangværende løb vises som trup-låst (#1825)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const locked = {
    ...DISTRIBUTION,
    columns: [
      { ...DISTRIBUTION.columns[0], lineup_locked: true, stages_completed: 3 },
      DISTRIBUTION.columns[1],
    ],
  };
  await mockDistribution(page, locked);
  await login(page);
  await page.goto("/races");
  const board = page.getByTestId("race-hub-board");
  await expect(board).toBeVisible();

  // Status-chip "Trup låst" + låse-note; ingen fjern-knap i det frosne løb.
  await expect(board.getByText("Trup låst").first()).toBeVisible();
  await expect(board.getByText(/Truppen er endelig/)).toBeVisible();
});
