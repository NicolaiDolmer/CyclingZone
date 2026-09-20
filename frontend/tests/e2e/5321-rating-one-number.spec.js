// #5321 — samme rytter, samme rating-tal på to flader.
//
// Spilleren mandia1984 sendte 16/9 to mobil-skærmbilleder af samme rytter med to
// forskellige rating-tal. Rod-årsagen var ikke to formler, men ét sted der kørte
// den rigtige formel på for lidt data: planlæggeren regnede ratingen ud af
// board-payloadens `abilities`, og det felt er løbsmotorens UDSNIT af evne-rækken.
// `ratingForRole` springer en manglende evne over i både tæller og nævner, så et
// udsnit giver et andet tal end hele rækken.
//
// SSOT: GAME_DESIGN_DOCUMENT.md D-049 (ejer-valgt 11/9) — rating-tallet på
// rytterkort, i tabeller og på markedet er den samme størrelse overalt.
//
// Testen beviser to ting på ægte flader, ved 393px (mandia1984 var på mobil):
//   1) Mit hold og planlæggeren viser SAMME tal for samme rytter.
//   2) Planlæggeren viser serverens rating-felt og regner det ikke selv om —
//      testen serverer et felt der ikke kan genskabes af `abilities`, og fladen
//      skal stadig vise feltet. Før rettelsen ville den vise sit eget tal.
import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks, stabilizePage, login, json, corsHeaders, evidenceShotPath, RIDERS,
} from "./fixtures.js";
import { ratingForRole } from "../../src/lib/generated/displayRecipes.js";
import { previewPlannerBoard } from "../../src/preview/plannerMock.js";

const ADA = RIDERS.find((r) => r.id === "rider-1");
const ADA_ABILITIES = ADA.rider_derived_abilities;
// Præcis den projektion serveren sender til løbsmotoren — nøglesættet læses af
// mocken i stedet for at blive skrevet af igen, så det ikke kan drive fra hinanden.
const ENGINE_ABILITY_KEYS = Object.keys(previewPlannerBoard().riders[0].abilities);
const ENGINE_SLICE = Object.fromEntries(ENGINE_ABILITY_KEYS.map((k) => [k, ADA_ABILITIES[k]]));
// Den kanoniske rating: hele evne-rækken gennem rollens opskrift.
const CANONICAL_RATING = ratingForRole(ADA_ABILITIES, ADA.primary_type);

function boardWithAda(rating) {
  const base = previewPlannerBoard();
  return {
    ...base,
    riders: [{
      id: ADA.id,
      firstname: ADA.firstname,
      lastname: ADA.lastname,
      nationality: ADA.nationality_code,
      age: 24,
      primaryType: ADA.primary_type,
      secondaryType: ADA.secondary_type,
      isAcademy: false,
      form: 60,
      fatigue: 20,
      injuredUntil: null,
      abilities: ENGINE_SLICE,
      rating,
      registeredRaceIds: [],
      peaks: [],
    }],
  };
}

async function routeBoard(page, rating) {
  await page.route("**/api/peak-plans/board**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, boardWithAda(rating));
  });
}

async function plannerRatingText(page) {
  await page.goto("/planning?tab=form");
  // Planlæggeren forkorter fornavnet (riderShortName) — efternavnet er det der
  // holder på tværs af de to flader.
  const row = page.locator("tr", { hasText: /Pedersen/ }).first();
  await row.waitFor();
  // Rating-plakaten er rækkens første tal-chip (PlannerSquad.jsx).
  return (await row.locator("span.tabular-nums").first().innerText()).trim();
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
});

test("#5321: samme rytter viser samme rating på Mit hold og på planlæggeren (393px)", async ({ page }, testInfo) => {
  await routeBoard(page, CANONICAL_RATING);
  await login(page);
  await page.setViewportSize({ width: 393, height: 852 });

  await page.goto("/team");
  const teamRow = page.locator("tr", { hasText: "Ada Pedersen" }).first();
  await teamRow.waitFor();
  await expect(teamRow).toContainText(String(CANONICAL_RATING));
  await page.screenshot({
    path: evidenceShotPath(`pr-screens/5321-myteam-393-${testInfo.project.name}.png`),
    fullPage: false,
  });

  const plannerText = await plannerRatingText(page);
  await page.screenshot({
    path: evidenceShotPath(`pr-screens/5321-planner-393-${testInfo.project.name}.png`),
    fullPage: false,
  });

  expect(plannerText).toBe(String(CANONICAL_RATING));
});

test("#5321: planlæggeren viser serverens rating-felt, ikke et tal den selv regner", async ({ page }) => {
  // Et felt der beviseligt ikke kan komme ud af `abilities`. Før rettelsen
  // regnede fladen sit eget tal af udsnittet og ville vise dét i stedet.
  const SENTINEL = 7;
  expect(ratingForRole(ENGINE_SLICE, ADA.primary_type)).not.toBe(SENTINEL);

  await routeBoard(page, SENTINEL);
  await login(page);
  await page.setViewportSize({ width: 393, height: 852 });

  expect(await plannerRatingText(page)).toBe(String(SENTINEL));
});
