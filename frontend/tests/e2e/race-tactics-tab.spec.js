// Løbssidens Taktik-fane (#4613, variant A godkendt 6/9) — afløser
// race-intention.spec.js, som testede intentions-fladen (#4632) dengang den var
// et selvstændigt kort i en <details>-fold på løbssiden. Fladen er nu en FANE:
// samme intention, men med ordrerne under samme etape og ét gem.
//
// Fire ting dækkes, fordi de er #4613's egentlige løfter:
//   1. Fane-striben følger LØBETS TILSTAND (før/under/efter) — det er hele
//      pointen i variant A, og den logik er værdiløs hvis den ikke når fladen.
//   2. Etapeløb under afvikling: én etape-vælger, kørt etape er READ-ONLY
//      (åbnes, men uden gem-knap), og gemmet taber ikke en anden etapes
//      intention.
//   3. Flaget OFF: serveren sender tre værdier, fanen viser TRE trin.
//   4. Endagsløb: ingen etape-vælger, og Taktik-fanen findes kun før start.
//
// Mønster følger race-selection.spec.js: stabilizePage → installNetworkMocks →
// spec-specifikke overrides (LIFO) → login → goto.
import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks,
  login,
  stabilizePage,
  evidenceShotPath,
  json,
  corsHeaders,
  raceResultsRoute,
} from "./fixtures.js";

const RACE_ID = "00000000-0000-4000-8000-000000004632";

// Fanen renderer BEGGE layouts (tabel fra sm og op, stablede kort under) og
// skjuler det ene med CSS, saa hver tekst findes to gange i DOM'en. Alle
// opslag scopes derfor til den SYNLIGE variant — samme moenster som
// race-detail-upcoming.spec.js' rute-match-assert.
const visible = (locator) => locator.filter({ visible: true }).first();

const FIVE_STEPS = ["grupetto", "save", "normal", "protect", "all_out"];
// Serverens OFF-vokabular står bevidst i sin EGEN rækkefølge (raceRoles.
// VALID_EFFORTS) — fladen skal selv sortere det til skala-rækkefølge.
const THREE_STEPS = ["protect", "normal", "save"];

const RIDERS = [
  { rider_id: "r1", name: "Rider One", race_role: "captain", abandoned: false },
  { rider_id: "r2", name: "Rider Two", race_role: "helper", abandoned: false },
];

function raceFixture({ stages, stagesCompleted, raceType, status = "scheduled" }) {
  return {
    id: RACE_ID,
    name: "E2E Tactics Race",
    race_type: raceType,
    race_class: "OtherWorldTourA",
    stages,
    stages_completed: stagesCompleted,
    edition_year: 2026,
    status,
    season: { id: "season-e2e", number: 1 },
    pool_race: null,
  };
}

// Etape 1 (kørt) leader-klassement — 2 rækker gør stillingen "fuld" for
// buildLiveStandings (#2081).
const LIVE_RESULTS = [
  { id: "res-1", stage_number: 1, result_type: "leader", rank: 1, rider_id: "r1", rider_name: "Rider One", team_id: "team-e2e", team_name: "E2E Team", finish_time: "+0:00" },
  { id: "res-2", stage_number: 1, result_type: "leader", rank: 2, rider_id: "r2", rider_name: "Rider Two", team_id: "team-e2e", team_name: "E2E Team", finish_time: "+0:12" },
];

/**
 * Mocker ét løb + dets stage-roles-kontekst. Returnerer en getter til den
 * sidst opfangede PUT-body.
 */
