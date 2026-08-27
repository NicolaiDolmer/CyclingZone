// #1307: holdudtagelses-flow — vælg 6, sæt kaptajn, gem.
//
// Testen mocker:
//   - Supabase REST-laget (races + race_results) så RaceDetailPage loader et
//     "scheduled" løb og renderer RaceSelectionPanel.
//   - GET /api/races/:id/selection så panelet henter rytterliste + størrelsesgrænser.
//   - PUT /api/races/:id/selection — fanger request-body og asserterer rider_ids +
//     captain_id (fuld trup i basis-testen, delvis trup i #4295-testene nederst).
//
// Mønster følger race-detail.spec.js: stabilizePage → installNetworkMocks →
// spec-specifikke overrides (LIFO, senest registrerede matcher først) → login → goto.
import { test, expect } from "@playwright/test";
import {
  installNetworkMocks,
  login,
  stabilizePage,
  json,
  corsHeaders,
} from "./fixtures.js";

const RACE_ID = "00000000-0000-4000-8000-000000001307";

const SCHEDULED_RACE = {
  id: RACE_ID,
  name: "E2E Classic",
  race_type: "single",
  race_class: "ProSeries",
  stages: 1,
  edition_year: 2026,
  status: "scheduled",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
};

// 9 ryttere — rider-8 (index 8) er skadet.
const SELECTION_RIDERS = Array.from({ length: 9 }, (_, i) => ({
  id: `sel-r${i}`,
  name: `Rider ${i}`,
  suitability: 70 - i,
  form: 55,
  fatigue: 10,
  injured: i === 8,
}));

test("manager kan udtage hold og gemme", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  // Override races-tabellen så RaceDetailPage finder SCHEDULED_RACE.
  // Følger race-detail.spec.js: registreres efter installNetworkMocks → vinder (LIFO).
  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes(
      "vnd.pgrst.object"
    );
    return json(route, wantsObject ? SCHEDULED_RACE : [SCHEDULED_RACE]);
  });

  // race_results er tom — det er et scheduleret løb, ingen resultater endnu.
  await page.route("**/rest/v1/race_results**", (route) =>
    json(route, [])
  );

  // Stash PUT-body så vi kan assertere payload efter klikket.
  let capturedBody = null;

  // Override GET + PUT på selection-endpointet.
  // Registreres EFTER installNetworkMocks → matcher FØR fixtures' generiske **/api/** handler.
  await page.route(`**/api/races/${RACE_ID}/selection`, async (route) => {
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
        status: 200,
        contentType: "application/json",
        headers: corsHeaders(request),
        body: JSON.stringify({ ok: true }),
      });
    }

    // GET
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify({
        enabled: true,
        race: SCHEDULED_RACE,
        size: { min: 6, max: 8 },
        selection: null,
        riders: SELECTION_RIDERS,
        availableCount: 8,
      }),
    });
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  // Panelet loader og er synligt.
  const panel = page.getByTestId("race-selection-panel");
  await expect(panel).toBeVisible();

  // Skadet rytter (Rider 8) skal være disabled fra starten.
  await expect(panel.getByRole("checkbox", { name: /Rider 8/ })).toBeDisabled();

  // Vælg den fulde trup — 8 raske ryttere (Rider 0-7; Rider 8 er skadet).
  // NB: en fuld trup er ikke længere et KRAV for at gemme (#4295 fjernede #1906's
  // blokering; se de to #4295-tests nederst i filen). Denne test dækker stadig det
  // normale flow hvor manageren fylder feltet helt op.
  for (let i = 0; i < 8; i++) {
    await panel.getByRole("checkbox", { name: new RegExp(`Rider ${i}`) }).check();
  }

  // Tæller viser "8/8 udtaget" (DA-locale — stabilizePage sætter cz_lang=da).
  await expect(panel.getByText(/8\/8/)).toBeVisible();

  // Sæt kaptajn — første combobox er kaptajn-select, vælg index 1 (første rytteroption).
  await panel.getByRole("combobox").first().selectOption({ index: 1 });

  // Forward-guard (#1834): ingen efterkommer i panelet må overflowe vandret.
  // En 5-kolonne rytter-tabel tvang en overflow-x-scroll-container på 393px-
  // viewporten; under Pixel 5 (isMobile) skævvred det Playwrights elementFromPoint
  // hit-test på gem-knappen nedenunder → klik "intercepted". Stablede mobil-kort
  // fjerner overflow'en. Denne deterministiske check fanger en regression FØR det
  // bliver et flaky hit-test-timeout (CI-font-afhængigt, advisory frontend-smoke).
  const horizOverflow = await panel.evaluate((section) => {
    const vw = document.documentElement.clientWidth;
    return [...section.querySelectorAll("*")]
      .filter((e) => e.scrollWidth - e.clientWidth > 1 || e.getBoundingClientRect().right > vw + 1)
      .map((e) => `${e.tagName}.${(typeof e.className === "string" ? e.className : "").slice(0, 30)}`);
  });
  expect(horizOverflow, "panelet må ikke overflowe vandret på mobil").toEqual([]);

  // Gem-knappen skal nu være aktiveret (fuld trup på 8 = max + kaptajn sat).
  // Tekst er "Gem udtagelse" i DA-locale.
  const saveBtn = panel.getByRole("button", { name: /gem udtagelse/i });
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();

  // Succesbesked vises: "Udtagelsen er gemt." i DA-locale.
  await expect(panel.getByText(/udtagelsen er gemt/i)).toBeVisible();

  // Assertér PUT-body: 8 rider_ids (fuld trup) + captain_id sat.
  expect(capturedBody).not.toBeNull();
  expect(Array.isArray(capturedBody.rider_ids)).toBe(true);
  expect(capturedBody.rider_ids).toHaveLength(8);
  expect(capturedBody.captain_id).not.toBeNull();
  expect(capturedBody.captain_id).not.toBe("");
  // Captain skal være én af de valgte ryttere.
  expect(capturedBody.rider_ids).toContain(capturedBody.captain_id);
});

