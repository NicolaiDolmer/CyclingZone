import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

// #5159 — porten foran automatisk genindlaesning (Codex-fund B1 + M1 + M2 + M3).
//
// Det der maales: en spiller har ugemt arbejde paa siden, der bliver deployet en
// ny frontend, og det periodiske tjek fyrer. FOER #5159 genindlaeste appen —
// auditten reproducerede netop det i Chromium og WebKit paa PR-preview:
// loginfeltet blev tomt efter at fokus var flyttet vaek. EFTER #5159 sker der
// intet automatisk; banneret dukker op, og reloadet venter paa et sikkert punkt.
//
// De tre mockede versioner:
//   · <meta name="cz-release">  = klientens git-sha (kun til fejlsporing)
//   · <meta name="cz-frontend"> = klientens frontend-INDHOLDS-id (beslutningen)
//   · /version.json             = det edgen serverer lige nu
// Testen skruer paa dem uafhaengigt af hinanden.
//
// Motor-fordeling (#4647-tidsbudgettet paa mobile-webkit-shard'en). Skillelinjen
// er "afhaenger udfaldet af MOTOREN?", ikke "hvor hurtigt koerer scenariet":
//
//   Begge motorer: B1-reproduktionen hvor loginfeltet blev toemt efter blur, det
//   sikre punkt, bannerets bekraeftelse + klik, den glade sti — og (efter
//   review 11/9) M2 og M3. De to er de MEST motor-afhaengige i hele specen:
//   M3 haenger paa hvordan motoren opfoerer sig naar sessionStorage kaster
//   (WebKit's "The operation is insecure." er praecis den browser private mode
//   rammer i praksis), og M2 paa at motorens fetch faktisk afbrydes af
//   AbortController-deadlinen og frigiver `inFlight`.
//
//   Kun Chromium: M1, H4 og traenings-varianten af B1 — ren mekanik uden
//   motor-afhaengighed (loop-guard-noegler, sha-vs-indholds-id, en select-kladde),
//   daekket linje for linje i releaseWatch.test.js.
//
// Uden en opdeling loeb webkit-shard'en 12 min 21 s mod et budget paa 12 min.

const CLIENT_SHA = "e2e-sha-a";
const CLIENT_FRONTEND = "e2e-frontend-a";

// Hver page-load taeller sig selv op i sessionStorage (som overlever et reload i
// samme fane). Det er den eneste maaling der skelner "fuldt dokument-load" fra
// "client-side navigation" uden at gaette paa timing.
const LOAD_COUNTER_KEY = "cz_e2e_document_loads";

// Det periodiske tjek. Klokken er installeret, saa vi kan spole frem i stedet
// for at vente fem rigtige minutter.
const PERIODIC = "05:05";

async function setupReleaseHarness(page, { served } = {}) {
  const state = { served: served ?? { release: CLIENT_SHA, frontend: CLIENT_FRONTEND }, versionCalls: 0 };

  await page.addInitScript((key) => {
    try {
      const next = Number(window.sessionStorage.getItem(key) || 0) + 1;
      window.sessionStorage.setItem(key, String(next));
    } catch {
      // sessionStorage utilgaengelig — testen fejler paa assertionen i stedet.
    }
  }, LOAD_COUNTER_KEY);

  // Klientens egen identitet: injiceres i den serverede HTML, praecis som
  // `cz-release-meta` og `cz-frontend-content-id` goer i et rigtigt build (det
  // lokale e2e-build har ingen commit-sha, saa tagsene staar tomme).
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    const html = await response.text();
    let patched = html.includes('name="cz-release"')
      ? html.replace(/name="cz-release"\s+content="[^"]*"/, `name="cz-release" content="${CLIENT_SHA}"`)
      : html.replace("<head>", `<head><meta name="cz-release" content="${CLIENT_SHA}">`);
    patched = patched.includes('name="cz-frontend"')
      ? patched.replace(/name="cz-frontend"\s+content="[^"]*"/, `name="cz-frontend" content="${CLIENT_FRONTEND}"`)
      : patched.replace("<head>", `<head><meta name="cz-frontend" content="${CLIENT_FRONTEND}">`);
    return route.fulfill({ response, body: patched });
  });

  await page.route("**/version.json", async (route) => {
    state.versionCalls += 1;
    if (state.hang) {
      // Et kald der aldrig afsluttes — M2's scenarie.
      await new Promise(() => {});
      return undefined;
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(state.served),
    });
  });

  return state;
}

// Selve maalingen loeber ind i det den maaler: naar reloadet kalder
// `location.assign()`, river browseren execution-contexten ned midt i
// `page.evaluate`. Behandl racen som "endnu ikke faerdig" i stedet for en fejl.
const NAVIGATION_RACE =
  /Execution context was destroyed|Target (?:page|closed)|frame was detached|Cannot find context/i;

