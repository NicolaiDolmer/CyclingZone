// Local before/after evidence using the real page and deterministic API fixtures.
// node tests/e2e/4860-sponsor-activation.shots.ts http://127.0.0.1:4860 before|after
import { chromium, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { installNetworkMocks, TEST_USER, json } from "./fixtures.js";
import { generateOffers } from "../../../backend/lib/sponsorOffers.js";

const baseURL = process.argv[2];
const stage = process.argv[3];
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(baseURL || "") || !["before", "after"].includes(stage)) {
  throw new Error("Expected localhost URL and before|after");
}
const out = resolve("../pr-screens/4860", stage);
mkdirSync(out, { recursive: true });
const contract = {
  sponsor_name: "Corvus Aviation", variant: "results", status: "active",
  guaranteed_base: 336000, guaranteed_fraction: 0.6, race_day_share: 0.12,
  per_race_day_rate: 480, length_seasons: 2, start_season: 4, expires_after_season: 5,
  signed_division: 3, activation_division: 2, bonus_clauses: [], results_bonus_paid: 0,
};
const offers = {
  negotiable: true, upcomingSeasonNumber: 4, pendingVariant: null, teamDivision: 2,
  stageCounts: { byTier: { 1: 140, 2: 140, 3: 140, 4: 140 }, fallbackDays: 140 },
  offers: generateOffers({ teamId: "sponsor-evidence", seasonNumber: 4, renownTargetValue: 560000, calendarDays: 140 }),
};
const browser = await chromium.launch();
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, locale: "en-US", serviceWorkers: "block" });
    try {
      // No external request may escape the fixture layer, including websocket traffic.
      await context.route("**/*", (route) => {
        const host = new URL(route.request().url()).hostname;
        return ["127.0.0.1", "localhost"].includes(host) ? route.continue() : route.abort();
      });
      await context.routeWebSocket(/.*/, (socket) => socket.close());
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await installNetworkMocks(page);
      await page.route("**/api/sponsor/contract", (route) => json(route, { contract, earnings: null, season: { number: 4, stagesTotal: 140, transactions: [] } }));
      await page.route("**/api/sponsor/offers", (route) => json(route, offers));
      await page.addInitScript(() => {
        localStorage.setItem("cz_lang", "en");
        localStorage.setItem("cz_consent_v1", JSON.stringify({ version: 1, necessary: true, analytics: false, marketing: false, email_marketing: false, updated_at: "2026-09-15T00:00:00Z" }));
      });
      await page.goto("/login");
      await page.getByPlaceholder(/email/i).fill(TEST_USER.email);
      await page.getByPlaceholder("••••••••").fill("playwright-password");
      await page.getByRole("button", { name: /log in/i }).click();
      await page.waitForURL(/\/dashboard$/);
      for (const tab of ["deal", "next"]) {
        await page.goto(`/sponsors?tab=${tab}`);
        await expect(page.getByRole("heading", { name: "Sponsors", level: 1 })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Sponsors", level: 1 })).toHaveCSS("font-size", "20px");
        await expect(page.getByText(tab === "deal" ? "Corvus Aviation" : offers.offers[0].sponsorName).first()).toBeVisible();
        if (tab === "deal") {
          await expect(page.getByText("Division adjustment", { exact: true })).toHaveCount(stage === "before" ? 1 : 0);
        }
        if (stage === "after" && tab === "next") {
          await expect(page.getByText(/Amounts are finalised when season 4 starts/)).toBeVisible();
        }
        await page.screenshot({ path: resolve(out, `${tab}-${width}.png`), fullPage: false });
      }
      if (errors.length) throw new Error(errors.join("\n"));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`Verified ${stage} sponsor screenshots at desktop and 390px: ${out}`);
