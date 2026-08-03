// #3184 fair-play/I: tastefejl-værn på auktions-startpris. Verificerer at
// StartPriceTypoGuardModal vises FØR submit når startprisen matcher et
// ciffer-drop af rytterens markedsværdi (rider-1 "Ada Pedersen", egen rytter,
// market_value 1.680.000 — se seedData.js) og at begge veje ud af dialogen
// virker: "Fix price" retter feltet uden at submitte, "No, intentional"
// fortsætter den oprindelige (lave) pris uændret.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders } from "./fixtures.js";

const SCREEN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../pr-screens");

test.describe("Auction start-price typo guard (#3184)", () => {
  test.beforeEach(async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
    // installNetworkMocks' generiske "auctions"-mock filtrerer IKKE på
    // rider_id (returnerer altid hele AUCTIONS-arrayet), så rider-1's
    // profilquery ville ellers fejlagtigt arve auction-1 (som reelt hører til
    // rider-2) og vise "Aktiv auktion" — og dermed skjule "Put up for
    // auction"/"Start auction". Overstyr til tom liste (senest registrerede
    // route vinder): ingen af testens ryttere er under aktiv auktion.
    await page.route("**/rest/v1/auctions*", route => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      return json(route, []);
    });
  });

  test("rider profile — digit-drop price triggers the guard before submit", async ({ page }) => {
    await login(page);
    await page.goto("/riders/rider-1");
    await expect(page.getByRole("heading", { name: "Ada Pedersen" })).toBeVisible();

    await page.getByRole("button", { name: /^(Put up for auction|Sæt til auktion)$/ }).click();

    const priceInput = page.getByRole("spinbutton").first();
    await priceInput.fill("168000"); // Ada's market_value (1.680.000) ÷ 10 — ciffer-drop

    await page.getByRole("button", { name: /^(Start auction|Start auktion)$/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/168.000|168000/)).toBeVisible();
    await expect(dialog.getByText(/1.680.000|1,680,000/)).toBeVisible();

    await page.screenshot({ path: path.join(SCREEN_DIR, "typo-guard-rider-profile.png") });

    // "Fix price" retter feltet til markedsværdien UDEN at submitte — dialogen
    // lukker, formularen forbliver åben, ingen POST er sendt endnu.
    await dialog.getByRole("button", { name: /Fix price|Ret prisen/ }).click();
    await expect(dialog).toBeHidden();
    await expect(priceInput).toHaveValue("1680000");
  });

  test("rider profile — 'No, intentional' proceeds with the original low price unchanged", async ({ page }) => {
    let capturedBody = null;
    await page.route("**/api/auctions", route => {
      if (route.request().method() === "POST") {
        capturedBody = JSON.parse(route.request().postData() || "{}");
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, warnings: [] }) });
    });

    await login(page);
    await page.goto("/riders/rider-1");
    await page.getByRole("button", { name: /^(Put up for auction|Sæt til auktion)$/ }).click();

    const priceInput = page.getByRole("spinbutton").first();
    await priceInput.fill("168000");
    await page.getByRole("button", { name: /^(Start auction|Start auktion)$/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /No, my price is intentional|Nej, min pris er med vilje/ }).click();
    await expect(dialog).toBeHidden();

    await expect.poll(() => capturedBody).not.toBeNull();
    expect(capturedBody.starting_price).toBe(168000);
  });

  test("rider profile — honest low price (0,49x, #3136 median) does not trigger the guard", async ({ page }) => {
    await login(page);
    await page.goto("/riders/rider-1");
    await page.getByRole("button", { name: /^(Put up for auction|Sæt til auktion)$/ }).click();

    const priceInput = page.getByRole("spinbutton").first();
    // 1.680.000 × 0,49 — median ratio for konkurrenceudsatte auktioner (#3136),
    // ikke et ciffer-drop-mønster. Skal IKKE flages.
    await priceInput.fill("823200");
    await page.getByRole("button", { name: /^(Start auction|Start auktion)$/ }).click();

    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("team page — squad tab shows the same guard for the RiderActionModal auction tab", async ({ page }) => {
    await login(page);
    await page.goto("/team");
    await expect(page.getByRole("heading", { name: "E2E Racing" })).toBeVisible();

    // #706 i TeamPage.jsx: rækkens "Sell / Auction"-knap åbner RiderActionModal
    // (stopPropagation — et klik andetsteds i rækken navigerer i stedet til
    // rytterprofilen via den indlejrede RiderLink).
    await page.getByRole("row", { name: /Ada Pedersen/ })
      .getByRole("button", { name: /^(Sell \/ Auction|Sælg \/ Auktion)$/ })
      .click();

    const priceInput = page.getByRole("spinbutton").first();
    await priceInput.fill("168000");
    await page.getByRole("button", { name: /^(Start|Start auction|Start auktion)$/ }).click();

    const dialog = page.getByRole("dialog", { name: /Check your price|Tjek din pris/ });
    await expect(dialog).toBeVisible();

    await page.screenshot({ path: path.join(SCREEN_DIR, "typo-guard-team-page.png") });
  });

  // #3184: player-facing copy er EN-først (jf. CLAUDE.md sprogprioritet) — de
  // øvrige tests i denne fil kører på DA-fixturens standard-locale (matcher
  // login()'s hardkodede danske placeholders), så denne dækker eksplicit at
  // den engelske streng-variant også renderer korrekt + giver et EN-screenshot
  // til PR'en.
  test("rider profile — English copy renders correctly", async ({ page }) => {
    await login(page);
    // #3184: sprogskiftet skal ske EFTER goto — stabilizePage's addInitScript
    // sætter cz_lang='da' ved HVER navigation (den kører på ny document load),
    // så et skift til 'en' FØR et page.goto() ville blive nulstillet af
    // scriptet igen. Naviger først (stadig DA), skift derefter sprog live på
    // den allerede-loadede side (i18n.changeLanguage, ingen reload).
    await page.goto("/riders/rider-1");
    await expect(page.getByRole("heading", { name: "Ada Pedersen" })).toBeVisible();

    await page.getByRole("button", { name: /Skift sprog|Change language/ }).click();
    await page.getByRole("option", { name: /^English$/ }).click();
    await expect(page.getByRole("button", { name: "Change language" })).toBeVisible();

    await page.getByRole("button", { name: /^(Put up for auction|Sæt til auktion)$/ }).click();
    const priceInput = page.getByRole("spinbutton").first();
    await priceInput.fill("168000");
    await page.getByRole("button", { name: /^(Start auction|Start auktion)$/ }).click();

    const dialog = page.getByRole("dialog", { name: "Check your price" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/You're listing/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "No, my price is intentional" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Fix price" })).toBeVisible();

    await page.screenshot({ path: path.join(SCREEN_DIR, "typo-guard-rider-profile-en.png") });
  });
});
