// chunk-reload-navigation-guard.spec.js — regression for #3602.
//
// Stale-chunk-recovery (#881/#906) reloader siden når et lazy chunk ikke kan
// hentes. Men når browseren navigerer væk fra et dokument, aborterer den
// dokumentets igangværende chunk-loads — og WebKit melder den abort med PRÆCIS
// samme fejlstreng som en ægte stale chunk. Recovery-stierne troede derfor på en
// stale chunk og reloadede et dokument der allerede var på vej ud, hvilket
// kaprede den ægte navigation:
//
//   Navigation to "/academy" is interrupted by another navigation to "/dashboard"
//
// Det gjorde mobile-webkit rød i CI (8 failed / 40 flaky, run 31191790232, #3429)
// — men det er først og fremmest en brugerfejl: en spiller der navigerer væk
// mens et chunk stadig loader, bliver reloadet TILBAGE til den side de forlod.
//
// Testen gør vinduet deterministisk ved at forsinke document-responsen for
// målruten. Uden guarden i chunkErrors.js/sentry.jsx fejler den 5/5; med den
// består den 5/5. Forsinkelsen erstatter den langsommere CI-runner — på en hurtig
// maskine committer den nye side tilfældigvis hurtigt nok til at gamle,
// tidsbaserede guards holdt.
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

// Længere end BÅDE den udskudte reload (250 ms) og error-boundary'ens effect, så
// begge recovery-stier ville nå at fyre inde i vinduet hvis de var uguarded.
const SLOW_COMMIT_MS = 1500;

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("navigation væk fra en side med et chunk under load bliver ikke kapret af stale-chunk-recovery (#3602)", async ({ page }) => {
  // Efter login står vi på /dashboard, hvis lazy chunk stadig er under load.
  await login(page);

  // Gør document-committen langsom, så navigationen er "in flight" længe nok til
  // at et uguarded reload ville nå at kapre den.
  await page.route("**/academy", async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, SLOW_COMMIT_MS));
    await route.fallback();
  });

  // Selve assertionen: goto må ikke afbrydes. Uden guarden kaster den
  // "Navigation to /academy is interrupted by another navigation to /dashboard".
  await page.goto("/academy");

  // ...og vi skal faktisk være landet på /academy, ikke være reloadet tilbage.
  await expect(page).toHaveURL(/\/academy$/);
  await expect(page.locator("main")).toBeVisible();
});
