import { test, expect } from "@playwright/test";
import {
  installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, evidenceShotPath,
} from "./fixtures.js";

// #3639 — hovedrum pr. evne i træningsfokus.
//
// Tre spillere meldte 10/8 at klatring ikke steg ved VO2max-træning. De havde ret:
// et fokus træner FLERE evner (vo2max = climbing+punch+tempo), progress-baren
// viser den evne der er TÆTTEST på gennembrud, og #2578's "færdigudviklet" fyrede
// kun når ALLE evner var på loftet. En rytter med climbing på loftet og tempo i
// vækst så derfor helt normal ud. Målt i prod 11/8: 892 ryttere i den tilstand.
//
// Testen dækker de to tilstande der var tavse:
//   DELVIST dødt → baren er sand (tempo rykker) OG advarslen navngiver climbing
//   HELT dødt   → dropdown'en markerer fokusset, så et dødt valg ikke ligner et frit
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
  // tempo tættest på gennembrud → baren VIL vise tempo, ikke climbing.
  progress: { "rider-1": { climbing: 0.0, punch: 0.2, tempo: 0.74 } },
  todayRun: null,
  weekPlan: null,
  riderWeekPlans: {},
};

async function mockTrainingMe(page, overrides = {}) {
  await page.route("**/api/training/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, { ...BASE_TRAINING_ME, ...overrides });
  });
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
});

test("#3639 delvist dødt fokus: baren viser tempo, men klatring udpeges som låst", async ({ page }, testInfo) => {
  await mockTrainingMe(page, { capped: { "rider-1": ["climbing"] } });
  await login(page);
  await page.goto("/training");

  const row = page.locator("tbody tr", { hasText: "Ada Pedersen" }).first();

  // Selve fejlen: baren er sand (tempo rykker) — og derfor misvisende alene.
  await expect(row.getByText(/Tempo/i).first()).toBeVisible();

  // Rettelsen: den låste evne navngives (DA-locale via stabilizePage).
  const warning = row.getByText(/Klatring på loftet/i);
  await expect(warning).toBeVisible();
  await expect(warning).toHaveAttribute("title", /stiger ikke igen/i);

  // #1162: caps er server-hidden. Advarslen må navngive EVNER, aldrig tal — en
  // bred række-regex ville ramme form/træthed, så guarden scopes til de to
  // strenge denne PR introducerer.
  await expect(warning).not.toHaveText(/\d/);
  expect(await warning.getAttribute("title")).not.toMatch(/\d/);

  await testInfo.attach("3639-delvist-doedt-fokus", {
    body: await row.screenshot(),
    contentType: "image/png",
  });
  await page.screenshot({ path: evidenceShotPath("pr-screens/3639-partial-capped-desktop.png"), fullPage: false });
});

test("#3639 helt dødt fokus: markeres i fokus-listen, så et dødt valg ikke ligner et frit", async ({ page }) => {
  await mockTrainingMe(page, { capped: { "rider-1": ["climbing", "punch", "tempo"] } });
  await login(page);
  await page.goto("/training");

  const row = page.locator("tbody tr", { hasText: "Ada Pedersen" }).first();

  // Progress-cellen: #2578's eksisterende "færdigudviklet"-tilstand (uændret).
  await expect(row.getByText(/Færdigudviklet i dette fokus/i)).toBeVisible();

  // Nyt: listen selv siger det, FØR spilleren vælger.
  const option = row.locator("option", { hasText: /VO2/i }).first();
  await expect(option).toHaveText(/loft nået/i);

  // Et fokus MED hovedrum må ikke markeres.
  await expect(row.locator("option", { hasText: /Spurt/i }).first()).not.toHaveText(/loft nået/i);
});

test("#3639 ingen lofter nået: fladen er præcis som før (ingen ny støj)", async ({ page }) => {
  await mockTrainingMe(page, { capped: {} });
  await login(page);
  await page.goto("/training");

  const row = page.locator("tbody tr", { hasText: "Ada Pedersen" }).first();
  await expect(row.getByText(/på loftet/i)).toHaveCount(0);
  await expect(row.getByText(/Færdigudviklet/i)).toHaveCount(0);
  await expect(row.locator("option", { hasText: /loft nået/i })).toHaveCount(0);
});
