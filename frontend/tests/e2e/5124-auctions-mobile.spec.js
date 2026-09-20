// #5124 — D-047-audit af Auktioner på mobil (#5124's ejer-tekst siger "<768px";
// AuctionCard/tabel-splittet herunder bruger sin egen, allerede eksisterende
// `md:hidden`/`hidden md:block`-grænse på 768px, forud for #5124).
//
// FUND (dokumenteret her i stedet for i kode, da ingen kode ændres): Auktions-
// tabellen (AuctionRow, sticky navn venstre + sticky bud højre — se kommentaren
// ved AuctionList i AuctionsPage.jsx) er allerede `hidden md:block` og vises
// ALDRIG under 768px. Under 768px viser AuctionList i stedet AuctionCard — en
// fuldt stablet kort-visning UDEN nogen tabel, sticky-kolonne eller vandret
// scroll, bygget før #5124 (se AuctionCard's egne komментarer, #2849 bølge 6,
// #228, #3956 m.fl.). Bud-input + byd-knap er allerede fulde bredde/flex-wrap
// med 44px tap-mål. #5124's antagelse om en "sticky højre bud-kolonne" der skal
// gøres brugbar på mobil holder derfor IKKE mod koden som den står i dag — der
// er ingen tabel at gøre noget ved under 768px. Denne spec beviser det i stedet
// for at bygge en løsning på et problem der ikke findes: ingen sidescroll, og
// hovedhandlingen (byd) virker uden at tabellen nogensinde vises.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders, evidenceShotPath } from "./fixtures.js";

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
});

test("mobil 393px: auktions-tabellen (sticky bud-kolonne) findes slet ikke — kortvisningen bruges, ingen sidescroll, og 'Byd' virker", async ({ page }, testInfo) => {
  await login(page);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/auctions");
  await expect(page.getByText("Mikkel Hansen").first()).toBeVisible();

  const noPageScroll = () => page.evaluate(
    () => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth + 1
  );
  await expect.poll(noPageScroll).toBe(true);

  // Den sticky-bud-tabel er i DOM'en (begge layouts renderes altid, #3099-
  // konventionen), men CSS-skjult under 768px — `.auction-bid-cell` (sticky
  // right) må ALDRIG være den synlige variant på mobil.
  await expect(page.locator("table[data-sortable]").filter({ visible: true })).toHaveCount(0);
  await expect(page.locator(".auction-bid-cell").filter({ visible: true })).toHaveCount(0);

  await page.screenshot({ path: evidenceShotPath(`pr-screens/5124-auctions-mobile-393-${testInfo.project.name}.png`), fullPage: false });

  // Hovedhandlingen: byd på auktionen fra kortet.
  let body = null;
  await page.route("**/api/auctions/auction-1/bid", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    body = JSON.parse(request.postData() || "{}");
    return json(route, { ok: true, currentPrice: body.amount });
  });
  const card = page.locator("[data-auction-row='auction-1']").filter({ visible: true });
  await card.getByRole("button", { name: /Afgiv bud/ }).click();
  // Byd-knappen åbner en bekræftelsesdialog (BidConfirmModal, delt med
  // Transferlisten) — samme to-trins flow som desktop-rækken, uændret af #5124.
  await page.getByRole("dialog").getByRole("button", { name: "Byd", exact: true }).click();
  await expect.poll(() => body).not.toBeNull();
  expect(body.amount).toBeGreaterThan(0);
  await expect.poll(noPageScroll).toBe(true);
});

test("desktop 1280px: uændret — tabellen med sticky bud-kolonne vises, kortvisningen er skjult", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only regressionstjek — dækket af mobile-projekterne ovenfor.");
  await login(page);
  await page.goto("/auctions");

  await expect(page.locator("table[data-sortable]").filter({ visible: true })).toHaveCount(1);
  await expect(page.locator(".auction-bid-cell").filter({ visible: true }).first()).toBeVisible();

  await page.screenshot({ path: evidenceShotPath(`pr-screens/5124-auctions-desktop-1280-${testInfo.project.name}.png`), fullPage: false });
});
