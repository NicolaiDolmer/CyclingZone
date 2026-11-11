import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login } from "./fixtures.js";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-11T12:00:00Z"));
  await stabilizePage(page);
  await installNetworkMocks(page);
});

test("returning visitor does not download consent settings until they reopen them", async ({ page }) => {
  const chunks: string[] = [];
  page.on("request", (request) => {
    if (/\/assets\/CookieBanner-[^/]+\.js/.test(request.url())) chunks.push(request.url());
  });
  await login(page);
  await expect(page.getByRole("heading", { name: "E2E Racing", exact: true })).toBeVisible();
  expect(chunks).toHaveLength(0);
  await page.goto("/profile?tab=privacy");
  await page.getByRole("button", { name: "Skift mine valg", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Jeg bruger data til at gøre spillet bedre" });
  await expect(dialog).toBeVisible();
  expect(chunks.length).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "Kun nødvendige", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("new visitor can reject optional consent through the lazy banner", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("cz_consent_v1"));
  await page.goto("/login");
  const dialog = page.getByRole("dialog", { name: "Jeg bruger data til at gøre spillet bedre" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Kun nødvendige", exact: true }).click();
  await expect(dialog).toBeHidden();
  const consent = await page.evaluate(() => JSON.parse(localStorage.getItem("cz_consent_v1")!));
  expect(consent).toMatchObject({ necessary: true, analytics: false, marketing: false, email_marketing: false });
});
