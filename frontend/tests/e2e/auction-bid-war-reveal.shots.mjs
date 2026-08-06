// #3401 — screenshots af post-hammerslag-reveal: budkrig-modalen (AuctionHistoryPage)
// + taber-notifikationen med vindernavn (NotificationsPage).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun *.spec.js).
// Kører mod en kørende preview/dev-server med e2e-netværksmocks. Notifikations-
// fixturen overrides KUN i denne scriptets egen browser-context (ikke i den delte
// mockHandlers.js/seedData.js) for ikke at forstyrre notifikations-badgen på tværs
// af hele core-smoke-korpusets skærmbilleder (Layout.jsx's ulæst-tæller er global).
//
//   node tests/e2e/auction-bid-war-reveal.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5199";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../screenshots/3401-auction-reveal"));

const LOST_NOTIFICATION = {
  id: "notif-bidwar-lost",
  user_id: "00000000-0000-4000-8000-000000000001",
  type: "auction_lost",
  title: "You lost the bidding war",
  message: "Northwind Cycling snatched Théo Journal for 340,000 CZ$, 12,000 CZ$ over your top bid of 328,000 CZ$.",
  related_id: "auction-completed-1",
  is_read: false,
  created_at: new Date().toISOString(),
  metadata: {
    riderId: "rider-bidwar",
    titleCode: "notif.auctionLostToRival.title",
    titleParams: {},
    messageCode: "notif.auctionLostToRival.message",
    messageParams: {
      winnerName: "Northwind Cycling",
      rider: "Théo Journal",
      price: 340000,
      overBid: 12000,
      yourMax: 328000,
    },
  },
};

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile-393", width: 393, height: 852 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await stabilizePage(page);
  await login(page);

  // ── 1) Budkrig-modalen (afsluttet auktion, AuctionHistoryPage) ──────────────
  await page.goto("/auctions/history");
  const viewBidWar = page.getByRole("button", { name: "Se budkrigen" });
  await viewBidWar.waitFor();
  await viewBidWar.click();
  await page.getByRole("dialog").waitFor();
  await page.getByText("Vindende bud").waitFor();
  await page.waitForTimeout(150); // font/paint settle
  await page.screenshot({ path: resolve(OUT, `${vp.name}-bidwar-modal.png`), fullPage: false });

  // ── 2) Taber-notifikationen (NotificationsPage) — scoped override for netop
  //      denne side, så det globale ulæst-badge i resten af korpuset er uændret.
  await page.route("**/rest/v1/notifications**", (route) => {
    if (route.request().method() !== "GET") return json(route, []);
    return json(route, [LOST_NOTIFICATION]);
  });
  await page.goto("/notifications");
  await page.getByText("Northwind Cycling").first().waitFor();
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(OUT, `${vp.name}-lost-notification.png`), fullPage: false });

  await context.close();
}

await browser.close();
console.log(`Screenshots -> ${OUT}`);
