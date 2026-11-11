import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, TEST_USER, json, login } from "./fixtures.js";
const NOW = new Date("2026-11-11T12:00:00Z");
const key = "sb-cycling-zone-e2e-auth-token";
const session = {
  access_token: "e2e-access-token",
  refresh_token: "e2e-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: NOW.getTime() / 1000 + 3600,
  user: TEST_USER,
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await stabilizePage(page);
  await installNetworkMocks(page);
});

test("legacy session without marker never paints marketing, migrates, and survives refresh", async ({
  page,
  context,
}) => {
  await page.addInitScript(
    ({ key, session }) => {
      if (!localStorage.getItem(`${key}:cookie-migrated`))
        localStorage.setItem(key, JSON.stringify(session));
      const observe = () => {
        const hero = document.querySelector("#main > section h1");
        if (location.pathname === "/" && hero && getComputedStyle(hero).visibility !== "hidden")
          sessionStorage.setItem("marketing-painted", "1");
        requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
    },
    { key, session }
  );
  await page.goto("/?utm_source=auth-regression");
  await expect(page).toHaveURL(/\/dashboard\?utm_source=auth-regression$/);
  await expect(page.getByRole("heading", { name: "E2E Racing", exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("marketing-painted"))).toBeNull();
  expect((await context.cookies()).some((c) => c.name === key || c.name === `${key}.0`)).toBe(true);
  expect((await context.cookies()).some((c) => c.name === "cz_session")).toBe(false);
  await page.reload();
  await expect(page.getByRole("heading", { name: "E2E Racing", exact: true })).toBeVisible();
});

test("expired refresh resolves to login with a quiet static transition and no marketing", async ({
  page,
}, info) => {
  await page.addInitScript(
    ({ key, session }) => localStorage.setItem(key, JSON.stringify(session)),
    { key, session: { ...session, expires_at: 1 } }
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/auth/v1/token?**", async (route) => {
    await gate;
    await json(route, { error: "invalid_grant", error_description: "Refresh token expired" }, 400);
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  try {
    await expect(page.locator('[data-auth-loading="static"]')).toBeVisible();
    expect(
      await page
        .locator("[data-auth-loading] span")
        .first()
        .evaluate((el) => getComputedStyle(el).animationName)
    ).toBe("none");
    await page.screenshot({ path: `../pr-screens/5250/after-${info.project.name}.png` });
  } finally {
    release();
  }
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByPlaceholder("din@email.dk")).toBeVisible();
});

test("fresh password login uses cookies and direct team link remains intact", async ({
  page,
  context,
}) => {
  await login(page);
  expect((await context.cookies()).some((c) => c.name === key || c.name === `${key}.0`)).toBe(true);
  expect(await page.evaluate((key) => localStorage.getItem(`${key}:cookie-migrated`), key)).toBe(
    "bridge"
  );
  await page.goto("/team");
  await expect(page).toHaveURL(/\/team$/);
  await expect(
    page.getByRole("heading", { name: "E2E Racing", exact: true }).first()
  ).toBeVisible();
});

test("anonymous root retains public landing", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#main > section h1")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("logout clears cookies and legacy state, then root is anonymous", async ({
  page,
  context,
}) => {
  await page.route("**/auth/v1/logout**", (route) => route.fulfill({ status: 204 }));
  await login(page);
  await expect(page.getByRole("heading", { name: "E2E Racing", exact: true })).toBeVisible();
  const menu = page.getByRole("button", { name: /^Åbn menu/ });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Log ud", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(
    (await context.cookies()).some((c) => c.name === key || c.name.startsWith(`${key}.`))
  ).toBe(false);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
  await page.goto("/");
  await expect(page.locator("#main > section h1")).toBeVisible();
});

test("old-tab storage logout invalidates the real cookie in an open new tab", async ({
  page,
  context,
}) => {
  await login(page);
  const other = await context.newPage();
  try {
    await other.route("**/*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>Storage event fixture</body></html>",
      })
    );
    await other.goto(new URL("/old-tab-fixture", page.url()).href);
    await other.evaluate((key) => localStorage.removeItem(key), key);
    await expect
      .poll(async () =>
        (await context.cookies()).some((c) => c.name === key || c.name.startsWith(`${key}.`))
      )
      .toBe(false);
    await page.goto("/");
    await expect(page.locator("#main > section h1")).toBeVisible();
  } finally {
    await other.close();
  }
});

test("expired access token with working refresh reaches dashboard", async ({ page }, info) => {
  await page.addInitScript(
    ({ key, session }) => {
      if (!localStorage.getItem(`${key}:cookie-migrated`))
        localStorage.setItem(key, JSON.stringify(session));
    },
    { key, session: { ...session, access_token: "old-access-token", expires_at: 1 } }
  );
  const refreshed = page.waitForResponse("**/auth/v1/token?**");
  await page.goto("/");
  await refreshed;
  await expect(page.getByRole("heading", { name: "E2E Racing", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).access_token, key)
  ).toBe("e2e-access-token");
  await page.screenshot({ path: `../pr-screens/5250/dashboard-${info.project.name}.png` });
});

test('implicit email callback reaches the app without marketing and clears the token fragment', async ({ page }) => {
  await page.goto('/#access_token=e2e-access-token&refresh_token=e2e-refresh-token&expires_in=3600&token_type=bearer&type=signup');
  await expect(page.getByRole('heading', { name: 'E2E Racing', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/dashboard');
  expect(new URL(page.url()).hash).toBe('');
});

test('expired email callback still reaches login rather than marketing', async ({ page }) => {
  await page.goto('/#error=access_denied&error_code=otp_expired&error_description=Expired');
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
  await expect(page.getByPlaceholder('din@email.dk')).toBeVisible();
});