async function documentLoads(page) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await page.evaluate(
        (key) => Number(window.sessionStorage.getItem(key) || 0),
        LOAD_COUNTER_KEY,
      );
    } catch (error) {
      if (!NAVIGATION_RACE.test(String(error?.message ?? ""))) throw error;
      lastError = error;
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
  }
  throw lastError;
}

const banner = (page) => page.getByTestId("release-update-banner");

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
  await page.clock.install();
});

// --- B1: den flade auditten faktisk maalte ---------------------------------

test("B1 login: usendt tekst overlever et deploy — intet reload, banner i stedet", async ({ page }) => {
  const state = await setupReleaseHarness(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Cycling Zone" })).toBeVisible();
  expect(await documentLoads(page)).toBe(1);

  const email = page.getByPlaceholder("din@email.dk");
  await email.fill("ugemt@cyclingzone.org");
  // Fokus VAEK — det var praecis her #5139 mistede teksten.
  await page.getByRole("heading", { name: "Cycling Zone" }).click();
  await expect(email).not.toBeFocused();

  // Der deployes en ny frontend, og det periodiske tjek fyrer.
  state.served = { release: "e2e-sha-b", frontend: "e2e-frontend-b" };
  await page.clock.fastForward(PERIODIC);

  await expect(banner(page)).toBeVisible();
  expect(await documentLoads(page), "INTET reload mens der staar usendt tekst").toBe(1);
  await expect(email).toHaveValue("ugemt@cyclingzone.org");
});

test("B1 login: det sikre punkt — reloadet sker naar teksten er ryddet", async ({ page }) => {
  const state = await setupReleaseHarness(page);
  await page.goto("/login");
  const email = page.getByPlaceholder("din@email.dk");
  await email.fill("ugemt@cyclingzone.org");
  await page.getByRole("heading", { name: "Cycling Zone" }).click();

  state.served = { release: "e2e-sha-b", frontend: "e2e-frontend-b" };
  await page.clock.fastForward(PERIODIC);
  await expect(banner(page)).toBeVisible();
  expect(await documentLoads(page)).toBe(1);

  // Spilleren rydder feltet: der er ikke laengere noget at miste.
  await email.fill("");
  await page.getByRole("heading", { name: "Cycling Zone" }).click();

  await expect.poll(() => documentLoads(page), { timeout: 15_000 }).toBe(2);
});

// Review-fund 2 (11/9): klikket springer stadig porten over — det er spillerens
// egen beslutning — men det skal SIGE hvad det koster foerst, i banneret selv.
test("B1 login: bannerets Update-klik bekraefter foerst, og genindlaeser saa", async ({ page }) => {
  const state = await setupReleaseHarness(page);
  await page.goto("/login");
  await page.getByPlaceholder("din@email.dk").fill("ugemt@cyclingzone.org");
  await page.getByRole("heading", { name: "Cycling Zone" }).click();

  state.served = { release: "e2e-sha-b", frontend: "e2e-frontend-b" };
  await page.clock.fastForward(PERIODIC);
  await expect(banner(page)).toBeVisible();

  // Foerste klik: porten er lukket (usendt tekst), saa banneret spoerger.
  // Tilstanden aflaeses paa "Gem foerst"-knappen, ikke paa copyen: e2e koerer paa
  // dansk (fixtures saetter cz_lang), og selve ordlyden er daekket i
  // releaseUpdateBanner.source.test.js + skaermbillederne.
  await page.getByTestId("release-update-apply").click();
  await expect(page.getByTestId("release-update-save-first")).toBeVisible();
  expect(await documentLoads(page), "bekraeftelsen alene genindlaeser ingenting").toBe(1);

  // Andet klik = "Update anyway": spilleren har set prisen og valgt alligevel.
  await page.getByTestId("release-update-apply").click();
  await expect.poll(() => documentLoads(page), { timeout: 15_000 }).toBe(2);
});

test("B1 login: 'Save first' lukker banneret uden at genindlaese", async ({ page, browserName }) => {
  test.skip(
    browserName !== "chromium",
    "Ren UI-mekanik (én React-state der lukker banneret) uden motor-afhaengighed. WebKit-shard'en ligger paa tidsbudgettet (#4647); bekraeftelsen + selve reloadet koerer i BEGGE motorer i scenariet ovenfor.",
  );
  const state = await setupReleaseHarness(page);
  await page.goto("/login");
  const email = page.getByPlaceholder("din@email.dk");
  await email.fill("ugemt@cyclingzone.org");
  await page.getByRole("heading", { name: "Cycling Zone" }).click();

  state.served = { release: "e2e-sha-b", frontend: "e2e-frontend-b" };
  await page.clock.fastForward(PERIODIC);
  await expect(banner(page)).toBeVisible();

  await page.getByTestId("release-update-apply").click();
  await page.getByTestId("release-update-save-first").click();

  await expect(banner(page)).toHaveCount(0);
  expect(await documentLoads(page), "INTET reload — og teksten staar der endnu").toBe(1);
  await expect(email).toHaveValue("ugemt@cyclingzone.org");

  // Markoeren ligger der stadig: i det sekund der ikke laengere er noget at
  // miste, tages opdateringen af sig selv — ogsaa efter et "Save first".
  await email.fill("");
  await page.getByRole("heading", { name: "Cycling Zone" }).click();
  await expect.poll(() => documentLoads(page), { timeout: 15_000 }).toBe(2);
});

// --- B1: en spilflade bag login --------------------------------------------

test("B1 traening: en ugemt ugekladde blokerer reloadet, Gem frigiver det", async ({ page, browserName }) => {
  test.skip(
    browserName !== "chromium",
    "Ren mekanik uden motor-afhaengighed: daekket linje for linje af releaseWatch.test.js og koert i Chromium. WebKit-shard'en ligger paa tidsbudgettet (#4647); de motor-afhaengige scenarier — B1-blur-reproduktionen, det sikre punkt, bannerets bekraeftelse + klik, den glade sti, M2 og M3 — koerer i BEGGE motorer.",
  );
  const state = await setupReleaseHarness(page);
  await login(page);
  // Ugerytme-editoren bor paa "Week plan"-fanen (#3746 trin 7).
  await page.goto("/training?tab=weekplan");
  await expect(page.locator("#root")).toBeVisible();
  const loadsBefore = await documentLoads(page);

  // Ugerytme-panelets select'er er kladde indtil Gem. Vi aendrer én og flytter
  // fokus vaek — den praecise tilstand auditten kaldte "beskytter fokus, ikke
  // arbejde".
  const weekSelect = page.locator("select:visible").first();
  await expect(weekSelect).toBeVisible({ timeout: 20_000 });
  const options = await weekSelect.locator("option").all();
  const values = [];
  for (const option of options) values.push(await option.getAttribute("value"));
  const current = await weekSelect.inputValue();
  const other = values.find((v) => v && v !== current);
  test.skip(!other, "ugerytme-panelet har kun én mulig vaerdi i dette mock-datasaet");
  await weekSelect.selectOption(other);
  await page.locator("h1").first().click();

  state.served = { release: "e2e-sha-b", frontend: "e2e-frontend-b" };
  await page.clock.fastForward(PERIODIC);

  await expect(banner(page)).toBeVisible();
  expect(await documentLoads(page), "kladden maa ikke kasseres af et deploy").toBe(loadsBefore);
});

// --- M1 ---------------------------------------------------------------------

test("M1: A -> forgaeves forsoeg paa B -> C bliver stadig opdaget", async ({ page, browserName }) => {
  test.skip(
    browserName !== "chromium",
    "Ren mekanik uden motor-afhaengighed: daekket linje for linje af releaseWatch.test.js og koert i Chromium. WebKit-shard'en ligger paa tidsbudgettet (#4647); de motor-afhaengige scenarier — B1-blur-reproduktionen, det sikre punkt, bannerets bekraeftelse + klik, den glade sti, M2 og M3 — koerer i BEGGE motorer.",
  );
  const state = await setupReleaseHarness(page);
  // Slottet for B er allerede brugt i en tidligere dokumentstart i samme fane.
  await page.addInitScript(() => {
    try { window.sessionStorage.setItem("cz:app-version-reload:e2e-frontend-b", "1"); } catch { /* noop */ }
  });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Cycling Zone" })).toBeVisible();
  const loadsBefore = await documentLoads(page);

  state.served = { release: "e2e-sha-b", frontend: "e2e-frontend-b" };
  await page.clock.fastForward(PERIODIC);
  await expect(banner(page)).toBeVisible();
  expect(await documentLoads(page), "B's slot er brugt - intet nyt reload paa B").toBe(loadsBefore);

  // Der deployes C. FOER #5159 var watcheren frosset her og ville aldrig
  // hente version.json igen.
  state.served = { release: "e2e-sha-c", frontend: "e2e-frontend-c" };
  await page.clock.fastForward(PERIODIC);
  await expect.poll(() => documentLoads(page), { timeout: 15_000 }).toBe(loadsBefore + 1);
});

// --- M2 ---------------------------------------------------------------------

// Koerer i BEGGE motorer (review 11/9): udfaldet haenger paa at motorens fetch
// faktisk afbrydes af AbortController-deadlinen OG at `inFlight` frigives — det
// er motor-adfaerd, ikke vores bogholderi.
test("M2: et haengende versionskald doeder ikke detektionen — naeste vindue henter igen", async ({ page }) => {
  const state = await setupReleaseHarness(page);
  state.hang = true;
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Cycling Zone" })).toBeVisible();
  const loadsBefore = await documentLoads(page);

  await page.clock.fastForward(PERIODIC);
  // fastForward returnerer naar timerne er fyret, ikke naar den fetch de startede
  // er naaet frem til route-handleren.
  await expect.poll(() => state.versionCalls, { timeout: 10_000 }).toBeGreaterThan(0);

  // Deadlinen er 8 s: spol foerst forbi DEN alene, saa aborten faar lov at
  // afvikle sig selv, og derefter frem til naeste vindue. Uden abort ville alle
  // senere kald dele den samme uafsluttede promise, og fanen ville aldrig
  // opdage noget igen.
  state.hang = false;
  state.served = { release: "e2e-sha-b", frontend: "e2e-frontend-b" };
  await page.clock.fastForward("00:15");
  await page.waitForTimeout(500);
  await page.clock.fastForward(PERIODIC);

  await expect.poll(() => documentLoads(page), { timeout: 20_000 }).toBe(loadsBefore + 1);
});

// --- M3 ---------------------------------------------------------------------

// Koerer i BEGGE motorer (review 11/9): "sessionStorage der kaster" ER en
// motor-tilstand — WebKit's "The operation is insecure." er praecis den browser
// private mode rammer i praksis, og fail-closed-adfaerden skal bevises der.
test("M3: tre dokumentstarter uden sessionStorage giver NUL automatiske reloads", async ({ page }) => {
  const state = await setupReleaseHarness(page);
  // sessionStorage findes, men ENHVER operation kaster — privat browsing med
  // site-data slaaet fra. (Varianten hvor selve property-OPSLAGET kaster er
  // daekket i unit-testen `safeSessionStorage overlever at selve OPSLAGET
  // kaster`; i browseren ville den ogsaa vaelte tredjeparts-kode uden for
  // dette spors ejerskab, og saa maalte testen noget andet end porten.)
  await page.addInitScript(() => {
    const hostile = {
      getItem() { throw new Error("The operation is insecure."); },
      setItem() { throw new Error("The operation is insecure."); },
      removeItem() { throw new Error("The operation is insecure."); },
      clear() { throw new Error("The operation is insecure."); },
      key() { throw new Error("The operation is insecure."); },
      length: 0,
    };
    Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => hostile });
  });
  state.served = { release: "e2e-sha-b", frontend: "e2e-frontend-b" };

  let reloadsObserved = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) reloadsObserved += 1;
  });

  // Maalt som en DELTA omkring hver fastForward, ikke som et samlet tal: en
  // browser fyrer ogsaa framenavigated for sine egne start-navigationer, og et
  // absolut tal ville maale dem med i stedet for det testen handler om.
  for (let documentStart = 0; documentStart < 3; documentStart += 1) {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Cycling Zone" })).toBeVisible();
    const before = reloadsObserved;
    await page.clock.fastForward(PERIODIC);
    await page.waitForTimeout(800);
    expect(reloadsObserved, `dokumentstart ${documentStart + 1}: intet automatisk reload`).toBe(before);
  }
});

