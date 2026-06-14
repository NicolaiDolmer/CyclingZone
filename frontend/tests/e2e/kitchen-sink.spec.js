import { expect, test } from "@playwright/test";
import { installNetworkMocks, stabilizePage } from "./fixtures.js";

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("kitchen-sink renders all primitives", async ({ page }) => {
  await page.goto("/ui");
  await expect(page.getByRole("heading", { name: "Kitchen sink" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Place bid" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open auction" })).toBeVisible();
  await expect(page).toHaveScreenshot("kitchen-sink.png", {
    animations: "disabled",
    caret: "hide",
    scale: "css",
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