async function mockTacticsRace(page, {
  race, validEfforts, overrides = [], results = [],
  // #6095: beta-flaget for etape-valget i rollevælgeren + et valgfrit PUT-svar
  // (fx 409 stage_roles_conflict). Default = 200 ok, som før.
  roleScopeChoice = false, putResponse = null, riders = RIDERS,
}) {
  let capturedBody = null;
  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? race : [race]);
  });
  await page.route("**/rest/v1/race_results**", raceResultsRoute(results));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, []));
  await page.route("**/rest/v1/race_stage_schedule**", (route) => json(route, []));

  await page.route(`**/api/races/${RACE_ID}/stage-roles`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    if (request.method() === "PUT") {
      try {
        capturedBody = JSON.parse(request.postData() || "{}");
      } catch {
        capturedBody = {};
      }
      return route.fulfill({
        status: putResponse?.status ?? 200,
        contentType: "application/json",
        headers: corsHeaders(request),
        body: JSON.stringify(putResponse?.body ?? { ok: true }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify({
        enabled: true,
        intention_enabled: validEfforts.length > 3,
        valid_efforts: validEfforts,
        stages_completed: race.stages_completed,
        stage_count: race.stages,
        riders,
        overrides,
        role_scope_choice: roleScopeChoice,
      }),
    });
  });

  return () => capturedBody;
}

// Fane-striben er sidens egen navigation; ?tab= er dyb-linket den sætter.
const tab = (page, name) => page.getByRole("tab", { name });

test("faner: stribens indhold følger løbets tilstand (før → under → efter)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  // FØR start: ingen resultater, ingen kørte etaper.
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 0, raceType: "stage_race" }),
    validEfforts: FIVE_STEPS,
  });
  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  await expect(tab(page, "Overblik")).toBeVisible();
  await expect(tab(page, "Hold")).toBeVisible();
  await expect(tab(page, "Taktik")).toBeVisible();
  await expect(tab(page, "Etaper")).toBeVisible();
  // Et løb der ikke er kørt har intet resultat at vise — fanen ville være tom.
  await expect(tab(page, "Resultater")).toHaveCount(0);

  // UNDER afvikling: etape 1 kørt. Resultater kommer til, Taktik BLIVER
  // (etape 2-3 er stadig åbne at sætte).
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await installNetworkMocks(page);
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 1, raceType: "stage_race" }),
    validEfforts: FIVE_STEPS,
    results: LIVE_RESULTS,
  });
  await page.goto(`/races/${RACE_ID}`);

  await expect(tab(page, "Taktik")).toBeVisible();
  await expect(tab(page, "Resultater")).toBeVisible();

  // EFTER: løbet er færdigt. Taktik forsvinder — der er intet tilbage at sætte,
  // og en fane der ikke kan bruges er værre end ingen fane.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await installNetworkMocks(page);
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 3, raceType: "stage_race", status: "completed" }),
    validEfforts: FIVE_STEPS,
    results: LIVE_RESULTS,
  });
  await page.goto(`/races/${RACE_ID}`);

  await expect(tab(page, "Resultater")).toBeVisible();
  await expect(tab(page, "Hold")).toBeVisible();
  await expect(tab(page, "Taktik")).toHaveCount(0);
});