// #3520 (spillerforslag, carpediemjbp): klik på rytternavnet skal åbne en profil-popup
// i stedet for at (dobbelt-)vælge rytteren. Checkboxen forbliver den ENESTE vælger.
test("klik på rytternavn åbner profil-popup uden at ændre udtagelsen", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? SCHEDULED_RACE : [SCHEDULED_RACE]);
  });
  await page.route("**/rest/v1/race_results**", (route) => json(route, []));

  await page.route(`**/api/races/${RACE_ID}/selection`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify({
        enabled: true,
        race: SCHEDULED_RACE,
        size: { min: 6, max: 8 },
        selection: null,
        riders: SELECTION_RIDERS,
        availableCount: 8,
      }),
    });
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  const panel = page.getByTestId("race-selection-panel");
  await expect(panel).toBeVisible();

  // Ingen ryttere er valgt endnu.
  await expect(panel.getByRole("checkbox", { name: /Rider 0/ })).not.toBeChecked();

  // Klik på navnet (knap, ikke checkbox) — åbner popup, ændrer IKKE udtagelsen.
  await panel.getByRole("button", { name: /Rider 0/ }).click();
  const modal = page.getByTestId("rider-mini-profile-modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByText("Rider 0")).toBeVisible();

  // Checkboxen er stadig unchecked — popuppen rørte ikke sel.
  await expect(panel.getByRole("checkbox", { name: /Rider 0/ })).not.toBeChecked();
  // Tælleren viser stadig 0 valgt.
  await expect(panel.getByText(/0\/8/)).toBeVisible();

  // Escape lukker popuppen.
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();

  // Popuppen kan også lukkes ved klik på Luk-knappen (X) — samme knap på tværs af
  // viewports. Backdrop-klik testes IKKE her: på mobil er panelet en fuld-skærms
  // sheet (w-full h-full, #3520-AC), så der er intet synligt backdrop at klikke på.
  await panel.getByRole("button", { name: /Rider 1/ }).click();
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /luk/i }).click();
  await expect(modal).toBeHidden();

  // Checkboxen virker stadig upåvirket efter popup-interaktionen.
  await panel.getByRole("checkbox", { name: /Rider 0/ }).check();
  await expect(panel.getByRole("checkbox", { name: /Rider 0/ })).toBeChecked();
  await expect(panel.getByText(/1\/8/)).toBeVisible();
});

