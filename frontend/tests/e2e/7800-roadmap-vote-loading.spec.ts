import { expect, test } from "./e2e-base.js";
import { corsHeaders, installNetworkMocks, json, login, stabilizePage, TEST_USER } from "./fixtures.js";

test("roadmap waits for the initial votes before accepting a vote (#7800)", async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== "chromium" || !isMobile, "Android touch regression");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date("2026-11-06T15:00:00Z"));
  await stabilizePage(page);
  await page.addInitScript(() => {
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options) {
      if (typeof options === "object" && options.block === "center") {
        this.setAttribute("data-test-reveal-scrolled", "true");
      }
      scrollIntoView.call(this, options);
    };
  });
  await installNetworkMocks(page);

  const firstRead = Promise.withResolvers<void>();
  const releaseRead = Promise.withResolvers<void>();
  let holdFirstRead = true;
  let writes = 0;
  const storedVotes = new Map();
  await page.route("**/rest/v1/roadmap_votes*", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    if (request.method() === "POST") {
      const vote = request.postDataJSON();
      expect(new URL(request.url()).searchParams.get("on_conflict")).toBe("user_id,item_id");
      expect(vote).toMatchObject({ user_id: TEST_USER.id, item_id: "rm-plan-1", importance_score: 4 });
      storedVotes.set(vote.user_id + ":" + vote.item_id, vote);
      writes += 1;
      return json(route, []);
    }
    const votes = [...storedVotes.values()];
    if (holdFirstRead) {
      holdFirstRead = false;
      firstRead.resolve();
      await releaseRead.promise;
    }
    return json(route, votes);
  });

  await login(page);
  await page.goto("/roadmap?tab=issues");
  await firstRead.promise;
  const row = page.locator("li", { hasText: "Eksempel på et planlagt punkt." });
  const rating = row.getByRole("radio", { name: "4", exact: true });
  try {
    await expect(page.getByText("Eksempel på en bekræftet fejl.")).toBeVisible();
    await page.getByRole("searchbox").fill("Eksempel på et planlagt punkt");
    await page.getByRole("button", { name: /Eksempel på et planlagt punkt/ }).click();
    await expect(page.getByRole("tab", { name: /^Plan/ })).toHaveAttribute("aria-selected", "true");
    await expect(rating).toHaveCount(0);
    await expect(page.getByText(/^Bedømt \d+ af 4$/)).toHaveCount(0);
  } finally {
    releaseRead.resolve();
  }

  await expect(page.getByText("Bedømt 0 af 4")).toBeVisible();
  await expect(row).toHaveAttribute("data-test-reveal-scrolled", "true");
  await rating.tap();
  await expect(row.getByText("Gemt")).toBeVisible();
  await expect(page.getByText("Bedømt 1 af 4")).toBeVisible();
  expect(writes).toBe(1);
  expect(storedVotes.size).toBe(1);
  await page.reload();
  await expect(page.getByText("Bedømt 1 af 4")).toBeVisible();
});
