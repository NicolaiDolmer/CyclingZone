import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, RIDERS, evidenceShotPath,
} from "./fixtures.js";

// #3761 + #3815 — de to manglende beslutningsgrundlag på Daglig træning.
//
// #3761: Status-kolonnen viste ÉN af de 8 badges rytteren kan bære (akademi).
// De to der manglede er præcis dem der afgør om træning på rytteren
// overhovedet er en investering værd: kontrakten udløber ved næste
// sæsonskifte (contractExpiring), eller rytteren er i/lige før pensions-
// vinduet (retireRisk). Begge findes allerede som helpers i riderAge.js og
// vises på TeamPage — testen låser at de nu også står HER, via den delte
// RiderBadges-recipe, og at akademiryttere undtages ligesom på TeamPage.
//
// #3815: alderen er den vigtigste enkeltvariabel når man vælger hvem der skal
// trænes hårdt, og manglede på den flade hvor valget træffes (@knud_r_flink,
// Discord 15/8). #1674 lukkede hullet på rytteroverblik + transferliste, men
// ikke her. #5485: alderen står nu i navnets underlinje og i kortet, og
// sorteringen findes i tabellens "Sortér efter". Oprindeligt: i portræt følger
// den samme fold som Type/Form/Træthed (#3045): tallet står i navne-
// underlinjen, ikke i en egen kolonne der ville stjæle plads fra Dag/Skift dag.
//
// ACTIVE_SEASON er sæson 1 → referenceår 2026 (LAUNCH_REFERENCE_YEAR).
// Fødselsårene herunder er valgt ud fra det: 1988 → 38 år (over
// RETIREMENT_WARNING_AGE=35), 2004 → 22 år (under). contract_end_season 1 <=
// aktiv sæson 1 → udløber ved næste skifte; 5 gør ikke.

const VETERAN = {
  ...RIDERS[0],
  id: "rider-veteran",
  firstname: "Mads",
  lastname: "Aagaard",
  team_id: TEST_TEAM.id,
  birthdate: "1988-03-04",
  contract_end_season: 1,
  is_academy: false,
};

const YOUNGSTER = {
  ...RIDERS[0],
  id: "rider-youngster",
  firstname: "Ida",
  lastname: "Bendtsen",
  team_id: TEST_TEAM.id,
  birthdate: "2004-07-19",
  contract_end_season: 5,
  is_academy: false,
};

const TRAINING_ME = {
  enabled: true,
  betaTester: true,
  teamId: TEST_TEAM.id,
  slots: { total: null, used: 2, remaining: null },
  focuses: ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"],
  intensities: ["easy", "normal", "hard", "rest"],
  plans: {
    [VETERAN.id]: { focus: "endurance", intensity: "normal" },
    [YOUNGSTER.id]: { focus: "endurance", intensity: "normal" },
  },
  condition: {
    [VETERAN.id]: { form: 61, fatigue: 30, injured_until: null, risk: 0.02 },
    [YOUNGSTER.id]: { form: 74, fatigue: 22, injured_until: null, risk: 0.01 },
  },
  progress: {
    [VETERAN.id]: { endurance: 0.3 },
    [YOUNGSTER.id]: { endurance: 0.5 },
  },
  todayRun: null,
  weekPlan: null,
  riderWeekPlans: {},
  // #3643 (ejer 19/9): den nye mobil-visning er beta-only bag
  // `training_mobile_table`. Serveren sender resultatet som en bar boolean;
  // her er den TÆNDT, fordi mobil-testen nedenfor måler netop den nye flade
  // (rytterens kort). Desktop-testene er uberørte af feltet.
  mobileTable: true,
};

// Rutene registreres EFTER installNetworkMocks, så de vinder over den generiske
// /rest/v1/**-handler (Playwright: sidst registrerede rute matcher først).
async function mockRoster(page) {
  await page.route("**/rest/v1/riders**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, [VETERAN, YOUNGSTER]);
  });
  await page.route("**/api/training/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, TRAINING_ME);
  });
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
  await mockRoster(page);
});

// #5485 (A3): desktop-rækken bærer navn, type og alder; akademi, kontrakt og
// pension står i rytterens kort, som navnet folder ud lige under rækken.
// Kravet fra #3761 er uændret: badgen står på den rytter den gælder og kun dér.
const rowFor = (page, name) => page.getByTestId("training-today-row").filter({ hasText: name });
async function openCard(page, name) {
  await rowFor(page, name).getByRole("button", { name: new RegExp(name) }).click();
  const card = page.getByTestId("training-rider-detail");
  await expect(card).toBeVisible();
  return card;
}

