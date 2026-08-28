// Selv-test af fejl-guarden i e2e-base.js (#4248).
//
// Guarden er suitens vigtigste sikkerhedsnet, men den er usynlig: den gør
// ingenting når alt er godt. Uden denne spec ville en refaktor kunne koble
// auto-fixturen fra, og alle 70 specs ville blive grønne-men-blinde igen —
// præcis den tilstand #4248 blev skrevet for at komme ud af.
//
// Testen er bevidst lille og beviser to ting maskinelt:
//
//   1. `allowedPageErrors` findes som option-fixture. Playwright fejler hårdt
//      på en ukendt option i `test.use()`, så denne spec kan KUN køre hvis
//      e2e-base.js faktisk er wired ind. Importerer nogen `test` fra
//      @playwright/test igen, dør specen med det samme.
//   2. Allowlisten er smal og virker: en fejl der matcher mønsteret slipper
//      igennem, og guarden fælder derfor ikke en bevidst fremprovokeret sti.
//
// At guarden FÆLDER en ikke-undtaget fejl kan ikke testes indefra uden at
// fejle testen selv. Den halvdel dækkes statisk af guards.test.js (#4248),
// som verificerer at pageerror-lytteren, unhandledrejection-lytteren og
// `auto: true` alle står i kilden.

import { test, expect } from "./e2e-base.js";
import { installNetworkMocks } from "./fixtures.js";

const SENTINEL = "cz-guard-selftest-sentinel";

test.use({ allowedPageErrors: [new RegExp(SENTINEL)] });

test("#4248 fejl-guarden er wired, og allowlisten undtager smalt", async ({ page }) => {
  await installNetworkMocks(page);
  await page.goto("/login");

  // Begge kanaler guarden dækker, med en besked allowlisten matcher.
  await page.evaluate((s) => {
    Promise.reject(new TypeError(s));
    setTimeout(() => { throw new Error(s); }, 0);
  }, SENTINEL);

  await page.waitForTimeout(300);

  // Naar vi naar hertil UDEN at auto-fixturen har kastet, har allowlisten
  // gjort sit arbejde. Var mønsteret ikke ramt, var testen faldet i teardown.
  await expect(page.getByRole("heading", { name: "Cycling Zone" })).toBeVisible();
});