test("taktik: etape-vælger, femtrins-vælger og et gem der ikke taber andre etaper", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  const getBody = await mockTacticsRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 1, raceType: "stage_race" }),
    validEfforts: FIVE_STEPS,
    // Etape 3 har allerede en gemt intention. Spilleren rører KUN etape 2 —
    // den må stadig være med i payloaden (PUT'en er REPLACE for alt kommende).
    overrides: [{ stage_number: 3, rider_id: "r2", race_role: "helper", effort: "save" }],
    results: LIVE_RESULTS,
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);

  const panel = page.getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible();

  // Etape 2 aabner som den foerste der kan saettes. Uden tidsplan loves ingen dato.
  // Etape-knapperne baerer et eksplicit navn ("Intentioner for etape N") fordi
  // loebssidens egen etape-stribe allerede har knapper der hedder "Etape N".
  await expect(visible(panel.getByRole("button", { name: "Intentioner for etape 2", exact: true })))
    .toHaveAttribute("aria-pressed", "true");
  // Rollen gaelder hele loebet og saettes i holdudtagelsen — ingen vaelger her.
  await expect(panel.getByRole("combobox")).toHaveCount(0);

  // "Ikke valgt" er en synlig tilstand, ikke et tomt felt.
  await expect(visible(panel.getByText("Intet valgt. Han kører sin rolle."))).toBeVisible();

  // Udfold vælgeren for den foerste rytter (Rider One): fem trin, hver med sin
  // saetning i ord. Kun én vaelger kan vaere aaben ad gangen, saa trinnene
  // slaas op paa kortet som helhed.
  await visible(panel.getByRole("button", { name: "Sæt intention" })).click();
  for (const label of ["Grupetto", "Kør roligt", "Normal", "(?:Arbejd|Følg angrebene)", "Alt ud"]) {
    await expect(visible(panel.getByRole("button", { name: new RegExp(`^${label}`) }))).toBeVisible();
  }
  await expect(visible(panel.getByText("Rollens standard", { exact: true }))).toBeVisible();

  await panel.screenshot({ path: evidenceShotPath(`pr-screens/4613-tactics-picker-${testInfo.project.name}.png`) });

  await visible(panel.getByRole("button", { name: /^Alt ud/ })).click();
  await expect(visible(panel.getByText("Standard: kaptajn. I dag: alt ud."))).toBeVisible();

  // Siden må ikke overflowe vandret (#1834-mønster).
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow, "siden må ikke overflowe vandret").toBeLessThanOrEqual(1);

  // ÉN guld-primær i fanen: gemmet for den AABNE etape.
  const saveBtn = visible(panel.getByRole("button", { name: "Gem etape 2" }));
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(visible(panel.getByText("Intentionerne er gemt."))).toBeVisible();

  // Hele kladden sendes stadig (en backend fra før #6095 er REPLACE for alt
  // kommende) — men #6095: serveren må KUN erstatte etape 2, den eneste ændrede.
  expect(getBody().overrides).toEqual([
    { stage_number: 2, rider_id: "r1", race_role: "captain", effort: "all_out" },
    { stage_number: 3, rider_id: "r2", race_role: "helper", effort: "save" },
  ]);
  expect(getBody().stages).toEqual([2]);
  expect(getBody().base_versions).toEqual({ 2: "empty" });
});

// #6095: en anden fane/enhed har ændret etapen siden indlæsning. Gemmet må ikke
// overskrive. #7327 (design A): kladden kasseres heller ikke af sig selv; boksen
// tilbyder [Hent den nye] / [Behold mine], og guldknappen venter på valget.
test("taktik (#6095/#7327): konflikt fra en anden fane overskriver intet og bevarer kladden", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 1, raceType: "stage_race" }),
    validEfforts: FIVE_STEPS,
    results: LIVE_RESULTS,
    putResponse: { status: 409, body: { error: "stage_roles_conflict", errors: ["stage_roles_conflict"] } },
  });
  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);
  const panel = page.getByTestId("race-tactics-tab");
  await visible(panel.getByRole("button", { name: "Sæt intention" })).click();
  await visible(panel.getByRole("button", { name: /^Alt ud/ })).click();
  await visible(panel.getByRole("button", { name: "Gem etape 2" })).click();
  const box = panel.getByTestId("tactics-save-status");
  await expect(box.getByText("Taktikken er ændret i et andet vindue")).toBeVisible();
  await expect(box.getByTestId("tactics-save-part-roles")).toHaveAttribute("data-saved", "false");
  // Kladden er bevaret, og guldknappen kan ikke overskrive før et valg.
  await expect(visible(panel.getByText("Standard: kaptajn. I dag: alt ud."))).toBeVisible();
  await expect(visible(panel.getByRole("button", { name: "Gem etape 2" }))).toBeDisabled();
  await panel.screenshot({ path: evidenceShotPath(`pr-screens/7327/conflict-${testInfo.project.name}.png`) });
  // "Hent den nye": kladden kasseres først nu, efter et eksplicit valg.
  await box.getByRole("button", { name: "Hent den nye" }).click();
  await expect(visible(panel.getByText("Standard: kaptajn. I dag: alt ud."))).toHaveCount(0);
  await expect(box).toHaveCount(0);
});

