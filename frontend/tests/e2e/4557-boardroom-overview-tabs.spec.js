// #4557 (overblik + faner, ejer-go 6/9 paa docs/design/mockups-boardroom-
// additions-2026-09-06/boardroom-tabs.html) · Boardroom-siden er nu ét overblik
// plus fire faner i stedet for en stak af kort. Denne spec daekker de tre ting
// mockup'en tilfoejede, som ingen anden spec rammer:
//
//   1. Fanerne skifter indhold og skriver sig i ?tab= (dyb-link + tilbage).
//   2. Bonustilbuddet (BOARD_RULES §4, lag 6) er synligt som én stribe paa
//      overblikket, og "Accept offer" rammer POST /board/bonus-offer/accept.
//   3. Et hold UDEN klub-DNA faar "Choose your club identity" oeverst paa
//      overblikket i stedet for tillidskortet.
import { readFileSync } from "node:fs";
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

// Samme moenster som board-meeting.spec.js: readFileSync + JSON.parse, fordi
// Playwright-test-runneren ikke understoetter import-attributter for JSON.
const boardRoomFixture = JSON.parse(
  readFileSync(new URL("../../src/pages/boardroom/__fixtures__/boardRoom.json", import.meta.url), "utf8"),
);
const dnaSuggestionsFixture = JSON.parse(
  readFileSync(new URL("../../src/pages/boardroom/__fixtures__/dnaSuggestions.json", import.meta.url), "utf8"),
);

// Registrerer /api/board/room + /api/board/meeting + /api/board/dna-* OVEN PAA
// installNetworkMocks (senest registrerede route vinder i Playwright).
// `state` er delt, saa GET /board/room svarer med det ACCEPTEREDE tilbud efter
// POST /bonus-offer/accept — praecis den genhentning `onReload` udloeser.
async function installBoardroomMocks(page, { hasDna = true, withBonusOffer = true } = {}) {
  const state = { accepted: false, acceptBody: null, declined: false };

  await page.route("**/api/board/room", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const offer = boardRoomFixture.bonusOffer;
    let bonusOffer = withBonusOffer ? offer : null;
    if (withBonusOffer && state.accepted) {
      bonusOffer = { ...offer, status: "accepted", acceptedAt: "2026-08-30T12:00:00Z" };
    }
    if (withBonusOffer && state.declined) bonusOffer = null;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...boardRoomFixture,
        team: { dnaKey: hasDna ? boardRoomFixture.team.dnaKey : null },
        bonusOffer,
      }),
    });
  });

  // Aarsmoedet er ikke aabent i denne spec — sidens ene guld-knap er derfor
  // skjult, og alt vi klikker paa er secondary/quiet.
  await page.route("**/api/board/meeting", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: false }) });
  });

  await page.route("**/api/board/dna-suggestions", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const body = hasDna
      ? { already_chosen: true, can_rechoose: false, suggestions: [] }
      : dnaSuggestionsFixture;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.route("**/api/board/bonus-offer/accept", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    state.acceptBody = JSON.parse(route.request().postData() || "{}");
    state.accepted = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
  });

  await page.route("**/api/board/bonus-offer/decline", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    state.declined = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
  });

  return state;
}

test("overblikket er default, og fanerne skifter indhold + ?tab= (#4557)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await installBoardroomMocks(page);

  await login(page);
  await page.goto("/board");

  // Overblik: tillidskortet + mandat-resuméet. Det fulde mandatkort (med
  // maal-ejernes monogrammer og kvitteringerne) hoerer til Mandat-fanen.
  await expect(page.getByRole("tab", { name: "Overblik" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Bestyrelsens tillid" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Åbn mandatet/ })).toBeVisible();

  // Bestyrelses-fanen: medlemmerne og referatet.
  await page.getByRole("tab", { name: "Bestyrelse" }).click();
  await expect(page).toHaveURL(/\?tab=board/);
  await expect(page.getByRole("heading", { name: "Bestyrelsen" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bestyrelsens tillid" })).toHaveCount(0);

  // Vision-fanen.
  await page.getByRole("tab", { name: "Vision" }).click();
  await expect(page).toHaveURL(/\?tab=vision/);

  // Dyb-link direkte til en fane virker (?tab= er sandheden, ikke en intern state).
  await page.goto("/board?tab=mandate");
  await expect(page.getByRole("tab", { name: "Mandat" })).toHaveAttribute("aria-selected", "true");
});

test("bonustilbuddet staar som én stribe paa overblikket, og Accept rammer den eksisterende rute (#4557)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const state = await installBoardroomMocks(page);

  await login(page);
  await page.goto("/board");

  // Striben ligger INDE i mandat-resumékortet, ikke som et femte kort.
  const stripe = page.getByText("Bonustilbud fra bestyrelsen.");
  await expect(stripe).toBeVisible();

  await page.getByRole("button", { name: "Acceptér tilbud" }).click();

  // Kaldet gik til den EKSISTERENDE rute med raekkens id, og siden genhentede
  // payloaden: striben er vaek og kvitteringen staar i stedet.
  await expect.poll(() => state.acceptBody?.offer_id).toBe(boardRoomFixture.bonusOffer.id);
  await expect(page.getByRole("button", { name: "Acceptér tilbud" })).toHaveCount(0);
  await expect(page.getByText(/sat ind på kontoen/)).toBeVisible();
});

test("hold uden klub-DNA faar identitetsvalget oeverst paa overblikket (#4557)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await installBoardroomMocks(page, { hasDna: false });

  await login(page);
  await page.goto("/board");

  const heading = page.getByRole("heading", { name: "Vælg klubbens identitet" });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("button", { name: "Vælg dette DNA" })).toHaveCount(3);

  // Valgkortet staar OVER tillidskortet (mockup-varianten: tillid rykker én ned).
  const dnaBox = await heading.boundingBox();
  const confidenceBox = await page.getByRole("heading", { name: "Bestyrelsens tillid" }).boundingBox();
  expect(dnaBox.y).toBeLessThan(confidenceBox.y);
});
