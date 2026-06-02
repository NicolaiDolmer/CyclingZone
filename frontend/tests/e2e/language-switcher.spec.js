import { expect, test } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

// #787: the language dropdown is a custom (non-native) listbox. It used to open
// strictly downward (mt-1, absolute). In the sidebar footer — which sits at the
// very bottom of a full-height sidebar — the menu opened below the viewport edge
// and the second option ("English") was clipped, so users on a tall sidebar
// could not reach it. The fix renders the menu in a portal with position:fixed
// and flips it upward when there isn't room below.
//
// This runs across all viewport projects: on desktop the visible switcher is the
// sidebar footer (the clipped case — exercises the upward flip); on mobile it is
// the topbar switcher (the downward case). In both the menu must stay fully on
// screen and both options must be reachable.
test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("#787 language dropdown: fully visible and both options reachable", async ({ page }) => {
  await login(page);

  const trigger = page.locator('button[aria-haspopup="listbox"]:visible').first();
  await expect(trigger).toBeVisible();
  await trigger.click();

  const menu = page.locator('ul[role="listbox"]');
  await expect(menu).toBeVisible();

  // Both language options render.
  const options = menu.getByRole("option");
  await expect(options).toHaveCount(2);

  // The menu must sit entirely within the viewport — the regression was the
  // bottom edge spilling past it. Assert against the real boundingBox so a
  // future "always open downward" regression in the footer fails here.
  const vp = page.viewportSize();
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);

  // The option that used to be clipped must be clickable and actually switch the
  // language (trigger label flips to EN).
  await menu.getByRole("option", { name: "English" }).click();
  await expect(menu).toBeHidden();
  // Label is lowercased in the DOM and CSS-uppercased — match case-insensitively.
  await expect(trigger).toContainText(/en/i);
});
