// #3643 — træningssiden på mobil, bygget efter ejerens valg 18/9 (mockup 2,
// tabel). Guarden her holder på det formen LOVER, ikke på pixels:
//
//   1) Ingen vandret scroll på hverken 412 px, 375 px eller i landskab
//      (892 × 412) — målt på `document.scrollingElement.scrollWidth`, ikke håbet.
//   2) Rækker er ryttere, kolonner er dagens løbsdage. Med
//      `training_tick_per_race_day` OFF er der PRÆCIS én kolonne ("I dag"),
//      og tabellen skifter ikke form når tallet en dag bliver 4.
//   3) Den rytter man trykker på får sit fulde kort ÉN gang under tabellen —
//      form, træthed og "tæller for <rolle>" er dér, ikke bag vandret scroll.
//   4) "Skift" i kortet åbner det SAMME dagspanel som desktop bruger, så
//      sidens hovedhandling er to tryk væk uden nogen "Fuld tabel".
//   5) Alle tryk-mål ≥ 44 px.
//   6) #5350: navnet er forkortet ("A. Pedersen"), og ryttertypen er en dæmpet
//      underlinje i stedet for en badge der æder bredden.
//   7) Desktop (1280 px) er UÆNDRET: samme kolonner som før, ingen mobil-tabel.
//
// Testene sætter selv viewport, så alle tre Playwright-projekter kører de samme
// mobil-assertions (desktop-chromium inkluderet) — mobil-formen må ikke kunne
// drive i én motor uden at de to andre ser det.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, RIDERS, evidenceShotPath } from "./fixtures.js";

const TYPES = ["sprinter", "climber", "rouleur", "puncheur", "tt", "allrounder"];
const SESSIONS = ["sprint", "threshold", "endurance", "vo2max", "tempo", "technique"];

// En trup i realistisk størrelse. Den ægte fixture-rytter (rider-1, Ada
// Pedersen) beholdes som første række, så de andre træningsspecs' navne stadig
// betyder det samme her.
const base = RIDERS.find((r) => r.id === "rider-1");
const SQUAD = [
  base,
  ...Array.from({ length: 10 }, (_, i) => ({
    ...base,
    id: `rider-3643-${i}`,
    firstname: ["Mathias", "Tom", "Luca", "Rafael", "Viktor", "Antoine", "Soeren", "Jonas", "Emil", "Nikolaj"][i],
    lastname: ["Soerensen", "Van Aerde", "Colombo", "Duran", "Lindqvist", "Fabre", "Mikkelsen", "Halvorsen", "Bakker", "Riis"][i],
    team_id: TEST_TEAM.id,
    primary_type: TYPES[i % TYPES.length],
    secondary_type: TYPES[(i + 2) % TYPES.length],
    is_academy: false,
  })),
];

const plans = {};
const condition = {};
const progress = {};
for (const [i, rider] of SQUAD.entries()) {
  plans[rider.id] = { focus: SESSIONS[i % SESSIONS.length], intensity: ["normal", "hard", "easy"][i % 3] };
  condition[rider.id] = { form: 55 + ((i * 7) % 35), fatigue: 18 + ((i * 11) % 45), injured_until: null, risk: 0 };
  progress[rider.id] = { sprint: 0.64, flat: 0.2, threshold: 0.41, endurance: 0.55, tempo: 0.3, vo2max: 0.47 };
}

const TRAINING_ME = {
  enabled: true,
  betaTester: true,
  teamId: TEST_TEAM.id,
  slots: { total: null, used: SQUAD.length, remaining: null },
  focuses: SESSIONS,
  intensities: ["easy", "normal", "hard", "rest"],
  plans,
  condition,
  progress,
  capped: { "rider-1": ["durability"] },
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
  await page.route("**/rest/v1/riders**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, SQUAD);
  });
  await page.route("**/api/training/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, TRAINING_ME);
  });
});

const roster = (page) => page.locator('[data-testid="training-mobile-roster"]');

// Vandret side-scroll måles på dokumentet selv: en tabel der stikker ud af sin
// ramme flytter netop dette tal, uanset hvilken container den ligger i.
async function pageScrollOverflow(page) {
  return page.evaluate(
    () => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
  );
}

async function openTraining(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto("/training");
  await roster(page).waitFor();
  await expect(page.getByText("A. Pedersen")).toBeVisible();
}

