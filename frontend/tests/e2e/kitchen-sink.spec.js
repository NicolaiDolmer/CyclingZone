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
  await expect(page.getByRole("tab", { name: "Roster" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open dialog" })).toBeVisible();
  await expect(page.getByText("Open beta · Free to play")).toBeVisible();
  await expect(page.getByRole("progressbar").first()).toBeVisible();
  // #3684: farve-ankerets tilstedeværelse — uden denne sektion er der INGEN
  // umaskeret flade hvor statColor-rampen kan fejle en pixel-diff.
  await expect(page.getByRole("heading", { name: "Stat colours (#3684)" })).toBeVisible();
  // Eget ELEMENT-snapshot med stram tolerance: i fullPage-billedet drukner de
  // 12 små plader i 0.02-ratioen (negativ-test 18/8: en helt grå plade-rampe
  // passerede). Element-billedet er ~sektionens egne pixels, så et tabt fyld,
  // en flyttet rampe eller forkert blæk IKKE kan gemme sig i tolerancen.
  await expect(page.getByTestId("stat-colours")).toHaveScreenshot("stat-colours.png", {
    animations: "disabled",
    caret: "hide",
    scale: "css",
    maxDiffPixels: 50,
  });
  await expect(page).toHaveScreenshot("kitchen-sink.png", {
    animations: "disabled",
    caret: "hide",
    scale: "css",
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
