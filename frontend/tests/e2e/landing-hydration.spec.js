import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage } from "./fixtures.js";

// Hydration-guard for den prerendrede landing (dist/index.html).
//
// prerender.mjs renderer ALTID landing på engelsk (render("/", "en")). En
// da-besøgende har cz_lang="da" i localStorage FØR boot, så i18next's
// LanguageDetector vælger dansk før React monterer. Uden hydration-fixet
// renderer klientens hydrerings-pass derfor dansk mod engelsk server-HTML →
// React #418 (hydration failed) / #422 (Suspense → client render) / #425 (text
// content mismatch) logges i konsollen, og prerender-gevinsten smides væk for
// præcis de brugere.
//
// stabilizePage() sætter cz_lang="da" (samme init-script som resten af suiten),
// så denne test reproducerer prod-scenariet 1:1 mod preview-buildet (statisk
// dist/, prerendret index.html). Fixet skal hydrere mod EN og skifte til den
// besøgendes sprog FØRST efter hydration → ren konsol.
//
// #4925: det "først efter hydration" var et gæt på tid (requestIdleCallback,
// ellers setTimeout(0)). WebKit har ingen requestIdleCallback, så i Safari
// kunne skiftet lande FØR React havde hydreret rute-boundary'en (Suspense i
// App.jsx) → dansk "Spring til indhold" mod engelsk "Skip to content" → #418,
// og React genopbyggede hele landing-træet på klienten. Nu venter skiftet på et
// signal fra selve boundary'en (lib/prerenderHydration.ts). Den anden test
// nedenfor gør racet deterministisk, så det ikke kun fanges under CI-belastning.

const HYDRATION_ERROR = /Minified React error #(418|422|423|425)|Hydration failed|hydrat|did not match|server[- ]rendered/i;

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
  // #4925: gem en reference til den PRERENDREDE <h1> før appens scripts kører.
  // `readystatechange → interactive` fyrer efter parsing men FØR module-scripts
  // (main.jsx) eksekveres. Lykkes hydrationen, genbruger React netop den node;
  // fejler den (#418), genopbygger React træet på klienten, og noden er væk.
  // Det er prerender-gevinsten målt direkte — uafhængigt af hvad der når
  // konsollen.
  await page.addInitScript(() => {
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "interactive") {
        window.__czPrerenderedH1 = document.querySelector("#root h1");
      }
    });
  });
});

async function expectCleanDanishHydration(page) {
  const errors = [];
  // e2e-error-collector-exempt: denne spec asserter IKKE på "ingen fejl" —
  // den samler alt og filtrerer bagefter på HYDRATION_ERROR (se nedenfor).
  // WebKit-dev-noise (afbrudte route-chunks, mock-CORS) kan ikke matche det
  // mønster, så #3601-filtret ville hverken hjælpe eller skade her. Rå
  // opsamling er det rigtige: den holder hydration-signalet uafhængigt af
  // hvad fixtures.js måtte filtrere fra i fremtiden.
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");

  // Landing hydrerede uden at blæse op (hero-overskrift synlig) …
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // … og skiftede til dansk EFTER hydration (post-hydration language-switch).
  await expect(page.locator("header")).toContainText("Log ind");
  await expect(page.getByText("Sådan spiller du")).toBeVisible();

  // Giv en evt. mismatch tid til at nå konsollen før vi asserter.
  await page.waitForTimeout(300);

  const hydrationErrors = errors.filter((e) => HYDRATION_ERROR.test(e));
  expect(
    hydrationErrors,
    `landing loggede hydration-fejl:\n${hydrationErrors.join("\n") || "(ingen)"}`,
  ).toEqual([]);

  // #4925: den prerendrede <h1> skal være den SAMME node efter sprogskiftet —
  // ellers har React smidt server-HTML'en væk og client-renderet landing.
  const keptPrerenderedDom = await page.evaluate(() => {
    const serverH1 = window.__czPrerenderedH1;
    return Boolean(serverH1) && serverH1 === document.querySelector("#root h1");
  });
  expect(
    keptPrerenderedDom,
    "landingens prerendrede <h1> blev erstattet — React genopbyggede træet på klienten",
  ).toBe(true);
}

test("prerendered landing hydrates cleanly for a Danish visitor (no #418/#422/#425)", async ({
  page,
}) => {
  await expectCleanDanishHydration(page);
});

// #4925: værste tilfælde, deterministisk. Det gamle sprogskifte ventede på
// requestIdleCallback (Safari: setTimeout(0)) og lod browserens scheduler
// afgøre om rute-boundary'en nåede at hydrere først. Her fyrer "idle" MED DET
// SAMME, så et skifte der stoler på tid, lander før boundary'en er hydreret —
// i alle tre projekter, hver gang. Kun et skifte der venter på hydrations-
// signalet fra selve boundary'en (lib/prerenderHydration.ts) består.
test("prerendered landing hydrates cleanly for a Danish visitor even when idle fires immediately", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.requestIdleCallback = (callback) => {
      callback({ didTimeout: false, timeRemaining: () => 50 });
      return 0;
    };
  });
  await expectCleanDanishHydration(page);
});
