import { test, expect } from "@playwright/test";
import {
  installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, evidenceShotPath,
} from "./fixtures.js";

// #3709 trin 1 (afløser #3639's oprindelige dækning) — kvitteringen pr. evne.
//
// Historikken: tre spillere meldte 10/8 at klatring ikke steg ved VO2max-træning.
// De havde ret. Et fokus træner FLERE evner, men fladen aggregerede fokusset til
// ÉN progress-bar, som viste evnen TÆTTEST på gennembrud. En rytter med climbing
// på loftet og tempo i vækst så derfor helt normal ud. #3639 lappede det med to
// advarsels-tekster ("Klatring på loftet", "Færdigudviklet i dette fokus").
//
// Trin 1 fjerner både baren og teksterne. De tre loft-tekster lovede at en evne
// ALDRIG steg igen — sandt under den gamle model, usandt under den nye (#3649,
// spec §5.3). I stedet står hver evne på sin egen linje med hvad den er på NU,
// hvad rytteren fik i DENNE SÆSON, og hvor langt han er mod næste point. En låst
// evne skriver "færdig".
//
// capped indeholder kun ability-NØGLER (aldrig cap-TAL — server-hidden, #1162);
// testen ville fange det med det samme hvis et loft-tal begyndte at lække ud.

const BASE_TRAINING_ME = {
  enabled: true,
  betaTester: true,
  teamId: TEST_TEAM.id,
  slots: { total: null, used: 1, remaining: null },
  focuses: ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"],
  intensities: ["easy", "normal", "hard", "rest"],
  plans: { "rider-1": { focus: "vo2max", intensity: "normal" } },
  condition: { "rider-1": { form: 68, fatigue: 35, injured_until: null, risk: 0.02 } },
  // tempo tættest på gennembrud → den gamle ENE bar VILLE have vist tempo og
  // skjult climbing. Nu står begge evner der.
  progress: { "rider-1": { climbing: 0.0, punch: 0.2, tempo: 0.74 } },
  todayRun: null,
  weekPlan: null,
  riderWeekPlans: {},
};

// Sæsonens træningsdage. Den første ligger FØR sæsonstart og må ikke tælles med:
// vinduet er 30 dage, sæsonen 28, så forrige sæsons hale er inde i svaret.
const TRAINING_DAY_RUNS = [
  {
    tick_date: "2026-05-04", executed_by: "manager", bonus_applied: true,
    report: { riders: [{ rider_id: "rider-1", name: "Ada Pedersen", focus: "vo2max", intensity: "normal", gains: { tempo: 2 }, fatigue_delta: 3 }] },
  },
  {
    tick_date: "2026-04-28", executed_by: "manager", bonus_applied: false,
    report: { riders: [{ rider_id: "rider-1", name: "Ada Pedersen", focus: "vo2max", intensity: "normal", gains: { tempo: 9 }, fatigue_delta: 2 }] },
  },
];

async function mockTrainingMe(page, overrides = {}) {
  await page.route("**/api/training/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, { ...BASE_TRAINING_ME, ...overrides });
  });
}

async function mockTrainingRuns(page, rows = TRAINING_DAY_RUNS) {
  await page.route("**/rest/v1/training_day_runs**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, rows);
  });
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
});

test("#3709 roster-rækken viser hver af fokussets evner, ikke ét aggregeret tal", async ({ page }, testInfo) => {
  await mockTrainingMe(page, { capped: { "rider-1": ["climbing"] } });
  await mockTrainingRuns(page);
  await login(page);
  await page.goto("/training");

  const row = page.locator("tbody tr", { hasText: "Ada Pedersen" }).first();
  const receipt = row.locator("td").filter({ hasText: /Klatring/ }).first();

  // vo2max = climbing + punch + tempo. Alle tre står nu på hver sin linje.
  for (const label of ["Klatring", "Punch", "Tempo"]) {
    await expect(receipt.getByText(label, { exact: true })).toBeVisible();
  }

  // Den låste evne siger "færdig" i stedet for en død bar, uden at love noget.
  const done = receipt.getByText("færdig", { exact: true });
  await expect(done).toBeVisible();
  await expect(done).not.toHaveText(/\d/);
  expect(await done.getAttribute("title")).not.toMatch(/\d/);
  expect(await done.getAttribute("title")).not.toMatch(/aldrig/i);

  // Evnen med hovedrum viser stadig sin fremdrift.
  await expect(receipt.getByText("74%")).toBeVisible();

  await testInfo.attach("3709-roster-kvittering", {
    body: await row.screenshot(),
    contentType: "image/png",
  });
});

test("#3709 sæsonens point tælles fra sæsonstart, ikke fra 30-dages-vinduet", async ({ page }) => {
  await mockTrainingMe(page, { capped: {} });
  await mockTrainingRuns(page);
  await login(page);
  await page.goto("/training");

  const row = page.locator("tbody tr", { hasText: "Ada Pedersen" }).first();
  const receipt = row.locator("td").filter({ hasText: /Klatring/ }).first();

  // Tempo fik 2 point i sæsonen (4/5) og 9 point dagen før sæsonstart (28/4).
  // Ville filteret mangle, stod der +11 her.
  await expect(receipt.getByText("+2", { exact: true })).toBeVisible();
  await expect(receipt.getByText("+11", { exact: true })).toHaveCount(0);
});

