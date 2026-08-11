// season-start-guide.spec.js — #2925 "Season N: kom i gang"-kortet.
//
// Kortet er usynligt i det normale fixture-setup (seed-sæsonen har hverken
// `number` eller `start_date`, så isSeasonStartWindow returnerer false) — netop
// derfor rører denne spec ikke de delte seed-data, men overrider kun de fire
// kilder kortet læser. Så forbliver alle andre snapshots uændrede.
//
// Dækning: vinduet åbner, alle fire punkter deep-linker rigtigt, "udført"-
// markeringen følger data, og dismiss får kortet til at forsvinde.

import { expect, test } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json, TEST_TEAM, evidenceShotPath } from "./fixtures.js";

const SEASON_2 = {
  id: "season-2-e2e",
  number: 2,
  status: "active",
  // Dag 0 i vinduet: sæsonen startede i dag.
  start_date: new Date().toISOString().slice(0, 10),
  end_date: null,
  race_days_completed: 0,
  race_days_total: 28,
};

// Træningsplanen ER lagt (12 rækker) — de tre andre beslutninger mangler. Den
// blandede tilstand er med vilje: screenshottet skal vise BÅDE et afkrydset og
// et ikke-afkrydset punkt.
const TRAINING_PLAN_ROWS = Array.from({ length: 12 }, (_, i) => ({ rider_id: `rider-${i + 1}` }));
const PENDING_GRADUATIONS = [{ rider_id: "grad-1" }, { rider_id: "grad-2" }];

async function installSeasonStartMocks(page) {
  // Akademiet skal være synligt for holdet, ellers udelades akademi-punktet.
  // Samme cache-nøgle som Layout.jsx skriver (lib/academyNavVisibility.js).
  await page.addInitScript(() => {
    window.localStorage.setItem("cz:academyNavEnabled", "1");
  });

  // Registreres EFTER installNetworkMocks, så disse handlers vinder.
  await page.route("**/rest/v1/seasons**", (route) => {
    const accept = route.request().headers().accept || "";
    const wantsSingle = accept.includes("vnd.pgrst.object");
    return json(route, wantsSingle ? SEASON_2 : [SEASON_2]);
  });
  await page.route("**/rest/v1/training_plans**", (route) => json(route, TRAINING_PLAN_ROWS));
  await page.route("**/rest/v1/academy_graduation**", (route) => json(route, PENDING_GRADUATIONS));

  // Bestyrelsen: forhandlingen er åben (ikke baseline) og ingen plan er
  // færdigforhandlet → punktet skal stå som manglende.
  await page.route("**/api/board/status", (route) => json(route, {
    is_baseline_phase: false,
    setup_next_plan_type: "1yr",
    plans: {
      "1yr": { board: { negotiation_status: "pending", satisfaction: 62, focus: "balanced", budget_modifier: 1 } },
      "3yr": null,
      "5yr": null,
    },
    team: TEST_TEAM,
    riders: [],
    standing: null,
    identity_profile: null,
    auto_accept: null,
    active_loans_count: 0,
    team_members: [],
    active_consequences: [],
    bonus_offer: null,
    team_dna: null,
    dna_suggestions: [],
  }));
}

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
  await installSeasonStartMocks(page);
});

async function gotoDashboardInEnglish(page) {
  await login(page);
  await page.evaluate(async () => {
    if (window.__i18n) await window.__i18n.changeLanguage("en");
  });
  await expect.poll(() => page.evaluate(() => window.__i18n?.language)).toBe("en");
}

test("season start guide lists the four cutover decisions with working deep links", async ({ page }) => {
  await gotoDashboardInEnglish(page);

  const card = page.getByTestId("season-start-guide");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/Season 2: get started/i);

  // Alle fire beslutninger, hver med den rute beslutningen faktisk træffes på.
  const expected = [
    [/Build your squad/i, "/auctions"],
    [/Set the training plan/i, "/training"],
    [/Negotiate with the board/i, "/board"],
    [/Decide on academy graduates/i, "/academy"],
  ];
  for (const [name, href] of expected) {
    const row = card.getByRole("link", { name });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("href", href);
  }
});

test("done state follows the data, and unknown never renders as done", async ({ page }) => {
  await gotoDashboardInEnglish(page);
  const card = page.getByTestId("season-start-guide");

  // Træningsplanen er lagt (12 rækker) → præcis ét punkt er markeret udført.
  await expect(card).toContainText(/1 of 4 decisions made/i);
  await expect(card.getByRole("link", { name: /Set the training plan/i })).toContainText(/Done/i);
  await expect(card.getByRole("link", { name: /Build your squad/i })).not.toContainText(/Done/i);
});

test("dismissing the guide hides it", async ({ page }) => {
  await gotoDashboardInEnglish(page);
  const card = page.getByTestId("season-start-guide");
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: /Dismiss the season start guide/i }).click();
  await expect(card).toHaveCount(0);
});

test("capture season start guide screenshot", async ({ page }, testInfo) => {
  await gotoDashboardInEnglish(page);
  const card = page.getByTestId("season-start-guide");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/1 of 4 decisions made/i);

  // Parkér markøren uden for kortet. Uden dette kan en række fange :hover og
  // rendere i guld (--accent-t) i screenshottet, hvilket fejlagtigt ser ud som
  // et brud på guld-rationeringen når ejeren reviewer billedet.
  await page.mouse.move(0, 0);
  await expect(card.locator("a.text-cz-accent-t")).toHaveCount(0);

  await card.screenshot({
    path: evidenceShotPath(`docs/screenshots/wave3-2507/2925/season-start-guide-${testInfo.project.name}.png`),
  });
});