// #7327 (design A): ordren fejler efter at intentionen er gemt. Boksen viser
// flueben/kryds pr. del, kladden bevares, og "Gem resten" sender kun ordren.
test("taktik (#7327): delvis gemning bevarer kladden og gemmer kun resten", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 1, raceType: "stage_race" }),
    validEfforts: FIVE_STEPS,
    results: LIVE_RESULTS,
  });
  let rolePuts = 0;
  await page.route(`**/api/races/${RACE_ID}/stage-roles`, (route) => {
    if (route.request().method() === "PUT") rolePuts += 1;
    return route.fallback();
  });
  const orderPuts = [];
  await page.route(`**/api/races/${RACE_ID}/team-orders**`, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() === "PUT") {
      orderPuts.push(request.postData());
      if (orderPuts.length === 1) {
        return route.fulfill({ status: 500, contentType: "application/json", headers: corsHeaders(request), body: JSON.stringify({ error: "team_orders_save_failed" }) });
      }
      return json(route, { ok: true });
    }
    return json(route, {
      stage_count: 3, stages_completed: 1, riders: RIDERS,
      stages: [1, 2, 3].map((n) => ({ stage_number: n, locked: n <= 1, scheduled_at: null })),
      orders: [],
    });
  });
  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);
  const panel = page.getByTestId("race-tactics-tab");
  await visible(panel.getByRole("button", { name: "Sæt intention" })).click();
  await visible(panel.getByRole("button", { name: /^Alt ud/ })).click();
  await visible(panel.getByRole("button", { name: "Gem etape 2" })).click();

  const box = panel.getByTestId("tactics-save-status");
  await expect(box.getByText("Kun en del af planen blev gemt")).toBeVisible();
  await expect(box.getByTestId("tactics-save-part-roles")).toHaveAttribute("data-saved", "true");
  await expect(box.getByTestId("tactics-save-part-orders")).toHaveAttribute("data-saved", "false");
  await expect(visible(panel.getByText("Standard: kaptajn. I dag: alt ud."))).toBeVisible();
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow, "siden må ikke overflowe vandret").toBeLessThanOrEqual(1);
  await panel.screenshot({ path: evidenceShotPath(`pr-screens/7327/partial-${testInfo.project.name}.png`) });

  await visible(panel.getByRole("button", { name: "Gem resten" })).click();
  await expect(visible(panel.getByText("Intentionerne er gemt."))).toBeVisible();
  expect(rolePuts, "intentionen sendes ikke igen").toBe(1);
  expect(orderPuts).toHaveLength(2);
});

// #6095 (beta): "etape N og løbet ud" er forvalgt; "kun etape N" ændrer kun den
// åbne etape. Uden flaget findes valget ikke.
test("taktik (#6095, beta): rollevælgeren har etape-valg, og 'kun etape 2' skriver kun etape 2", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const getBody = await mockTacticsRace(page, {
    race: raceFixture({ stages: 4, stagesCompleted: 1, raceType: "stage_race" }),
    validEfforts: FIVE_STEPS,
    results: LIVE_RESULTS,
    roleScopeChoice: true,
  });
  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);
  const panel = page.getByTestId("race-tactics-tab");
  await visible(panel.getByRole("button", { name: "Skift Rider Twos rolle" })).click();
  const rest = visible(panel.getByRole("radio", { name: "Etape 2 og løbet ud" }));
  const only = visible(panel.getByRole("radio", { name: "Kun etape 2" }));
  await expect(rest).toHaveAttribute("aria-checked", "true");
  await expect(only).toHaveAttribute("aria-checked", "false");
  await panel.screenshot({ path: evidenceShotPath(`pr-screens/6095-role-scope-${testInfo.project.name}.png`) });

  await only.click();
  await visible(panel.getByRole("button", { name: /^Udbrudsjæger/ })).click();
  await visible(panel.getByRole("button", { name: "Gem etape 2" })).click();
  await expect(visible(panel.getByText("Intentionerne er gemt."))).toBeVisible();
  expect(getBody().stages).toEqual([2]);
  expect(getBody().overrides).toEqual([{ stage_number: 2, rider_id: "r2", race_role: "hunter", effort: "normal" }]);
});

