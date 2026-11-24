import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, json, login, stabilizePage } from "./fixtures.js";
import { SEED_ACADEMY } from "../../src/preview/seedData.js";
import { join } from "node:path";

const shots = process.env.ACADEMY_PRE_BETA_SHOTS;
const before = shots && process.env.ACADEMY_PRE_BETA_BEFORE === "1";
const profile = {
  tier: 2,
  candidatesPerWeek: 3,
  slots: { origins: 1, types: 1, extra: 0 },
  options: { nations: ["dk", "fr"], regions: [], types: ["climber"], delayDays: 14 },
  active: { origins: ["dk"], types: ["climber"], effectiveFrom: "2026-11-01" },
};
const current = {
  seasonId: "s5", seasonNumber: 5, isCurrent: true,
  offerSignings: 12000, youthAuctionBuys: 49000, drift: 0, salesCount: 8,
  salesProceeds: 116000, net: 55000,
};
const earlier = {
  seasonId: "s4", seasonNumber: 4, isCurrent: false,
  offerSignings: 3000, youthAuctionBuys: 24000, drift: 2000, salesCount: 1,
  salesProceeds: 12000, net: -17000,
};
const total = {
  offerSignings: 15000, youthAuctionBuys: 73000, drift: 2000, salesCount: 9,
  salesProceeds: 128000, net: 38000,
};
const sales = Array.from({ length: 9 }, (_, index) => ({
  riderId: `sale-${index + 1}`,
  riderName: ["Théo Dubois", "Luca Morel", "Axel Bergström", "Marco De Luca", "Jonas Svensson",
    "Ada Pedersen", "Mads Nielsen", "Noah Larsen", "Sam Rivera"][index],
  soldAt: `2026-11-${22 - index}T12:00:00Z`,
  via: index % 2 ? "auction" : "transfer",
  origin: index % 2 ? "offer" : "youthAuction",
  price: index === 8 ? 12000 : 14500,
  seasonId: index === 8 ? "s4" : "s5",
  seasonNumber: index === 8 ? 4 : 5,
}));

for (const width of [1440, 390]) {
  test(`academy overview, profile and ledger before beta at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installNetworkMocks(page);
    await stabilizePage(page);
    await page.clock.setFixedTime(new Date("2026-11-24T10:00:00Z"));
    await page.route("**/api/feature-flags**", (route) =>
      json(route, { flags: { academy_page_v2_8081: true } }));
    await page.route("**/api/academy/me**", (route) => json(route, {
      ...SEED_ACADEMY,
      intake: [],
      roster: SEED_ACADEMY.roster.map((rider) => ({ ...rider, squad: "u23" })),
      academyProfile: profile,
    }));
    await page.route("**/api/academy/v2/age-focus", (route) => json(route, {
      tier: 2, unlocked: true, active: { ageFocus: "17" }, pending: null, options: ["16", "17", "18", "19"],
    }));
    await page.route("**/api/academy/profile", (route) => {
      expect(route.request().postDataJSON()).toEqual({ origins: ["fr"], types: ["climber"] });
      return json(route, { ok: true, effectiveFrom: "2026-12-08" });
    });
    let releaseOrigins = () => {};
    const waitForOrigins = new Promise<void>((resolve) => { releaseOrigins = resolve; });
    await page.route("**/rest/v1/academy_intake?**", async (route) => {
      await waitForOrigins;
      return json(route, SEED_ACADEMY.roster.map((rider) => ({ id: rider.id, rider_id: rider.id })));
    });
    await page.route("**/api/academy/pnl**", (route) => json(route, {
      ledger: { seasons: [current, earlier], total, sales, showDrift: true, driftIsHistoric: true },
    }));

    const shot = async (name: string) => {
      if (shots) await page.screenshot({ path: join(shots, `${before ? "before" : "after"}-${name}-${width}.png`), animations: "disabled" });
    };
    await login(page);
    await page.goto("/academy");
    const academy = page.getByTestId("academy-v2");
    await expect(academy).toBeVisible();
    try {
      const talents = academy.getByRole("tab", { name: "Dine talenter" });
      await talents.click();
      const busy = academy.getByRole("status", { name: "Dine talenter" });
      await expect(busy).toHaveAttribute("aria-busy", "true");
      if (!before) await expect(busy.locator(".cz-skeleton-static")).toHaveCount(6);
      await shot("loading");
    } finally {
      releaseOrigins();
    }
    await expect(academy.getByRole("link", { name: "Jonas Svensson" })).toBeVisible();
    if (!before) {
      await expect(academy.locator('a[href="/academy/graduation"]')).toHaveCount(0);
      if (width === 1440) await expect(academy.getByRole("columnheader", { name: "Nationalitet" })).toBeVisible();
    }
    await shot("talents");

    const ageRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/academy/v2/")) ageRequests.push(request.url());
    });
    await academy.getByRole("tab", { name: before ? "Profil og alder" : "Profil", exact: true }).click();
    const profileCard = academy.getByTestId("academy-profile");
    await expect(profileCard).toBeVisible();
    await shot("profile");
    if (!before) {
      await expect(academy.getByText(/aldersfokus|forventet optag pr\. alder/i)).toHaveCount(0);
      await profileCard.locator("#academy-profile-origin").selectOption("fr");
      await profileCard.getByRole("button", { name: /gem/i }).click();
      await expect(profileCard.getByText(/^Gemt/)).toBeVisible();
      expect(ageRequests).toEqual([]);
    }

    await academy.getByRole("tab", { name: "Akademi-regnskab" }).click();
    const ledger = academy.getByTestId("academy-ledger-tab");
    await expect(ledger.getByText("Alle sæsoner", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(ledger.getByText("+38.000 CZ$", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(ledger.getByRole("link", { name: "Théo Dubois" })).toHaveAttribute("href", "/riders/sale-1");
    await expect(ledger.getByRole("link", { name: "Sam Rivera" })).toHaveCount(0);
    const salesHeading = ledger.getByRole("heading", { name: before ? "Salg af akademiryttere" : "Salg af ryttere hentet som unge" });
    await expect(salesHeading).toBeVisible();
    if (!before) await expect(ledger.getByRole("table")).toHaveCount(2);
    await shot("ledger");
    if (shots) {
      await salesHeading.evaluate((heading) => heading.scrollIntoView({ block: "center" }));
      await shot("sales");
    }
    await ledger.getByRole("button", { name: "Vis alle 9 salg" }).click();
    await expect(ledger.getByRole("link", { name: "Sam Rivera" })).toBeVisible();
    if (!before) {
      const salesTable = ledger.getByRole("table", { name: "Salg af ryttere hentet som unge" });
      await salesTable.getByRole("columnheader", { name: "Dato" }).click();
      await expect(salesTable.getByRole("row").nth(1)).toContainText("Sam Rivera");
      if (width === 390) {
        await ledger.getByTestId("table-columns-open").nth(1).click();
        const columns = page.getByRole("dialog", { name: "Kolonner" });
        const origin = columns.getByRole("button", { name: "Kom fra" });
        await origin.click();
        await expect(origin).toHaveAttribute("aria-pressed", "true");
        await columns.getByRole("button", { name: "Luk", exact: true }).click();
        await expect(salesTable.getByRole("columnheader", { name: "Kom fra" })).toBeVisible();
      }
    }
  });
}
