import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

async function target(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect.soft(box!.width).toBeGreaterThanOrEqual(44);
  expect.soft(box!.height).toBeGreaterThanOrEqual(44);
  return box!;
}

async function kitchen(page: Page) {
  await page.goto("/ui");
  await page.getByRole("heading", { name: "Kitchen sink" }).waitFor();
  await page.evaluate(async () => { await document.fonts.ready; });
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.clock.setFixedTime(new Date("2026-11-08T12:00:00Z"));
});

test("P16: buttons, native fields and tabs have real 44px mobile targets", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await kitchen(page);
  for (const control of [
    page.getByRole("button", { name: "Small", exact: true }),
    page.locator("#ks-name"), page.locator("#ks-strat"), page.locator("#ks-note"),
    page.getByRole("tab", { name: "Roster", exact: true }),
  ]) await target(control);

  const input = page.locator("#ks-name");
  const before = await target(input);
  await page.mouse.click(before.x + 2, before.y + 2);
  await expect(input).toBeFocused();
  await input.fill("P16 native input");
  await expect(input).toHaveValue("P16 native input");
  const after = await input.boundingBox();
  expect(after!.width).toBe(before.width);
  expect(after!.height).toBe(before.height);
  await page.locator("#ks-strat").selectOption("sprint");
  await expect(page.locator("#ks-strat")).toHaveValue("sprint");
  await expect(page.getByRole("button", { name: "Disabled", exact: true })).toBeDisabled();
});

test.describe("fine-pointer viewport geometry", () => {
  test.use({ hasTouch: false, isMobile: false });
test("P16: phone boundary includes 640px and leaves desktop geometry unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await kitchen(page);
  const small = page.getByRole("button", { name: "Small", exact: true });
  await target(small);
  await page.setViewportSize({ width: 641, height: 900 });
  await expect.poll(async () => (await small.boundingBox())!.height).toBe(30);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await page.locator("#ks-name").boundingBox())!.height).toBe(38);
  expect((await page.getByRole("tab", { name: "Roster", exact: true }).boundingBox())!.height).toBe(42);
});
});

test.describe("touch phone orientation", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("P16: targets remain 44px when a phone is wider in landscape", async ({ page }) => {
    await page.setViewportSize({ width: 812, height: 375 });
    await kitchen(page);
    await target(page.getByRole("button", { name: "Small", exact: true }));
    await target(page.locator("#ks-name"));
    await target(page.getByRole("tab", { name: "Roster", exact: true }));
  });
});

test("P16: language and dense segmented options keep their own pointer targets", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/login");
  const language = page.locator('button[aria-haspopup="listbox"]').first();
  await target(language);
  await language.click();
  for (const option of await page.getByRole("option").all()) await target(option);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);

  await page.goto("/patch-notes");
  const group = page.locator('[role="group"]').filter({ has: page.locator('button[aria-pressed]') }).first();
  await group.waitFor();
  const buttons = group.locator("button");
  const rectangles = [];
  for (const option of await buttons.all()) rectangles.push(await target(option));
  for (let i = 1; i < rectangles.length; i++) {
    expect(rectangles[i - 1].x + rectangles[i - 1].width).toBeLessThanOrEqual(rectangles[i].x + 0.1);
  }
  const second = buttons.nth(1);
  const box = await target(second);
  await page.mouse.click(box.x + 1, box.y + 1);
  await expect(second).toHaveAttribute("aria-pressed", "true");
  const stable = await second.boundingBox();
  expect(stable!.width).toBe(box.width);
  expect(stable!.height).toBe(box.height);
});

test("P16: column chips remain reachable and do not steal a neighbour's tap", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto("/team");
  await page.locator('button[aria-haspopup="listbox"]:visible').first().click();
  await page.getByRole("option", { name: /English|Engelsk/ }).click();
  await expect(page.getByRole("tab", { name: "Contracts", exact: true })).toBeVisible();
  const tabs = page.getByRole("tablist").first().getByRole("tab");
  for (const tab of await tabs.all()) {
    expect.soft(await tab.evaluate((el) => el.scrollWidth - el.clientWidth), "tab labels must not spill over the next tab").toBeLessThanOrEqual(1);
  }
  const full = page.getByRole("button", { name: /^(Full table|Fuld tabel)$/ }).first();
  await target(full);
  const group = page.getByRole("group", { name: /^(Choose columns|Vælg kolonner)$/ }).first();
  const candidate = group.locator('button[aria-pressed="false"]:not([disabled])').first();
  const chip = group.getByRole("button", { name: (await candidate.textContent())!.trim(), exact: true });
  const box = await target(chip);
  await page.mouse.click(box.x + 2, box.y + box.height / 2);
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await full.click();
  await expect(full).toHaveAttribute("aria-pressed", "true");
  await full.click();
  await expect(full).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("P16: field floor preserves a consumer's larger minimum width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto("/riders");
  const select = page.locator("select.min-w-36").first();
  await select.waitFor();
  // A short option must not collapse the FilterBar's explicit 144px minimum.
  await select.evaluate((el) => el.replaceChildren(new Option("All", "all")));
  expect((await select.boundingBox())!.width).toBeGreaterThanOrEqual(144);
  await target(select);
});