test("taktik: en kørt etape kan åbnes, men er read-only", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 1, raceType: "stage_race" }),
    validEfforts: FIVE_STEPS,
    overrides: [{ stage_number: 1, rider_id: "r1", race_role: "captain", effort: "all_out" }],
    results: LIVE_RESULTS,
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);

  const panel = page.getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible();

  // Etape 1 er kørt. Den kan aabnes — "det du sendte dem ud med" er værd at se
  // igen — men taktik kan ALDRIG saettes paa den.
  await visible(panel.getByRole("button", { name: "Intentioner for etape 1" })).click();

  await expect(visible(panel.getByText(/^Etape 1 er låst\./))).toBeVisible();
  // Ingen gem-knap, ingen kopiér-knap, ingen vaelger: fladen tilbyder ikke en
  // beslutning serveren ville afvise.
  await expect(panel.getByRole("button", { name: /^Gem etape/ })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /^Kopiér til etape/ })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Sæt intention" })).toHaveCount(0);
});

test("taktik: flaget OFF giver TRE trin på fanen", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 0, raceType: "stage_race" }),
    validEfforts: THREE_STEPS,
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);

  const panel = page.getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible();

  await visible(panel.getByRole("button", { name: "Sæt intention" })).click();

  for (const label of ["Kør roligt", "Normal", "(?:Arbejd|Følg angrebene)"]) {
    await expect(visible(panel.getByRole("button", { name: new RegExp(`^${label}`) }))).toBeVisible();
  }
  // De to yderpunkter findes ikke når flaget er off — fanen må ikke tilbyde et
  // valg backenden afviser.
  await expect(panel.getByRole("button", { name: /^Grupetto/ })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /^Alt ud/ })).toHaveCount(0);
});

test("taktik: endagsløb har ingen etape-vælger, og fanen forsvinder ved start", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 1, stagesCompleted: 0, raceType: "single" }),
    validEfforts: FIVE_STEPS,
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);

  const panel = page.getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible();

  // Ingen etape-vaelger: kun ét "Løbsdag"-maerke, og kolonnen hedder loebsdag
  // (kolonne-headeren lever kun i desktop-tabellen, derfor toolbar-maerket her).
  await expect(visible(panel.getByText("Løbsdag", { exact: true }))).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Intentioner for etape/ })).toHaveCount(0);
  await expect(visible(panel.getByRole("button", { name: "Gem løbsdagen" }))).toBeVisible();
  // Der er ingen næste etape at kopiere til.
  await expect(panel.getByRole("button", { name: /^Kopiér til etape/ })).toHaveCount(0);

  await panel.screenshot({ path: evidenceShotPath(`pr-screens/4613-tactics-one-day-${testInfo.project.name}.png`) });

  // Endagsloebet har KUN den ene dag, og den laaser naar flaget falder. Naar
  // loebet er kørt, findes Taktik-fanen ikke laengere.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await installNetworkMocks(page);
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 1, stagesCompleted: 1, raceType: "single", status: "completed" }),
    validEfforts: FIVE_STEPS,
    results: LIVE_RESULTS,
  });
  await page.goto(`/races/${RACE_ID}`);

  await expect(tab(page, "Resultater")).toBeVisible();
  await expect(tab(page, "Taktik")).toHaveCount(0);
});

