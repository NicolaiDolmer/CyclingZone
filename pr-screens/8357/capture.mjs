// Run with the before and after E2E static servers and mock builds.
// node pr-screens/8357/capture.mjs http://127.0.0.1:5198 http://127.0.0.1:5199
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { AUCTIONS, installNetworkMocks, json, login, stabilizePage, TEST_TEAM } from "../../frontend/tests/e2e/fixtures.js";

const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const out = fileURLToPath(new URL("./", import.meta.url));
const origins = process.argv.slice(2).map((arg) => new URL(arg).origin);
if (origins.length !== 2 || origins.some((origin) => new URL(origin).hostname !== "127.0.0.1")) {
  throw new Error("Supply the before and after local E2E preview URLs.");
}

const leading = { id: "mock-leading", current_price: 120000 };
const proxy = { auction_id: "mock-proxy", max_amount: 45000, auction: { status: "active" } };
const mockAuctions = [
  { ...AUCTIONS[0], ...leading, current_bidder_id: TEST_TEAM.id, current_bidder: { id: TEST_TEAM.id, name: TEST_TEAM.name } },
  { ...AUCTIONS[0], id: proxy.auction_id },
];
const formatted = (value) => new Intl.NumberFormat("da-DK").format(value);
const locked = leading.current_price + proxy.max_amount;
const available = TEST_TEAM.balance - locked;
const sale = { id: "mock-sale", amount: 75000, riders: [] };
const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const descriptions = {
  dashboard: ["Beløbet kunne bruges, men hed Balance.", "Hovedtallet har nu samme navn som i menuen."],
  sidebar: ["Hovedtallet var hele kontosaldoen.", "Til rådighed øverst. Bud og salgsprovenu står på hver sin linje."],
  auctions: ["Kontosaldo og binding stod på samme linje.", "Til rådighed er størst. Bindingen står lige under."],
};

async function installBalanceMocks(page) {
  await installNetworkMocks(page);
  await page.route("**/rest/v1/auctions?**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    const columns = query.get("select") ?? "";
    if (query.get("current_bidder_id") === `eq.${TEST_TEAM.id}` && columns === "id,current_price") {
      return json(route, [leading]);
    }
    if (columns.startsWith("id,rider_id,current_price,") && query.get("status")?.includes("active")) {
      return json(route, mockAuctions);
    }
    return route.fallback();
  });
  await page.route("**/rest/v1/auction_proxy_bids?**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    return query.get("team_id") === `eq.${TEST_TEAM.id}` ? json(route, [proxy]) : route.fallback();
  });
  await page.route("**/api/me/locked-sales", (route) => (
    route.request().method() === "GET" ? json(route, { sales: [sale] }) : route.fallback()
  ));
}

async function capture(page, selector, padding = 0) {
  const box = await selector.boundingBox();
  const { width, height } = page.viewportSize();
  const x = Math.max(0, Math.floor(box.x - padding));
  const y = Math.max(0, Math.floor(box.y - padding));
  return page.screenshot({
    animations: "disabled",
    clip: {
      x, y,
      width: Math.min(width, Math.ceil(box.x + box.width + padding)) - x,
      height: Math.min(height, Math.ceil(box.y + box.height + padding)) - y,
    },
  });
}

async function takeShots(browser, origin, viewport, after) {
  const context = await browser.newContext({ baseURL: origin, viewport, serviceWorkers: "block", locale: "da-DK" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  try {
    // The page mocks take priority. Any unmatched external request stays local to the browser.
    await context.route("**/*", (route) => (
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    ));
    await context.routeWebSocket("**/*", (ws) => ws.close());
    await stabilizePage(page);
    await installBalanceMocks(page);
    await login(page);
    const dashboardBalance = page.locator('main a[href="/finance"]').filter({ has: page.locator("p.text-xl") });
    await expect(dashboardBalance).toContainText(formatted(available), { timeout: 15_000 });
    if (after) await expect(dashboardBalance).toContainText(`${formatted(locked)} CZ$ låst i bud`);
    const dashboard = await capture(page, dashboardBalance, 12);

    if (viewport.width === 390) await page.getByRole("button", { name: /Åbn menu/i }).click();
    const sidebar = page.locator("aside:visible").first();
    const sidebarBalance = sidebar.getByTestId("locked-sales-line").locator("..");
    await expect(sidebarBalance).toContainText(formatted(sale.amount));
    await expect(sidebarBalance).toContainText(formatted(after ? available : TEST_TEAM.balance));
    if (after) await expect(sidebarBalance).toContainText(`${formatted(locked)} CZ$ låst i bud`);
    const sidebarShot = await capture(page, sidebarBalance);

    await page.goto("/auctions");
    const auctionsBalance = page.getByTestId("auctions-ticker").locator("..");
    await expect(auctionsBalance).toContainText(formatted(after ? available : TEST_TEAM.balance));
    await expect(auctionsBalance).toContainText(after
      ? `${formatted(locked)} CZ$ låst i bud`
      : `Reserveret i bud ${formatted(locked)} CZ$`);
    const auctions = await capture(page, auctionsBalance.locator(".."), 8);
    return { dashboard, sidebar: sidebarShot, auctions };
  } catch (err) {
    const headings = await page.getByRole("heading").allTextContents();
    throw new Error(`${origin} at ${viewport.width}px: ${headings.join(" | ")}. Browser errors: ${pageErrors.join(" | ")}`, { cause: err });
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();
try {
  const shots = [];
  for (const viewport of viewports) {
    shots.push(await Promise.all(origins.map((origin, index) => takeShots(browser, origin, viewport, index === 1))));
  }
  const sheet = await browser.newPage({ viewport: { width: 940, height: 200 } });
  for (const [surface, captions] of Object.entries(descriptions)) {
    const title = { dashboard: "Dashboard", sidebar: "Sidebjælke", auctions: "Auktioner" }[surface];
    const rows = shots.map((pair, row) => `
      <h2>${viewports[row].width} px</h2>
      <section>${pair.map((frame, side) => `
        <figure>
          <figcaption>${side ? "Efter" : "Før"} · ${captions[side]}</figcaption>
          <img src="data:image/png;base64,${frame[surface].toString("base64")}" />
        </figure>`).join("")}</section>`).join("");
    await sheet.setContent(`<html lang="da"><meta charset="utf-8"><style>
      * { box-sizing: border-box; } body { margin: 0; padding: 24px; font: 14px system-ui; color: #142134; background: #f0f3f7; }
      h1 { margin: 0 0 4px; font-size: 23px; } p { margin: 0; color: #44536a; }
      h2 { margin: 20px 0 6px; font-size: 14px; } section { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      figure { margin: 0; padding: 12px; border: 1px solid #c0c9d7; border-radius: 5px; background: #fff; }
      figcaption { min-height: 36px; font-weight: 600; } img { display: block; max-width: 100%; height: auto; }
    </style><h1>${title}</h1><p>MOCK · Fiktive beløb</p>${rows}</html>`);
    await sheet.locator("body").screenshot({ path: join(out, `${surface}-before-after.png`) });
  }
} finally {
  await browser.close();
}
