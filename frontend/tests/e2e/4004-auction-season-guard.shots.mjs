// #4004 (ejer-revision 21/8) — screenshots af de to nye elementer:
// (a) pre-bid-varsel i bud-bekræftelsen når auktionen slutter efter søndagens
//     værdi-refresh, (b) fejlbesked ved oprettelse når auktionen ville krydse
//     transfer-vinduets lukketid (sæsonskifte-guarden).
//
// Fixturens login()-flow kræver DA (danske placeholders, se fixtures.js's
// stabilizePage-kommentar), så disse skærmbilleder er på dansk — samme
// sprog som resten af repoets *.shots.mjs-scripts (fx vk-auction-signals),
// der alle bruger bilingual regex frem for at forsøge at overstyre sproget.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js), mønster kopieret fra vk-auction-signals.shots.mjs /
// auction-startprice-typo-guard.spec.js.
//
//   node tests/e2e/4004-auction-season-guard.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, json, corsHeaders } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const { AUCTIONS } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/seedData.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5199";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

// Scenarie A: auktionen slutter langt i fremtiden (10 dage) — garanteret efter
// næste søndags værdi-refresh uanset hvornår scriptet kører.
const LONG_RUNNING_AUCTION = {
  ...AUCTIONS[0],
  calculated_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
};

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 393, height: 852 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

// ── Scenarie A: pre-bid-varsel i bud-bekræftelsen ────────────────────────────
for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    locale: "da-DK",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);

  await page.route("**/rest/v1/auctions**", (route) => {
    const request = route.request();
    if (request.method() !== "GET" || request.url().includes("status=eq.completed")) {
      return route.fallback();
    }
    return json(route, [LONG_RUNNING_AUCTION]);
  });

  await stabilizePage(page);
  await login(page);

  await page.goto("/auctions");
  await page.getByTestId("auctions-ticker").waitFor();

  const scope = page.locator(vp.name === "desktop" ? "table" : ".md\\:hidden");
  await scope.getByRole("button", { name: /^(Place bid|Afgiv bud)$/ }).first().waitFor();
  await scope.getByRole("button", { name: /^(Place bid|Afgiv bud)$/ }).first().click();

  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByText(/settles after Sunday's value update|afsluttes efter søndagens værdi-opdatering/i).waitFor();
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(OUT, `4004-bid-confirm-value-update-notice-${vp.name}.png`), fullPage: false });

  await context.close();
}

// ── Scenarie B: sæsonskifte-guarden afviser en for-lang auktion ─────────────
for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    locale: "da-DK",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);

  // Ingen aktiv auktion på rider-1 (Ada Pedersen, egen rytter) — samme
  // override-mønster som auction-startprice-typo-guard.spec.js.
  await page.route("**/rest/v1/auctions*", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, []);
  });
  // Mock selve POST /api/auctions til at svare med guardens 400.
  await page.route("**/api/auctions", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Auctions can't end after the transfer window closes (23/08 22:00)",
        errorCode: "auction_end_crosses_window_close",
        errorParams: { closesAt: "23/08 22:00" },
      }),
    });
  });

  await stabilizePage(page);
  await login(page);

  await page.goto("/riders/rider-1");
  await page.getByRole("button", { name: /^(Put up for auction|Sæt til auktion)$/ }).first().waitFor();
  await page.getByRole("button", { name: /^(Put up for auction|Sæt til auktion)$/ }).first().click();

  await page.getByRole("button", { name: /^(Start auction|Start auktion)$/ }).first().waitFor();
  await page.getByRole("button", { name: /^(Start auction|Start auktion)$/ }).first().click();

  await page.getByText(/transfer window closes|transfervinduet lukker/i).first().waitFor();
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(OUT, `4004-season-boundary-guard-error-${vp.name}.png`), fullPage: false });

  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
