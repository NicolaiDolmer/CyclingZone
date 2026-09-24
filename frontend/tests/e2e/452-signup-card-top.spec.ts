// #452 — tilmeldingskortet til næste sæson står øverst på dashboardet for de
// managers der ser det (ejer-go 23/9).
//
// Før lå "Keep your spot for season N" blandt de betingede engangskort, under
// [Holdudtagelse | Sæsonstatus]: nederst på første skærm på desktop og under
// folden på telefonen (390 × 844). Nu står det lige under trup-/kontrakt-
// advarslerne og over dagens etaper, i samme konto-risiko-klasse som dem
// (docs/DASHBOARD_RULES.md §2).
//
// Guarden holder på det flytningen LOVER, ikke på pixels:
//   1) Når kortet vises (flag on + parkeret/sovende), står det OVER
//      holdudtagelses-kortet og helt på første skærm, på desktop 1440 × 900 og
//      mobil 390 × 844 (over den faste bundnavigation).
//   2) Én guld pr. view er uændret: står holdudtagelsen med guld, er
//      tilmeldingsknappen sekundær; uden holdudtagelse får den guld.
//   3) Aktive managers (flag on, ikke kandidat) ser intet kort, og
//      holdudtagelses-kortet står præcis samme sted som med flaget slukket.
//
// Testene sætter selv viewport, så alle tre Playwright-projekter kører de samme
// assertions.
import type { Locator, Page, Route } from "@playwright/test";
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

type SignupStatus = {
  enabled: boolean;
  eligible: boolean;
  parked: boolean;
  signed_up: boolean;
  next_season_number: number;
};

// Sovende manager (30 dage uden login, ikke parkeret endnu) — kortets
// "Keep your spot"-form. Flaget er on (ejer 23/9).
const DORMANT: SignupStatus = { enabled: true, eligible: true, parked: false, signed_up: false, next_season_number: 4 };
const PARKED: SignupStatus = { ...DORMANT, parked: true };
// Aktiv manager: flaget er on, men holdet er ikke kandidat.
const ACTIVE: SignupStatus = { ...DORMANT, eligible: false };
const FLAG_OFF: SignupStatus = { ...DORMANT, enabled: false, eligible: false };

// Ét planlagt løb uden manuel udtagelse → holdudtagelses-kortet vises (samme
// greb som core-smoke's "team-selection CTA"-test).
const SCHEDULED_RACE = {
  id: "race-452-next",
  name: "Tour Test Prologue",
  race_type: "one_day",
  race_class: "Class1",
  stages: 1,
  status: "scheduled",
  season_id: "season-e2e",
  pool_race: { date_text: "5/7" },
};

const SIZES = [
  { label: "desktop 1440 × 900", slug: "1440", width: 1440, height: 900 },
  { label: "mobil 390 × 844", slug: "390", width: 390, height: 844 },
];

const GOLD = /\bbg-cz-accent\b/;

async function mockSignupStatus(page: Page, status: SignupStatus) {
  await page.route("**/api/season/signup-status**", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, status);
  });
}

async function mockRaces(page: Page, rows: (typeof SCHEDULED_RACE)[]) {
  // Override OVEN PÅ installNetworkMocks (senest registrerede route vinder).
  // Tom liste = ingen holdudtagelse mangler (default-fixturen har selv løb).
  await page.route("**/rest/v1/races?**", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    return json(route, rows);
  });
}

async function openDashboard(
  page: Page,
  { width, height, status, withRace = true }: { width: number; height: number; status: SignupStatus; withRace?: boolean },
) {
  await mockSignupStatus(page, status);
  await mockRaces(page, withRace ? [SCHEDULED_RACE] : []);
  await login(page);
  // Copy'en er EN-first, så beviset tages på engelsk: login-helperen kræver de
  // danske placeholders, og stabilizePage sætter cz_lang=da ved hver
  // navigation, så sproget flyttes EFTER login (samme greb som #5485).
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  await page.setViewportSize({ width, height });
  await gotoDashboard(page);
  if (withRace) await expect(page.getByTestId("team-selection-cta")).toBeVisible();
}

