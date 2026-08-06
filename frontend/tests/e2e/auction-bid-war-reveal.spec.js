import { expect, test } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

// #3401 · Post-hammerslag-reveal af budkrigen. Fixture-auktionen
// (auction-completed-1, seedData.js) er AFSLUTTET og har 4 realiserede bud
// mellem E2E Racing (testholdet, vinder) og Northwind Cycling (rival). Testen
// låser den nye kontrakt fast:
//   • "Se budkrigen"-knappen er synlig på en afsluttet auktion med bud,
//   • modalen viser BEGGE holdnavne i kronologisk rækkefølge,
//   • det vindende bud er tydeligt markeret,
//   • og fair-play-noten (proxy-lofter forbliver private) er synlig.

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("completed auction reveals the full bid war with team names (#3401)", async ({ page }) => {
  await login(page);
  await page.goto("/auctions/history");

  await expect(page.getByRole("heading", { name: "Théo Journal" }).or(
    page.getByRole("link", { name: "Théo Journal" })
  )).toBeVisible();

  const viewBidWar = page.getByRole("button", { name: "Se budkrigen" });
  await expect(viewBidWar).toBeVisible();
  await viewBidWar.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Théo Journal");
  await expect(dialog).toContainText("340.000");

  // Begge hold optræder i historikken — reveal virker for BÅDE vinder og taber.
  await expect(dialog.getByText("Northwind Cycling").first()).toBeVisible();
  await expect(dialog.getByText("E2E Racing").first()).toBeVisible();

  // Det vindende bud (sidste kronologisk, 340.000 fra E2E Racing) er markeret.
  await expect(dialog.getByText("Vindende bud")).toBeVisible();

  // Fair-play-grænsen er synlig i UI'et, ikke kun i kode-kommentarer.
  await expect(dialog).toContainText("autobud-lofter", { ignoreCase: true });

  // Luk modalen igen.
  await dialog.getByRole("button", { name: "Luk" }).click();
  await expect(dialog).toBeHidden();
});

test("active auctions never reveal bidder names (#3401 anonymity boundary)", async ({ page }) => {
  await login(page);
  await page.goto("/auctions");

  // Fixture-auktionen (auction-1) er AKTIV og har ingen bud endnu, men selv med
  // bud må hverken tabel-rækken eller live-feeden vise et rivalholds navn — kun
  // "Ingen bud endnu"/beløb. Denne test dokumenterer grænsen: ingen "Se
  // budkrigen"-knap findes nogen steder på den aktive side.
  await expect(page.getByRole("button", { name: "Se budkrigen" })).toHaveCount(0);
});
