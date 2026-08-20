// #3721 — træningssiden omlagt til faner (Train today / Development /
// History), ejer-godkendt design 19/8. #3746 trin 7 (ejer-beslutning 20/8)
// tilføjede en ny fane, "Week plan", og flyttede den ugentlige rytme-editor
// dertil (som en åben sektion, ikke længere en accordion). Guarden her holder på:
//   1) "Train today" er default (ingen ?tab=) og viser rosteret — men ALDRIG
//      den slettede åbne FAQ, og IKKE LÆNGERE ugerytme-editoren (flyttet).
//   2) Toolbaren bærer et stille "How training works"-link til
//      /help?section=dailytraining i stedet for FAQ-prosaen.
//   3) "Week plan"-fanen viser ugerytme-editoren åben (ingen <details>) + en
//      kompakt oversigt over ryttere med individuel ugeplan.
//   4) Development-fanen viser én række pr. rytter: navn+alder, glyf-tallene
//      "now · lo-hi · loft", og en fungerende fokus-knap (samme FocusPanel).
//   5) History-fanen viser den uændrede træningshistorik.
//   6) ?tab=development og ?tab=weekplan er gyldige dyb-links (samme mønster
//      som RiderStatsPage).
//
// riders kommer fra Supabase-mocken uden override: rider-1 = Ada Pedersen
// (samme fixture-rytter som training-report.spec.js bruger), som har et fuldt
// prognose-bånd i SEED_SCOUT_ESTIMATES (now:29, prog:{lo:40,hi:48}, loft:93).

import { test, expect } from "@playwright/test";
import { installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM } from "./fixtures.js";

const TRAINING_ME = {
  enabled: true,
  betaTester: true,
  teamId: TEST_TEAM.id,
  slots: { total: null, used: 1, remaining: null },
  focuses: ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"],
  intensities: ["easy", "normal", "hard", "rest"],
  plans: { "rider-1": { focus: "vo2max", intensity: "hard" } },
  condition: { "rider-1": { form: 75, fatigue: 20, injured_until: null, risk: 0 } },
  progress: {},
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

test("Train today er default: rosteret er synligt, den slettede FAQ er væk, ugerytmen er flyttet til Week plan", async ({ page }) => {
  await login(page);
  await page.goto("/training");
  await page.locator("table[data-sortable]").waitFor();

  // Default fane: intet ?tab= i URL'en.
  await expect(page).toHaveURL(/\/training$/);

  // Rosteret (fokus + intensitet) er synligt uden at skifte fane.
  await expect(page.getByText("Ada Pedersen")).toBeVisible();

  // #3721: den åbne FAQ ("Får man energi tilbage hver dag?") er slettet.
  await expect(page.getByText("Får man energi tilbage hver dag?")).toHaveCount(0);

  // #3746 trin 7: ugerytme-editoren bor IKKE længere på Train today — den er
  // flyttet til sin egen fane ("Week plan"), se testen nedenfor.
  await expect(page.getByText("Ugentlig rytme")).toHaveCount(0);

  // Det stille Hjælp-link i toolbaren erstatter FAQ-prosaen.
  const helpLink = page.getByRole("link", { name: "Sådan virker træning" });
  await expect(helpLink).toBeVisible();
  await expect(helpLink).toHaveAttribute("href", "/help?section=dailytraining");
});

test("Week plan-fanen viser ugerytme-editoren åben (ingen accordion) + den individuelle ugeplan-oversigt", async ({ page }) => {
  await login(page);
  await page.goto("/training");
  await page.locator("table[data-sortable]").waitFor();

  await page.getByRole("tab", { name: "Ugeplan" }).click();
  await expect(page).toHaveURL(/\/training\?tab=weekplan$/);

  // Rosterets tabel er væk (kun Week plan-fanens indhold rendres).
  await expect(page.locator("table[data-sortable]")).toHaveCount(0);

  // Ugerytme-editoren er synlig UDEN at skulle åbnes — ingen <details>-element.
  await expect(page.getByText("Ugentlig rytme")).toBeVisible();
  await expect(page.locator("details:has-text('Ugentlig rytme')")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Gem rytme" })).toBeVisible();

  // Den individuelle ugeplan-oversigt (tom i denne fixture — riderWeekPlans: {}).
  await expect(page.getByText("Individuelle ugeplaner")).toBeVisible();
  await expect(page.getByText("Ingen ryttere har en individuel ugeplan endnu.", { exact: false })).toBeVisible();

  // "Gå til rosteret"-knappen springer tilbage til Train today.
  await page.getByRole("button", { name: "Gå til rosteret" }).click();
  await expect(page).toHaveURL(/\/training\?tab=today$/);
  await expect(page.locator("table[data-sortable]")).toBeVisible();
});

test("Development-fanen viser navn+alder, glyf-tallene og en fungerende fokus-knap", async ({ page }) => {
  await login(page);
  await page.goto("/training");
  await page.locator("table[data-sortable]").waitFor();

  await page.getByRole("tab", { name: "Udvikling" }).click();
  await expect(page).toHaveURL(/\/training\?tab=development$/);

  // Rosterets tabel er væk (kun Development-fanens indhold rendres).
  await expect(page.locator("table[data-sortable]")).toHaveCount(0);

  await expect(page.getByText("Ada Pedersen")).toBeVisible();
  // rider-1 er født 2002-04-12; alderen selv afhænger af aktiv sæsons
  // referenceår, så vi tester KUN at en alders-linje findes, ikke det eksakte tal.
  // Tester-feedback 20/8 (#3798): rollen står PÅ rækken — alders-linjen bærer
  // estimatets egen rolle (SEED_SCOUT_ESTIMATES.role = "sprinter"), så spilleren
  // aldrig skal gætte hvilken rolle tallene gælder.
  await expect(page.getByText(/^Alder \d+ · Sprinter$/)).toBeVisible();

  // Glyf-tallene: now:29, prog:{lo:40,hi:48}, loft:93 (SEED_SCOUT_ESTIMATES) —
  // med rolle-labelen foran i samme linje.
  await expect(page.getByText("29 · 40-48 · loft 93")).toBeVisible();

  // Fokus-knappen er DEN SAMME komponent/mutation som rosterets — åbner panelet.
  await page.getByRole("button", { name: /Dag — Ada Pedersen/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("History-fanen viser den uændrede træningshistorik, roster er væk", async ({ page }) => {
  await login(page);
  await page.goto("/training");
  await page.locator("table[data-sortable]").waitFor();

  await page.getByRole("tab", { name: "Historik" }).click();
  await expect(page).toHaveURL(/\/training\?tab=history$/);

  await expect(page.locator("table[data-sortable]")).toHaveCount(0);
  await expect(page.getByText("Træningshistorik")).toBeVisible();
});

test("?tab=development er et gyldigt dyb-link (samme VALID_TABS-mønster som RiderStatsPage)", async ({ page }) => {
  await login(page);
  await page.goto("/training?tab=development");

  await expect(page.getByRole("tab", { name: "Udvikling", selected: true })).toBeVisible();
  await expect(page.getByText("Ada Pedersen")).toBeVisible();
});

test("?tab=weekplan er et gyldigt dyb-link", async ({ page }) => {
  await login(page);
  await page.goto("/training?tab=weekplan");

  await expect(page.getByRole("tab", { name: "Ugeplan", selected: true })).toBeVisible();
  await expect(page.getByText("Ugentlig rytme")).toBeVisible();
});
