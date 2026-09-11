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

test("B1 login: bannerets Update-knap genindlaeser paa spillerens eget klik", async ({ page }) => {
  const state = await setupReleaseHarness(page);
  await page.goto("/login");
  await page.getByPlaceholder("din@email.dk").fill("ugemt@cyclingzone.org");
  await page.getByRole("heading", { name: "Cycling Zone" }).click();

  state.served = { release: "e2e-sha-b", frontend: "e2e-frontend-b" };
  await page.clock.fastForward(PERIODIC);
  await expect(banner(page)).toBeVisible();

  await page.getByTestId("release-update-apply").click();
  await expect.poll(() => documentLoads(page), { timeout: 15_000 }).toBe(2);
});

// --- B1: en spilflade bag login --------------------------------------------

test("B1 traening: en ugemt ugekladde blokerer reloadet, Gem frigiver det", async ({ page }) => {
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

test("M1: A -> forgaeves forsoeg paa B -> C bliver stadig opdaget", async ({ page }) => {
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

  for (let documentStart = 0; documentStart < 3; documentStart += 1) {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Cycling Zone" })).toBeVisible();
    await page.clock.fastForward(PERIODIC);
    await page.waitForTimeout(500);
  }

  // Praecis de tre bevidste goto'er og ikke ét automatisk reload mere. (Kravet
  // i issuet var "hoejst ét"; fail-closed giver nul, og det er det testen laaser.)
  expect(reloadsObserved).toBe(3);
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

test("H4: et deploy der kun aendrer git-sha'en genindlaeser ingen", async ({ page }) => {
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
