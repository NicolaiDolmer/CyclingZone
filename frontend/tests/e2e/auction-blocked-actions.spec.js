import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

// #2719 · Autobud-loftet: knappen "Gem" var `disabled` så snart beløbet lå under
// minimumsbuddet, uden ét ord om hvorfor. Clarity fangede det som et dead click.
// Testen låser den nye kontrakt fast:
//   • knappen er IKKE disabled (så browseren sluger ikke klikket),
//   • den er aria-disabled og peger på en synlig begrundelse,
//   • begrundelsen nævner beløbet spilleren skal op på,
//   • og klikket gemmer IKKE noget.
//
// Fixture-auktionen har current_price 50000 uden aktiv byder → minimumsbud 50000.

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("auto-bid Save explains itself instead of dying silently (#2719)", async ({ page }) => {
  await login(page);
  await page.goto("/auctions");

  // Åbn autobud-panelet (mobil-kort og desktop-række deler samme aria-labels;
  // .first() rammer den flade viewporten faktisk renderer).
  await page.getByRole("button", { name: /autobud-loft|auto-bid limit/i }).first().click();

  // #3495: proxy-/bud-felterne skiftede fra type="number" (role "spinbutton")
  // til type="text" + inputMode="numeric" (role "textbox") for at kunne
  // acceptere danske tusindtalsseparatorer ("," og mellemrum blokeres helt af
  // native number-inputs).
  const limitInput = page.getByRole("textbox", { name: /autobud-loft|auto-bid limit/i }).first();
  await expect(limitInput).toBeVisible();
  await limitInput.fill("40000");

  const save = page.getByRole("button", { name: /gem autobud-loft|save auto-bid limit/i }).first();

  // Kernen i #2719: DOM-propertien `disabled` skal være false, ellers sluger
  // browseren klikket og spilleren får intet svar. (Bemærk: Playwright's
  // toBeDisabled() regner aria-disabled MED, så den kan ikke bruges her — det er
  // netop forskellen mellem "browseren ignorerer dig" og "vi svarer dig".)
  await expect(save).toHaveJSProperty("disabled", false);
  await expect(save).toHaveAttribute("aria-disabled", "true");

  // Begrundelsen er synlig OG bundet til knappen.
  const reasonId = await save.getAttribute("aria-describedby");
  expect(reasonId).toBeTruthy();
  // Attribut-selector, ikke #id: React's useId laver id'er som ":r1:" der ikke
  // er gyldige i en rå CSS id-selector.
  const reason = page.locator(`[id="${reasonId}"]`);
  await expect(reason).toBeVisible();
  await expect(reason).toContainText("50.000");

  // Et klik på den blokerede knap åbner ikke bekræftelses-dialogen. `force`
  // springer Playwright's aria-bevidste enabled-gate over og efterligner det
  // faktiske bruger-tryk (som browseren VIL levere til vores handler).
  await save.click({ force: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(reason).toBeVisible();

  // Hæver spilleren loftet til minimumsbuddet, forsvinder blokaden.
  await limitInput.fill("50000");
  await expect(save).not.toHaveAttribute("aria-disabled", "true");
  await expect(reason).toHaveCount(0);
});
