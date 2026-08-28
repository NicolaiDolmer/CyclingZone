// #3786 + #3066 — rytterprofilens auktions-UX manglede to ting som resten af
// auktions-fladen allerede havde: et sluttidspunkt-vælger (#2884-flowet fra
// holdsiden) og bud-plads-gaten (#2701-flowet fra AuctionsPage.jsx). Begge
// dele kunne føre til at spilleren sendte en handling serveren garanteret
// afviste, uden at have set forklaringen først.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders, evidenceShotPath } from "./fixtures.js";

test.describe("Rider profile auction UX (#3786 + #3066)", () => {
  test.beforeEach(async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
  });

  test("#3786 — auction-end-time selector is visible on the rider profile's start-auction flow", async ({ page }) => {
    // Samme override som auction-startprice-typo-guard.spec.js: den generiske
    // auctions-mock returnerer altid hele AUCTIONS-arrayet uanset rider_id, så
    // rider-1 (egen rytter, ingen aktiv auktion i virkeligheden) ville ellers
    // arve auction-1 (som reelt hører til rider-2) og "Put up for auction"
    // ville aldrig vises.
    await page.route("**/rest/v1/auctions*", route => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      return json(route, []);
    });

    await login(page);
    await page.goto("/riders/rider-1");
    await expect(page.getByRole("heading", { name: "Ada Pedersen" })).toBeVisible();

    await page.getByRole("button", { name: /^(Put up for auction|Sæt til auktion)$/ }).click();

    const endTimeInput = page.getByTestId("rider-auction-end-time-input");
    await expect(endTimeInput).toBeVisible();
    // Standardforslaget skal ligge inde i det åbne vindue (08-24), samme regel
    // som holdsidens vælger (#2884) — ingen fejl vist for standardforslaget.
    const value = await endTimeInput.inputValue();
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    await expect(page.getByTestId("rider-auction-end-time-error")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Start auction|Start auktion)$/ })).toBeEnabled();

    await page.screenshot({ path: evidenceShotPath("pr-screens/3786-desktop-rider-profile-duration.png") });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: evidenceShotPath("pr-screens/3786-mobile-rider-profile-duration.png") });
  });

  test("#3786 — an out-of-window end time is rejected before the POST", async ({ page }) => {
    await page.route("**/rest/v1/auctions*", route => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      return json(route, []);
    });

    await login(page);
    await page.goto("/riders/rider-1");
    await page.getByRole("button", { name: /^(Put up for auction|Sæt til auktion)$/ }).click();

    const endTimeInput = page.getByTestId("rider-auction-end-time-input");
    await expect(endTimeInput).toBeVisible();
    const current = await endTimeInput.inputValue();
    // Samme #3792-rettelse som TeamPage's vælger-test: dagen SKAL rulle med,
    // ellers rammer natforslaget "for tidligt" i stedet for "uden for vinduet".
    const night = new Date(`${current}:00`);
    night.setDate(night.getDate() + 1);
    const pad = (n) => String(n).padStart(2, "0");
    const nightWall = `${night.getFullYear()}-${pad(night.getMonth() + 1)}-${pad(night.getDate())}T03:44`;
    await endTimeInput.fill(nightWall);

    const error = page.getByTestId("rider-auction-end-time-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText(/market is open|markedet er åbent/i);
    await expect(page.getByRole("button", { name: /^(Start auction|Start auktion)$/ })).toBeDisabled();
  });

  test("#3066 — a full senior squad blocks the bid/auto-bid UI on the rider profile", async ({ page }) => {
    // #3066: TEST_TEAM ejer kun ét seed (rider-1) — override optællingen så
    // senior-truppen fremstår fuld (30/30), præcis den situation der ramte
    // 3 spillere (CYCLINGZONE-3Y) uden nogen forklaring FØR de bød.
    await page.route("**/rest/v1/riders*", async route => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      const url = new URL(request.url());
      if (url.search.includes("team_id=eq.team-e2e") && url.search.includes("is_academy=eq.false")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { ...corsHeaders(request), "Content-Range": "0-29/30" },
          body: JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ id: `fake-senior-${i}` }))),
        });
      }
      // #3066: kun override count-queryen ovenfor — alt andet (fx profilens
      // egen id=eq-opslag) skal falde tilbage til installNetworkMocks' generiske
      // handler, ikke ramme det virkelige (ikke-eksisterende) netværk.
      return route.fallback();
    });

    await login(page);
    // rider-2 (Mikkel Hansen) har seedets eneste aktive auktion (auction-1,
    // RIVAL_TEAM's sælgende) — canBid=true for TEST_TEAM-brugeren.
    await page.goto("/riders/rider-2");
    await expect(page.getByRole("heading", { name: "Mikkel Hansen" })).toBeVisible();

    await expect(page.getByText(/senior squad is full|senior-trup er fuld/i)).toBeVisible();
    await expect(page.getByTestId("rider-auction-end-time-input")).toHaveCount(0);
    // Bud-inputtet må ikke findes — ikke bare være disabled. En spærret sektion
    // der stadig renderer feltet ville stadig lade et Enter-tryk poste et bud.
    await expect(page.getByLabel(/Your bid in CZ\$|Dit bud i CZ\$/i)).toHaveCount(0);

    await page.screenshot({ path: evidenceShotPath("pr-screens/3066-desktop-rider-profile-squad-full.png") });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: evidenceShotPath("pr-screens/3066-mobile-rider-profile-squad-full.png") });
  });
});

