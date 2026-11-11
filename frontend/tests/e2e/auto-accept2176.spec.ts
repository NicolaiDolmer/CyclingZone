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
import type { Page, TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

async function captureBeta2176(page: Page, info: TestInfo, name: string) {
  const send = page.getByRole("button", { name: "Send", exact: true });
  // Keep the real form action above the fixed mobile navigation in evidence.
  await send.evaluate(element => element.scrollIntoView({ block: "center", inline: "nearest" }));
  await expect(send).toBeInViewport({ ratio: 1 });
  await expect(send).toBeEnabled();
  const navigation = page.locator("[data-mobile-quick-nav]");
  if (await navigation.isVisible()) {
    const [actionBox, navigationBox] = await Promise.all([send.boundingBox(), navigation.boundingBox()]);
    if (!actionBox || !navigationBox) throw new Error("Screenshot actions must have layout boxes");
    expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(navigationBox.y);
  }
  const directory = resolve("../pr-screens/2176-beta");
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${info.project.name}-${name}.png`), fullPage: true });
}

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
async function setup(page: Page, { enabled = true, seller = false, listingEligible = true, offerEligible = true } = {}) {
  await installNetworkMocks(page);
  await stabilizePage(page);
  await page.clock.setFixedTime(new Date("2026-11-09T10:00:00Z"));
  await page.route("**/api/feature-flags", (route) =>
    json(route, { flags: { auto_accept_enabled: enabled } })
  );
  await page.route("**/api/market/auto-accept-config", (route) => json(route, timing));
  await page.route("**/api/transfers", (route) => {
    const row: Partial<ReturnType<typeof listing>> = listing(seller);
    if (!listingEligible) delete row.auto_accept_price;
    return json(route, [row]);
  });
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
              auto_accept_eligible: offerEligible,
            },
          ]
        : [],
    })
  );
  await login(page);
  await page.goto(`/transfers?tab=${seller ? "received" : "market"}`);
  await expect(page.getByRole("button", { name: seller ? "Modbud" : /Ada Pedersen/, exact: seller })).toBeVisible({ timeout: 20000 });
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
  await expect(page.getByTestId("listing-auto-price")).toHaveCount(0);
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
  await expect(dialog.getByTestId("auto-accept-end-updated")).toHaveText(
    "Sluttiden er opdateret. Tjek den, og tryk igen."
  );
  expect(requests).toBe(0);
  await dialog.getByRole("button", { name: "Start auktion", exact: true }).click();
  await expect.poll(() => requests).toBe(1);
});
test("owner 10/11: a changed end time shows the server's time and needs a second click", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  const dialog = await openBuyer(page);
  // The server's clock is 5 minutes ahead of the browser's fixed 10:00:00Z.
  const serverEnd = "2026-11-09T10:35:00.000Z";
  await page.route("**/api/transfers/auto-listing/auto-accept", async (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) {
      await json(route, { errorCode: "auto_accept_end_changed", errorParams: { endsAt: serverEnd, serverNow: "2026-11-09T10:05:00.000Z" } }, 409);
    } else {
      await json(route, { ok: true }, 200);
    }
  });
  await dialog.getByRole("button", { name: "Start auktion", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Auktionens sluttid er ændret");
  await expect(dialog).toContainText("11.35");
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ duration_minutes: 30, expected_end_at: "2026-11-09T10:30:00.000Z" });
  await dialog.getByRole("button", { name: "Start auktion", exact: true }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({ duration_minutes: 30, expected_end_at: serverEnd });
});

type Call = { method: string; url: string; body: Record<string, unknown> | null };
async function setupSeller(
  page: Page,
  { enabled = true, listed = false, autoPrice = 600000, putStatus = 200 } = {}
) {
  const calls: Call[] = [];
  await installNetworkMocks(page);
  await stabilizePage(page);
  await page.route("**/api/feature-flags", (route) =>
    json(route, { flags: { auto_accept_enabled: enabled } })
  );
  const existing = {
    id: "own-listing",
    rider: { id: "rider-1" },
    seller: TEST_TEAM,
    asking_price: 200000,
    auto_accept_price: autoPrice,
    status: "open",
  };
  await page.route("**/api/transfers", (route) => {
    const request = route.request();
    if (request.method() === "GET") return json(route, listed ? [existing] : []);
    if (request.method() !== "POST") return route.fallback();
    const body = request.postDataJSON();
    calls.push({ method: "POST", url: request.url(), body });
    return json(
      route,
      { id: "new-listing", rider: { id: "rider-1" }, asking_price: body.asking_price, status: "open" },
      201
    );
  });
  await page.route("**/api/transfers/*", (route) => {
    const request = route.request();
    if (request.method() !== "PATCH") return route.fallback();
    calls.push({ method: "PATCH", url: request.url(), body: request.postDataJSON() });
    return json(route, { id: "own-listing", status: "open" });
  });
  await page.route("**/api/transfers/*/auto-accept-price", (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    calls.push({ method: "PUT", url: request.url(), body });
    if (putStatus !== 200) {
      return json(route, { errorCode: "auto_accept_price_changed", errorParams: { autoAcceptPrice: 650000 } }, putStatus);
    }
    return json(route, { listing_id: "x", auto_accept_price: body.auto_accept_price, status: "updated" });
  });
  await login(page);
  await page.goto(listed ? "/riders/rider-1" : "/riders/rider-1?sell=1");
  return calls;
}
test("seller sets an optional auto-price, validated against the asking price", async ({ page }) => {
  const calls = await setupSeller(page);
  const price = page.getByTestId("transfer-list-price-input");
  const auto = page.getByTestId("transfer-list-auto-price-input");
  await expect(auto).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/Byder nogen denne pris eller mere/)).toBeVisible();
  const submit = page.getByRole("button", { name: "Sæt til salg", exact: true }).last();
  await price.fill("200000");
  await auto.fill("199999");
  await expect(page.getByTestId("transfer-list-auto-price-error")).toHaveText(
    "Auto-prisen skal være mindst prisen."
  );
  await expect(auto).toHaveAttribute("aria-invalid", "true");
  await expect(submit).toBeDisabled();
  await auto.fill("200000");
  await expect(submit).toBeEnabled();
  await auto.fill("600000");
  await submit.click();
  await expect(page.getByText(/På transferlisten for 200\.000/)).toBeVisible();
  await expect(page.getByTestId("seller-auto-price-status")).toContainText(/Auto-pris 600\.000/);
  expect(calls.map((c) => c.method)).toEqual(["POST", "PUT"]);
  expect(calls[0].body).toMatchObject({ asking_price: 200000 });
  expect(calls[1].url).toContain("/api/transfers/new-listing/auto-accept-price");
  expect(calls[1].body).toEqual({ auto_accept_price: 600000, expected_auto_accept_price: null });
});
test("a failed auto-price save keeps the listing and shows the error", async ({ page }) => {
  await setupSeller(page, { putStatus: 409 });
  const auto = page.getByTestId("transfer-list-auto-price-input");
  await expect(auto).toBeVisible({ timeout: 20000 });
  await page.getByTestId("transfer-list-price-input").fill("200000");
  await auto.fill("600000");
  await page.getByRole("button", { name: "Sæt til salg", exact: true }).last().click();
  await expect(page.getByText(/Auto-prisen blev ikke gemt/)).toBeVisible();
  await expect(page.getByText(/På transferlisten for 200\.000/)).toBeVisible();
});
test("a changed auto-price from another tab is adopted and needs a second explicit save", async ({ page }) => {
  const calls = await setupSeller(page, { listed: true, putStatus: 409 });
  await expect(page.getByText(/På transferlisten for 200.000/)).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Redigér priser", exact: true }).click();
  await page.getByTestId("transfer-list-auto-price-input").fill("700000");
  await page.getByRole("button", { name: "Opdatér priser", exact: true }).click();
  await expect(page.getByText(/Auto-prisen blev ikke gemt/)).toBeVisible();
  await expect(page.getByTestId("seller-auto-price-status")).toContainText(/Auto-pris 650.000/);
  await expect(page.getByTestId("transfer-list-auto-price-input")).toBeVisible();
  await page.getByRole("button", { name: "Opdatér priser", exact: true }).click();
  await expect.poll(() => calls.filter((c) => c.method === "PUT").length).toBe(2);
  expect(calls.filter((c) => c.method === "PUT")[1].body).toEqual({ auto_accept_price: 700000, expected_auto_accept_price: 650000 });
});
test("seller edits and removes the auto-price on an existing listing", async ({ page }) => {
  const calls = await setupSeller(page, { listed: true });
  await expect(page.getByText(/På transferlisten for 200\.000/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("seller-auto-price-status")).toContainText(/Auto-pris 600\.000/);
  await page.getByRole("button", { name: "Redigér priser", exact: true }).click();
  const auto = page.getByTestId("transfer-list-auto-price-input");
  await expect(auto).toHaveValue("600000");
  await expect(page.getByText("En ny auto-pris gælder kun nye bud.")).toBeVisible();
  // Raising the asking price sets the auto-price first, so the asking price never passes the old one.
  await page.getByTestId("transfer-list-price-input").fill("250000");
  await auto.fill("700000");
  await page.getByRole("button", { name: "Opdatér priser", exact: true }).click();
  await expect(page.getByTestId("seller-auto-price-status")).toContainText(/Auto-pris 700\.000/);
  expect(calls.map((c) => c.method)).toEqual(["PUT", "PATCH"]);
  expect(calls[0].body).toEqual({ auto_accept_price: 700000, expected_auto_accept_price: 600000 });
  // Empty field removes the auto-price.
  await page.getByRole("button", { name: "Redigér priser", exact: true }).click();
  await auto.fill("");
  await page.getByRole("button", { name: "Opdatér priser", exact: true }).click();
  await expect(page.getByTestId("seller-auto-price-status")).toHaveCount(0);
  const last = calls[calls.length - 1];
  expect(last.method).toBe("PUT");
  expect(last.body).toEqual({ auto_accept_price: null, expected_auto_accept_price: 700000 });
});
test("OFF: the seller form has no auto-price field and the old button label", async ({ page }) => {
  const calls = await setupSeller(page, { enabled: false, listed: true });
  await expect(page.getByRole("button", { name: "Redigér pris", exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Redigér pris", exact: true }).click();
  await expect(page.getByTestId("transfer-list-price-input")).toBeVisible();
  await expect(page.getByTestId("transfer-list-auto-price-input")).toHaveCount(0);
  await expect(page.getByTestId("seller-auto-price-status")).toHaveCount(0);
  expect(calls).toHaveLength(0);
});
test("an eligible buyer sees the approved auto-price row", async ({ page }, info) => {
  await setup(page);
  await page.getByRole("button", { name: /Ada Pedersen/ }).click();
  const row = page.getByTestId("listing-auto-price");
  await expect(row).toContainText("Auto-pris (starter auktion)");
  await expect(row).toContainText(/600\.000/);
  if (process.env.BETA2176_SCREENSHOTS) {
    // Clicking a far-right action scrolls the existing wide table. Bring its
    // first columns back into view, as a user can, before capturing evidence.
    await row.evaluate((element) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent.scrollWidth > parent.clientWidth) parent.scrollLeft = 0;
      }
    });
    await expect(row).toBeInViewport();
    await captureBeta2176(page, info, "eligible");
  }
});

for (const enabled of [false, true]) test(`beta-ineligible pair, viewer flag=${enabled}: ordinary negotiation without auto-price`, async ({ page }, info) => {
  await setup(page, { enabled, listingEligible: false });
  await page.getByRole("button", { name: /Ada Pedersen/ }).click();
  await expect(page.getByTestId("listing-auto-price")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start auktion", exact: true })).toHaveCount(0);
  if (process.env.BETA2176_SCREENSHOTS) {
    await page.getByRole("button", { name: /Ada Pedersen/ }).evaluate((element) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent.scrollWidth > parent.clientWidth) parent.scrollLeft = 0;
      }
    });
    await captureBeta2176(page, info, `ineligible-${enabled}`);
  }
});

test("beta seller and non-beta counterparty can negotiate above the hidden auto-price", async ({ page }, info) => {
  await setup(page, { seller: true, offerEligible: false });
  await page.getByRole("button", { name: "Modbud", exact: true }).click();
  const amount = page.getByLabel("Dit modbud (CZ$)");
  await amount.fill("700000");
  await expect(page.getByTestId("auto-counter-prices")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  if (process.env.BETA2176_SCREENSHOTS) {
    await captureBeta2176(page, info, "ordinary-counter");
  }
});
