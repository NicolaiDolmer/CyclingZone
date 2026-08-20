// #vk-auction-signals — screenshots af de to ejer-godkendte mikrofeatures:
// (a) vedvarende overbudt-markering på /auctions (række + kort), (b) budkrigs-
// markør i auktionshistorikken (/auctions/history).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js), mønster kopieret fra quality-auctions-contract.shots.mjs. Kører
// mod en kørende preview/dev-server med e2e-netværksmocks.
//
//   node tests/e2e/vk-auction-signals.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const { AUCTIONS, TEST_TEAM, BIDWAR_RIVAL_TEAM } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/seedData.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5199";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

// Overbudt-scenarie: samme aktive auktion som standard-seedet, men med en
// TREDJE manager (BIDWAR_RIVAL_TEAM — hverken sælger eller mig) som aktuel
// fører, så "jeg er overbudt" kan vises uden at ændre sælger-/ejerskabs-
// antagelser andre specs bygger på.
const OVERBID_AUCTION = {
  ...AUCTIONS[0],
  current_bidder_id: BIDWAR_RIVAL_TEAM.id,
  current_bidder: { id: BIDWAR_RIVAL_TEAM.id, name: BIDWAR_RIVAL_TEAM.name },
  current_price: 65000,
};

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 393, height: 852 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    locale: "da-DK",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);

  // Aktiv auktion → OVERBID_AUCTION (kun den aktive liste, IKKE completed-
  // queryen AuctionHistoryPage bruger — den skal fortsat ramme den generiske
  // handler i installNetworkMocks).
  await page.route("**/rest/v1/auctions**", (route) => {
    const request = route.request();
    if (request.method() !== "GET" || request.url().includes("status=eq.completed")) {
      return route.fallback();
    }
    return json(route, [OVERBID_AUCTION]);
  });
  // Mit tidligere (nu overbudte) bud på auktionen — samme query-form som
  // AuctionsPage.loadAll(): .select("auction_id, amount").eq("team_id", teamId).
  await page.route("**/rest/v1/auction_bids**", (route) => {
    const request = route.request();
    if (request.method() !== "GET" || !request.url().includes(`team_id=eq.${TEST_TEAM.id}`)) {
      return route.fallback();
    }
    return json(route, [{ auction_id: OVERBID_AUCTION.id, amount: 55000 }]);
  });

  await stabilizePage(page);
  await login(page);

  await page.goto("/auctions");
  await page.getByTestId("auctions-ticker").waitFor();
  // Den vedvarende overbudt-chip (badge.outbid) — venter på den frem for et
  // fast timeout, så snapshottet ikke kan lande før chippen er rendret.
  // Rytteren renderes BÅDE i det (skjulte) mobil-kort og den (skjulte) desktop-
  // række afhængigt af viewport (begge ligger altid i DOM'et, CSS skjuler den
  // ene) — scope til den container CSS'en faktisk viser ved denne viewport,
  // ellers kan .first() ramme den skjulte kopi og aldrig blive "visible".
  const outbidScope = page.locator(vp.name === "desktop" ? "table" : ".md\\:hidden");
  await outbidScope.getByText(/Overbudt · dit|Outbid · yours/).first().waitFor();
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(OUT, `vk-auction-outbid-${vp.name}.png`), fullPage: false });

  // Budkrigs-markøren kræver ingen override — COMPLETED_AUCTIONS/
  // COMPLETED_AUCTION_BIDS (seedData.js, #3401) har allerede 4 bud fra 2
  // forskellige hold på auction-completed-1, serveret af den generiske
  // installNetworkMocks-handler.
  if (vp.name === "desktop") {
    await page.goto("/auctions/history");
    await page.getByRole("table").first().waitFor();
    await page.getByText(/Budkrig ·|Bid war ·/).first().waitFor();
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(OUT, "vk-auction-bidwar-history.png"), fullPage: false });
  }

  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