// #5290: the reported screenshot is this toolbar, not Planning or Dashboard.
// Inject the reporting instant and both sides of Copenhagen midnight.
test.describe("#5290 tactics calendar date", () => {
  test.use({ timezoneId: "America/Los_Angeles" });
  for (const { label, now, today } of [
    { label: "report at 18:06", now: "2026-09-15T16:06:00Z", today: false },
    { label: "23:30 Copenhagen", now: "2026-09-15T21:30:00Z", today: false },
    { label: "00:30 Copenhagen", now: "2026-09-15T22:30:00Z", today: true },
  ]) {
    test(label, async ({ page }, testInfo) => {
      await page.clock.setFixedTime(new Date(now));
      await stabilizePage(page);
      await installNetworkMocks(page);
      await mockTacticsRace(page, {
        race: raceFixture({ stages: 5, stagesCompleted: 3, raceType: "stage_race" }),
        validEfforts: FIVE_STEPS,
        results: LIVE_RESULTS,
      });
      await page.route(`**/api/races/${RACE_ID}/team-orders`, (route) => {
        if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
        return json(route, {
          stage_count: 5, stages_completed: 3, riders: RIDERS,
          stages: [
            { stage_number: 1, locked: true, scheduled_at: "2026-09-14T09:00:00Z" },
            { stage_number: 2, locked: true, scheduled_at: "2026-09-14T11:00:00Z" },
            { stage_number: 3, locked: true, scheduled_at: "2026-09-15T13:00:00Z" },
            { stage_number: 4, locked: false, scheduled_at: "2026-09-16T12:00:00Z" },
            { stage_number: 5, locked: false, scheduled_at: "2026-09-17T12:00:00Z" },
          ],
        });
      });
      await login(page);
      await page.goto(`/races/${RACE_ID}?tab=tactics`);
      const panel = page.getByTestId("race-tactics-tab");
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("button", {
        name: `Intentioner for etape 4${today ? ", i dag" : ""}`, exact: true,
      })).toHaveAttribute("aria-pressed", "true");
      // Yesterday and tomorrow cannot inherit the next stage's date label.
      await expect(panel.getByRole("button", { name: "Intentioner for etape 1", exact: true })).toBeVisible();
      await expect(panel.getByRole("button", { name: "Intentioner for etape 5", exact: true })).toBeVisible();
      if (today) await expect(panel.getByRole("button", { name: "Intentioner for etape 3", exact: true })).toBeVisible();
      await panel.getByRole("button", {
        name: `Intentioner for etape 4${today ? ", i dag" : ""}`, exact: true,
      }).scrollIntoViewIfNeeded();
      await panel.screenshot({ path: evidenceShotPath(`pr-screens/5290-tactics-${today ? "today" : "tomorrow"}-${testInfo.project.name}.png`) });
      if (label === "23:30 Copenhagen") {
        await page.clock.setFixedTime(new Date("2026-09-15T22:30:00Z"));
        await page.clock.fastForward(30_000);
        await expect(panel.getByRole("button", { name: "Intentioner for etape 4, i dag", exact: true })).toBeVisible();
        await expect(panel.getByRole("button", { name: "Intentioner for etape 3", exact: true })).toBeVisible();
      }
    });
  }
});

test("taktik (#6095): uden beta-flaget har rollevælgeren intet etape-valg", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 4, stagesCompleted: 1, raceType: "stage_race" }),
    validEfforts: FIVE_STEPS,
    results: LIVE_RESULTS,
  });
  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);
  const panel = page.getByTestId("race-tactics-tab");
  await visible(panel.getByRole("button", { name: "Skift Rider Twos rolle" })).click();
  await expect(panel.getByRole("radio")).toHaveCount(0);
  await expect(visible(panel.getByText("Fra etape 2 og løbet ud"))).toBeVisible();
  await panel.screenshot({ path: evidenceShotPath(`pr-screens/6095-role-noscope-${testInfo.project.name}.png`) });
});

