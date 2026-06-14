import { expect, test } from "@playwright/test";
import { installNetworkMocks, stabilizePage } from "./fixtures.js";

// Verificér at den altid-aktive boundary (#671 Plan 3) fanger en render-fejl i
// en PROD preview-build (ingen Sentry-DSN i e2e -> foer Plan 3 var boundary'en
// disabled her -> white-screen) og render den branded fallback paa
// ErrorState/Button. stabilizePage saetter cz_lang=da -> DA-copy.
test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("error-boundary fanger render-fejl og viser branded fallback (DA)", async ({ page }) => {
  await page.goto("/ui?boom=1");
  await page.getByRole("button", { name: "Trigger render error" }).click();

  // Branded fallback (DA, render-fejl-variant) — IKKE white-screen.
  // role="alert" -> fallback'en er en alert-region; ErrorState's titel er en <p>.
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("Siden kunne ikke vises")).toBeVisible();
  await expect(page.getByRole("button", { name: "Genindlæs siden" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prøv igen" })).toBeVisible();
  // Ingen eventId-linje naar Sentry er disabled (e2e har ingen DSN).
  await expect(page.getByText(/Fejl-id:/)).toHaveCount(0);
});

test("fallback render i EN naar cz_lang=en", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  await page.goto("/ui?boom=1");
  await page.getByRole("button", { name: "Trigger render error" }).click();
  await expect(page.getByText("The page could not be shown")).toBeVisible();
});