// #3520: backdrop-klik lukker popuppen på desktop (der er intet backdrop at klikke på,
// på mobil er panelet en fuld-skærms sheet — testet ovenfor via Luk-knappen i stedet).
test("klik udenfor rytterprofil-popuppen lukker den (desktop)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "backdrop findes kun ved en centreret modal (desktop)");
  await stabilizePage(page);
  await installNetworkMocks(page);

  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? SCHEDULED_RACE : [SCHEDULED_RACE]);
  });
  await page.route("**/rest/v1/race_results**", (route) => json(route, []));
  await page.route(`**/api/races/${RACE_ID}/selection`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify({
        enabled: true,
        race: SCHEDULED_RACE,
        size: { min: 6, max: 8 },
        selection: null,
        riders: SELECTION_RIDERS,
        availableCount: 8,
      }),
    });
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  const panel = page.getByTestId("race-selection-panel");
  await panel.getByRole("button", { name: /Rider 0/ }).click();
  const modal = page.getByTestId("rider-mini-profile-modal");
  await expect(modal).toBeVisible();

  // Klik i toppen af viewporten — uden for det centrerede kort — lukker popuppen.
  await page.mouse.click(5, 5);
  await expect(modal).toBeHidden();
  // Udtagelsen er stadig uændret.
  await expect(panel.getByRole("checkbox", { name: /Rider 0/ })).not.toBeChecked();
});

// #1954: et løb i en ANDEN pulje/division (backend GET → eligible:false) må ikke
// vise et fuldt udtageligt panel der først fejler ved gem — kun en read-only forklaring.
test("fremmed-pulje-løb viser read-only forklaring, ikke et udtageligt panel", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? SCHEDULED_RACE : [SCHEDULED_RACE]);
  });
  await page.route("**/rest/v1/race_results**", (route) => json(route, []));

  await page.route(`**/api/races/${RACE_ID}/selection`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    // GET → eligible:false (fremmed pulje). PUT bør aldrig kaldes fra denne tilstand.
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify({
        enabled: true,
        eligible: false,
        race: SCHEDULED_RACE,
        size: { min: 6, max: 8 },
        selection: null,
        riders: SELECTION_RIDERS,
        availableCount: 8,
      }),
    });
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  // Read-only forklaring vises; det fulde udtagelses-panel gør IKKE.
  await expect(page.getByTestId("race-selection-wrong-pool")).toBeVisible();
  await expect(page.getByText(/anden division/i)).toBeVisible();
  await expect(page.getByTestId("race-selection-panel")).toHaveCount(0);
  // Ingen gem-knap at fejle på.
  await expect(page.getByRole("button", { name: /gem udtagelse/i })).toHaveCount(0);
});