test("412 px: tabel med dagens løbsdage, ingen vandret scroll, ingen 'Fuld tabel'", async ({ page }, testInfo) => {
  await login(page);
  await openTraining(page, 412, 915);

  await expect.poll(() => pageScrollOverflow(page)).toBeLessThanOrEqual(1);

  // Flaget er OFF i alle miljøer i dag → præcis én løbsdags-kolonne, og den
  // hedder "I dag" i stedet for at nummerere en model der ikke kører endnu.
  const headers = roster(page).locator("thead th");
  await expect(headers).toHaveCount(2);
  await expect(headers.nth(1)).toHaveText("I dag");

  // #5350: navnet er forkortet, og typen er en dæmpet underlinje — ikke en badge.
  await expect(page.getByText("A. Pedersen")).toBeVisible();
  await expect(roster(page).getByText(/SPRINTER\/ROULEUR · F\d+ · T\d+/i).first()).toBeVisible();

  // D-047's chip-række og "Fuld tabel" hører til desktop-tabellens gamle
  // mobil-tilstand og findes ikke i den nye visning.
  await expect(page.getByRole("button", { name: "Fuld tabel" })).toHaveCount(0);

  await page.screenshot({ path: evidenceShotPath(`pr-screens/3643-training-mobile-412-${testInfo.project.name}.png`), fullPage: true });
});

test("412 px: rytteren man trykker på får sit fulde kort ÉN gang, og 'Skift' åbner dagspanelet", async ({ page }, testInfo) => {
  await login(page);
  await openTraining(page, 412, 915);

  // Ingen rytter valgt → et hint, ikke et tomt kort.
  await expect(page.getByText(/Tryk på en rytter/)).toBeVisible();

  await page.getByRole("button", { name: /A\. Pedersen/ }).click();

  // Kortet bærer præcis det beslutningen kræver: form + træthed som tal,
  // rollens opskrift som evne-chips, og loftet som chip i evnelisten.
  const card = page.locator("section", { hasText: "Tæller for" }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText("Tæller for Sprinter")).toBeVisible();
  await expect(card.getByText("på loftet")).toBeVisible();

  // ÉN gang: kortet står under tabellen, ikke i hver række.
  await expect(page.getByText("Tæller for Sprinter")).toHaveCount(1);
  await expect.poll(() => pageScrollOverflow(page)).toBeLessThanOrEqual(1);

  await page.screenshot({ path: evidenceShotPath(`pr-screens/3643-training-mobile-412-card-${testInfo.project.name}.png`), fullPage: true });

  // Sidens hovedhandling: "Skift" åbner det SAMME dagspanel desktop bruger.
  await card.getByRole("button", { name: "Skift" }).click();
  await expect(page.getByText(/1 · Hvad slags dag/)).toBeVisible();
});

test("375 px: stadig ingen vandret scroll, og alle tryk-mål er mindst 44 px", async ({ page }, testInfo) => {
  await login(page);
  await openTraining(page, 375, 812);

  await expect.poll(() => pageScrollOverflow(page)).toBeLessThanOrEqual(1);

  // Rækkeknapperne + den ene gold primary + assistent-panelet. 44 px er #1602's
  // krav og gælder hele fladen, ikke kun knapper der ligner knapper.
  const tooSmall = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("main button, main a[href]")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.height < 44) out.push(`${el.textContent.trim().slice(0, 30)}=${Math.round(r.height)}`);
    }
    return out;
  });
  // Hjælp-linket er brødtekst, ikke et tryk-mål, og står bevidst som et
  // dæmpet link (P9: manualen bor i Hjælp).
  expect(tooSmall.filter((s) => !s.startsWith("Sådan virker træning"))).toEqual([]);

  await page.screenshot({ path: evidenceShotPath(`pr-screens/3643-training-mobile-375-${testInfo.project.name}.png`), fullPage: true });
});

test("landskab 892 × 412 (#4982): tabellen fylder bredden ud uden boks-scroll", async ({ page }, testInfo) => {
  await login(page);
  await page.setViewportSize({ width: 892, height: 412 });
  await page.goto("/training");

  // Over 640 px er det desktop-fladen der tegnes — landskabs-kravet er at
  // INGEN af de to former lægger siden bag en vandret scroll.
  await page.locator("table").first().waitFor();
  await expect.poll(() => pageScrollOverflow(page)).toBeLessThanOrEqual(1);

  await page.screenshot({ path: evidenceShotPath(`pr-screens/3643-training-mobile-892x412-${testInfo.project.name}.png`), fullPage: false });
});

test("desktop 1280 px: uændret — alle kolonner som før, ingen mobil-tabel", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-regressionstjek; mobil-formen dækkes af testene ovenfor.");
  await login(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/training");
  await page.locator("table[data-sortable]").first().waitFor();

  await expect(page.getByRole("columnheader", { name: "Denne sæson" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Ugeplan" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
  await expect(roster(page)).toHaveCount(0);
  // "Gruppér efter type" bliver stående på desktop (ejer 18/9), og fjernes kun
  // på mobil.
  await expect(page.getByText("Gruppér efter type")).toBeVisible();

  await page.screenshot({ path: evidenceShotPath(`pr-screens/3643-training-desktop-1280-${testInfo.project.name}.png`), fullPage: false });
});
