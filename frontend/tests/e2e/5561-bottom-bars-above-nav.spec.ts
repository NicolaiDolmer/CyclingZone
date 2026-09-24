// #5561 — bundbjælkerne (NPS, samtykke) står OVER bundmenuen på mobil, aldrig
// oven på den.
//
// Før: NPS-baren og cookie-banneret tegnede `fixed bottom-0` i z-toast og
// dækkede MobileQuickNav (56 px, z-nav) helt, så Dashboard / Indbakke / Marked /
// Ryttere / Mit Hold ikke kunne trykkes, før baren var lukket eller besvaret.
// Nu måler menuen sin højde (--cz-mobile-nav-offset) og bjælkerne står lige
// over den. Desktop er uændret: menuen er skjult og offsettet er 0.
//
// Guarden holder på det rettelsen LOVER:
//   1) Mobil 390: bjælkens nederste kant ligger på eller over menuens øverste
//      kant, og en menuknap kan klikkes mens baren er synlig.
//   2) Desktop 1440: bjælken står stadig helt nede i bunden.
//
// Testene sætter selv viewport, så alle tre Playwright-projekter kører de samme
// assertions.
import type { Locator, Page, Route } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, evidenceShotPath } from "./fixtures.js";

// NPS-gaten åbnes med vilje (samme greb som 5159-reload-gate.spec.js):
// fixturens testhold har for få afsluttede løbsdage, og uden disse routes ville
// baren aldrig vises.
async function makeNpsEligible(page: Page) {
  await page.route("**/rest/v1/users**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.searchParams.get("select") === "nps_last_prompted_at") {
      const row = { nps_last_prompted_at: null };
      const wantsObject = (request.headers().accept || "").includes("vnd.pgrst.object");
      return json(route, wantsObject ? row : [row]);
    }
    return route.fallback();
  });
  await page.route("**/rest/v1/nps_responses**", (route: Route) =>
    route.request().method() === "GET" ? json(route, []) : route.fallback(),
  );
  await page.route("**/api/rankings/race-count**", (route: Route) =>
    route.request().method() === "GET" ? json(route, { count: 5 }) : route.fallback(),
  );
}

async function setup(page: Page, { width, height }: { width: number; height: number }) {
  await page.setViewportSize({ width, height });
  await stabilizePage(page);
  await installNetworkMocks(page);
}

const quickNav = (page: Page) => page.locator("[data-mobile-quick-nav]");

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b, "elementet skal have en boks").not.toBeNull();
  return b!;
}

// Baren selv er en ydre `fixed`-wrapper med pointer-events:none; kortet inde i
// den er det spilleren ser. Den ydre boks' underkant er den der skal stå over
// menuen.
async function expectAboveNav(page: Page, bar: Locator) {
  const nav = await box(quickNav(page));
  const b = await box(bar);
  expect(b.y + b.height, "bjælkens underkant må ikke gå ned i bundmenuen").toBeLessThanOrEqual(nav.y + 0.5);
}

test.describe("mobil 390 × 844", () => {
  test("NPS-baren står over bundmenuen, og menuen kan bruges mens baren er synlig", async ({ page }) => {
    await setup(page, { width: 390, height: 844 });
    await makeNpsEligible(page);
    await login(page);

    const bar = page.getByRole("region", { name: "Feedback-prompt" });
    await expect(bar).toBeVisible({ timeout: 20_000 });
    await expect(quickNav(page)).toBeVisible();
    await expectAboveNav(page, bar);
    await page.screenshot({ path: evidenceShotPath("pr-screens/5561-nps-390.png") });

    // Menuen er ikke dækket: et klik på "Ryttere" navigerer, uden at baren
    // først er lukket eller besvaret.
    await quickNav(page).getByRole("link", { name: "Ryttere" }).click();
    await expect(page).toHaveURL(/\/riders$/);
  });

  test("samtykke-banneret står også over bundmenuen", async ({ page }) => {
    await setup(page, { width: 390, height: 844 });
    // stabilizePage giver samtykke; her skal spilleren IKKE have svaret endnu.
    await page.addInitScript(() => window.localStorage.removeItem("cz_consent_v1"));
    await login(page);

    const banner = page.getByRole("dialog", { name: "Jeg bruger data til at gøre spillet bedre" });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(quickNav(page)).toBeVisible();
    await expectAboveNav(page, banner);
    await page.screenshot({ path: evidenceShotPath("pr-screens/5561-consent-390.png") });
  });
});

test.describe("desktop 1440 × 900", () => {
  test("NPS-baren står i bunden som før (ingen bundmenu, offset 0)", async ({ page }) => {
    await setup(page, { width: 1440, height: 900 });
    await makeNpsEligible(page);
    await login(page);

    const bar = page.getByRole("region", { name: "Feedback-prompt" });
    await expect(bar).toBeVisible({ timeout: 20_000 });
    await expect(quickNav(page)).toBeHidden();
    const b = await box(bar);
    expect(Math.round(b.y + b.height), "desktop: bjælken slutter ved viewportens bund").toBe(900);
    await page.screenshot({ path: evidenceShotPath("pr-screens/5561-nps-1440.png") });
  });
});
