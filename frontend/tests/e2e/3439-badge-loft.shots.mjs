// #3439 — screenshots af notifikations-badgens hævede loft ("99+" i stedet
// for det gamle "9+"). Ad-hoc capture-script (ikke en del af CI-suiten;
// testMatch fanger kun *.spec.js), samme mønster som
// 3521-transfers-menu-badge.shots.mjs. Overrider KUN notifications-tællingen
// i denne scriptets egen browser-context (Layout.jsx's fetchUnreadCount
// bruger en HEAD-request med Prefer: count=exact — kun Content-Range-headeren
// læses, body er ligegyldig).
//
//   node tests/e2e/3439-badge-loft.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, corsHeaders, TEST_TEAM } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5185";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

// 142 ulæste notifikationer → badgen skal vise "99+" (over det nye loft),
// ikke det gamle "9+"-loft fra før #3439.
const UNREAD_COUNT = 142;

async function installUnreadCountMock(page) {
  await page.route("**/rest/v1/notifications**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        ...corsHeaders(request),
        "Content-Range": `0-0/${UNREAD_COUNT}`,
      },
      body: "[]",
    });
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
  await installUnreadCountMock(page);
  await stabilizePage(page);
  await login(page);

  if (vp.name === "desktop") {
    await page.getByRole("link", { name: /^Indbakke/ }).first().waitFor();
    await page.waitForTimeout(150); // font/paint settle
    await page.locator("aside:visible").first().screenshot({ path: resolve(OUT, `3439-desktop-sidebar-badge.png`) });
  } else {
    // Mobil topbar-klokken (badge uden for hamburger-drawer'et) + drawer'ets
    // eget badge under samme item.
    await page.locator("nav.fixed.bottom-0").first().waitFor();
    await page.waitForTimeout(150);
    await page.locator("nav.fixed.bottom-0").first().screenshot({ path: resolve(OUT, `3439-mobile-quicknav-badge.png`) });

    await page.getByRole("button", { name: "Åbn menu" }).click();
    await page.getByRole("link", { name: /^Indbakke/ }).first().waitFor();
    await page.waitForTimeout(150);
    await page.locator("aside:visible").first().screenshot({ path: resolve(OUT, `3439-mobile-drawer-badge.png`) });
  }

  await context.close();
}

await browser.close();
console.log(`[3439] Screenshots skrevet til ${OUT} (team ${TEST_TEAM.id})`);
