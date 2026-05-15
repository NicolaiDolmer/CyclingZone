import { expect, test } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

const CORE_PAGES = [
  { path: "/dashboard", heading: "E2E Racing", snapshot: "dashboard.png" },
  { path: "/riders", heading: "Rytterdatabase", snapshot: "riders.png" },
  { path: "/auctions", heading: "Auktioner", snapshot: "auctions.png" },
  { path: "/team", heading: "E2E Racing", snapshot: "team.png" },
  { path: "/finance", heading: "Finanser", snapshot: "finance.png" },
  { path: "/board", heading: "Bestyrelse", snapshot: "board.png" },
  { path: "/seasons", heading: /Sæson/, snapshot: "seasons.png" },
  { path: "/notifications", heading: "Indbakke", snapshot: "inbox.png" },
];

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("login redirects authenticated manager to dashboard", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "E2E Racing" })).toBeVisible();
});

test("root path redirects to dashboard", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("core manager pages render without blank screens", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await login(page);

  for (const spec of CORE_PAGES) {
    await page.goto(spec.path);
    await expect(page.getByRole("heading", { name: spec.heading }).first()).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("VITE_API_URL is not set");
    await expect(page).toHaveScreenshot(spec.snapshot, {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      // Tolerate små intentional UI-tilføjelser (fx ny tekst-linje, ikon-justering).
      // Smoke-testen skal fange "blank-screen / katastrofale layout-fejl", ikke
      // hver kosmetisk tweak — separate visual-regression suites tager nuance.
      maxDiffPixelRatio: 0.03,
    });
  }

  expect(pageErrors).toEqual([]);
});