// --- den glade sti ----------------------------------------------------------

test("uden ugemt arbejde tages opdateringen af sig selv — ÉT dokument-load", async ({ page }) => {
  const state = await setupReleaseHarness(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Cycling Zone" })).toBeVisible();
  expect(await documentLoads(page)).toBe(1);

  state.served = { release: "e2e-sha-b", frontend: "e2e-frontend-b" };
  await page.clock.fastForward(PERIODIC);

  await expect.poll(() => documentLoads(page), { timeout: 15_000 }).toBe(2);
  expect(
    await page.evaluate(() => window.sessionStorage.getItem("cz:app-version-reload:e2e-frontend-b")),
  ).toBe("1");
});

test("H4: et deploy der kun aendrer git-sha'en genindlaeser ingen", async ({ page, browserName }) => {
  test.skip(
    browserName !== "chromium",
    "Ren mekanik uden motor-afhaengighed: daekket linje for linje af releaseWatch.test.js og koert i Chromium. WebKit-shard'en ligger paa tidsbudgettet (#4647); de motor-afhaengige scenarier — B1-blur-reproduktionen, det sikre punkt, bannerets bekraeftelse + klik, den glade sti, M2 og M3 — koerer i BEGGE motorer.",
  );
  const state = await setupReleaseHarness(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Cycling Zone" })).toBeVisible();

  // Docs-/backend-deploy: ny commit, uaendret frontend.
  state.served = { release: "e2e-sha-docs-only", frontend: CLIENT_FRONTEND };
  await page.clock.fastForward(PERIODIC);
  await page.waitForTimeout(500);

  expect(await documentLoads(page)).toBe(1);
  await expect(banner(page)).toHaveCount(0);
});
