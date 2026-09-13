// 5161-entry-404-selfheal.spec.js — browserbevis for audit-fund H2 (11/9).
//
// ── Hvorfor denne test findes ──────────────────────────────────────────────
//
// Boot-vagten (`public/chunk-selfheal.js`) byggede sin liste over boot-assets med
// `document.querySelectorAll` i det oejeblik den blev installeret. Men vagten
// ligger i <head> FOER entry-scriptet og Vites modulepreloads, saa parseren har
// ikke indsat et eneste modultag endnu: maalt i BAADE Chromium og WebKit var
// listen `count: 0, readyState: "loading"` ved install, og 28 tags fandtes foerst
// efter boot. Listen blev aldrig genopbygget, saa fejlhandleren afviste enhver
// fejlet ressource som "uden for boot-scope".
//
// Konsekvensen for en spiller med en immutable-cachet 404 paa entry-bundlen
// (#4595-klassen): tom `#root`, ingen heal-noegle i sessionStorage, ingen
// selvhelingsadvarsel og ingen fallback. Unit-testen var groen, fordi dens falske
// dokument startede paa `readyState: "complete"`.
//
// Derfor koerer denne test i RIGTIGE browsere mod det FAKTISK BYGGEDE HTML
// (webServer i playwright.config.js er en statisk server paa `dist/`, ikke vite
// dev) og fremprovokerer en entry-404 med route-interception:
//
//   1. Hurtig fejl (edgen svarer 404 midt i et deploy, filen findes bagefter):
//      vagten skal rense og genindlaese ÉN gang, og appen skal boote.
//   2. Allerede cachet 404 (filen er VAEK — 404 ogsaa efter reload): vagten maa
//      hoejst reloade én gang og skal derefter vise fallback-siden, saa spilleren
//      ikke sidder med en sort side uden udvej.
//
// Begge tilfaelde fejler paa den gamle guard: uden boot-liste matcher entry-URL'en
// ingenting, saa der kommer hverken advarsel, reload eller fallback.
//
// Dokumentvalg: scenarie 1 koerer paa "/" (den prerendrede landing, som Vercel
// serverer fra dist/index.html), scenarie 2 paa "/app.html" — den TOMME shell
// Vercel rewriter alle app-ruter til (se vercel.json). Fallback-UI'en skriver
// kun i en tom `#root`, og app.html er praecis det dokument en spiller paa
// /dashboard faar.
//
// Refs #5161 #5162 #4595
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage } from "./fixtures.js";

/**
 * Laes den build-genererede boot-liste ud af det faerdige HTML.
 * Kaldes FOER route-interceptionen installeres, saa den altid ser det aegte svar.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} documentPath
 * @returns {Promise<string[]>}
 */
async function readBootAssets(page, documentPath) {
  const response = await page.request.get(documentPath);
  expect(response.ok(), `${documentPath} kunne ikke hentes fra preview-serveren`).toBeTruthy();
  // HTML-kommentarer FJERNES foerst: doc-kommentaren over guard-tagget i
  // index.html citerer selve datablok-tagget ordret ("<script
  // type=\"application/json\" id=\"cz-boot-assets\">") og staar FOER den
  // plugin-injicerede blok i dokumentet. Uden strip rammer regexen
  // kommentarteksten, og JSON.parse kaster paa prosaen i stedet.
  const html = (await response.text()).replace(/<!--[\s\S]*?-->/g, "");
  // Kraev ogsaa det lukkende tag, saa kun en rigtig datablok kan matche.
  const match = html.match(/<script\b[^>]*\bid="cz-boot-assets"[^>]*>([\s\S]*?)<\/script>/);
  expect(
    match,
    `${documentPath} mangler <script id="cz-boot-assets"> — uden den er boot-vagten slukket (#5161)`,
  ).not.toBeNull();
  const urls = JSON.parse(match[1]);
  expect(
    urls.length,
    "boot-listen i det byggede HTML er tom — vite-pluginet cz-boot-assets-manifest koerte ikke",
  ).toBeGreaterThan(1);
  return urls;
}

/**
 * Interceptér dokumentet (for at taelle page-loads) og entry-bundlen (for at
 * fremprovokere 404'en). `failEntry` afgoer pr. request om entryen skal fejle.
 *
 * @returns {Promise<{ loads: () => number }>}
 */
async function interceptBoot(page, { documentPath, entryPath, failEntry }) {
  let documentLoads = 0;
  const loads = () => documentLoads;

  await page.route(
    (url) => url.pathname === documentPath,
    async (route) => {
      // Kun det rigtige dokument-load taelles — vagtens egen canary-fetch mod
      // location.href rammer samme sti med resourceType "fetch".
      if (route.request().resourceType() === "document") documentLoads += 1;
      await route.fallback();
    },
  );

  await page.route(
    (url) => url.pathname === entryPath,
    async (route) => {
      if (!failEntry(loads())) return route.fallback();
      // Samme svar som Vercels edge giver paa et endnu ikke (eller ikke laengere)
      // eksisterende chunk.
      await route.fulfill({ status: 404, contentType: "text/plain", body: "Not Found" });
    },
  );

  return { loads };
}

