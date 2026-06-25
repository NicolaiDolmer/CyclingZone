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
      stages: 1, status: "scheduled", window: { start: 1, end: 1 },
      size: { min: 6, max: 6 }, withdrawn: false, counts: { selected: 1, target: 6 },
      riders: ROSTER, selection: { rider_ids: ["r0"], captain_id: "r0", sprint_captain_id: null, hunter_id: null, is_auto_filled: true },
    },
    {
      id: "race-b", name: "La Corsa dei Due Mari", race_class: "OtherWorldTourA", race_type: "stage_race",
      stages: 7, status: "scheduled", window: { start: 1, end: 1 },
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

  // Begge overlappende løb vises som kolonner.
  await expect(board.getByText("Hamburger Klassiker")).toBeVisible();
  await expect(board.getByText("La Corsa dei Due Mari")).toBeVisible();

  // Underbemandet-status på race-b (0/8).
  await expect(board.getByText(/0 \/ 8/)).toBeVisible();

  // r0 er udtaget til race-a → låst (disabled) i puljen. Pulje-chip'en bærer
  // bound-title; kolonne-knappen for samme rytter gør ikke (entydig selector).
  const lockedChip = board.locator("button[title]").filter({ hasText: "Rider 0" });
  await expect(lockedChip).toBeDisabled();

  // En ledig rytter (ikke udtaget nogen steder) er klikbar i puljen.
  await expect(board.getByRole("button", { name: /Rider 5/ })).toBeEnabled();
});

// #1823: gem-fejl må IKKE være tavse — board'et viser en mappet fejlbesked.
test("board surfacer fejlbesked når en udtagelse afvises (#1823)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockDistribution(page);
  // PUT /selection på race-a → 409 selection_wrong_size (fx fjern under min).
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

  // Fjern r0 fra race-a (× = "Fjern rytter") → PUT fejler → toast med min/max (6).
  await board.getByRole("button", { name: /Fjern rytter/ }).first().click();
  const alert = board.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/6/); // "Vælg mellem 6 og 6 ryttere" (ikke literal {min})
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
