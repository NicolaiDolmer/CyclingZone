import { expect, test } from "./e2e-base.js";
import {
  installNetworkMocks,
  json,
  login,
  stabilizePage,
  TEST_TEAM,
  RIVAL_TEAM,
  RIDERS,
} from "./fixtures.js";
import type { Page } from "@playwright/test";
const timing = {
  weekday_open_hour: 8,
  weekday_close_hour: 24,
  weekend_open_hour: 8,
  weekend_close_hour: 24,
};
const rider = {
  ...RIDERS[0],
  id: "auto-rider",
  firstname: "Ada",
  lastname: "Pedersen",
  nationality_code: "dk",
};
function listing(own = false, price = 600000) {
  return {
    id: "auto-listing",
    rider,
    seller: own ? TEST_TEAM : RIVAL_TEAM,
    asking_price: 200000,
    auto_accept_price: price,
    status: "open",
  };
}
async function setup(page: Page, { enabled = true, seller = false } = {}) {
  await installNetworkMocks(page);
  await stabilizePage(page);
  await page.clock.setFixedTime(new Date("2026-11-09T10:00:00Z"));
  await page.route("**/api/feature-flags", (route) =>
    json(route, { flags: { auto_accept_enabled: enabled } })
  );
  await page.route("**/api/market/auto-accept-config", (route) => json(route, timing));
  await page.route("**/api/transfers", (route) => json(route, [listing(seller)]));
  await page.route("**/api/transfers/my-offers", (route) =>
    json(route, {
      sent: [],
      received: seller
        ? [
            {
              id: "auto-offer",
              rider,
              buyer: RIVAL_TEAM,
              offer_amount: 300000,
              status: "pending",
              round: 1,
            },
          ]
        : [],
    })
  );
  await login(page);
  await page.goto(`/transfers?tab=${seller ? "received" : "market"}`);
}
async function openBuyer(page: Page) {
  await setup(page);
  await page.getByRole("button", { name: /Ada Pedersen/ }).click();
  await page.getByRole("button", { name: "Start auktion", exact: true }).click();
  return page.getByRole("dialog");
}
test("OFF preserves direct negotiations and shows no start dialog", async ({ page }) => {
  await setup(page, { enabled: false });
  await page.getByRole("button", { name: /Ada Pedersen/ }).click();
  await expect(page.getByRole("button", { name: "Start auktion", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("seller cannot send a counter at or above the current auto-price", async ({ page }) => {
  await setup(page, { seller: true });
  await page.getByRole("button", { name: "Modbud", exact: true }).click();
  await expect(page.getByTestId("auto-counter-prices")).toContainText("Listepris");
  const amount = page.getByLabel("Dit modbud (CZ$)");
  await amount.fill("599999");
  await expect(page.getByRole("button", { name: "Send modbud", exact: true })).toBeEnabled();
  await amount.fill("600000");
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "Send modbud", exact: true })).toBeDisabled();
  await expect(page.getByText("Kun køberen kan starte den.")).toBeVisible();
  await amount.fill("700000");
  await expect(page.getByRole("button", { name: "Send modbud", exact: true })).toBeDisabled();
});
test("buyer uses free active duration, immediate end preview and Escape", async ({ page }) => {
  const dialog = await openBuyer(page);
  await expect(dialog.getByLabel("Dit bud (CZ$)")).toHaveValue("600000");
  await expect(dialog).toContainText("Dit bud binder pengene, så længe du fører.");
  await expect(dialog).toContainText("08:00-24:00");
  await dialog.getByLabel("timer", { exact: true }).fill("0");
  await dialog.getByLabel("min", { exact: true }).fill("29");
  await expect(dialog.getByRole("button", { name: "Start auktion", exact: true })).toBeDisabled();
  await dialog.getByLabel("min", { exact: true }).fill("30");
  await expect(dialog.getByRole("button", { name: "Start auktion", exact: true })).toBeEnabled();
  await expect(dialog).toContainText("11.30");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
test("a stale price refresh requires a second explicit submit", async ({ page }) => {
  const bodies: unknown[] = [];
  const dialog = await openBuyer(page);
  await page.route("**/api/transfers/auto-listing/auto-accept", async (route) => {
    bodies.push(route.request().postDataJSON());
    await json(
      route,
      { errorCode: "auto_accept_price_changed", errorParams: { autoAcceptPrice: 700000 } },
      409
    );
  });
  await page.route("**/api/transfers", (route) => json(route, [listing(false, 700000)]));
  await dialog.getByRole("button", { name: "Start auktion", exact: true }).click();
  await expect(dialog.getByLabel("Dit bud (CZ$)")).toHaveValue("700000");
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({
    expected_price: 600000,
    bid_amount: 600000,
    duration_minutes: 30,
  });
});
test("rapid submissions reserve the editable bid once and cannot dismiss pending", async ({
  page,
}) => {
  let count = 0;
  let finish: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const dialog = await openBuyer(page);
  await page.route("**/api/transfers/auto-listing/auto-accept", async (route) => {
    count++;
    expect(route.request().postDataJSON()).toMatchObject({
      expected_price: 600000,
      bid_amount: 800000,
    });
    await wait;
    await json(route, { status: "started", auction_id: "auction-test" }, 201);
  });
  await dialog.getByLabel("Dit bud (CZ$)").fill("800000");
  await dialog.locator("form").evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect.poll(() => count).toBe(1);
  await expect(dialog.getByRole("link", { name: "Ada Pedersen" })).toHaveCount(0);
  await expect(dialog.getByText("Ada Pedersen", { exact: true })).toHaveAttribute(
    "aria-disabled",
    "true"
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Annuller", exact: true }).last()).toBeDisabled();
  finish?.();
  await expect(dialog).toHaveCount(0);
  expect(count).toBe(1);
});

test("crossing closing time refreshes Ends before a binding submit", async ({ page }) => {
  const dialog = await openBuyer(page);
  await page.clock.setFixedTime(new Date("2026-11-09T22:29:45Z"));
  // Refresh the preview clock without any commitment first.
  await dialog.getByRole("button", { name: "Start auktion", exact: true }).click();
  await expect(dialog).toContainText("23.59");
  let requests = 0;
  await page.route("**/api/transfers/auto-listing/auto-accept", async (route) => {
    requests++;
    await json(route, { errorCode: "auto_accept_rider_unavailable" }, 409);
  });
  await page.clock.setFixedTime(new Date("2026-11-09T22:30:05Z"));
  await dialog.getByRole("button", { name: "Start auktion", exact: true }).click();
  await expect(dialog).toContainText("08.00");
  expect(requests).toBe(0);
  await dialog.getByRole("button", { name: "Start auktion", exact: true }).click();
  await expect.poll(() => requests).toBe(1);
});