function collectWarnings(page) {
  const lines = [];
  // e2e-error-collector-exempt: denne spec asserter IKKE paa "ingen fejl" — den
  // leder efter boot-vagtens EGNE "[chunk-selfheal]"-linjer, som er beviset paa at
  // boot-listen ikke var tom. WebKit-dev-noise kan ikke matche det praefiks, saa
  // fixtures.js' filter ville hverken hjaelpe eller skade. Uncaught fejl daekkes
  // stadig af auto-fixturen i e2e-base.js.
  page.on("console", (msg) => {
    if (msg.text().includes("[chunk-selfheal]")) lines.push(msg.text());
  });
  return lines;
}

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("entry-404 ved boot: vagten renser boot-listen og genindlaeser ÉN gang, og appen booter (#5161)", async ({
  page,
}) => {
  const bootAssets = await readBootAssets(page, "/");
  const entryPath = bootAssets.find((url) => url.endsWith(".js"));
  expect(entryPath, "boot-listen indeholdt ingen JS-entry").toBeTruthy();

  const warnings = collectWarnings(page);
  // Hurtig fejl: 404 kun i det FOERSTE page-load. Efter vagtens reload findes
  // filen — praecis som naar et deploy er faerdigt.
  const { loads } = await interceptBoot(page, {
    documentPath: "/",
    entryPath,
    failEntry: (documentLoads) => documentLoads <= 1,
  });

  await page.goto("/");

  // Vagten skal have genindlaest dokumentet ÉN gang — ikke nul (fundet H2) og
  // ikke i en loop.
  await expect.poll(loads, { timeout: 20000, message: "vagten genindlaeste ikke dokumentet" }).toBe(2);

  // ... og det andet load skal faktisk give en booted app.
  await page.waitForLoadState("load");
  // `.catch(() => false)`: vagtens reload kan rive konteksten vaek MIDT i en
  // poll-runde ("Execution context was destroyed"), og i WebKit sker det ofte nok
  // til at fejle koerslen. Det er ikke en fejl i vagten — det er beviset paa at
  // den reloadede. En tabt runde skal derfor bare taelle som "ikke booted endnu".
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__czAppBooted)).catch(() => false), {
      timeout: 20000,
      message: "appen booted ikke efter selvhelingen",
    })
    .toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Beviset for at listen IKKE var tom: advarslen taeller de URL'er der blev
  // renset med cache:'reload'. Paa den gamle guard var tallet 0 — faktisk kom
  // advarslen aldrig, fordi entry-URL'en ikke matchede den tomme liste.
  const healLine = warnings.find((line) => line.includes("renser"));
  expect(healLine, `ingen heal-advarsel fra boot-vagten:\n${warnings.join("\n") || "(ingen)"}`).toBeTruthy();
  const cleaned = Number(healLine.match(/renser (\d+) modul-URL'er/)?.[1] ?? 0);
  expect(cleaned, "boot-listen var tom ved install — se #5161/H2").toBeGreaterThan(1);
  expect(healLine).toContain("entry-modulet kunne ikke hentes");

  // Heal-noeglen skal vaere skrevet (audit maalte den som null).
  const guardKey = await page.evaluate(() => window.sessionStorage.getItem("cz_chunk_selfheal_at"));
  expect(guardKey, "heal-noeglen blev ikke skrevet").toMatch(/^\d+$/);

  expect(loads(), "vagten maa hoejst reloade én gang pr. sideindlaesning").toBe(2);
});

test("allerede cachet entry-404: hoejst ét reload, derefter fallback-siden med en udvej (#5161)", async ({
  page,
}) => {
  // app.html er den TOMME shell Vercel rewriter app-ruter til — det dokument en
  // spiller paa /dashboard faar, og det eneste sted fallback-UI'en kan skrive.
  const bootAssets = await readBootAssets(page, "/app.html");
  const entryPath = bootAssets.find((url) => url.endsWith(".js"));
  expect(entryPath, "boot-listen indeholdt ingen JS-entry").toBeTruthy();

  const warnings = collectWarnings(page);
  // Filen er VAEK: 404 i hvert load, ogsaa efter vagtens refetch med
  // cache:'reload'. Det er den cachede-404-situation uden selvhelingsudvej.
  const { loads } = await interceptBoot(page, {
    documentPath: "/app.html",
    entryPath,
    failEntry: () => true,
  });

  await page.goto("/app.html");

  // Fallback-siden er vagtens sidste udvej: EN foerst, DA under.
  await expect(page.getByRole("heading", { level: 1, name: "The game did not start" })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByText("Spillet startede ikke")).toBeVisible();
  await expect(page.getByText("The game's files did not load. Reload to try again.")).toBeVisible();
  await expect(
    page.getByText("Spillets filer blev ikke hentet. Genindlæs for at prøve igen."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();

  // Brand-fladen (ejer-krav 11/9): siden skal se ud som Cycling Zone, ikke som en
  // browserfejl. Wordmarken er inline SVG (app-CSS og brand-fontene findes ikke
  // her), og den skal vaere synlig i BEGGE viewports uden vandret scroll.
  await expect(page.getByRole("img", { name: "Cycling Zone" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "fallback-siden gav vandret scroll").toBeLessThanOrEqual(0);

  // Loop-sikkerheden: ét heal-reload, ikke flere — og advarslen skal forklare hvorfor.
  expect(loads(), "vagten reloadede mere end én gang").toBe(2);
  expect(warnings.join("\n")).toMatch(/reload sprunget over \(allerede forsoegt/);
});
