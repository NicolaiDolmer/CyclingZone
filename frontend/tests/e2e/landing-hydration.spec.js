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
// nedenfor fjerner requestIdleCallback, så Safari-stien også køres i Chromium.

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

// #4925: Safari/WebKit har ingen requestIdleCallback. Uden den faldt det gamle
// sprogskifte tilbage til setTimeout(0), som kunne lande før rute-boundary'en
// var hydreret. Denne variant tvinger den sti i ALLE tre projekter, så den ikke
// kun er dækket af den ene webkit-shard.
test("prerendered landing hydrates cleanly for a Danish visitor without requestIdleCallback (Safari path)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.requestIdleCallback = undefined;
  });
  await expectCleanDanishHydration(page);
});