// #7003 (spec 2026-10-25-taktik-roller-design §3): modsatte ordrer kan ikke
// slaas til, og en gemt raekke der allerede bryder reglen faar "Vaelg en".
test("taktik (#7003): modsatte ordrer spaerres, gamle modsaetninger faar 'Vælg én'", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const riders = [
    ...RIDERS,
    { rider_id: "r3", name: "Rider Three", race_role: "helper", abandoned: false },
  ];
  await mockTacticsRace(page, {
    race: raceFixture({ stages: 5, stagesCompleted: 1, raceType: "stage_race" }),
    validEfforts: FIVE_STEPS,
    results: LIVE_RESULTS,
    riders,
    overrides: [
      { stage_number: 2, rider_id: "r2", race_role: "helper", effort: "protect" },
      { stage_number: 2, rider_id: "r3", race_role: "helper", effort: "grupetto" },
    ],
  });
  await page.route(`**/api/races/${RACE_ID}/team-orders`, (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    return json(route, {
      stage_count: 5, stages_completed: 1, riders,
      stages: [1, 2, 3, 4, 5].map((n) => ({ stage_number: n, locked: n <= 1, scheduled_at: `2026-10-2${n}T12:00:00Z` })),
      // Gemt foer reglen: hjaelperen arbejder OG forsoeger udbrud.
      orders: [{ stage_number: 2, breakaway_stance: "neutral", riders: [{ rider_id: "r2", effort: "protect", try_break: true, leadout: false }] }],
    });
  });
  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);
  const panel = page.getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible();
  await expect(visible(panel.getByTestId("opposite-orders-pick-one"))).toHaveText("Vælg én");
  // Grupetto-rytteren kan ikke slaa "Forsoeg udbrud" til.
  await expect(visible(panel.getByRole("button", { name: /Rider Three/ }).filter({ hasText: "Forsøg udbrud" }))).toBeDisabled();
  await expect(visible(panel.getByText("Ikke sammen med Grupetto."))).toBeVisible();
  await expect(visible(panel.getByText("En rytter der arbejder for lederen, kan ikke forsøge udbrud."))).toBeVisible();
  await panel.screenshot({ path: evidenceShotPath(`pr-screens/7003-opposite-orders-${testInfo.project.name}.png`) });
});

// #7332 (ejer 31/10): paa en enkeltstart (itt/itt_hilly) giver Grupetto og
// Arbejd/Foelg angrebene ingen mening. Vaelgeren viser kun Kør roligt, Normal og
// Alt ud; et gammelt gemt "protect" vises og gemmes som Kør roligt, og "Kopiér til
// etape N" til en enkeltstart lander som Kør roligt.
async function mockIttTeamOrders(page, { riders = RIDERS, stages = 3, stagePlan = true } = {}) {
  const puts = [];
  await page.route(`**/api/races/${RACE_ID}/team-orders**`, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() === "PUT") {
      try { puts.push(JSON.parse(request.postData() || "{}")); } catch { puts.push({}); }
      return json(route, { ok: true });
    }
    return json(route, {
      stage_count: stages, stages_completed: 1, riders,
      stages: Array.from({ length: stages }, (_, i) => ({ stage_number: i + 1, locked: i === 0, scheduled_at: null })),
      orders: [],
      stage_plan_enabled: stagePlan,
    });
  });
  return puts;
}

const ittProfile = (stageNumber, profileType) => ({
  race_id: RACE_ID, stage_number: stageNumber, profile_type: profileType, finale_type: null,
  distance_km: 30, elevation_gain_m: 200, climbs: [], sprints: [], sectors: [], weather: null,
});

