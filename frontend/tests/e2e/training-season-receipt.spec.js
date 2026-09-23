import { test, expect } from "./e2e-base.js";
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

// #5485 (A3): desktop-rækken bærer ikke længere kvitteringen; den står i
// rytterens kort, som navnet folder ud lige under rækken. Samme
// AbilityReceiptRow som før, så kravene nedenfor er de samme.
async function openCard(page, name = "Ada Pedersen") {
  await page.getByTestId("training-today-row").filter({ hasText: name })
    .getByRole("button", { name: new RegExp(name) }).click();
  const card = page.getByTestId("training-rider-detail");
  await expect(card).toBeVisible();
  return card;
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  // #3643: denne spec maaler DESKTOP-rosterets indhold. Telefonen har siden
  // 18/9 sin egen visning (tabel med dagens loebsdage, mockup 2), og den er
  // daekket af 3643-training-mobile.spec.js. Viewporten saettes derfor
  // eksplicit, saa alle tre projekter bliver ved med at koere DENNE flade i
  // deres egen motor i stedet for at teste en flade der ikke findes laengere.
  await page.setViewportSize({ width: 1280, height: 900 });
  await installNetworkMocks(page);
});

test("#3709 rytterens kort viser hver af fokussets evner, ikke ét aggregeret tal", async ({ page }, testInfo) => {
  await mockTrainingMe(page, { capped: { "rider-1": ["climbing"] } });
  await mockTrainingRuns(page);
  await login(page);
  await page.goto("/training");

  const receipt = await openCard(page);

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
    body: await receipt.screenshot(),
    contentType: "image/png",
  });
});

test("#3709 sæsonens point tælles fra sæsonstart, ikke fra 30-dages-vinduet", async ({ page }) => {
  await mockTrainingMe(page, { capped: {} });
  await mockTrainingRuns(page);
  await login(page);
  await page.goto("/training");

  const receipt = await openCard(page);

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

  const row = page.getByTestId("training-today-row").filter({ hasText: "Ada Pedersen" });
  const receipt = await openCard(page);

  // Teksterne lovede "stiger ikke igen, uanset hvordan rytteren træner".
  for (const surface of [row, receipt]) {
    await expect(surface.getByText(/Færdigudviklet i dette fokus/i)).toHaveCount(0);
    await expect(surface.getByText(/på loftet/i)).toHaveCount(0);
    await expect(surface.locator("option", { hasText: /loft nået/i })).toHaveCount(0);
  }

  // Alle tre evner er låste, så alle tre linjer siger "færdig". Ingen død bar.
  await expect(receipt.getByText("færdig", { exact: true })).toHaveCount(3);
});

test("#3706 Status-sorteringen samler akademi-rytterne", async ({ page }) => {
  await mockTrainingMe(page, { capped: {} });
  await mockTrainingRuns(page);
  await login(page);
  await page.goto("/training");

  // Overskriften var et bart <th> uden aria-sort og uden comparator, så et klik
  // gjorde ingenting (@cybersimon, Discord 13/8). #5485: Status er ikke længere
  // en kolonne (akademi, kontrakt og pension står i rytterens kort), men
  // sort-nøglen findes stadig i tabellens "Sortér efter" — samme kontrol og
  // samme comparator som telefonen.
  const table = page.getByTestId("training-today-table");
  const sortBy = table.getByRole("combobox", { name: "Sortér efter" });
  await sortBy.selectOption("status");
  await expect(sortBy).toHaveValue("status");
  // Desc-først, så akademi-rytterne lander øverst med ét klik.
  const dir = table.getByRole("button", { name: /Sorterer faldende/ });
  await expect(dir).toBeVisible();
  await dir.click();
  await expect(table.getByRole("button", { name: /Sorterer stigende/ })).toBeVisible();
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

  // #3706-bevis: sorteret på Status via tabellens "Sort by" (#5485: Status er
  // ikke længere en kolonne; nøglen bor i sorteringen).
  const sortBy = page.getByTestId("training-today-table").getByRole("combobox", { name: "Sort by" });
  await sortBy.selectOption("status");
  await expect(sortBy).toHaveValue("status");
  if (label === "desktop") {
    await page.screenshot({
      path: evidenceShotPath("pr-screens/3709-training-status-sort-desktop-en.png"),
      fullPage: false,
    });
  }
});
