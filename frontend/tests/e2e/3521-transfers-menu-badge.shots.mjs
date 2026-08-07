// #3521 — screenshots af Transfers-menupunktets ulæst-badge (ubesvarede
// indgående tilbud). Ad-hoc capture-script (ikke en del af CI-suiten;
// testMatch fanger kun *.spec.js). Kører mod en kørende preview/dev-server
// med e2e-netværksmocks. /api/inbox/pending overrides KUN i denne scriptets
// egen browser-context (ikke i den delte mockHandlers.js) for ikke at
// forstyrre de øvrige skærmbillleder i korpuset, som forventer 0 pending
// (Layout.jsx's badge-tæller er global, samme mønster som auction-bid-war-
// reveal.shots.mjs bruger for notifikations-badgen).
//
//   node tests/e2e/3521-transfers-menu-badge.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, json, corsHeaders, TEST_TEAM } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5199";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

// To ubesvarede indgående tilbud (én transfer, én swap) — samme shape som
// backend/lib/inboxPending.js returnerer, og som NotificationsPage allerede
// konsumerer. Total = 2, så badgen viser "2" (ikke "9+"-loftet).
const PENDING_INBOX = {
  transfer_offers: [
    {
      id: "offer-e2e-1",
      kind: "transfer_offer",
      role: "seller_decide",
      rider_id: "rider-1",
      rider_name: "Ada Pedersen",
      counterparty_team_name: "Northwind Cycling",
      price: 185000,
      updated_at: "2026-08-06T18:20:00.000Z",
      link: "/transfers",
    },
  ],
  swap_offers: [
    {
      id: "swap-e2e-1",
      kind: "swap_offer",
      role: "receiving_decide",
      offered_rider_id: "rider-2",
      offered_rider_name: "Théo Journal",
      requested_rider_id: "rider-3",
      requested_rider_name: "Sofie Rye",
      counterparty_team_name: "Alpenwerk Pro",
      cash_adjustment: 0,
      updated_at: "2026-08-06T18:27:00.000Z",
      link: "/transfers",
    },
  ],
  counts: { transfer_offers: 1, swap_offers: 1, total: 2 },
};

async function installPendingInboxMock(page) {
  await page.route("**/api/inbox/pending**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, PENDING_INBOX);
  });
}

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
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await installPendingInboxMock(page);
  await stabilizePage(page);
  await login(page);

  if (vp.name === "desktop") {
    // Marked-gruppen er lukket by default på /dashboard (kun Klubhus-gruppen
    // matcher ruten) — åbn den for at afsløre Transfers-punktet + badgen.
    await page.getByRole("button", { name: "Marked" }).click();
    await page.getByRole("link", { name: /^Transfers/ }).first().waitFor();
    await page.waitForTimeout(150); // font/paint settle
    await page.locator("aside:visible").first().screenshot({ path: resolve(OUT, `3521-desktop-sidebar-badge.png`) });
  } else {
    // Mobil: hamburger-drawer indeholder samme SidebarContent — åbn menu +
    // Marked-gruppen for at vise badgen i mobil-navigationen.
    await page.getByRole("button", { name: "Åbn menu" }).click();
    await page.getByRole("button", { name: "Marked" }).click();
    await page.getByRole("link", { name: /^Transfers/ }).first().waitFor();
    await page.waitForTimeout(150);
    await page.locator("aside:visible").first().screenshot({ path: resolve(OUT, `3521-mobile-drawer-badge.png`) });
  }

  await context.close();
}

await browser.close();
console.log(`[3521] Screenshots skrevet til ${OUT} (team ${TEST_TEAM.id})`);