test("#3761 rytterens kort viser kontraktudløb + pensionsrisiko, og kun på den rytter de gælder", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/training");
  await expect(rowFor(page, "Mads Aagaard")).toBeVisible();

  // 38 år (over 35) + contract_end_season 1 <= aktiv sæson 1 → begge badges.
  // Labels fra den DELTE RiderBadges (rider:badges.label.*), ikke ny markup.
  const veteranCard = await openCard(page, "Mads Aagaard");
  await expect(veteranCard.getByTitle(/pensionsrisiko/i)).toBeVisible();
  await expect(veteranCard.getByTitle(/Kontrakten udløber/i)).toBeVisible();
  await expect(veteranCard.getByText("35+", { exact: true })).toBeVisible();
  await expect(veteranCard.getByText("UDLØB", { exact: true })).toBeVisible();

  await testInfo.attach("3761-status-badges", {
    body: await veteranCard.screenshot(),
    contentType: "image/png",
  });
  if (testInfo.project.name === "desktop-chromium") {
    await page.screenshot({ path: evidenceShotPath("pr-screens/3761-training-status-badges.png"), fullPage: false });
  }

  // 22 år + kontrakt til sæson 5 → ingen af dem. Badgen må ikke stå på alle.
  // Ét kort ad gangen: et tryk på den næste rytter flytter kortet.
  const youngCard = await openCard(page, "Ida Bendtsen");
  await expect(page.getByTestId("training-rider-detail")).toHaveCount(1);
  await expect(youngCard).toContainText("Ida Bendtsen");
  await expect(youngCard.getByText("35+", { exact: true })).toHaveCount(0);
  await expect(youngCard.getByText("UDLØB", { exact: true })).toHaveCount(0);
});

test("#3815 alderen står på rytteren — i rækkens underlinje og i kortet", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/training");
  await expect(rowFor(page, "Mads Aagaard")).toBeVisible();

  // Sæson-alderen (2026 − 1988 = 38, 2026 − 2004 = 22) står som sidste led i
  // navnets underlinje ("type · alder"). Hele leddet matches, så et bart tal i
  // form/træthed ikke kan give et falsk grønt.
  await expect(rowFor(page, "Mads Aagaard").getByText(/· 38$/)).toBeVisible();
  await expect(rowFor(page, "Ida Bendtsen").getByText(/· 22$/)).toBeVisible();

  const card = await openCard(page, "Mads Aagaard");
  await expect(card.getByText(/Alder 38/)).toBeVisible();

  await testInfo.attach(`3815-alder-${testInfo.project.name}`, {
    body: await rowFor(page, "Mads Aagaard").screenshot(),
    contentType: "image/png",
  });
});

// #3815 gjaldt oprindeligt "landskab OG portræt", fordi alderen dengang lå i
// navne-underlinjen på telefonen (#3045-folden). Telefonen har siden 18/9 sin
// egen visning, hvor rækken kun bærer type + form + træthed — alderen står i
// rytterens kort ét tryk væk (ejer 18/9: "intet tal forsvinder helt på mobil").
// Kravet er altså uændret, kun stedet er flyttet, og det er DET denne test
// holder på.
test("#3815 alderen forsvinder ikke på mobil — den står i rytterens kort", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/training");
  await page.locator('[data-testid="training-mobile-roster"]').waitFor();

  await page.getByRole("button", { name: /M\. Aagaard/ }).click();
  await expect(page.getByText(/Alder 38/i)).toBeVisible();
});

test("#3815 alderen er sorterbar på desktop via tabellens sortering", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-tabellens værktøjslinje; mobil sorterer via RosterMobileSortControl (dækket af #3706-mønstret).");

  await login(page);
  await page.goto("/training");

  // #5485: Alder er ikke længere en egen kolonne, men den SAMME sort-nøgle
  // findes i tabellens "Sortér efter" (samme kontrol som telefonen bruger), så
  // valget ikke forsvandt med kolonnen.
  const table = page.getByTestId("training-today-table");
  const sortBy = table.getByRole("combobox", { name: "Sortér efter" });
  await sortBy.selectOption("age");
  await expect(sortBy).toHaveValue("age");

  // Første valg af alder er faldende: den ældste (38) står øverst.
  const rows = page.getByTestId("training-today-row");
  await expect(rows.first()).toContainText("Mads Aagaard");

  await table.getByRole("button", { name: /Sorterer faldende/ }).click();
  await expect(rows.first()).toContainText("Ida Bendtsen");

  await page.screenshot({ path: evidenceShotPath("pr-screens/3815-training-alder-kolonne.png"), fullPage: false });
});
