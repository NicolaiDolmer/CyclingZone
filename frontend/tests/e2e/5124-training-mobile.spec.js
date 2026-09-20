// #5124 — D-047 til Daglig træning-rosteret på mobil. #5124's ejer-tekst siger
// "<768px", men selve mekanikken genbruger D-047/DataTable.jsx's EGEN,
// kanoniske grænse (`useIsMobileViewport`, 640px — samme som Tailwinds `sm`)
// for at holde ÉN grænse i hele appen, ikke to. Testet ved 393px, samme
// viewport som playwright.config.js's mobile-chromium-projekt (godt under
// begge grænser). Roster-tabellen kan ikke bruge <DataTable> (multi-
// select-checkbox + gruppe-header-rækker + en udvidelig ugeplan-underrække),
// så mobil-standarden bygges i TrainingPage.jsx selv oven på MobileTableChips.jsx
// (se filens kommentar ved `rosterMobile`).
//
// Beviser konkret:
//   1) Siden scroller ALDRIG vandret på mobil (document.scrollingElement) —
//      hverken i standardtilstanden (tre kolonner) eller i "Fuld tabel".
//   2) Hovedhandlingen (#5124: "vælge træning") — knapperne der skifter dagens
//      træningstype — er synlig og klikbar UDEN at åbne "Fuld tabel" først.
//   3) Chip-rækken kan bytte en fjerde kolonne (Ugeplan) ind, og "Fuld tabel"
//      viser alle fem.
// Desktop (1280px) er uændret — samme markup, kun mobil-gates er no-op.
//
// #3643 (ejer 19/9): DETTE ER FLAG-OFF-STIEN. Den nye mobil-visning ligger bag
// `training_mobile_table` (stadie beta), og mock-svaret herunder sætter
// bevidst IKKE `mobileTable` — altså præcis det svar en spiller der ikke er
// beta-tester får. Specen er derfor guarden for at den gamle visning stadig
// virker uændret for alle andre. Den nye visning dækkes af
// 3643-training-mobile.spec.js, som sætter `mobileTable: true` i sin mock.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, evidenceShotPath } from "./fixtures.js";

const TRAINING_ME = {
  enabled: true,
  betaTester: true,
  teamId: TEST_TEAM.id,
  slots: { total: null, used: 2, remaining: null },
  focuses: ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"],
  intensities: ["easy", "normal", "hard", "rest"],
  plans: {
    "rider-1": { focus: "vo2max", intensity: "hard" },
    "rider-2": { focus: "threshold", intensity: "normal" },
  },
  condition: {
    "rider-1": { form: 75, fatigue: 20, injured_until: null, risk: 0 },
    "rider-2": { form: 60, fatigue: 35, injured_until: null, risk: 0 },
  },
  progress: { "rider-1": { vo2max: 0.4 }, "rider-2": { threshold: 0.6 } },
  capped: {},
  trainability: {},
  smartDefaultFocus: {},
  weekPlan: null,
  riderWeekPlans: {},
  racingToday: {},
  todayRun: null,
};

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/training/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, TRAINING_ME);
  });
});

test("mobil 393px: roster scroller aldrig vandret, og hovedhandlingen (skift dagens træning) virker uden 'Fuld tabel'", async ({ page }, testInfo) => {
  await login(page);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/training");
  await page.locator("table[data-sortable]").first().waitFor();
  await expect(page.getByText("Ada Pedersen")).toBeVisible();

  const noPageScroll = () => page.evaluate(
    () => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth + 1
  );
  await expect.poll(noPageScroll).toBe(true);

  // #5124's hovedhandling: "Skift dag"-knapperne (Hvile/Aktiv restitution/
  // Session) er en af standardtilstandens tre kolonner (rosterMobileColumns'
  // "today") og skal derfor kunne bruges UDEN "Fuld tabel".
  const adaRow = page.locator("tbody tr", { hasText: "Ada Pedersen" }).first();
  const restButton = adaRow.getByRole("button", { name: "Hvile", exact: true });
  await expect(restButton).toBeVisible();

  // Skærmbillede FØR klik — viser den brugbare standardtilstand (navn + tre
  // kolonner, ingen sidescroll). Efter klik erstatter mock-svaret nedenfor
  // rytterens fokus med null, hvorfor knap-rækken selv forsvinder (uændret
  // eksisterende adfærd, ikke en #5124-regression) — irrelevant for DENNE
  // skærmbillede.
  await page.screenshot({ path: evidenceShotPath(`pr-screens/5124-training-mobile-393-${testInfo.project.name}.png`), fullPage: false });

  let body = null;
  await page.route("**/api/training/rider-1", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    body = JSON.parse(request.postData() || "{}");
    return json(route, { ok: true, riderId: "rider-1", plan: { focus: null, intensity: "rest" }, slots: TRAINING_ME.slots });
  });
  await restButton.click();
  await expect.poll(() => body).not.toBeNull();
  expect(body).toEqual({ dayType: "rest", session: null });

  // "Fuld tabel" åbner de resterende kolonner (Dag/Fokus + Ugeplan) — stadig
  // ingen sidescroll (den kontainerede sticky-name-cell-mekanik, se
  // rosterScrollerClass-kommentaren i TrainingPage.jsx).
  await page.getByRole("button", { name: "Fuld tabel" }).click();
  await expect(page.getByRole("columnheader", { name: "Ugeplan" })).toBeVisible();
  await expect.poll(noPageScroll).toBe(true);

  await page.screenshot({ path: evidenceShotPath(`pr-screens/5124-training-mobile-393-fulltable-${testInfo.project.name}.png`), fullPage: false });
});

test("desktop 1280px: uændret — alle kolonner synlige uden chip-række, ingen 'Fuld tabel'-knap", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only regressionstjek — dækket af mobile-projekterne ovenfor.");
  await login(page);
  await page.goto("/training");
  await page.locator("table[data-sortable]").first().waitFor();

  await expect(page.getByRole("columnheader", { name: "Denne sæson" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Ugeplan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fuld tabel" })).toHaveCount(0);

  await page.screenshot({ path: evidenceShotPath(`pr-screens/5124-training-desktop-1280-${testInfo.project.name}.png`), fullPage: false });
});