// #4295 (spiller-rapport 27/8, knud_r_flink): en FOERSTEGANGS-udtagelse (selection: null,
// tilstanden efter "Ryd alt" eller en kalender-rebuild) kunne ikke gemmes med faerre end
// size.max ryttere. #4175's escape-ventil hvilede paa availableCount, som er hele den raske
// trup og aldrig traekker bundne ryttere fra, saa den udloeste aldrig for et hold med
// ryttere nok paa papiret. Denne test daekker praecis det hul: 29 ledige paa papiret,
// 7-mands felt, 4 valgte, ingen gemt udtagelse.
test("#4295 delvis trup kan gemmes ved en foerstegangs-udtagelse", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? SCHEDULED_RACE : [SCHEDULED_RACE]);
  });
  await page.route("**/rest/v1/race_results**", (route) => json(route, []));

  let capturedBody = null;
  await page.route(`**/api/races/${RACE_ID}/selection`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    if (request.method() === "PUT") {
      try { capturedBody = JSON.parse(request.postData() || "{}"); } catch { capturedBody = {}; }
      return route.fulfill({ status: 200, contentType: "application/json", headers: corsHeaders(request), body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify({
        enabled: true,
        race: SCHEDULED_RACE,
        size: { min: 7, max: 7 },
        selection: null,
        riders: SELECTION_RIDERS,
        // Stor trup paa papiret: praecis den vaerdi der fik #4175's ventil til at tie.
        availableCount: 29,
        bound_riders: [],
      }),
    });
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  const panel = page.getByTestId("race-selection-panel");
  await expect(panel).toBeVisible();

  // 4 af 7 pladser + kaptajn.
  for (let i = 0; i < 4; i++) {
    await panel.getByRole("checkbox", { name: new RegExp(`Rider ${i}`) }).check();
  }
  await expect(panel.getByText(/4\/7/)).toBeVisible();
  await panel.getByRole("combobox").first().selectOption({ index: 1 });

  // Hint-linjen er en NEUTRAL oplysning, ikke en blokering: 3 aabne pladser, og der er
  // frie ryttere nok til dem (8 raske minus de 4 valgte).
  const hint = panel.getByTestId("selection-partial-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText(/3 pladser står åbne/);
  await expect(hint).toHaveText(/Assistenten fylder dem/);
  // Den gamle, loegnagtige fejltekst ("Du kan hoejst udtage 7 ryttere" ved for FAA
  // valgte) maa ikke vises nogen steder i panelet.
  await expect(panel.getByText(/højst udtage/i)).toHaveCount(0);

  // Gem er aktiv og gemmer faktisk de 4.
  const saveBtn = panel.getByRole("button", { name: /gem udtagelse/i });
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(panel.getByText(/udtagelsen er gemt/i)).toBeVisible();

  expect(capturedBody).not.toBeNull();
  expect(capturedBody.rider_ids).toHaveLength(4);
  expect(capturedBody.rider_ids).toContain(capturedBody.captain_id);
});

// #4295: hint-linjen skal tale om ryttere der er frie til NETOP dette loeb. Bundne ryttere
// (udtaget i et overlappende loeb) taeller med i availableCount, men kan ikke bruges her.
// Det er knud_r_flinks egen case: "4 available riders for a race that requires 7".
test("#4295 hint-linjen taeller kun ryttere der er frie til dette loeb", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? SCHEDULED_RACE : [SCHEDULED_RACE]);
  });
  await page.route("**/rest/v1/race_results**", (route) => json(route, []));

  let capturedBody = null;
  await page.route(`**/api/races/${RACE_ID}/selection`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    if (request.method() === "PUT") {
      try { capturedBody = JSON.parse(request.postData() || "{}"); } catch { capturedBody = {}; }
      return route.fulfill({ status: 200, contentType: "application/json", headers: corsHeaders(request), body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify({
        enabled: true,
        race: SCHEDULED_RACE,
        size: { min: 7, max: 7 },
        selection: null,
        riders: SELECTION_RIDERS,
        availableCount: 29,
        // Rider 4-7 er bundet i et andet loeb, Rider 8 er skadet → kun Rider 0-3 er frie.
        bound_riders: [4, 5, 6, 7].map((i) => ({
          rider_id: `sel-r${i}`, bound_race_id: "other-race", bound_race_name: "Overlappende loeb",
        })),
      }),
    });
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  const panel = page.getByTestId("race-selection-panel");
  await expect(panel).toBeVisible();
  // Bundne ryttere kan ikke vaelges.
  await expect(panel.getByRole("checkbox", { name: /Rider 4/ })).toBeDisabled();

  for (let i = 0; i < 4; i++) {
    await panel.getByRole("checkbox", { name: new RegExp(`Rider ${i}`) }).check();
  }
  await panel.getByRole("combobox").first().selectOption({ index: 1 });

  // Alle frie ryttere er brugt: 3 pladser staar aabne, 0 ryttere tilbage. Teksten siger
  // sandheden i stedet for at kraeve en umulig fuld trup.
  const hint = panel.getByTestId("selection-partial-hint");
  await expect(hint).toHaveText(/3 pladser står åbne/);
  await expect(hint).toHaveText(/0 ryttere er frie til dette løb/);

  const saveBtn = panel.getByRole("button", { name: /gem udtagelse/i });
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(panel.getByText(/udtagelsen er gemt/i)).toBeVisible();
  expect(capturedBody.rider_ids).toHaveLength(4);
});