test("#3709 de tre loft-tekster er væk fra fladen", async ({ page }) => {
  await mockTrainingMe(page, { capped: { "rider-1": ["climbing", "punch", "tempo"] } });
  await mockTrainingRuns(page);
  await login(page);
  await page.goto("/training");

  const row = page.locator("tbody tr", { hasText: "Ada Pedersen" }).first();

  // Teksterne lovede "stiger ikke igen, uanset hvordan rytteren træner".
  await expect(row.getByText(/Færdigudviklet i dette fokus/i)).toHaveCount(0);
  await expect(row.getByText(/på loftet/i)).toHaveCount(0);
  await expect(row.locator("option", { hasText: /loft nået/i })).toHaveCount(0);

  // Alle tre evner er låste, så alle tre linjer siger "færdig". Ingen død bar.
  const receipt = row.locator("td").filter({ hasText: /Klatring/ }).first();
  await expect(receipt.getByText("færdig", { exact: true })).toHaveCount(3);
});

test("#3706 Status-kolonnen sorterer akademi-rytterne sammen", async ({ page }) => {
  await mockTrainingMe(page, { capped: {} });
  await mockTrainingRuns(page);
  await login(page);
  await page.goto("/training");

  // Overskriften var et bart <th> uden aria-sort og uden comparator, så et klik
  // gjorde ingenting (@cybersimon, Discord 13/8). Nu er den samme SortableTh som
  // navn/type/form/træthed: aria-sort går fra "none" til en retning ved klik.
  const header = page.getByRole("columnheader", { name: /Status/i }).first();
  await expect(header).toBeVisible();
  await expect(header).toHaveAttribute("aria-sort", "none");
  await header.click();
  // Desc-først, så akademi-rytterne lander øverst med ét klik.
  await expect(header).toHaveAttribute("aria-sort", "descending");
  await header.click();
  await expect(header).toHaveAttribute("aria-sort", "ascending");
});

test("#3709 EN-bevis: kvitteringen på rytterprofilens Træning-fane", async ({ page }, testInfo) => {
  await mockTrainingMe(page, { capped: { "rider-1": ["climbing", "acceleration"] } });
  await mockTrainingRuns(page);
  await login(page);

  // Copy'en er EN-first, så PR-beviset tages på engelsk. Login-helperen kræver de
  // danske placeholders, så sproget flyttes FØRST bagefter, og via addInitScript
  // fordi stabilizePage's eget init-script sætter cz_lang=da ved HVER navigation.
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  await page.goto("/riders/rider-1");
  await page.getByRole("tab", { name: "Training" }).click();

  const card = page
    .getByRole("heading", { name: "This season" })
    .locator("xpath=ancestor::div[contains(@class,'bg-cz-card')][1]");
  await expect(card).toBeVisible();

  // Alle tre kolonner + "done" på de låste evner, og et sæson-tal der ikke er
  // et opfundet nul (sæsonstarten er kendt, så tallet er en rigtig sum).
  // Tre kategori-blokke (Physical/Mental/Technical) → tre kolonne-overskrifter.
  await expect(card.getByText("Now", { exact: true })).toHaveCount(3);
  await expect(card.getByText("Season", { exact: true })).toHaveCount(3);
  await expect(card.getByText("done", { exact: true }).first()).toBeVisible();
  await expect(card.getByText("+2", { exact: true })).toBeVisible();

  // #1162: kvitteringen må aldrig vise et loft-tal. Tooltip'et på "done" er den
  // eneste tekst der overhovedet taler om grænsen, og den nævner intet tal.
  expect(await card.getByText("done", { exact: true }).first().getAttribute("title")).not.toMatch(/\d/);

  await testInfo.attach(`3709-profil-kvittering-${testInfo.project.name}`, {
    body: await card.screenshot(),
    contentType: "image/png",
  });

  // De to mobil-projekter rammer samme layout, så kun ét mobil-billede committes.
  if (testInfo.project.name === "mobile-webkit") return;
  const label = testInfo.project.name === "desktop-chromium" ? "desktop" : "mobile";
  await page.screenshot({
    path: evidenceShotPath(`pr-screens/3709-rider-profile-receipt-${label}-en.png`),
    fullPage: false,
  });

  // Den anden flade i samme sprog og samme kørsel: roster-tabellens kvittering.
  await page.goto("/training");
  await expect(page.locator("tbody tr", { hasText: "Ada Pedersen" }).first()).toBeVisible();
  await page.screenshot({
    path: evidenceShotPath(`pr-screens/3709-training-roster-${label}-en.png`),
    fullPage: false,
  });

  // #3706-bevis: Status-kolonnen efter et klik på dens overskrift. Kolonnen
  // ligger til højre for kvitteringen og er derfor uden for viewporten i den
  // normale bredde, så beviset tages i en bredere viewport (kun til billedet,
  // ingen assertion afhænger af bredden).
  const statusHeader = page.getByRole("columnheader", { name: /Status/i }).first();
  await statusHeader.click();
  await expect(statusHeader).toHaveAttribute("aria-sort", "descending");
  if (label === "desktop") {
    await page.setViewportSize({ width: 1700, height: 700 });
    await expect(statusHeader).toBeInViewport();
    await page.screenshot({
      path: evidenceShotPath("pr-screens/3709-training-status-sort-desktop-en.png"),
      fullPage: false,
    });
  }
});
