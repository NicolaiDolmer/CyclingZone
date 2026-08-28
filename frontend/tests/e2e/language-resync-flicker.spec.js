import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json } from "./fixtures.js";

// #2045: in-app sprog-flimmer — teksten skifter flere gange ved sprog-skift
// (og efterlader localStorage/DB i disharmoni, så det gentager sig ved næste load).
//
// Rod-årsag (to sammenspillende mekanismer i LanguageProvider's DB-resync-
// effekt, frontend/src/lib/language.jsx):
//   1. Effekten havde `language` i sit useEffect-dependency-array. Ethvert
//      LOKALT sprogskift (inkl. brugerens eget klik i <LanguageSwitcher>, som
//      allerede skriver DB'en i samme setLanguage()-kald) genstartede derfor
//      effekten.
//   2. Selv med `language` fjernet fra deps ville effekten STADIG genstarte:
//      den hook-returnerede `i18n` fra react-i18next v17's useTranslation()
//      er IKKE en stabil reference — biblioteket returnerer bevidst et NYT
//      wrapper-objekt (Object.create-kopi) hver gang i18n.language ændrer sig
//      (se node_modules/react-i18next/dist/es/useTranslation.js,
//      `createI18nWrapper`). Så `i18n` i et deps-array er reelt en skjult
//      proxy for `language` — samme selv-udløste genstart.
// Begge veje endte samme sted: hver genstart kaldte syncFromSession() PÅ NY —
// et helt uafhængigt HTTP-opslag på users.language, uden nogen garanti for
// rækkefølge overfor DB-skrivningen der lige var undervejs fra det samme
// klik. Landede læsningen FØR skrivningen var committed (målt: ~32ms efter
// klikket), læste den den GAMLE værdi og flippede UI'et tilbage — synligt som
// "skifter flere gange".
//
// De eksisterende e2e-mocks (fixtures.js/seedData.js) har ALDRIG haft et
// `language`-felt på "users"-tabellen, så `row?.language` var altid undefined,
// og resync-grenen (`if (dbLang && ...)`) var et permanent no-op i test — bugget
// var usynligt for hele test-suiten. Denne spec giver "users" et deterministisk
// `language`-felt der ALTID læses som "da" (uanset hvad klienten lige skrev),
// hvilket tvinger den beskrevne race uden at afhænge af netværks-timing.
//
// Instrumenteret via window.__i18n (kun eksponeret i e2e/dev-builds, se
// frontend/src/i18n/index.js), der tæller 'languageChanged'-events EFTER det
// eksplicitte klik — det er den observerbare "flimmer"-events selve React-
// re-renderet reagerer på.
test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);

  // Registreres EFTER installNetworkMocks, så "senest registrerede route
  // vinder" (samme mønster som installBoardStatusMock, #2863). GET på
  // "users" svarer altid "da" — simulerer en læsning der aldrig ser brugerens
  // egen nyligt afsendte skrivning (den værst tænkelige, men helt gyldige,
  // timing for et rigtigt netværkskald).
  await page.route("**/rest/v1/users**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204 });
    }
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method())) {
      return json(route, {});
    }
    return json(route, {
      id: "00000000-0000-4000-8000-000000000001",
      role: "manager",
      username: "Playwright Manager",
      login_streak: 3,
      language: "da",
    });
  });
});

test("#2045 sprogskift flimrer ikke: klik EN skal IKKE reverteres af en efterfølgende DB-resync", async ({ page }) => {
  await login(page);

  const trigger = page.locator('button[aria-haspopup="listbox"]:visible').first();
  await expect(trigger).toBeVisible();

  // Tæl 'languageChanged'-events FRA HERUDAF (efter mount-initialisering er
  // faldet til ro), så vi kun måler det brugerens klik forårsager.
  await page.evaluate(() => {
    window.__langEvents = [];
    window.__i18n.on("languageChanged", (lng) => window.__langEvents.push(lng));
  });

  await trigger.click();
  const menu = page.locator('ul[role="listbox"]');
  await expect(menu).toBeVisible();
  await menu.getByRole("option", { name: "English" }).click();
  await expect(menu).toBeHidden();

  // Første, forventede skift: da → en.
  await expect(trigger).toContainText(/en/i);

  // #2045-forward-guard: vent et rundeligt vindue (langt over ét mocket
  // HTTP-round-trip) og bekræft at INGEN yderligere sprogskift sker — hverken
  // en revert til "da" eller flere omgange. En bounded, begrundet wait er
  // nødvendig her: vi tester FRAVÆRET af en efterfølgende hændelse, hvilket
  // ikke kan udtrykkes som en polling-assertion på en positiv tilstand.
  await page.waitForTimeout(600);

  const events = await page.evaluate(() => window.__langEvents);
  expect(events, "sprog skiftede mere end forventet efter klik — DB-resync-race (#2045)").toEqual(["en"]);

  // UI'et skal stadig vise engelsk — ikke revertet tilbage til dansk.
  await expect(trigger).toContainText(/en/i);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
