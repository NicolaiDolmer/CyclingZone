import { test, expect } from "@playwright/test";
import {
  installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, evidenceShotPath,
} from "./fixtures.js";

// #3651 — "Limited upside for this rider type" skal også stå i træningssektionen
// på rytterprofilen.
//
// @cybersimon (Discord #feedback-and-ideas 11/8): chippen fandtes kun på
// trænings-fladens roster-tabel. Rytterprofilen er dér spilleren faktisk vælger
// hvad rytteren skal træne — og dér var signalet tavst.
//
// Testen dækker de tre tilstande der afgør om de to flader siger det samme:
//   limited  → chippen står på profilen med den EKSISTERENDE ordlyd + tooltip
//   blocked  → den hårde variant, samme regel
//   strength → ingen chip (ingen ny støj på et fokus der passer rytteren)
//
// DA-locale via stabilizePage (samme som resten af e2e-suiten); den sidste test
// skifter til EN og tager PR-bevis-billederne, fordi copy'en er EN-first.

const BASE_TRAINING_ME = {
  enabled: true,
  betaTester: true,
  teamId: TEST_TEAM.id,
  slots: { total: null, used: 1, remaining: null },
  focuses: ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"],
  intensities: ["easy", "normal", "hard", "rest"],
  plans: { "rider-1": { focus: "vo2max", intensity: "normal" } },
  condition: { "rider-1": { form: 68, fatigue: 35, injured_until: null, risk: 0.02 } },
  progress: { "rider-1": { climbing: 0.31, punch: 0.2, tempo: 0.44 } },
  capped: {},
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

// Rytterprofilens faner er state-drevne (ingen URL-parameter), så fanen klikkes.
async function openTrainingTab(page, tabName = "Træning") {
  await page.goto("/riders/rider-1");
  await page.getByRole("tab", { name: tabName }).click();
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
});

test("#3651 limited: profilen viser samme chip og samme tooltip som trænings-fladen", async ({ page }) => {
  await mockTrainingMe(page, { trainability: { "rider-1": { vo2max: "limited" } } });
  await login(page);
  await openTrainingTab(page);

  const chip = page.getByText("Begrænset potentiale for denne ryttertype");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("title", /hverken rytterens primære eller sekundære type/i);

  // Samme rytter, samme fokus, samme ordlyd på den flade chippen kom fra — det er
  // hele pointen i #3651 (de to steder må ikke kunne sige noget forskelligt).
  await page.goto("/training");
  const row = page.locator("tbody tr", { hasText: "Ada Pedersen" }).first();
  await expect(row.getByText("Begrænset potentiale for denne ryttertype")).toBeVisible();
});

test("#3651 blocked: profilen viser den hårde variant", async ({ page }) => {
  await mockTrainingMe(page, { trainability: { "rider-1": { vo2max: "blocked" } } });
  await login(page);
  await openTrainingTab(page);

  await expect(
    page.getByText("Denne ryttertype har meget lidt plads til at udvikle disse evner")
  ).toBeVisible();
});

test("#3651 strength: intet fokus-match-signal, ingen ny støj", async ({ page }) => {
  await mockTrainingMe(page, { trainability: { "rider-1": { vo2max: "strength" } } });
  await login(page);
  await openTrainingTab(page);

  // Fanen er faktisk indlæst (ellers ville de tomme forventninger nedenfor være falsk grønne).
  await expect(page.getByRole("button", { name: /VO2max/i }).first()).toBeVisible();
  await expect(page.getByText(/potentiale for denne ryttertype/i)).toHaveCount(0);
  await expect(page.getByText(/plads til at udvikle disse evner/i)).toHaveCount(0);
});

test("#3651 EN-bevis: chippen på profilen, med den engelske originaltekst", async ({ page }, testInfo) => {
  await mockTrainingMe(page, { trainability: { "rider-1": { vo2max: "limited" } } });
  await login(page);

  // Copy'en er EN-first, så PR-beviset tages på engelsk. Login-helperen kræver de
  // danske placeholders, så sproget flyttes FØRST bagefter — og via addInitScript,
  // fordi stabilizePage's egen init-script sætter cz_lang=da ved HVER navigation
  // (init-scripts kører i registreringsrækkefølge, så denne vinder).
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  await openTrainingTab(page, "Training");

  const chip = page.getByText("Limited upside for this rider type");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("title", /neither this rider's primary nor secondary type/i);

  // Beviset er selve trænings-kortet: fokus-valget og chippen i samme billede.
  const focusCard = page
    .getByRole("heading", { name: "Training focus" })
    .locator("xpath=ancestor::div[contains(@class,'bg-cz-card')][1]");
  await expect(focusCard).toBeVisible();

  await testInfo.attach(`3651-profil-en-${testInfo.project.name}`, {
    body: await focusCard.screenshot(),
    contentType: "image/png",
  });
  // De to mobil-projekter rammer samme layout — kun ét mobil-billede committes,
  // så PR-mappen ikke får tre næsten identiske PNG'er.
  if (testInfo.project.name !== "mobile-webkit") {
    const label = testInfo.project.name === "desktop-chromium" ? "desktop" : "mobile";
    await focusCard.screenshot({
      path: evidenceShotPath(`pr-screens/3651-rider-profile-limited-${label}-en.png`),
    });
  }
});