// Venter på at signup-status faktisk er besvaret (ellers er "intet kort" sandt
// bare fordi kaldet ikke er landet endnu) og på stabil geometri, så en
// y-måling ikke rammer midt i indlæsningen af kortene ovenover.
async function gotoDashboard(page: Page) {
  const statusAnswered = page.waitForResponse((res) => res.url().includes("/api/season/signup-status"));
  await page.goto("/dashboard");
  await statusAnswered;
  await expect(page.getByRole("heading", { name: "E2E Racing" })).toBeVisible();
  await waitForStableSnapshotTarget(page);
}

// Første skærm = viewporten minus den faste bundnavigation på telefonen
// (MobileQuickNav bærer målekrogen data-mobile-quick-nav, #3643).
async function onFirstScreen(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const size = page.viewportSize();
  if (!box || !size) return false;
  const navHeight = await page.evaluate(() => {
    const nav = document.querySelector("[data-mobile-quick-nav]");
    if (!nav) return 0;
    const rect = nav.getBoundingClientRect();
    return rect.height > 0 && getComputedStyle(nav).display !== "none" ? rect.height : 0;
  });
  return box.y >= 0 && box.x >= 0 && box.y + box.height <= size.height - navHeight && box.x + box.width <= size.width;
}

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

for (const size of SIZES) {
  test(`${size.label}: sovende manager ser tilmeldingskortet over holdudtagelsen, på første skærm`, async ({ page }) => {
    await openDashboard(page, { width: size.width, height: size.height, status: DORMANT });

    const card = page.getByTestId("season-signup-card");
    const squad = page.getByTestId("team-selection-cta");
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Keep your spot for season 4/);
    await expect(card.getByRole("button", { name: /Sign up for next season/ })).toBeVisible();

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await onFirstScreen(page, card), "tilmeldingskortet skal stå helt på første skærm").toBe(true);

    // Over holdudtagelses-kortet — både i DOM-rækkefølgen og på skærmen.
    const cardBox = await card.boundingBox();
    const squadBox = await squad.boundingBox();
    expect(cardBox && squadBox).toBeTruthy();
    expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(squadBox!.y);
    const cardFirstInDom = await card.evaluate(
      (el, other) => Boolean(other && el.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING),
      await squad.elementHandle(),
    );
    expect(cardFirstInDom).toBe(true);

    // Én guld pr. view er uændret: holdudtagelsen ejer guldet, tilmeldingen er sekundær.
    await expect(squad.getByRole("link")).toHaveClass(GOLD);
    await expect(card.getByRole("button", { name: /Sign up for next season/ })).not.toHaveClass(GOLD);

    await page.screenshot({ path: evidenceShotPath(`pr-screens/452-dashboard-${size.slug}-dormant.png`) });
  });

  test(`${size.label}: aktiv manager ser intet kort, og holdudtagelsen står hvor den plejer`, async ({ page }) => {
    // Referencen: flaget slukket.
    await openDashboard(page, { width: size.width, height: size.height, status: FLAG_OFF });
    await expect(page.getByTestId("season-signup-card")).toHaveCount(0);
    const reference = await page.getByTestId("team-selection-cta").boundingBox();

    // Flaget on, men holdet er aktivt (ikke kandidat): intet ændrer sig.
    await mockSignupStatus(page, ACTIVE);
    await gotoDashboard(page);
    const squad = page.getByTestId("team-selection-cta");
    await expect(squad).toBeVisible();
    await expect(page.getByTestId("season-signup-card")).toHaveCount(0);
    const active = await squad.boundingBox();
    expect(reference && active).toBeTruthy();
    expect(active!.y).toBe(reference!.y);
    expect(active!.height).toBe(reference!.height);
    await expect(squad.getByRole("link")).toHaveClass(GOLD);

    await page.screenshot({ path: evidenceShotPath(`pr-screens/452-dashboard-${size.slug}-active.png`) });
  });
}

test("desktop 1440 × 900: parkeret hold uden holdudtagelse — tilmeldingen får viewets ene guld, øverst", async ({ page }) => {
  await openDashboard(page, { width: 1440, height: 900, status: PARKED, withRace: false });

  const card = page.getByTestId("season-signup-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/Your team was parked/);
  await expect(page.getByTestId("team-selection-cta")).toHaveCount(0);
  expect(await onFirstScreen(page, card)).toBe(true);
  await expect(card.getByRole("button", { name: /Sign up for next season/ })).toHaveClass(GOLD);

  await page.screenshot({ path: evidenceShotPath("pr-screens/452-dashboard-1440-parked.png") });
});