// #2748 — pension-minimum: rytterprofilens definitive "final season"-banner.
// Motoren har allerede besluttet pensionen for rytteren (announcedRetirementAfterSeason,
// backend/lib/riderProgression.js) — banneret må ALDRIG kun være et risiko-badge.
// Overrider den dedikerede /retirement-status-fetch direkte (samme princip som
// #3786-testen ovenfor overrider auctions*) i stedet for at konstruere en ægte
// 39-årig fødselsdato — selve determinismen er allerede bevist i
// riderProgression.test.js; her testes kun at UI'et RENDERER svaret korrekt.
test.describe("Rider profile final-season banner (#2748)", () => {
  test.beforeEach(async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
  });

  test("#2748 — a rider with announced_retirement=true shows the definitive final-season banner", async ({ page }) => {
    // Ingen aktiv auktion — banneret skal vises uden at konkurrere med
    // auction-banneret (prioritet: auction > finalSeason > academy > expiry).
    await page.route("**/rest/v1/auctions*", route => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      return json(route, []);
    });
    // Simulerer en 39-årig hvis pension motoren allerede har afgjort for den
    // aktive sæson (seedet i backend, se riderProgression.test.js for beviset).
    await page.route("**/api/riders/*/retirement-status**", route => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      return json(route, { announced_retirement: true });
    });

    await login(page);
    await page.goto("/riders/rider-1");
    await expect(page.getByRole("heading", { name: "Ada Pedersen" })).toBeVisible();

    await expect(page.getByText(/Final season|Sidste sæson/i)).toBeVisible();
    await expect(page.getByText(/Announced his retirement at the season start|Meldte sin pension ved sæsonstart/i)).toBeVisible();
    // Sæson-fixturet (ACTIVE_SEASON.number=1) skal interpoleres ind i teksten.
    await expect(page.getByText(/season 1 ends|sæson 1 slutter/i)).toBeVisible();

    await page.screenshot({ path: evidenceShotPath("pr-screens/2748-final-season-banner-desktop.png") });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: evidenceShotPath("pr-screens/2748-final-season-banner-mobile.png") });
  });

  test("#2748 — a rider without announced_retirement never shows the final-season banner", async ({ page }) => {
    await page.route("**/rest/v1/auctions*", route => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      return json(route, []);
    });
    await page.route("**/api/riders/*/retirement-status**", route => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      return json(route, { announced_retirement: false });
    });

    await login(page);
    await page.goto("/riders/rider-1");
    await expect(page.getByRole("heading", { name: "Ada Pedersen" })).toBeVisible();

    await expect(page.getByText(/Final season|Sidste sæson/i)).toHaveCount(0);
  });
});
