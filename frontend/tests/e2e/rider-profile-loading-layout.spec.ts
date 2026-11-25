import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, TEST_USER } from "./fixtures.js";

test("rider profile keeps its outer width while the rider is loading", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-11T12:00:00Z"));
  await installNetworkMocks(page);
  await page.addInitScript(user => {
    localStorage.setItem("cz_lang", "en");
    localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false, email_marketing: false,
      updated_at: "2026-11-11T12:00:00.000Z",
    }));
    localStorage.setItem("sb-cycling-zone-e2e-auth-token", JSON.stringify({
      access_token: "e2e-access-token", refresh_token: "e2e-refresh-token",
      token_type: "bearer", expires_at: 1794402000, user,
    }));
  }, TEST_USER);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/rest/v1/riders?**", async route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("id") === "eq.rider-1" && query.get("select")?.includes("pcm_id")) {
      await pending;
    }
    await route.fallback();
  });

  await page.goto("/riders/rider-1", { waitUntil: "domcontentloaded" });
  const frame = page.locator("main > div:last-child > div").first();
  try {
    await expect(frame.getByRole("status", { name: /rider/i })).toBeVisible();
    const loadingBox = await frame.boundingBox();
    expect(loadingBox).not.toBeNull();
    release();

    await expect(frame.getByRole("heading", { name: "Ada Pedersen", exact: true })).toBeVisible();
    const readyBox = await frame.boundingBox();
    expect(readyBox).not.toBeNull();
    expect(loadingBox!.width).toBe(readyBox!.width);
    expect(loadingBox!.x).toBe(readyBox!.x);
  } finally {
    release();
  }
});
