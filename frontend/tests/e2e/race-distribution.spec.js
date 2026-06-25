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

// #1823: gem-fejl må IKKE være tavse — når en GYLDIG ændring afvises af serveren,
// viser board'et en mappet fejlbesked. (Auto-gem-når-gyldig: en rolle-ændring på en
// fuld trup PUT'er; her mocker vi et 409 og forventer alert'en.)
test("board surfacer fejlbesked når en gyldig udtagelse afvises (#1823)", async ({ page }) => {
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

  // Klik en udtagen rytter → rolle-menu → sæt en rolle (gyldig ændring) → PUT → 409 → alert.
  await board.getByRole("button", { name: /Rider 1/ }).first().click();
  await board.getByRole("button", { name: /Sprint-kaptajn/ }).click();
  const alert = board.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/6/); // "Udtag mellem 6 og 6 ryttere" (ikke literal {min})
});

// Rod A (#1823): auto-gem-når-gyldig — at fjerne en rytter under minimum GEMMER IKKE
// (ingen PUT, ingen fejl-alert); kolonnen viser blot underbemandet, så man kan redigere
// videre. Det er det fix der ophæver den hårde 6-og-6-lås.
test("board: fjern under minimum gemmer ikke + viser underbemandet uden fejl (#1823)", async ({ page }) => {
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
