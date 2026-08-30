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
// ikke her. Kolonnen skal være sorterbar som de øvrige, og i portræt følger
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
  await installNetworkMocks(page);
  await mockRoster(page);
});

test("#3761 Status-kolonnen viser kontraktudløb + pensionsrisiko, og kun på den rytter de gælder", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/training");

  const veteranRow = page.locator("tbody tr", { hasText: "Mads Aagaard" }).first();
  const youngRow = page.locator("tbody tr", { hasText: "Ida Bendtsen" }).first();
  await expect(veteranRow).toBeVisible();

  // 38 år (over 35) + contract_end_season 1 <= aktiv sæson 1 → begge badges.
  // Labels fra den DELTE RiderBadges (rider:badges.label.*), ikke ny markup.
  await expect(veteranRow.getByTitle(/pensionsrisiko/i)).toBeVisible();
  await expect(veteranRow.getByTitle(/Kontrakten udløber/i)).toBeVisible();
  await expect(veteranRow.getByText("35+", { exact: true })).toBeVisible();
  await expect(veteranRow.getByText("UDLØB", { exact: true })).toBeVisible();

  // 22 år + kontrakt til sæson 5 → ingen af dem. Badgen må ikke stå på alle.
  await expect(youngRow.getByText("35+", { exact: true })).toHaveCount(0);
  await expect(youngRow.getByText("UDLØB", { exact: true })).toHaveCount(0);

  await testInfo.attach("3761-status-badges", {
    body: await veteranRow.screenshot(),
    contentType: "image/png",
  });

  if (testInfo.project.name === "desktop-chromium") {
    // Status-kolonnen ligger til højre for viewportens kant på 1280px (#2446,
    // uændret her) — scroll tabellen ud til den, så beviset viser badges.
    // Kolonne-indeks: 0 vælg, 1 navn, 2 type, 3 alder, 4 dag, 5 skift dag,
    // 6 denne sæson, 7 form, 8 træthed, 9 status, 10 ugeplan.
    await veteranRow.locator("td").nth(9).scrollIntoViewIfNeeded();
    await page.screenshot({ path: evidenceShotPath("pr-screens/3761-training-status-badges.png"), fullPage: false });
  }
});

test("#3815 alderen står på rytteren i landskab OG i portræt", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/training");

  const veteranRow = page.locator("tbody tr", { hasText: "Mads Aagaard" }).first();
  const youngRow = page.locator("tbody tr", { hasText: "Ida Bendtsen" }).first();
  await expect(veteranRow).toBeVisible();

  if (testInfo.project.name === "desktop-chromium") {
    // Egen kolonne med sæson-alderen (2026 − 1988 = 38, 2026 − 2004 = 22).
    // Cellen adresseres på kolonne-indeks (0 vælg, 1 navn, 2 type, 3 alder) —
    // et bart tal-match ville også ramme træthed/fremdrift i samme række.
    const header = page.getByRole("columnheader", { name: /^Alder/ }).first();
    await expect(header).toBeVisible();
    await expect(veteranRow.locator("td").nth(3)).toHaveText("38");
    await expect(youngRow.locator("td").nth(3)).toHaveText("22");
  } else {
    // #3045-folden: kolonnen er skjult ≤640px, tallet står i navne-underlinjen.
    // Uden dette ville ønsket kun være opfyldt på desktop.
    await expect(veteranRow.getByText(/Alder 38/i)).toBeVisible();
    await expect(youngRow.getByText(/Alder 22/i)).toBeVisible();
  }

  await testInfo.attach(`3815-alder-${testInfo.project.name}`, {
    body: await veteranRow.screenshot(),
    contentType: "image/png",
  });
});

test("#3815 Alder-kolonnen er sorterbar som de øvrige", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Alder-kolonnen er foldet ind i navne-underlinjen ≤640px; mobil sorterer via RosterMobileSortControl (dækket af #3706-mønstret).");

  await login(page);
  await page.goto("/training");

  // Samme SortableTh-kontrakt som navn/type/form/træthed/status: aria-sort går
  // fra "none" til en retning ved klik. Et bart <th> var netop fejlen #3706
  // rettede på Status-kolonnen — den må ikke gentages her.
  const header = page.getByRole("columnheader", { name: /^Alder/ }).first();
  await expect(header).toHaveAttribute("aria-sort", "none");
  await header.click();
  await expect(header).toHaveAttribute("aria-sort", "descending");

  // Desc: den ældste (38) står øverst.
  const firstName = page.locator("tbody tr td").filter({ hasText: /Aagaard|Bendtsen/ }).first();
  await expect(firstName).toContainText("Mads Aagaard");

  await header.click();
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  await expect(page.locator("tbody tr td").filter({ hasText: /Aagaard|Bendtsen/ }).first()).toContainText("Ida Bendtsen");

  await page.screenshot({ path: evidenceShotPath("pr-screens/3815-training-alder-kolonne.png"), fullPage: false });
});