test("taktik (#7332): enkeltstart viser kun Kør roligt, Normal og Alt ud", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const getBody = await mockTacticsRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 1, raceType: "stage_race" }),
    validEfforts: FIVE_STEPS,
    results: LIVE_RESULTS,
    // Gemt foer #7332: hjaelperen "arbejder" paa enkeltstarten.
    overrides: [{ stage_number: 2, rider_id: "r2", race_role: "helper", effort: "protect" }],
  });
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, [
    ittProfile(1, "flat"), ittProfile(2, "itt"), ittProfile(3, "flat"),
  ]));
  const puts = await mockIttTeamOrders(page);
  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);
  const panel = page.getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible();
  await expect(visible(panel.getByRole("button", { name: "Intentioner for etape 2", exact: true })))
    .toHaveAttribute("aria-pressed", "true");

  await visible(panel.getByRole("button", { name: "Sæt intention" })).click();
  await expect(visible(panel.getByRole("button", { name: /^Normal/ }))).toBeVisible();
  await panel.screenshot({ path: evidenceShotPath(`pr-screens/7332/itt-picker-${testInfo.project.name}.png`) });
  // Rider Two's gamle "Arbejd" staar som Kør roligt.
  await expect(visible(panel.getByText("Standard: rytter. I dag: kør roligt."))).toBeVisible();
  for (const label of ["Kør roligt", "Normal", "Alt ud"]) {
    await expect(visible(panel.getByRole("button", { name: new RegExp(`^${label}`) }))).toBeVisible();
  }
  for (const label of ["Grupetto", "Arbejd", "Følg angrebene", "Kør offensivt"]) {
    await expect(panel.getByRole("button", { name: new RegExp(`^${label}`) }).filter({ visible: true })).toHaveCount(0);
  }

  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow, "siden må ikke overflowe vandret").toBeLessThanOrEqual(1);

  await visible(panel.getByRole("button", { name: /^Alt ud/ })).click();
  await visible(panel.getByRole("button", { name: "Gem etape 2" })).click();
  await expect(visible(panel.getByText("Intentionerne er gemt."))).toBeVisible();
  // Et gem fra fladen skriver aldrig protect/grupetto paa enkeltstarten.
  expect(getBody().overrides).toEqual([
    { stage_number: 2, rider_id: "r1", race_role: "captain", effort: "all_out" },
    { stage_number: 2, rider_id: "r2", race_role: "helper", effort: "save" },
  ]);
  const orderEfforts = Object.fromEntries((puts.at(-1)?.riders ?? []).map((r) => [r.rider_id, r.effort]));
  expect(orderEfforts).toEqual({ r1: "all_out", r2: "save" });
});

test("taktik (#7332): kopi til en enkeltstart lander som Kør roligt", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const getBody = await mockTacticsRace(page, {
    race: raceFixture({ stages: 3, stagesCompleted: 1, raceType: "stage_race" }),
    validEfforts: FIVE_STEPS,
    results: LIVE_RESULTS,
    overrides: [
      { stage_number: 2, rider_id: "r1", race_role: "captain", effort: "grupetto" },
      { stage_number: 2, rider_id: "r2", race_role: "helper", effort: "protect" },
    ],
  });
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, [
    ittProfile(1, "flat"), ittProfile(2, "mountain"), ittProfile(3, "itt_hilly"),
  ]));
  await mockIttTeamOrders(page, { stagePlan: false });
  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);
  const panel = page.getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible();
  await visible(panel.getByRole("button", { name: "Kopiér til etape 3" })).click();
  await visible(panel.getByRole("button", { name: "Gem etape 2" })).click();
  await expect(visible(panel.getByText("Intentionerne er gemt."))).toBeVisible();
  expect(getBody().stages).toEqual([3]);
  expect(getBody().overrides).toEqual([
    { stage_number: 2, rider_id: "r1", race_role: "captain", effort: "grupetto" },
    { stage_number: 2, rider_id: "r2", race_role: "helper", effort: "protect" },
    { stage_number: 3, rider_id: "r1", race_role: "captain", effort: "save" },
    { stage_number: 3, rider_id: "r2", race_role: "helper", effort: "save" },
  ]);
});
