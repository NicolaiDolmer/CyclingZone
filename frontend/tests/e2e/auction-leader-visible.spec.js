import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, AUCTIONS } from "./fixtures.js";

// #3099 · Hvem fører auktionen? Desktop-tabellen bar fører-holdnavnet i en
// `title`-tooltip på beløbet: usynligt uden mus, og på touch findes tooltippen
// slet ikke. Mobil-kortet viste det som linje. Testen låser den nye kontrakt:
// linjen er SYNLIG uden hover i den flade viewporten faktisk renderer (specs
// kører i alle tre projekter, så både desktop- og mobil-layoutet dækkes), og
// uden bud siger den det eksplicit i stedet for at være tom.
//
// `.filter({ visible: true })`: begge layouts ligger i DOM'en samtidig (md:hidden
// / hidden md:block), så en rå tekst-locator ville matche to elementer — ét af
// dem display:none. getByRole ville filtrere selv, men her matcher vi på tekst.

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("leading team is visible in the row without hovering (#3099)", async ({ page }) => {
  // Mere specifik route end installNetworkMocks' rest-catch-all → registreret
  // sidst, så Playwright vælger den. Fixture-auktionen har ingen byder.
  const led = AUCTIONS.map(a => ({
    ...a,
    current_price: 75000,
    current_bidder_id: "team-leader",
    current_bidder: { id: "team-leader", name: "Leading Wheels" },
  }));
  await page.route("**/rest/v1/auctions**", route => {
    if (route.request().method() !== "GET") return json(route, []);
    return json(route, led);
  });

  await login(page);
  await page.goto("/auctions");

  const leaderLine = page
    .getByText(/^(Fører|Leading): Leading Wheels$/)
    .filter({ visible: true });

  await expect(leaderLine).toHaveCount(1);
  await expect(leaderLine).toBeVisible();

  // Kernen i #3099: navnet må ikke kun bo i en title-tooltip på beløbet.
  await expect(page.locator("[title^='Fører:'], [title^='Leading:']")).toHaveCount(0);
});

test("no-bid auction says so instead of leaving the line blank (#3099)", async ({ page }) => {
  await login(page);
  await page.goto("/auctions");

  // Seed-auktionen: current_bidder_id null og rytteren står stadig hos sælger
  // → ingen fører. Linjen renderes alligevel, så rækkehøjden ikke hopper.
  const noBids = page
    .getByText(/^(Ingen bud endnu|No bids yet)$/)
    .filter({ visible: true });

  await expect(noBids).toHaveCount(1);
  await expect(noBids).toBeVisible();
});
