// academy.spec.js — Playwright smoke-test for AcademyPage (#1308).
//
// Verificerer at siden renderer intake-kandidater + sign-knapper + slot-tæller
// via mock-data fra fixtures.js (academy/me-respons med 3 kandidater + 2 roster-ryttere).

import { expect, test } from "@playwright/test";
import {
  installNetworkMocks,
  login,
  stabilizePage,
} from "./fixtures.js";

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("academy page renders intake candidates, slot counter, and roster", async ({ page }) => {
  await login(page);
  await page.goto("/academy");

  // Slot-tæller
  await expect(page.locator("main")).toContainText(/Academy.*2.*\/.*8|Akademi.*2.*\/.*8/i);

  // Intake-sektion
  await expect(page.locator("main")).toContainText(/Intake|intake/i);

  // Serious prospect-badge (Emil Kristiansen er is_serious=true)
  await expect(page.locator("main")).toContainText(/Serious|Seriøs/i);

  // Sign + Reject-knapper (mindst én af hvert)
  await expect(page.getByRole("button", { name: /Sign|Signer/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Reject|Afvis/i }).first()).toBeVisible();

  // Roster-sektion — Jonas Svensson + Luca Morel
  await expect(page.locator("main")).toContainText(/Roster|roster|Akademihold/i);

  // Free-agent-sektion (#1308 Fase B) — frie ungdomsryttere + "Sign to academy"-knap
  await expect(page.locator("main")).toContainText(/Free youth agents|Frie ungdomsryttere/i);
  await expect(page.locator("main")).toContainText(/Noah Berg/i);
  await expect(page.getByRole("button", { name: /Sign to academy|Signér til akademi/i }).first()).toBeVisible();
});

test("academy page shows disabled state gracefully when flag is off", async ({ page }) => {
  // Override academy/me til at returnere 409 academy_disabled.
  await page.route("**/api/academy/me**", route => {
    const req = route.request();
    if (req.method() === "OPTIONS") {
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "academy_disabled" }),
    });
  });

  await login(page);
  await page.goto("/academy");

  // Graceful disabled state — ingen JS-crash, heading vises
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Academy|Akademi/i })).toBeVisible();
  // Ingen intake-kandidat-grid rendret
  await expect(page.getByRole("button", { name: /Sign|Signer/i })).toHaveCount(0);
});
