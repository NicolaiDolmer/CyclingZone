import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

async function expectContactMatchesNavItem(page) {
  const nav = page.locator("nav:visible").first();
  const contact = nav.getByRole("button", { name: /^(Contact|Kontakt)$/i });
  const navItem = nav.getByRole("link", { name: /^(Settings|Indstillinger)$/i });
  await expect(contact).toBeVisible();
  await expect(navItem).toBeVisible();

  const [contactRect, navItemRect, scroll] = await Promise.all([
    contact.evaluate((element) => {
      const { x, width } = element.getBoundingClientRect();
      return { x, width };
    }),
    navItem.evaluate((element) => {
      const { x, width } = element.getBoundingClientRect();
      return { x, width };
    }),
    nav.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })),
  ]);

  expect(contactRect.x).toBeCloseTo(navItemRect.x, 0);
  expect(contactRect.width).toBeCloseTo(navItemRect.width, 0);
  expect(scroll.scrollWidth).toBe(scroll.clientWidth);
}

test("Contact matches a NavItem's width and inset on desktop (#6904)", async ({ page, isMobile }) => {
  test.skip(isMobile, "Covered by the mobile drawer test");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.goto("/dashboard");
  await expectContactMatchesNavItem(page);
});

test("Contact matches a NavItem's width and inset in the 375px mobile menu (#6904)", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Covered by the desktop sidebar test");
  await page.setViewportSize({ width: 375, height: 844 });
  await login(page);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /menu/i }).click();
  await expectContactMatchesNavItem(page);
});
